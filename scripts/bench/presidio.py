"""Step 2 of `pnpm bench:presidio`: run Microsoft Presidio over the stripped corpus.
Also step 2 of `pnpm bench:gretel`, on the Gretel sample.

Reads reports/presidio-input.json (written by export-corpus.ts) and writes
reports/presidio-raw.json with, per file and per configuration, the anonymized
text (default `replace` operator, so `<PERSON>` and so on) and the spans that
were replaced, with entity types and scores.

Language per file comes from the file name suffix: `-en` runs the English
pipeline, `-es` the Spanish one, `-mixed` runs both and passes the union of
the results to the anonymizer, which resolves overlaps the way it always does.

Three configurations run:
  default       Presidio's shipped NER settings, which drop spaCy ORG entities
                (`labels_to_ignore` lists ORGANIZATION, "has many false positives").
  default_tld   the same, on a copy of each text where the reserved test TLD
                `.example` is rewritten to `-exa.com` (same length, so offsets
                hold). Presidio's email and URL recognizers check the TLD and
                reject `.example`, which real mail never uses, so without this
                the email and URL rows measure the corpus convention, not Presidio.
  with_org_tld  default_tld with ORGANIZATION no longer ignored, so org recall
                has a Presidio number at all.
  with_org      ORGANIZATION on, text as written. Not run on blind's corpus by default.
                It is the with_org_tld equivalent for text that does not use `.example`,
                such as the Gretel sample (`pnpm bench:gretel`), where the rewrite would
                only damage real-looking hosts like www.example.com.
`--configs` picks a subset, `--input` and `--out` another input, both for bench:gretel.
The anonymized text is always rebuilt over the original text from the replaced
spans, so a value Presidio leaves alone keeps its `.example` and is scored as
it was written.
Everything else is Presidio's default: every predefined recognizer enabled in
default_recognizers.yaml for en and es, score threshold 0, replace operator,
MERGE_SIMILAR_OR_CONTAINED conflict resolution, whitespace merging.

Offsets in the output are UTF-16 code units, to line up with JavaScript.
Run it with the venv in .local/presidio-venv, see scripts/bench/RESULTS.md.
"""

import argparse
import copy
import json
import platform
import re
import sys
import time
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import yaml
from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import ConflictResolutionStrategy

import presidio_analyzer

MODELS = {"en": "en_core_web_lg", "es": "es_core_news_lg"}
# name: (ignore ORGANIZATION, rewrite .example)
CONFIGS = {"default": (True, False), "default_tld": (True, True), "with_org_tld": (False, True), "with_org": (False, False)}
CONFIG_NOTES = {
    "default": "Presidio default NER settings (ORGANIZATION ignored), corpus text as written",
    "default_tld": "default, with .example rewritten to -exa.com before analysis",
    "with_org_tld": "default_tld with ORGANIZATION removed from labels_to_ignore",
    "with_org": "ORGANIZATION removed from labels_to_ignore, text as written",
}
LANGS = {"en": ["en"], "es": ["es"], "mixed": ["en", "es"]}


def nlp_configuration(ignore_org: bool) -> dict:
    conf_dir = Path(presidio_analyzer.__file__).parent / "conf"
    with open(conf_dir / "default.yaml") as fh:
        default = yaml.safe_load(fh)
    ner = copy.deepcopy(default["ner_model_configuration"])
    if not ignore_org:
        ner["labels_to_ignore"] = [x for x in ner["labels_to_ignore"] if x not in ("ORG", "ORGANIZATION")]
    return {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": lang, "model_name": name} for lang, name in MODELS.items()],
        "ner_model_configuration": ner,
    }


def build(ignore_org: bool) -> tuple[AnalyzerEngine, list[str]]:
    nlp = NlpEngineProvider(nlp_configuration=nlp_configuration(ignore_org)).create_engine()
    registry = RecognizerRegistry(supported_languages=list(MODELS))
    registry.load_predefined_recognizers(languages=list(MODELS), nlp_engine=nlp)
    analyzer = AnalyzerEngine(nlp_engine=nlp, registry=registry, supported_languages=list(MODELS))
    names = sorted({f"{r.name}:{r.supported_language}" for r in registry.recognizers})
    return analyzer, names


def utf16_offsets(text: str) -> list[int]:
    """offs[i] is the UTF-16 offset of code point i, offs[len] the total length."""
    offs = [0]
    for ch in text:
        offs.append(offs[-1] + (2 if ord(ch) > 0xFFFF else 1))
    return offs


TLD_RE = re.compile(r"\.example(?![A-Za-z0-9])", re.IGNORECASE)


def rewrite_tld(text: str) -> str:
    out = TLD_RE.sub("-exa.com", text)
    assert len(out) == len(text)
    return out


def rebuild(text: str, spans) -> str:
    """The replace operator's output, applied to `text`: each span becomes <ENTITY>."""
    out, at = [], 0
    for r in sorted(spans, key=lambda x: x.start):
        out.append(text[at:r.start])
        out.append(f"<{r.entity_type}>")
        at = r.end
    out.append(text[at:])
    return "".join(out)


def run_file(analyzer: AnalyzerEngine, anonymizer: AnonymizerEngine, original: str, lang: str, tld: bool) -> dict:
    text = rewrite_tld(original) if tld else original
    results = []
    seen = set()
    for language in LANGS.get(lang, ["en"]):
        for r in analyzer.analyze(text=text, language=language):
            key = (r.start, r.end, r.entity_type)
            if key in seen:
                continue
            seen.add(key)
            results.append(r)
    anon = anonymizer.anonymize(text=text, analyzer_results=results)
    # The spans the anonymizer actually replaced, in input offsets. Same steps
    # anonymize() runs before it operates, on a copy.
    final = anonymizer._copy_recognizer_results(results)
    final.sort(key=lambda x: (x.start, x.end))
    final = anonymizer._remove_conflicts_and_get_text_manipulation_data(final, ConflictResolutionStrategy.MERGE_SIMILAR_OR_CONTAINED)
    final = anonymizer._merge_entities_with_spaces_between(text, final)
    rebuilt = rebuild(original, final)
    if not tld and rebuilt != anon.text:
        raise SystemExit("rebuilt text differs from the anonymizer output")
    offs = utf16_offsets(text)

    def span(r) -> dict:
        return {"start": offs[r.start], "end": offs[r.end], "entity": r.entity_type, "score": round(r.score, 4)}

    return {
        "anonymized": rebuilt,
        "replaced": [span(r) for r in sorted(final, key=lambda x: (x.start, x.end))],
        "detected": [span(r) for r in sorted(results, key=lambda x: (x.start, x.end, x.entity_type))],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="reports/presidio-input.json")
    ap.add_argument("--out", default="reports/presidio-raw.json")
    ap.add_argument("--configs", default="default,default_tld,with_org_tld", help="comma-separated subset of " + ", ".join(CONFIGS))
    args = ap.parse_args()
    files = json.loads(Path(args.input).read_text("utf8"))["files"]
    anonymizer = AnonymizerEngine()
    configs = {}
    recognizers = {}
    for name in args.configs.split(","):
        if name not in CONFIGS:
            raise SystemExit(f"unknown config {name}")
        ignore_org, tld = CONFIGS[name]
        analyzer, recognizers[name] = build(ignore_org)
        t0 = time.time()
        out = {}
        for f in files:
            out[f["name"]] = run_file(analyzer, anonymizer, f["text"], f["lang"], tld)
        configs[name] = {"seconds": round(time.time() - t0, 1), "files": out}
        print(f"{name}: {len(files)} files in {configs[name]['seconds']} s", file=sys.stderr)
    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "versions": {p: version(p) for p in ("presidio-analyzer", "presidio-anonymizer", "spacy", *MODELS.values())},
        "models": MODELS,
        "languagePerSuffix": LANGS,
        "input": args.input,
        "configs": {k: v for k, v in CONFIG_NOTES.items() if k in configs},
        "recognizers": recognizers,
        "scoreThreshold": 0,
        "operator": "replace",
        "conflictResolution": "MERGE_SIMILAR_OR_CONTAINED",
        "offsets": "utf16",
    }
    Path(args.out).write_text(json.dumps({"meta": meta, "configs": configs}, ensure_ascii=False, indent=1) + "\n", "utf8")
    print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
