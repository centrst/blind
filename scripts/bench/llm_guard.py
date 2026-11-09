"""Historical benchmark source, retained to document the published measurements.

LLM Guard execution is retired: its archived release pins vulnerable dependencies.
There is no supported install command. See RESULTS-llmguard-gretel.md.

Run LLM Guard's Anonymize scanner over the same texts the Presidio step reads.

Formerly step 2 of `pnpm bench:llmguard` (blind's corpus) and of `pnpm bench:gretel` (the Gretel
sample). Reads an input file in the shape export-corpus.ts writes ({files: [{name, lang,
text}]}) and writes, per configuration and per file, the sanitized text and the spans that
were replaced, in the shape presidio.py writes, so scripts/bench/score.ts and
score-gretel.ts can score both the same way.

Only the public API is used to anonymize: `Anonymize(vault, ...)` and `scan(text)`, then
`Deanonymize(vault).scan(text, sanitized)`. One fresh vault per file, the way one
conversation would hold one vault. Anonymize writes placeholders such as
`[REDACTED_PERSON_1]` and keeps the originals in the vault, but returns no offsets. The
spans are recovered by walking the sanitized text: text between placeholders must equal
the input at the same place, and each placeholder stands for its vault value. A file where
that walk fails, because LLM Guard changed something outside a placeholder or one
placeholder stands for text that is not its vault value, is listed under `outsideChanges`
and aligned with difflib instead.

Configurations:
  default      Anonymize(vault) as shipped: its default entity list, its default recognizer
               (Isotonic/deberta-v3-base_finetuned_ai4privacy_v2 in llm-guard 0.3.16), the
               default threshold 0.5, on the text as written.
  default_tld  the same, on a copy where `.example` becomes `-exa.com` (same length, as in
               presidio.py), to test whether the reserved test TLD changes LLM Guard's email
               or URL detection.
  all          every entity type the scanner's analyzer supports for "en", which is the
               broadest list the docs point to (LLM Guard's defaults, Presidio's supported
               entities, LLM Guard's regex patterns). It adds ORGANIZATION, LOCATION,
               DATE_TIME, URL, PRICE_RE, DATE_RE, TIME_RE and more.
  all_tld      all, with the `.example` rewrite.
In the _tld configurations the spans are applied over the original text, as presidio.py
does, and the round trip is checked against the rewritten text LLM Guard saw.

Language: Anonymize supports only "en" and "zh". Every file runs with "en", including the
Spanish and mixed ones.

Offsets in the output are UTF-16 code units, to line up with JavaScript.
Run it with `python -I`, so this file does not shadow the `llm_guard` package it imports.
"""

import argparse
import copy
import difflib
import json
import platform
import re
import sys
import time
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

from llm_guard.input_scanners import Anonymize
from llm_guard.input_scanners.anonymize import DEFAULT_ENTITY_TYPES
from llm_guard.input_scanners.anonymize_helpers import DEBERTA_AI4PRIVACY_v2_CONF
from llm_guard.output_scanners import Deanonymize
from llm_guard.util import configure_logger
from llm_guard.vault import Vault

CONFIGS = {
    "default": {"entities": "default", "tld": False},
    "default_tld": {"entities": "default", "tld": True},
    "all": {"entities": "all", "tld": False},
    "all_tld": {"entities": "all", "tld": True},
}
LANGUAGE = "en"

TLD_RE = re.compile(r"\.example(?![A-Za-z0-9])", re.IGNORECASE)


def rewrite_tld(text: str) -> str:
    out = TLD_RE.sub("-exa.com", text)
    assert len(out) == len(text)
    return out


def utf16_offsets(text: str) -> list[int]:
    """offs[i] is the UTF-16 offset of code point i, offs[len] the total length."""
    offs = [0]
    for ch in text:
        offs.append(offs[-1] + (2 if ord(ch) > 0xFFFF else 1))
    return offs


def entity_of(placeholder: str) -> str:
    m = re.fullmatch(r"\[REDACTED_(.+)_(\d+)\]", placeholder)
    return m.group(1) if m else placeholder


def align_strict(text: str, sanitized: str, vault_items: list[tuple]) -> list[tuple[int, int, str]] | None:
    """Spans (start, end, placeholder) in `text`, or None when the sanitized text is not
    the input with each placeholder standing for its vault value."""
    values = {}
    for ph, val in vault_items:
        values.setdefault(ph, val)
    if not values:
        return [] if sanitized == text else None
    pattern = re.compile("|".join(re.escape(p) for p in sorted(values, key=len, reverse=True)))
    spans = []
    pos = 0
    at = 0
    for m in pattern.finditer(sanitized):
        literal = sanitized[at:m.start()]
        if text[pos:pos + len(literal)] != literal:
            return None
        pos += len(literal)
        val = values[m.group(0)]
        if text[pos:pos + len(val)] != val:
            return None
        spans.append((pos, pos + len(val), m.group(0)))
        pos += len(val)
        at = m.end()
    if text[pos:] != sanitized[at:]:
        return None
    return spans


def align_fallback(text: str, sanitized: str, vault_items: list[tuple]) -> tuple[list[tuple[int, int, str]], list[dict]]:
    """difflib alignment for files the strict walk rejects. Returns spans and the edits
    that touch no placeholder, which are changes outside the placeholders."""
    pattern = re.compile("|".join(re.escape(p) for p, _ in vault_items)) if vault_items else None
    sm = difflib.SequenceMatcher(None, text, sanitized, autojunk=False)
    spans, outside = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        found = pattern.search(sanitized, j1, j2) if pattern else None
        if found and i2 > i1:
            spans.append((i1, i2, found.group(0)))
        else:
            outside.append({"op": op, "start": i1, "end": i2, "inserted": len(sanitized[j1:j2])})
    return spans, outside


def rebuild(text: str, spans: list[tuple[int, int, str]]) -> str:
    out, at = [], 0
    for s, e, ph in sorted(spans):
        out.append(text[at:s])
        out.append(ph)
        at = e
    out.append(text[at:])
    return "".join(out)


def clear(vault: Vault) -> None:
    for item in list(vault.get()):
        vault.remove(item)


def run_file(scanner: Anonymize, vault: Vault, original: str, tld: bool) -> dict:
    text = rewrite_tld(original) if tld else original
    clear(vault)
    t0 = time.perf_counter()
    sanitized, _valid, _risk = scanner.scan(text)
    seconds = time.perf_counter() - t0
    items = list(vault.get())
    restored, _, _ = Deanonymize(vault).scan(text, sanitized)

    spans = align_strict(text, sanitized, items)
    outside = None
    if spans is None:
        spans, outside = align_fallback(text, sanitized, items)
    # A placeholder for an empty value replaces nothing. Count it, keep it out of the spans.
    empty = [s for s in spans if s[0] == s[1]]
    spans = [s for s in spans if s[0] < s[1]]

    # Over the text LLM Guard scanned, so the .example rewrite cannot split one value in two.
    by_placeholder: dict[str, set[str]] = {}
    for s, e, ph in spans:
        by_placeholder.setdefault(ph, set()).add(text[s:e])
    collapsed = sorted(ph for ph, vals in by_placeholder.items() if len(vals) > 1)

    offs = utf16_offsets(original)
    return {
        "anonymized": rebuild(original, spans) if outside is None or tld else sanitized,
        "replaced": [
            {"start": offs[s], "end": offs[e], "entity": entity_of(ph), "placeholder": ph}
            for s, e, ph in sorted(spans)
        ],
        "roundTrip": restored == text,
        "collapsedPlaceholders": collapsed,
        "emptyPlaceholders": len(empty),
        "outsideChanges": outside,
        "seconds": round(seconds, 4),
    }


def recognizer_conf(device: str) -> dict:
    conf = copy.deepcopy(DEBERTA_AI4PRIVACY_v2_CONF)
    if device == "cpu":
        import torch

        conf["DEFAULT_MODEL"].pipeline_kwargs["device"] = torch.device("cpu")
    return conf


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="reports/presidio-input.json")
    ap.add_argument("--out", default="reports/llmguard-raw.json")
    ap.add_argument("--configs", default=",".join(CONFIGS), help="comma-separated subset of " + ", ".join(CONFIGS))
    ap.add_argument("--device", default="auto", choices=["auto", "cpu"], help="auto is LLM Guard's own choice (cuda, then mps, then cpu)")
    ap.add_argument("--limit", type=int, default=0, help="first N files only, for a quick check")
    args = ap.parse_args()
    configure_logger(log_level="ERROR", stream=sys.stderr)

    files = json.loads(Path(args.input).read_text("utf8"))["files"]
    if args.limit:
        files = files[: args.limit]
    wanted = [c for c in args.configs.split(",") if c]
    for c in wanted:
        if c not in CONFIGS:
            raise SystemExit(f"unknown config {c}")

    vault = Vault()
    t0 = time.perf_counter()
    probe = Anonymize(vault, recognizer_conf=recognizer_conf(args.device), language=LANGUAGE)
    load_seconds = round(time.perf_counter() - t0, 1)
    # The analyzer's own list of every entity it can return for "en". `_analyzer` is
    # private, but this is the list, not a behaviour change.
    all_entities = sorted(e for e in probe._analyzer.get_supported_entities(LANGUAGE) if e != "CUSTOM")
    model = DEBERTA_AI4PRIVACY_v2_CONF["DEFAULT_MODEL"]
    device = str(model.pipeline_kwargs["device"]) if args.device == "auto" else "cpu"

    configs, entity_lists = {}, {}
    for name in wanted:
        cfg = CONFIGS[name]
        entities = None if cfg["entities"] == "default" else list(all_entities)
        scanner = Anonymize(vault, entity_types=copy.copy(entities), recognizer_conf=recognizer_conf(args.device), language=LANGUAGE)
        entity_lists[name] = sorted(e for e in scanner._entity_types if e != "CUSTOM")
        scanner.scan("Warm-up text for Jane Example, jane@acme-exa.com.")
        out = {}
        t1 = time.perf_counter()
        for f in files:
            out[f["name"]] = run_file(scanner, vault, f["text"], cfg["tld"])
        total = time.perf_counter() - t1
        per_file = [r["seconds"] for r in out.values()]
        configs[name] = {
            "seconds": round(total, 1),
            "secondsPerFile": round(sum(per_file) / max(1, len(per_file)), 4),
            "files": out,
        }
        bad = sum(1 for r in out.values() if r["outsideChanges"] is not None)
        rt = sum(1 for r in out.values() if r["roundTrip"])
        print(f"{name}: {len(files)} files in {configs[name]['seconds']} s, round trip {rt}/{len(files)}, outside changes in {bad} files", file=sys.stderr)

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "input": args.input,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "device": device,
        "modelLoadSeconds": load_seconds,
        "versions": {p: version(p) for p in ("llm-guard", "presidio-analyzer", "presidio-anonymizer", "transformers", "torch", "spacy", "en_core_web_sm")},
        "recognizer": {"path": model.path, "revision": model.revision},
        "threshold": 0.5,
        "language": LANGUAGE,
        "defaultEntityTypes": DEFAULT_ENTITY_TYPES,
        "entityTypes": entity_lists,
        "configs": {
            "default": "Anonymize(vault) as shipped, text as written",
            "default_tld": "default, with .example rewritten to -exa.com before scanning",
            "all": "entity_types = every entity the analyzer supports for en",
            "all_tld": "all, with .example rewritten to -exa.com before scanning",
        },
        "roundTrip": "Deanonymize(vault).scan(text, sanitized) == text, with text the input LLM Guard scanned",
        "offsets": "utf16",
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"meta": meta, "configs": configs}, ensure_ascii=False, indent=1) + "\n", "utf8")
    print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
