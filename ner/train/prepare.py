"""Builds the training data and the held-out score inputs.

    python -I ner/train/prepare.py pools                  # name pools for the training emails, from Nemotron train
    python -I ner/train/prepare.py build --variant full   # .local/train/full/{train,val}.jsonl and stats.json
    python -I ner/train/prepare.py build --variant nogretel
    python -I ner/train/prepare.py evalsets               # reports/{neutral,privy,nemotron}-input.json

Training records are {id, source, lang, text, spans: [{start, end, kind}]}, offsets in code
points, kinds person, org and place. Everything else in a source's labels becomes O.

What never goes in: the 379 corpus files, Gretel's test split (the 888-file benchmark comes
from it), urchade/synthetic-pii-ner-mistral-v1 and beki/privy (both held out entirely), and
Nemotron's test split. `build` checks the first two by exact text and by 200-character prefix.
"""

from __future__ import annotations

import argparse
import ast
import collections
import hashlib
import json
import random
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq
import regex

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import ROOT, check, path  # noqa: E402

OUT = ROOT / ".local" / "train"
SEED = 20261024

# How many documents each variant takes from each source. `nogretel` is `full` minus the two
# Gretel sources, the same Nemotron rows and the same emails, so the two differ in one thing.
# Round two (`full2`, `nogretel2`) adds the synth.py documents and masks unlabelled towns in Gretel.
BUDGET = {
    "full": {"gretel_finance_es": None, "gretel_finance_en": 12000, "gretel_masking": 12000, "nemotron": 25000, "emails": None},
    "nogretel": {"nemotron": 25000, "emails": None},
    "full2": {"gretel_finance_es": None, "gretel_finance_en": 12000, "gretel_masking": 12000, "nemotron": 25000, "emails": None, "synth": None},
    "nogretel2": {"nemotron": 25000, "emails": None, "synth": None},
}
MASK_GRETEL_TOWNS = {"full2"}
"""Variants where a word Gretel leaves unlabelled but the gazetteer knows as a town gets no loss."""
VAL_SHARE = 0.03

GRETEL_FINANCE = {"name": "person", "first_name": "person", "last_name": "person", "company": "org", "street_address": "place"}
GRETEL_MASKING = {"name": "person", "first_name": "person", "last_name": "person", "company_name": "org", "street_address": "place", "address": "place", "city": "place"}
NEMOTRON_PLACE_PARTS = {"street_address", "city", "state", "postcode", "county", "country"}

# Party roles in contracts and letters. A label whose whole text is one of these, with or without
# an article, is dropped: it names a role, not a party ("El Prestatario", "LA EMPRESA", "the Borrower").
ROLES = (
    "borrower|lender|company|customer|client|employer|employee|supplier|insured|insurer|policyholder|participant|tenant|landlord|buyer|seller|"
    "vendor|contractor|recipient|sender|beneficiary|guarantor|licensee|licensor|"
    "prestatario|prestataria|prestamista|empresa|cliente|clienta|destinatario|destinataria|proveedor|proveedora|arrendatario|arrendataria|arrendador|"
    "arrendadora|comprador|compradora|vendedor|vendedora|asegurado|asegurada|aseguradora|empleador|empleadora|trabajador|trabajadora|contratista|titular|"
    "beneficiario|beneficiaria|remitente|avalista|fiador|fiadora"
)
ROLE_SPAN = regex.compile(rf"(?i)^(?:(?:the|el|la|los|las|del|al)\s+)?(?:{ROLES})s?$")
PLACEHOLDER = regex.compile(r"[\[\]{}<>]|_{3,}|\.{3,}|X{3,}")


def clean_spans(text: str, spans: list[dict], counts: collections.Counter) -> list[dict]:
    """Drops person and org labels that are a role word, and any label on a template placeholder
    ("[Nombre del Prestatario]", "____", "XXX"). Both are label noise in Gretel's data and both are
    the hard negatives the model must learn to leave alone."""
    out = []
    for s in spans:
        v = text[s["start"]:s["end"]].strip()
        if s["kind"] in ("person", "org") and ROLE_SPAN.match(v):
            counts[f"role:{s['kind']}"] += 1
            continue
        if PLACEHOLDER.search(v):
            counts[f"placeholder:{s['kind']}"] += 1
            continue
        out.append(s)
    return out


ROLE_WORDS = ["Borrower", "Lender", "Company", "Customer", "Client", "Employer", "Supplier", "Prestatario", "Prestamista", "Empresa", "Cliente", "Destinatario", "Proveedor", "Arrendatario"]


def stable(s: str) -> float:
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def utf16_to_cp(text: str) -> list[int]:
    """Index i in UTF-16 units to the code point index."""
    m = []
    for cp, ch in enumerate(text):
        m.append(cp)
        if ord(ch) > 0xFFFF:
            m.append(cp)
    m.append(len(text))
    return m


def utf16_offsets(text: str) -> list[int]:
    offs = [0]
    for ch in text:
        offs.append(offs[-1] + (2 if ord(ch) > 0xFFFF else 1))
    return offs


# ------------------------------------------------------------------ sources


def gretel_finance(lang: str) -> list[dict]:
    check("gretel_finance")
    rows = pq.read_table(path("gretel_finance", "data/train-00000-of-00001.parquet"), columns=["language", "generated_text", "pii_spans", "document_type"]).to_pylist()
    want = {"en": "English", "es": "Spanish"}[lang]
    out = []
    for i, r in enumerate(rows):
        if r["language"] != want:
            continue
        text = r["generated_text"]
        spans = []
        for s in json.loads(r["pii_spans"]):
            k = GRETEL_FINANCE.get(s["label"])
            if k and 0 <= s["start"] < s["end"] <= len(text):
                spans.append({"start": s["start"], "end": s["end"], "kind": k})
        out.append({"id": f"gretel_finance/{i}", "source": f"gretel_finance_{lang}", "lang": lang, "text": text, "spans": spans})
    return out


def find_all(text: str, value: str) -> list[tuple[int, int]]:
    if not value.strip():
        return []
    pat = regex.compile(r"(?<![\p{L}\p{N}])" + regex.escape(value) + r"(?![\p{L}\p{N}])")
    return [(m.start(), m.end()) for m in pat.finditer(text)]


def gretel_masking() -> list[dict]:
    check("gretel_masking")
    rows = pq.read_table(path("gretel_masking", "data/train-00000-of-00001.parquet"), columns=["uid", "text", "entities"]).to_pylist()
    out = []
    for r in rows:
        text = r["text"]
        spans = []
        for e in ast.literal_eval(r["entities"]):
            kinds = {GRETEL_MASKING[t] for t in e["types"] if t in GRETEL_MASKING}
            if len(kinds) != 1:
                continue  # no mapped type, or two kinds for one value
            k = kinds.pop()
            for a, b in find_all(text, e["entity"]):
                spans.append({"start": a, "end": b, "kind": k})
        out.append({"id": f"gretel_masking/{r['uid']}", "source": "gretel_masking", "lang": "en", "text": text, "spans": spans})
    return out


def realign(text: str, spans: list[dict]) -> tuple[list[dict], int, int]:
    """Nemotron's offsets are off for about 12% of spans. Keep the stated offsets when they hold,
    else take the occurrence of the span's text nearest to them, else drop the span."""
    fixed = dropped = 0
    out = []
    for e in spans:
        a, b, v = e["start"], e["end"], str(e["text"])
        if text[a:b] != v:
            hits = [m.start() for m in regex.finditer(regex.escape(v), text)] if v else []
            if not hits:
                dropped += 1
                continue
            a = min(hits, key=lambda h: abs(h - e["start"]))
            b = a + len(v)
            fixed += 1
        out.append({"start": a, "end": b, "label": e["label"]})
    return out, fixed, dropped


def nemotron_spans(text: str, spans: list[dict]) -> list[dict]:
    """Nemotron labels names and address parts piece by piece. blind's place is a town or a whole
    address, so a chain of address parts that holds a street address becomes one place span, and
    a city or county on its own is a place. A state, country or postcode on its own is O. A first
    name followed by a last name becomes one person span."""
    spans = sorted(spans, key=lambda s: (s["start"], s["end"]))
    out: list[dict] = []
    i = 0
    while i < len(spans):
        s = spans[i]
        if s["label"] in NEMOTRON_PLACE_PARTS:
            j = i
            while j + 1 < len(spans) and spans[j + 1]["label"] in NEMOTRON_PLACE_PARTS and regex.fullmatch(r"[\s,]*", text[spans[j]["end"]:spans[j + 1]["start"]]):
                j += 1
            chain = spans[i:j + 1]
            if any(c["label"] == "street_address" for c in chain):
                out.append({"start": chain[0]["start"], "end": chain[-1]["end"], "kind": "place"})
            else:
                out.extend({"start": c["start"], "end": c["end"], "kind": "place"} for c in chain if c["label"] in ("city", "county"))
            i = j + 1
            continue
        if s["label"] in ("first_name", "last_name"):
            end = s["end"]
            j = i
            while j + 1 < len(spans) and spans[j + 1]["label"] in ("first_name", "last_name") and regex.fullmatch(r" +", text[end:spans[j + 1]["start"]]):
                j += 1
                end = spans[j]["end"]
            out.append({"start": s["start"], "end": end, "kind": "person"})
            i = j + 1
            continue
        if s["label"] == "company_name":
            out.append({"start": s["start"], "end": s["end"], "kind": "org"})
        i += 1
    return out


def nemotron(split: str = "train") -> tuple[list[dict], dict]:
    check("nemotron")
    rows = pq.read_table(path("nemotron", f"data/{split}-00000-of-00001.parquet"), columns=["uid", "text", "spans", "locale", "document_type"]).to_pylist()
    out = []
    fixed = dropped = 0
    for r in rows:
        text = r["text"]
        raw, f, d = realign(text, ast.literal_eval(r["spans"]))
        fixed += f
        dropped += d
        out.append({"id": f"nemotron/{r['uid']}", "source": "nemotron", "lang": "en", "text": text, "spans": nemotron_spans(text, raw), "raw": raw, "documentType": r["document_type"], "locale": r["locale"]})
    return out, {"offsetsFixed": fixed, "spansDropped": dropped}


def synth() -> list[dict]:
    p = OUT / "synth.jsonl"
    if not p.exists():
        raise SystemExit(f"{p} missing. Run: python -I ner/train/synth.py")
    return [json.loads(line) for line in p.read_text("utf8").splitlines() if line.strip()]


class TownMask:
    """Unlabelled towns in Gretel's text. Gretel labels street addresses but not a town on its own,
    so its O on a town teaches the model to skip towns. A word sequence that is a town in the
    gazetteer (gazetteer.py: GeoNames and Wikidata, minus common lower-case words and corpus
    values), starts with a capital, and lies outside every label gets an ignore range: the loss
    skips those words and validation does not count a prediction on them. No label is added."""

    PARTICLES = {"de", "del", "la", "las", "los", "el", "y", "of", "on", "upon", "the", "en", "di", "da", "do", "dos", "das", "le", "sur"}

    def __init__(self) -> None:
        g = json.loads((ROOT / ".local" / "gaz" / "gazetteer.json").read_text("utf8"))
        from words import split_words
        self.split = split_words
        self.names: set[tuple[str, ...]] = set()
        for group in g["towns"].values():
            for n in group:
                w = tuple(x[0] for x in split_words(n))
                if w and w[0][:1].isupper() and len(w) <= 6:
                    self.names.add(w)
        self.maxn = max(len(w) for w in self.names)
        self.hits: collections.Counter = collections.Counter()
        self.records = 0
        self.partial = 0

    @staticmethod
    def glued(words, a: int, b: int) -> bool:
        """Words a and b are both there, b follows a after one space, and both start with a capital."""
        if a < 0 or b >= len(words):
            return False
        return words[b][1] - words[a][2] == 1 and words[a][0][:1].isupper() and words[b][0][:1].isupper()

    def ranges(self, text: str, spans: list[dict]) -> list[list[int]]:
        words = self.split(text)
        covered = [any(s["start"] < e and b < s["end"] for s in spans) for _, b, e in words]
        out = []
        i = 0
        while i < len(words):
            hit = 0
            if words[i][0][:1].isupper() and not covered[i]:
                for n in range(min(self.maxn, len(words) - i), 0, -1):
                    seq = tuple(w[0] for w in words[i:i + n])
                    if seq in self.names and not any(covered[i:i + n]) and seq[-1].lower() not in self.PARTICLES:
                        # words must be adjacent with at most one space or a hyphen between them
                        if all(words[j + 1][1] - words[j][2] <= 1 for j in range(i, i + n - 1)):
                            hit = n
                            break
            if hit and (self.glued(words, i - 1, i) or self.glued(words, i + hit - 1, i + hit)):
                # part of a longer capitalised name ("New York" when only "York" is known, "Madrid Stock Exchange")
                self.partial += 1
                hit = 0
            if hit:
                out.append([words[i][1], words[i + hit - 1][2]])
                self.hits[" ".join(w[0] for w in words[i:i + hit])] += 1
                i += hit
            else:
                i += 1
        self.records += bool(out)
        return out


def emails() -> list[dict]:
    p = OUT / "emails.jsonl"
    if not p.exists():
        raise SystemExit(f"{p} missing. Run: pnpm exec tsx --tsconfig ner/tsconfig.json ner/scripts/gen-train-emails.ts")
    out = []
    for line in p.read_text("utf8").splitlines():
        r = json.loads(line)
        m = utf16_to_cp(r["text"])
        spans = [{"start": m[s["start"]], "end": m[s["end"]], "kind": s["kind"]} for s in r["spans"] if s["kind"] in ("person", "org", "place")]
        out.append({"id": r["id"], "source": "emails", "lang": r["lang"], "text": r["text"], "spans": spans})
    return out


# ------------------------------------------------------------------ pools


def pools() -> None:
    """Names, company words and towns from Nemotron train for the training emails. The
    generator swaps its own small pools for these, so no corpus name is ever a training
    label (gen-train-emails.ts also drops any word that appears in a corpus annotation)."""
    check("nemotron")
    rows = pq.read_table(path("nemotron", "data/train-00000-of-00001.parquet"), columns=["text", "spans"]).to_pylist()
    word = regex.compile(r"^\p{Lu}\p{Ll}{2,13}$")
    first, last, org, town = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    generic = {"The", "Global", "Group", "United", "National", "American", "International", "First", "General", "New", "Best", "Advanced", "Smart", "Digital", "Green", "Health", "Care", "Tech", "Data", "City", "County", "State"}
    for r in rows:
        for e in ast.literal_eval(r["spans"]):
            v = str(e["text"]).strip()
            if e["label"] == "first_name" and word.match(v):
                first[v] += 1
            elif e["label"] == "last_name" and word.match(v):
                last[v] += 1
            elif e["label"] == "company_name":
                t = v.split()
                if len(t) >= 2 and word.match(t[0]) and t[0] not in generic:
                    org[t[0]] += 1
            elif e["label"] == "city" and all(word.match(t) for t in v.split()) and 1 <= len(v.split()) <= 3:
                town[v] += 1
    OUT.mkdir(parents=True, exist_ok=True)
    res = {k: sorted(c) for k, c in {"first": first, "last": last, "orgBase": org, "town": town}.items()}
    res["source"] = "nvidia/Nemotron-PII train, revision b70ffaf, CC BY 4.0"
    (OUT / "pools.json").write_text(json.dumps(res, ensure_ascii=False, indent=0) + "\n", "utf8")
    print("pools:", {k: len(v) for k, v in res.items() if isinstance(v, list)})


# ------------------------------------------------------------------ build


class LeakIndex:
    """Texts that must never be trained on: every corpus file and every row of Gretel's test
    split (the 888-file benchmark is drawn from it). A training text is a leak when it equals one
    of them after collapsing white space, or when half of its 8-word shingles, or half of one
    protected text's shingles, are shared with that one text. Shingles found in more than 20
    protected texts are boilerplate (log headers, rules) and do not count."""

    N = 8

    def __init__(self) -> None:
        texts: list[str] = []
        for group in ("generated", "handwritten"):
            for f in sorted((ROOT / "corpus" / group).glob("*.txt")):
                src = f.read_text("utf8")
                body = "\n".join(l for l in src.split("\n") if not regex.match(r"^%(known|order) ", l))
                texts.append(regex.sub(r"\{\{[a-z]+:([^{}]*?)\}\}", r"\1", body))
        check_gretel_test()
        texts += pq.read_table(ROOT / ".local" / "gretel" / "test.parquet", columns=["generated_text"]).column("generated_text").to_pylist()
        self.exact = {self.norm(t) for t in texts}
        self.sizes: list[int] = []
        index: dict[int, set[int]] = collections.defaultdict(set)
        for j, t in enumerate(texts):
            sh = self.shingles(t)
            self.sizes.append(len(sh))
            for h in sh:
                index[h].add(j)
        self.index = {h: js for h, js in index.items() if len(js) <= 20}
        self.protected = len(texts)

    @staticmethod
    def norm(s: str) -> str:
        return regex.sub(r"\s+", " ", s).strip()

    @classmethod
    def shingles(cls, t: str) -> set[int]:
        w = regex.findall(r"[\p{L}\p{N}]+", t.lower())
        return {hash(" ".join(w[i:i + cls.N])) for i in range(max(0, len(w) - cls.N + 1))}

    def leaks(self, t: str) -> bool:
        if self.norm(t) in self.exact:
            return True
        sh = self.shingles(t)
        if not sh:
            return False
        shared: collections.Counter = collections.Counter()
        for h in sh:
            for j in self.index.get(h, ()):
                shared[j] += 1
        return any(n / len(sh) >= 0.5 or n / max(1, self.sizes[j]) >= 0.5 for j, n in shared.items())


def check_gretel_test() -> None:
    import hashlib as _h
    p = ROOT / ".local" / "gretel" / "test.parquet"
    want = "014e1057978f030fce4f4cad7c93b9e3377fd0ded713d2bf4c7de00e3e3c8c72"
    if not p.exists() or _h.sha256(p.read_bytes()).hexdigest() != want:
        raise SystemExit(f"{p} missing or not the pinned file. Run pnpm bench:gretel:setup")


def role_word_stats(records: list[dict]) -> dict:
    """How often a role word appears and how often it sits inside a person or org label."""
    res = {}
    for w in ROLE_WORDS:
        pat = regex.compile(r"(?<![\p{L}])" + w + r"(?![\p{L}])")
        seen = inside = 0
        for r in records:
            for m in pat.finditer(r["text"]):
                seen += 1
                if any(s["start"] <= m.start() and m.end() <= s["end"] and s["kind"] in ("person", "org") for s in r["spans"]):
                    inside += 1
        res[w] = {"occurrences": seen, "insidePersonOrOrg": inside}
    return res


def build(variant: str) -> None:
    budget = BUDGET[variant]
    rng = random.Random(SEED)
    picked: list[dict] = []
    meta: dict = {"variant": variant, "seed": SEED, "budget": budget, "generatedAt": datetime.now(timezone.utc).isoformat()}
    loaders = {
        "gretel_finance_es": lambda: gretel_finance("es"),
        "gretel_finance_en": lambda: gretel_finance("en"),
        "gretel_masking": gretel_masking,
        "nemotron": lambda: nemotron("train")[0],
        "emails": emails,
        "synth": synth,
    }
    leak = LeakIndex()
    dropped: dict[str, int] = {}
    for src, n in budget.items():
        rows = loaders[src]()
        # A fixed shuffle per source, so `nogretel` takes the same Nemotron rows and emails as `full`.
        random.Random(f"{SEED}-{src}").shuffle(rows)
        take: list[dict] = []
        dropped[src] = 0
        for r in rows:
            if n is not None and len(take) >= n:
                break
            if leak.leaks(r["text"]):
                dropped[src] += 1
                continue
            take.append(r)
        picked.extend(take)
        meta.setdefault("available", {})[src] = len(rows)
    cleaned: collections.Counter = collections.Counter()
    mask = TownMask() if variant in MASK_GRETEL_TOWNS else None
    for r in picked:
        r.pop("raw", None)
        r["spans"] = clean_spans(r["text"], r["spans"], cleaned)
        if mask and r["source"].startswith("gretel"):
            r["ignore"] = mask.ranges(r["text"], r["spans"])
    train = [r for r in picked if stable(r["id"]) >= VAL_SHARE]
    val = [r for r in picked if stable(r["id"]) < VAL_SHARE]
    rng.shuffle(train)
    d = OUT / variant
    d.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train", train), ("val", val)):
        with (d / f"{name}.jsonl").open("w", encoding="utf8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    count = lambda rows: dict(collections.Counter(r["source"] for r in rows))  # noqa: E731
    kinds = lambda rows: dict(collections.Counter(s["kind"] for r in rows for s in r["spans"]))  # noqa: E731
    meta.update({
        "train": {"docs": len(train), "bySource": count(train), "spans": kinds(train), "byLang": dict(collections.Counter(r["lang"] for r in train))},
        "val": {"docs": len(val), "bySource": count(val), "spans": kinds(val)},
        "labelsDropped": dict(cleaned),
        "leakageCheck": {"protectedTexts": leak.protected, "rule": "exact text after collapsing white space, or >= 50% of 8-word shingles shared with one protected text (either direction); shingles in > 20 protected texts ignored", "droppedBySource": dropped},
        "roleWords": role_word_stats([r for r in train if r["source"].startswith("gretel_finance")]) if variant.startswith("full") else None,
        "gretelTownMask": None if not mask else {
            "recordsWithAMask": mask.records, "gretelRecords": sum(r["source"].startswith("gretel") for r in picked),
            "maskedOccurrences": sum(mask.hits.values()), "distinctNames": len(mask.hits), "skippedInsideLongerName": mask.partial, "top": mask.hits.most_common(60),
        },
    })
    (d / "stats.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", "utf8")
    print(json.dumps({k: meta[k] for k in ("train", "val", "labelsDropped", "leakageCheck")}))
    if mask:
        print(json.dumps({k: v for k, v in meta["gretelTownMask"].items() if k != "top"}), mask.hits.most_common(40))


# ------------------------------------------------------------------ held-out score inputs

NEUTRAL_KIND = {
    "person": "person", "name": "person", "full name": "person",
    "organization": "org", "company": "org", "company name": "org", "bank": "org", "insurance company": "org", "hospital": "org", "university": "org", "educational institution": "org",
    "address": "place", "street address": "place", "home address": "place", "location": "place", "city": "place",
    "email": "email", "email address": "email",
    "phone number": "phone", "mobile phone number": "phone", "mobile number": "phone", "landline phone number": "phone",
    "iban": "iban",
}
NEUTRAL_UNSCORED = "other"

STOP = {
    "en": {"the", "and", "of", "to", "is", "in", "for", "with", "his", "her", "was", "at", "on", "has", "a"},
    "es": {"el", "la", "los", "las", "de", "que", "y", "en", "del", "por", "con", "para", "una", "es", "su", "se", "al"},
    "fr": {"le", "les", "des", "et", "est", "une", "du", "au", "pour", "dans", "sur", "avec", "son", "sa"},
    "de": {"der", "die", "das", "und", "ist", "ein", "eine", "mit", "für", "von", "zu", "den", "dem", "sie"},
    "it": {"il", "lo", "gli", "di", "che", "è", "per", "una", "con", "del", "della", "nel", "sono", "suo"},
}


def guess_lang(tokens: list[str]) -> str:
    low = [t.lower() for t in tokens]
    score = {k: sum(t in v for t in low) for k, v in STOP.items()}
    best = max(score, key=score.get)
    return best if score[best] >= 3 else "unknown"


NO_SPACE_BEFORE = {",", ".", ";", ":", "!", "?", ")", "]", "}", "%", "»", "”"}
NO_SPACE_AFTER = {"(", "[", "{", "¿", "¡", "«", "“", "$", "€", "£"}


def detok(tokens: list[str]) -> tuple[str, list[tuple[int, int]]]:
    """Joins GLiNER-style word tokens into text, with each token's code point offsets."""
    text = ""
    offs = []
    prev = None
    for t in tokens:
        if prev is not None and t not in NO_SPACE_BEFORE and prev not in NO_SPACE_AFTER and not (t == "s" and prev == "'"):
            text += " "
        offs.append((len(text), len(text) + len(t)))
        text += t
        prev = t
    return text, offs


def write_input(name: str, files: list[dict], meta: dict) -> None:
    for f in files:
        o = utf16_offsets(f["text"])
        f["spans"] = sorted(({"start": o[s["start"]], "end": o[s["end"]], "label": s["label"]} for s in f["spans"]), key=lambda s: (s["start"], s["end"], s["label"]))
    p = ROOT / "reports" / f"{name}-input.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"meta": meta, "files": files}, ensure_ascii=False, indent=1) + "\n", "utf8")
    print(f"wrote {p.relative_to(ROOT)}: {len(files)} files, {collections.Counter(f['lang'] for f in files)}")


def evalsets(per_lang: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    # urchade/synthetic-pii-ner-mistral-v1: never trained on. English and Spanish rows only.
    check("neutral")
    data = json.loads(path("neutral", "data.json").read_text("utf8"))
    by_lang: dict[str, list[int]] = collections.defaultdict(list)
    for i, r in enumerate(data):
        by_lang[guess_lang(r["tokenized_text"])].append(i)
    files = []
    label_counts: collections.Counter = collections.Counter()
    for lang in ("en", "es"):
        idx = sorted(random.Random(f"{SEED}-neutral-{lang}").sample(by_lang[lang], min(per_lang, len(by_lang[lang]))))
        for i in idx:
            r = data[i]
            text, offs = detok(r["tokenized_text"])
            spans = []
            for a, b, lab in r["ner"]:
                lab = lab.lower().strip()
                label_counts[lab] += 1
                spans.append({"start": offs[a][0], "end": offs[b][1], "label": lab if lab in NEUTRAL_KIND else NEUTRAL_UNSCORED})
            files.append({"name": f"neutral/{lang}-{i:05d}", "lang": lang, "documentType": "synthetic", "text": text, "spans": spans})
    write_input("neutral", files, {
        "generatedAt": now, "dataset": "urchade/synthetic-pii-ner-mistral-v1", "license": "Apache-2.0", "revision": "392d6853aaec28075253565350e0d17b9e0ffc0d",
        "sample": f"random.Random('{SEED}-neutral-<lang>').sample of {per_lang} rows per language, language guessed from stop words",
        "rowsByGuessedLang": {k: len(v) for k, v in by_lang.items()},
        "labelToKind": {k: v for k, v in NEUTRAL_KIND.items()}, "unscored": [NEUTRAL_UNSCORED],
        "note": "Text rebuilt from the dataset's word tokens. Labels are free-form; the listed ones map to blind kinds, every other label is 'other' and scored for recall only.",
        "topLabels": label_counts.most_common(40), "offsets": "utf16",
    })

    # beki/privy test-small: never trained on. Protocol traces (JSON, SQL, HTML, XML), English.
    check("privy")
    with zipfile.ZipFile(path("privy", "privy-dataset.zip")) as z, z.open("test-small.json") as f:
        rows = json.load(f)
    pk = {"PER": "person", "ORG": "org", "LOC": "place", "PERSON": "person", "ORGANIZATION": "org", "LOCATION": "place", "EMAIL_ADDRESS": "email", "PHONE_NUMBER": "phone", "IBAN_CODE": "iban"}
    idx = sorted(random.Random(f"{SEED}-privy").sample(range(len(rows)), per_lang * 2))
    files = []
    for i in idx:
        r = rows[i]
        spans = [{"start": s["start_position"], "end": s["end_position"], "label": s["entity_type"] if s["entity_type"] in pk else "other"} for s in r["spans"] if s["entity_type"] != "O"]
        files.append({"name": f"privy/{i:06d}", "lang": "en", "documentType": "protocol trace", "text": r["full_text"], "spans": spans})
    write_input("privy", files, {
        "generatedAt": now, "dataset": "beki/privy", "config": "test-small", "license": "MIT", "revision": "dc137a6a976f6b5bb8768e9bb51ec58df930ccd1",
        "sample": f"random.Random('{SEED}-privy').sample of {per_lang * 2} rows", "labelToKind": pk, "unscored": ["other"], "offsets": "utf16",
    })

    # Nemotron test: in-distribution for every variant (all of them train on Nemotron train).
    rows, fix = nemotron("test")
    nk = {"first_name": "person", "last_name": "person", "company_name": "org", "street_address": "place", "city": "place", "county": "place", "email": "email", "phone_number": "phone"}
    idx = sorted(random.Random(f"{SEED}-nemotron-test").sample(range(len(rows)), per_lang * 2))
    files = []
    for i in idx:
        r = rows[i]
        spans = [{"start": s["start"], "end": s["end"], "label": s["label"] if s["label"] in nk else "other"} for s in r["raw"]]
        files.append({"name": f"nemotron/{i:06d}", "lang": "en", "documentType": r["documentType"], "text": r["text"], "spans": spans})
    write_input("nemotron", files, {
        "generatedAt": now, "dataset": "nvidia/Nemotron-PII", "split": "test", "license": "CC-BY-4.0", "revision": "b70ffaf5ff39e079776134c5bf4381f00a9fd1ed",
        "sample": f"random.Random('{SEED}-nemotron-test').sample of {per_lang * 2} rows", "labelToKind": nk, "unscored": ["other"], "offsets": "utf16", "realign": fix,
    })


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["pools", "build", "evalsets"])
    ap.add_argument("--variant", choices=list(BUDGET), default="full")
    ap.add_argument("--per-lang", type=int, default=500)
    a = ap.parse_args()
    {"pools": pools, "build": lambda: build(a.variant), "evalsets": lambda: evalsets(a.per_lang)}[a.cmd]()
