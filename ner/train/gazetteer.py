"""Name lists for round two: institutions from Wikidata (CC0) and towns from GeoNames (CC BY 4.0).

    python -I ner/train/gazetteer.py fetch    # downloads into .local/gaz, writes .local/gaz/manifest.json with SHA-256
    python -I ner/train/gazetteer.py build    # .local/gaz/gazetteer.json, the lists synth.py and prepare.py read

Both sources are live databases with no fixed revision, so `fetch` records the date and the
SHA-256 of every file it saved, and `build` refuses files whose hash is not the one in the
manifest. ner/TRAINED.md lists the hashes of the files the round-two model was trained on.

Nothing here reads a held-out set. The country list, the institution classes and the
population cut-offs were fixed before any round-two score was looked at.

What `build` drops:
  - any name that equals a person, org or place annotation of the 379 corpus files, or holds
    one of their distinctive words, so no corpus value becomes a training label;
  - names that are mostly a common word in lower case (GeoNames has towns called "Reading",
    "Mobile" and "Bath"), found with the word list of the training texts themselves;
  - org labels that look like a class name rather than a name ("hospital", "Universidad"),
    labels with brackets, digits-only labels and very long labels.
"""

from __future__ import annotations

import collections
import hashlib
import io
import json
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import regex

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import ROOT  # noqa: E402

GAZ = ROOT / ".local" / "gaz"
UA = "blind-ner-training/0.2 (https://github.com/centrst/blind; one-off gazetteer build)"
GEONAMES = "https://download.geonames.org/export/dump/"
GEONAMES_FILES = ["cities500.zip", "countryInfo.txt", "admin1CodesASCII.txt"]

# Spanish-speaking countries, then English-speaking ones. GeoNames ISO codes and Wikidata items.
COUNTRIES = {
    "ES": "Q29", "MX": "Q96", "AR": "Q414", "CO": "Q739", "CL": "Q298", "PE": "Q419", "VE": "Q717", "EC": "Q736",
    "GT": "Q774", "CU": "Q241", "BO": "Q750", "DO": "Q786", "HN": "Q783", "PY": "Q733", "SV": "Q792", "NI": "Q811",
    "CR": "Q800", "PA": "Q804", "UY": "Q77", "PR": "Q1183", "GQ": "Q983",
    "US": "Q30", "GB": "Q145", "IE": "Q27", "CA": "Q16", "AU": "Q408", "NZ": "Q664",
}
ES_COUNTRIES = {"ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ"}
EN_COUNTRIES = {"US", "GB", "IE", "CA", "AU", "NZ"}
WORLD_CITY_POP = 150_000
"""Towns outside those countries come in only above this population: the capitals and big
cities that Spanish and English mail mentions."""

# Wikidata classes per institution type (instances via P31, no subclass walk, which times out).
CLASSES = {
    "bank": ["Q22687", "Q848507", "Q157963", "Q2917176", "Q66344", "Q745877", "Q3277997"],
    "hospital": ["Q16917", "Q1059324", "Q1813474", "Q644264", "Q210999", "Q1774898", "Q106629957", "Q135806546"],
    "university": ["Q3918", "Q875538", "Q902104", "Q38723", "Q189004", "Q1336920"],
    "school": ["Q159334", "Q9826", "Q423208"],
    "insurer": ["Q2143354"],
    "government": ["Q192350", "Q1519799", "Q327333", "Q2659904"],
    "court": ["Q41487", "Q190752", "Q75029", "Q986172"],
}
GLOBAL = {"bank", "university", "insurer"}
# Generic "school" (Q3914) and "primary school" (Q9842) are left out: Mexico and Peru alone hold tens
# of thousands of imported school records, and the query times out.
"""Types small enough worldwide to take from every country. The rest only from COUNTRIES."""


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def get(url: str, data: bytes | None = None, accept: str = "*/*", tries: int = 6) -> bytes:
    for i in range(tries):
        req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            wait = 30 * (i + 1)
            print(f"  {e}; retry in {wait}s", flush=True)
            time.sleep(wait)
    raise SystemExit(f"giving up on {url}")


def sparql(q: str) -> bytes:
    """Runs a query, retrying when the endpoint times out mid-stream and sends broken JSON."""
    for i in range(4):
        b = get("https://query.wikidata.org/sparql", urllib.parse.urlencode({"query": q}).encode(), "application/sparql-results+json")
        try:
            json.loads(b)
            return b
        except ValueError:
            print(f"  truncated result ({len(b)} bytes); retry in 60s", flush=True)
            time.sleep(60)
    raise SystemExit("query keeps timing out")


def wikidata_queries() -> dict[str, str]:
    qs = {}
    allc = " ".join(f"wd:{q}" for q in COUNTRIES.values())
    groups = {
        "es": " ".join(f"wd:{COUNTRIES[c]}" for c in sorted(ES_COUNTRIES)),
        "en": " ".join(f"wd:{COUNTRIES[c]}" for c in sorted(EN_COUNTRIES - {"US"})),
        "us": "wd:Q30",
    }
    for kind, cls in CLASSES.items():
        types = " ".join(f"wd:{c}" for c in cls)
        # Types with many instances are split by country group, so no query runs past the endpoint's 60 s.
        parts = {"": ""} if kind in GLOBAL else {f"-{g}": f"VALUES ?c {{ {v} }} ?x wdt:P17 ?c ." for g, v in groups.items()}
        for suffix, where in parts.items():
            qs[f"org-{kind}{suffix}"] = (
                "SELECT DISTINCT ?x ?l WHERE { VALUES ?t { " + types + " } ?x wdt:P31 ?t . " + where
                + " ?x rdfs:label ?l FILTER(lang(?l) = \"es\" || lang(?l) = \"en\") } LIMIT 40000"
            )
    # Given names and family names whose native label (P1705) is Spanish, with their accents, for
    # Spanish person names (the round-one pools come from Nemotron and have no accents). A count of
    # name bearers per country timed out on the public endpoint.
    qs["name-first"] = (
        'SELECT DISTINCT ?l WHERE { VALUES ?t { wd:Q12308941 wd:Q11879590 wd:Q3409032 } ?n wdt:P31 ?t ; wdt:P1705 ?l FILTER(lang(?l) = "es") }'
    )
    qs["name-last"] = 'SELECT DISTINCT ?l WHERE { ?n wdt:P31 wd:Q101352 ; wdt:P1705 ?l FILTER(lang(?l) = "es") }'
    # Every municipality of Spain, small ones included (GeoNames' cities500 stops at 500 people).
    qs["town-es-municipality"] = 'SELECT DISTINCT ?x ?l WHERE { ?x wdt:P31 wd:Q2074737 . ?x rdfs:label ?l FILTER(lang(?l) = "es") }'
    # Spanish and English names of the bigger GeoNames towns, for exonyms such as Londres or Nueva York.
    qs["town-labels"] = (
        "SELECT DISTINCT ?g ?l WHERE { ?x wdt:P1566 ?g ; wdt:P1082 ?pop . FILTER(?pop >= " + str(WORLD_CITY_POP) + ") "
        '?x rdfs:label ?l FILTER(lang(?l) = "es" || lang(?l) = "en") }'
    )
    return qs


def fetch() -> None:
    GAZ.mkdir(parents=True, exist_ok=True)
    (GAZ / "geonames").mkdir(exist_ok=True)
    (GAZ / "wikidata").mkdir(exist_ok=True)
    man_p = GAZ / "manifest.json"
    man = json.loads(man_p.read_text()) if man_p.exists() else {"files": {}}
    def record(rel: str, p: Path, fresh: bool, **extra) -> None:
        """A file fetched now gets a new entry. A file already on disk must match its entry."""
        h = sha(p.read_bytes())
        old = man["files"].get(rel)
        if not fresh:
            if old is None:
                raise SystemExit(f"{rel} is on disk but not in the manifest; delete it to fetch it again")
            if old["sha256"] != h:
                raise SystemExit(f"{rel}: SHA-256 {h} differs from the manifest; delete it to fetch it again")
            return
        man["files"][rel] = {"sha256": h, **extra, "fetched": datetime.now(timezone.utc).isoformat()}

    for f in GEONAMES_FILES:
        p = GAZ / "geonames" / f
        fresh = not p.exists()
        if fresh:
            p.write_bytes(get(GEONAMES + f))
        record(f"geonames/{f}", p, fresh, url=GEONAMES + f, licence="CC BY 4.0")
        print("ok", f, flush=True)
    for name, q in wikidata_queries().items():
        p = GAZ / "wikidata" / f"{name}.json"
        fresh = not p.exists()
        if fresh:
            print("query", name, flush=True)
            p.write_bytes(sparql(q))
            time.sleep(10)
        n = len(json.loads(p.read_bytes())["results"]["bindings"])
        record(f"wikidata/{name}.json", p, fresh, rows=n, query=q, licence="CC0 1.0")
        print("ok", name, n, flush=True)
    man_p.write_text(json.dumps(man, ensure_ascii=False, indent=1) + "\n")


def read(rel: str) -> bytes:
    man = json.loads((GAZ / "manifest.json").read_text())
    b = (GAZ / rel).read_bytes()
    if sha(b) != man["files"][rel]["sha256"]:
        raise SystemExit(f"{rel}: hash differs from .local/gaz/manifest.json")
    return b


# ------------------------------------------------------------------ build

def fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


WORD = regex.compile(r"[\p{L}\p{N}]+")
GENERIC = {
    "de", "del", "la", "las", "los", "el", "y", "e", "san", "santa", "santo", "sur", "norte", "este", "oeste", "alta", "alto", "baja", "bajo",
    "abajo", "arriba", "nuevo", "nueva", "viejo", "vieja", "chico", "grande", "the", "of", "and", "on", "upon", "north", "south", "east", "west",
    "new", "old", "bay", "cross", "hollow", "reach", "heights", "inc", "ltd", "llc", "sl", "sa", "slu", "gmbh", "co", "partners", "labs",
    "studio", "design", "hotel", "consulting", "holdings", "logistics", "supply", "advisory", "works", "systems", "asesores", "gestion",
    "consultores", "ingenieria", "logistica", "reformas", "transportes", "estudio", "servicios", "clinica", "dental", "taller", "hermanos",
    "eventos", "graficas", "ceramicas", "asesoria", "barberia", "print", "landscaping", "atelier", "cuatro", "vientos",
}


def corpus_values() -> tuple[set[str], set[str]]:
    """Folded person, org and place values of the 379 corpus files, and their distinctive words."""
    vals, words = set(), set()
    for group in ("generated", "handwritten"):
        for f in sorted((ROOT / "corpus" / group).glob("*.txt")):
            for m in regex.finditer(r"\{\{(person|org|place):([^{}]*?)\}\}", f.read_text("utf8")):
                v = fold(m.group(2).strip())
                vals.add(v)
                words.update(w for w in WORD.findall(v) if w not in GENERIC and len(w) >= 3)
    return vals, words


def lower_words() -> collections.Counter:
    """How often each word, accents folded, appears in lower case in the round-one training texts.
    A town name made of common lower-case words ("reading", "church", "la compañía") is too
    ambiguous to label or to mask."""
    c: collections.Counter = collections.Counter()
    for p in (ROOT / ".local" / "train" / "full" / "train.jsonl",):
        with p.open(encoding="utf8") as f:
            for line in f:
                for w in regex.findall(r"\b\p{Ll}+\b", json.loads(line)["text"]):
                    c[fold(w)] += 1
    return c


NOT_TOWNS = {fold(x) for x in (
    "January February March April May June July August September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec "
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre "
    "lunes martes miércoles jueves viernes sábado domingo England Wales Scotland America América Europe Europa Africa África Asia"
).split()}
PARTICLES = {"de", "del", "la", "las", "los", "el", "y", "of", "on", "upon", "the", "en", "san", "santa", "santo", "st", "saint", "new", "north", "south", "east", "west"}


def bindings(rel: str) -> list[dict]:
    return json.loads(read(rel))["results"]["bindings"]


CLASS_WORDS = {
    "bank", "banco", "hospital", "clínica", "clinica", "clinic", "university", "universidad", "school", "escuela", "colegio", "instituto",
    "ministry", "ministerio", "court", "tribunal", "juzgado", "insurance", "aseguradora", "council", "ayuntamiento", "college", "agency", "agencia",
}


# Country names in Spanish, which GeoNames' countryInfo (English names) lacks. Used only as O.
COUNTRIES_ES = [
    "España", "México", "Argentina", "Colombia", "Chile", "Perú", "Venezuela", "Ecuador", "Guatemala", "Cuba", "Bolivia", "República Dominicana",
    "Honduras", "Paraguay", "El Salvador", "Nicaragua", "Costa Rica", "Panamá", "Uruguay", "Puerto Rico", "Estados Unidos", "Reino Unido",
    "Irlanda", "Canadá", "Australia", "Nueva Zelanda", "Francia", "Alemania", "Italia", "Portugal", "Países Bajos", "Bélgica", "Suiza",
    "Austria", "Suecia", "Noruega", "Dinamarca", "Polonia", "Grecia", "Marruecos", "China", "Japón", "India", "Brasil", "Rusia", "Turquía",
]
TOWN_ADMIN_WORDS = {"municipality", "district", "prefecture", "province", "county", "region", "department", "municipio", "distrito", "provincia", "departamento", "comarca", "governorate", "oblast", "city municipality"}


def good_org(l: str) -> bool:
    if not (4 <= len(l) <= 70) or regex.search(r"[(),\[\]{}:;/\\|\"“”]|https?|www\.|\bQ\d+\b", l):
        return False
    if not regex.search(r"\p{Lu}", l) or regex.fullmatch(r"[\d\s\W]+", l):
        return False
    if fold(l) in CLASS_WORDS or len(l.split()) > 9:
        return False
    return True


def build() -> None:
    cvals, cwords = corpus_values()
    lw = lower_words()
    dropped: collections.Counter = collections.Counter()

    def keep(name: str, what: str) -> bool:
        f = fold(name)
        toks = WORD.findall(f)
        if f in cvals or any(t in cwords for t in toks):
            dropped[f"{what}:corpus"] += 1
            return False
        # a one-word name that is mostly seen in lower case
        if len(toks) == 1 and lw[toks[0]] >= 5:
            dropped[f"{what}:common-word"] += 1
            return False
        if what == "town":
            content = [t for t in toks if t not in PARTICLES]
            if f in NOT_TOWNS or not content or all(lw[t] >= 3 for t in content):
                dropped["town:common-word"] += 1
                return False
        return True

    countries, regions = set(), set()
    for line in read("geonames/countryInfo.txt").decode("utf8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        countries.add(line.split("\t")[4])
    countries.update(COUNTRIES_ES)
    for line in read("geonames/admin1CodesASCII.txt").decode("utf8").splitlines():
        parts = line.split("\t")
        if len(parts) >= 3 and parts[0].split(".")[0] in COUNTRIES:
            regions.update({parts[1], parts[2]})

    labels_by_gid: dict[str, set[str]] = collections.defaultdict(set)
    for b in bindings("wikidata/town-labels.json"):
        labels_by_gid[b["g"]["value"]].add(b["l"]["value"])

    towns: dict[str, dict[str, int]] = {"es": {}, "en": {}, "world": {}}
    with zipfile.ZipFile(io.BytesIO(read("geonames/cities500.zip"))) as z:
        rows = z.read("cities500.txt").decode("utf8").splitlines()
    for line in rows:
        p = line.split("\t")
        gid, name, cc, pop, fclass = p[0], p[1], p[8], int(p[14] or 0), p[6]
        if fclass != "P":
            continue
        group = "es" if cc in ES_COUNTRIES else "en" if cc in EN_COUNTRIES else ("world" if pop >= WORLD_CITY_POP else None)
        if group is None:
            continue
        for n in {name} | labels_by_gid.get(gid, set()):
            n = n.strip()
            if not regex.fullmatch(r"[\p{L}][\p{L}\p{M}'’. -]*[\p{L}.]", n) or len(n) > 40 or n in countries or set(fold(n).split()) & TOWN_ADMIN_WORDS:
                continue
            # A town that shares its name with a region ("Delaware", "Ontario") is ambiguous unless it is a
            # big city ("Madrid", "Buenos Aires"). A one-word name of a small place is too often a word.
            if (n in regions and pop < 300_000) or (" " not in n and pop < 5_000):
                continue
            towns[group][n] = max(towns[group].get(n, 0), pop)
    for b in bindings("wikidata/town-es-municipality.json"):
        n = b["l"]["value"].strip()
        if regex.fullmatch(r"[\p{L}][\p{L}\p{M}'’. -]*[\p{L}.]", n) and n not in countries:
            towns["es"].setdefault(n, 0)  # every Spanish municipality, whatever its size
    out_towns = {g: sorted((n, pop) for n, pop in d.items() if keep(n, "town")) for g, d in towns.items()}

    orgs: dict[str, dict[str, set[str]]] = {}
    for kind in CLASSES:
        es, en = set(), set()
        files = [f"wikidata/org-{kind}.json"] if kind in GLOBAL else [f"wikidata/org-{kind}-{g}.json" for g in ("es", "en", "us")]
        for b in (b for f in files for b in bindings(f)):
            l = b["l"]["value"].strip()
            if not good_org(l) or not keep(l, f"org-{kind}"):
                continue
            (es if b["l"].get("xml:lang") == "es" else en).add(l)
        orgs[kind] = {"es": sorted(es), "en": sorted(en)}

    # Spanish given and family names, one word or two joined by a particle.
    names: dict[str, set[str]] = {"first": set(), "last": set()}
    for what in names:
        for b in bindings(f"wikidata/name-{what}.json"):
            n = b["l"]["value"].strip()
            if regex.fullmatch(r"\p{Lu}\p{Ll}+(?:[ -](?:de |del |de la )?\p{Lu}\p{Ll}+)?", n) and keep(n, f"name-{what}"):
                names[what].add(n)
    # A region or a country is O. Names that are also towns stay towns and are not used as regions.
    all_towns = {n for d in towns.values() for n in d}
    regions = {r for r in regions if r not in all_towns}

    res = {
        "built": datetime.now(timezone.utc).isoformat(),
        "names": {k: sorted(v) for k, v in names.items()},
        "towns": {g: [n for n, _ in v] for g, v in out_towns.items()},
        "townPop": {g: [pop for _, pop in v] for g, v in out_towns.items()},
        "countries": sorted(countries),
        "regions": sorted(r for r in regions if regex.fullmatch(r"[\p{L}][\p{L}' -]*", r)),
        "orgs": orgs,
        "dropped": dict(dropped),
        "attribution": "Towns: GeoNames (https://www.geonames.org), CC BY 4.0. Institution names and Spanish municipalities: Wikidata, CC0 1.0.",
    }
    (GAZ / "gazetteer.json").write_text(json.dumps(res, ensure_ascii=False) + "\n", "utf8")
    print(json.dumps({"towns": {g: len(v) for g, v in res["towns"].items()}, "orgs": {k: {l: len(x) for l, x in v.items()} for k, v in orgs.items()}, "regions": len(res["regions"]), "names": {k: len(v) for k, v in names.items()}, "dropped": dict(dropped)}, indent=1))


if __name__ == "__main__":
    {"fetch": fetch, "build": build}[sys.argv[1]]()
