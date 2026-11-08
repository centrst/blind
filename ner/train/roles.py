"""Counts role words a model tags as person or org on the Gretel sample, from the bench caches.

    python -I ner/train/roles.py "GLiNER 0.3=.local/bench-ner-cache-0.3.json" "DeBERTa=.local/bench-tc-cache-...-0.3.json"

A span counts when its whole text is a role word ("Borrower", "the Company", "La Empresa"), with or
without an article. Reads reports/gretel-input.json and the raw spans each bench run cached.
"""

from __future__ import annotations

import collections
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROLE = re.compile(
    r"(?i)^(?:(?:the|el|la|los|las)\s+)?(borrower|lender|company|customer|client|employer|employee|supplier|insured|insurer|policyholder|"
    r"participant|tenant|landlord|buyer|seller|vendor|contractor|prestatario|prestamista|empresa|cliente|clienta|proveedor|arrendatario|"
    r"arrendador|asegurado|aseguradora|trabajador|empleador|titular|beneficiario)s?$"
)


def main() -> None:
    files = json.loads((ROOT / "reports" / "gretel-input.json").read_text("utf8"))["files"]
    def cp(text: str) -> list[int]:
        """UTF-16 offset (what the TypeScript runners cache) to code point index."""
        m = []
        for i, ch in enumerate(text):
            m.append(i)
            if ord(ch) > 0xFFFF:
                m.append(i)
        m.append(len(text))
        return m

    for arg in sys.argv[1:]:
        name, p = arg.split("=", 1)
        cache = json.loads(Path(p).read_text("utf8"))
        n: collections.Counter = collections.Counter()
        tot = 0
        for f in files:
            u = cp(f["text"])
            for x in cache.get(hashlib.sha1(f"person,organization,location|{f['text']}".encode()).hexdigest()) or []:
                if x["label"] in ("person", "organization"):
                    tot += 1
                    v = f["text"][u[x["start"]]:u[x["end"]]].strip()
                    if ROLE.match(v):
                        n[v.lower()] += 1
        print(f"{name}: {sum(n.values())} role-word person/org spans of {tot}; top {n.most_common(8)}")


if __name__ == "__main__":
    main()
