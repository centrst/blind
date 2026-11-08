"""Step 1 of `pnpm bench:gretel`: draw a fixed sample from Gretel's synthetic finance set.

Reads the test split of gretelai/synthetic_pii_finance_multilingual (Apache 2.0, by Gretel),
pinned by `pnpm bench:gretel:setup` to revision 7b844d1 and checked here by SHA-256, and
writes reports/gretel-input.json in the shape export-corpus.ts writes ({files: [{name, lang,
text}]}), so presidio.py and llm_guard.py read it unchanged. Each file also carries Gretel's
own labels as `spans` ({start, end, label}, UTF-16 offsets) and its `documentType`.

The sample: every Spanish row of the test split (444), and the same number of English rows
drawn with random.Random(SEED).sample over the English rows in file order. Names are
`gretel/<lang>-<row>`, with the row number in the parquet file.

Gretel's labels are used as written, with two clean-ups that are counted in `meta`: a span
that is empty or runs past the text is dropped, and an exact duplicate (same start, end and
label) is kept once. Overlapping spans of different labels are kept.
"""

import argparse
import hashlib
import json
import random
import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import pyarrow.parquet as pq

SHA256 = "014e1057978f030fce4f4cad7c93b9e3377fd0ded713d2bf4c7de00e3e3c8c72"
REVISION = "7b844d16738527a04264f50214cb426a4cea0897"
SOURCE = f"https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual/resolve/{REVISION}/data/test-00000-of-00001.parquet"
SEED = 20261024
LANGS = {"Spanish": "es", "English": "en"}


def utf16_offsets(text: str) -> list[int]:
    offs = [0]
    for ch in text:
        offs.append(offs[-1] + (2 if ord(ch) > 0xFFFF else 1))
    return offs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", default=".local/gretel/test.parquet")
    ap.add_argument("--out", default="reports/gretel-input.json")
    args = ap.parse_args()

    data = Path(args.parquet).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"{args.parquet} has SHA-256 {digest}, expected {SHA256}. Run pnpm bench:gretel:setup")
    rows = pq.read_table(args.parquet).to_pylist()

    es = [i for i, r in enumerate(rows) if r["language"] == "Spanish"]
    en_all = [i for i, r in enumerate(rows) if r["language"] == "English"]
    en = sorted(random.Random(SEED).sample(en_all, len(es)))

    dropped = duplicates = 0
    files = []
    for i in es + en:
        r = rows[i]
        text = r["generated_text"]
        offs = utf16_offsets(text)
        seen = set()
        spans = []
        for s in json.loads(r["pii_spans"]):
            start, end, label = s["start"], s["end"], s["label"]
            if not (0 <= start < end <= len(text)):
                dropped += 1
                continue
            if (start, end, label) in seen:
                duplicates += 1
                continue
            seen.add((start, end, label))
            spans.append({"start": offs[start], "end": offs[end], "label": label})
        spans.sort(key=lambda x: (x["start"], x["end"], x["label"]))
        lang = LANGS[r["language"]]
        files.append({"name": f"gretel/{lang}-{i:04d}", "lang": lang, "documentType": r["document_type"], "text": text, "spans": spans})

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": "gretelai/synthetic_pii_finance_multilingual",
        "license": "Apache-2.0",
        "split": "test",
        "revision": REVISION,
        "source": SOURCE,
        "sha256": SHA256,
        "sample": f"all {len(es)} Spanish rows, plus random.Random({SEED}).sample of {len(en)} of the {len(en_all)} English rows",
        "seed": SEED,
        "rows": {"es": len(es), "en": len(en)},
        "spansDropped": dropped,
        "duplicateSpans": duplicates,
        "pyarrow": version("pyarrow"),
        "offsets": "utf16",
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"meta": meta, "files": files}, ensure_ascii=False, indent=1) + "\n", "utf8")
    print(f"wrote {args.out}: {len(es)} es + {len(en)} en, {dropped} empty or out-of-range spans dropped, {duplicates} duplicates", file=sys.stderr)


if __name__ == "__main__":
    main()
