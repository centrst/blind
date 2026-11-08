"""Round-two training documents: institutions and bare towns in context, Spanish and English.

    python -I ner/train/synth.py [count]     # .local/train/synth.jsonl, default 24,000 documents

Reads .local/gaz/gazetteer.json (gazetteer.py) and .local/train/pools.json (prepare.py pools).
Each document is a short email, letter, form, note or chat built from the sentence templates
below, with every span recorded as it is written, so labels are exact by construction:

  - org: banks, hospitals, clinics, universities, schools, ministries and agencies, councils,
    courts and insurers. Half are names from Wikidata (CC0), half are composed from a town or a
    surname ("Hospital General de <town>", "<town> Crown Court", "Clínica <surname>"). The whole
    name is the span. An article before it ("el", "la", "the") is outside the span.
  - place: a town from GeoNames (CC BY 4.0) or a Spanish municipality from Wikidata, written bare
    ("vive en <town>", "born in <town>", "Ciudad: <town>"), or a whole street address. A region or
    country next to a town is O, as in the round-one Nemotron rule.
  - person: names from the round-one pools, and Spanish names with accents from Wikidata.
  - O on purpose: role words ("el Prestatario", "the Bank" as a defined term), institution nouns
    with no name ("el hospital", "the council"), countries, regions, months and departments.

Seeded, so the same count gives the same file.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import ROOT  # noqa: E402

GAZ = ROOT / ".local" / "gaz" / "gazetteer.json"
POOLS = ROOT / ".local" / "train" / "pools.json"
OUT = ROOT / ".local" / "train" / "synth.jsonl"
SEED = "blind-ner-synth-v2"

MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
DAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes"]
DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
SAINTS_ES = ["San José", "Santa María", "San Juan de Dios", "San Rafael", "Santa Teresa", "San Pedro", "Santa Ana", "San Agustín", "Nuestra Señora del Carmen", "Santa Cristina", "San Ignacio", "La Inmaculada", "Virgen del Rocío", "San Francisco de Asís", "Santa Lucía", "Sagrado Corazón"]
SAINTS_EN = ["St Mary's", "St Thomas'", "St George's", "St Luke's", "St James's", "St Joseph's", "St Anne's", "St Michael's", "St Patrick's", "St Catherine's", "Holy Cross", "Mercy", "Good Samaritan", "Sacred Heart"]
AREAS_ES = ["Hacienda", "Sanidad", "Educación", "Trabajo y Economía Social", "Interior", "Justicia", "Transportes", "Cultura", "Inclusión, Seguridad Social y Migraciones", "Agricultura, Pesca y Alimentación", "Vivienda", "Industria y Turismo"]
AREAS_EN = ["Health", "Education", "Transport", "Justice", "Finance", "Home Affairs", "Agriculture", "Housing", "Labour", "Culture", "Environment", "Defence"]
STREET_ES = ["Calle", "Avenida", "Paseo", "Plaza", "Camino", "Ronda", "Calle de", "Avda."]
STREET_EN = ["Street", "Road", "Lane", "Avenue", "Drive", "Close", "Way", "Crescent"]
DEPTS_ES = ["Departamento de Recursos Humanos", "Atención al Cliente", "Servicio de Urgencias", "Secretaría", "Administración", "Contabilidad", "Departamento Jurídico"]
DEPTS_EN = ["Human Resources", "Customer Service", "Accounts Payable", "Admissions Office", "Legal Department", "Finance Team", "Front Desk"]
ROLES_ES = ["el Prestatario", "la Empresa", "el Cliente", "el Arrendatario", "el Asegurado", "la Entidad", "el Banco", "el Titular", "el Beneficiario", "la Aseguradora"]
ROLES_EN = ["the Borrower", "the Company", "the Customer", "the Tenant", "the Insured", "the Bank", "the Lender", "the Policyholder", "the Supplier", "the Employer"]
GENERIC_ES = ["el hospital", "el banco", "la universidad", "el colegio", "el ayuntamiento", "el juzgado", "la clínica", "la aseguradora", "el ministerio", "el centro de salud"]
GENERIC_EN = ["the hospital", "the bank", "the university", "the school", "the council", "the court", "the clinic", "the insurer", "the ministry", "the surgery"]

# Gender of the head noun decides the Spanish article in front of a name.
MASC = ("Banco", "Hospital", "Instituto", "Colegio", "Ministerio", "Ayuntamiento", "Juzgado", "Tribunal", "Centro", "Consejo", "Servicio", "Complejo", "Consorcio", "Cabildo", "Registro", "Concejo", "Departamento", "Organismo")
FEM = ("Universidad", "Clínica", "Caja", "Mutua", "Consejería", "Escuela", "Agencia", "Audiencia", "Diputación", "Fundación", "Junta", "Dirección", "Tesorería", "Policlínica", "Mutualidad", "Delegación", "Oficina", "Alcaldía", "Municipalidad", "Corte", "Policía", "Secretaría", "Comisión", "Superintendencia", "Fiscalía", "Contraloría", "Cámara")


class Doc:
    def __init__(self, rng: random.Random, lang: str):
        self.r = rng
        self.lang = lang
        self.text = ""
        self.spans: list[dict] = []

    def add(self, s: str) -> None:
        self.text += s

    def ent(self, kind: str, v: str) -> None:
        a = len(self.text)
        self.text += v
        self.spans.append({"start": a, "end": len(self.text), "kind": kind})


class Gen:
    def __init__(self, seed: str):
        self.r = random.Random(seed)
        g = json.loads(GAZ.read_text("utf8"))
        p = json.loads(POOLS.read_text("utf8"))
        self.towns = g["towns"]
        pops = g["townPop"]
        # Half the draws come from the 3,000 biggest towns of a group, half from all of them.
        self.big = {k: [n for n, _ in sorted(zip(v, pops[k]), key=lambda x: -x[1])[:3000]] for k, v in self.towns.items()}
        self.regions = g["regions"]
        self.countries = g["countries"]
        self.orgs = g["orgs"]
        self.first_pool = {"en": p["first"], "es": g.get("names", {}).get("first", []) or p["first"]}
        self.last_pool = {"en": p["last"], "es": g.get("names", {}).get("last", []) or p["last"]}
        self.org_base = p["orgBase"]

    # ---------------------------------------------------------------- values

    def town(self, lang: str) -> str:
        r = self.r
        x = r.random()
        group = ("es" if x < 0.6 else "world" if x < 0.85 else "en") if lang == "es" else ("en" if x < 0.6 else "world" if x < 0.85 else "es")
        pool = self.big[group] if r.random() < 0.5 else self.towns[group]
        return r.choice(pool)

    def first(self, lang: str) -> str:
        pool = self.first_pool["es"] if lang == "es" and self.r.random() < 0.7 else self.first_pool["en"]
        return self.r.choice(pool)

    def surname(self, lang: str) -> str:
        pool = self.last_pool["es"] if lang == "es" and self.r.random() < 0.7 else self.last_pool["en"]
        return self.r.choice(pool)

    def person(self, lang: str) -> str:
        r = self.r
        n = f"{self.first(lang)} {self.surname(lang)}"
        if lang == "es" and r.random() < 0.45:
            n += " " + self.surname(lang)
        return n

    def region(self) -> str:
        return self.r.choice(self.regions)

    def country(self) -> str:
        return self.r.choice(self.countries)

    def date(self, lang: str) -> str:
        r = self.r
        d, y = r.randint(1, 28), r.randint(2019, 2027)
        if lang == "es":
            return r.choice([f"{d} de {r.choice(MONTHS_ES)} de {y}", f"{d:02d}/{r.randint(1, 12):02d}/{y}", f"el {r.choice(DAYS_ES)} {d}"])
        return r.choice([f"{r.choice(MONTHS_EN)} {d}, {y}", f"{d} {r.choice(MONTHS_EN)} {y}", f"{r.choice(DAYS_EN)} {d} {r.choice(MONTHS_EN)}"])

    def money(self, lang: str) -> str:
        v = self.r.randint(20, 90000)
        c = self.r.randint(0, 99)
        return f"{v:,}".replace(",", ".") + f",{c:02d} €" if lang == "es" else f"${v:,}.{c:02d}"

    def street(self, lang: str) -> str:
        r = self.r
        if lang == "es":
            return f"{r.choice(STREET_ES)} {self.surname('es')} {r.randint(1, 140)}, {r.randint(1000, 52999):05d} {self.town('es')}"
        return f"{r.randint(1, 990)} {self.surname('en')} {r.choice(STREET_EN)}, {self.town('en')}"

    def org(self, kind: str, lang: str) -> str:
        """An institution of one kind. Half from Wikidata, half composed."""
        r = self.r
        real = self.orgs.get(kind, {})
        names = real.get(lang) or real.get("en" if lang == "es" else "es") or []
        if names and r.random() < 0.5:
            return r.choice(names)
        t = self.town(lang)
        s = self.surname(lang)
        if lang == "es":
            pats = {
                "bank": [f"Banco {s}", f"Caja Rural de {t}", f"Banco Popular de {t}", f"Caja de Ahorros de {t}", f"Banca {s}", f"Cooperativa de Crédito de {t}"],
                "hospital": [f"Hospital General de {t}", f"Hospital Universitario de {t}", f"Hospital {r.choice(SAINTS_ES)}", f"Clínica {s}", f"Clínica Dental {s}", f"Centro de Salud {t}", f"Hospital Comarcal de {t}", f"Policlínica {s}", f"Hospital Doctor {s}"],
                "university": [f"Universidad de {t}", f"Universidad Autónoma de {t}", f"Universidad Politécnica de {t}", f"Universidad Católica {r.choice(SAINTS_ES)}", f"Universidad Nacional de {t}", f"Escuela Universitaria de Enfermería de {t}"],
                "school": [f"Colegio {r.choice(SAINTS_ES)}", f"IES {self.person('es')}", f"Colegio Público {self.person('es')}", f"Instituto de Educación Secundaria {s}", f"CEIP {r.choice(SAINTS_ES)}", f"Escuela Infantil {s}", f"Colegio {s} de {t}"],
                "government": [f"Ministerio de {r.choice(AREAS_ES)}", f"Consejería de {r.choice(AREAS_ES)}", f"Agencia Tributaria", f"Tesorería General de la Seguridad Social", f"Delegación de Hacienda de {t}", f"Servicio Público de Empleo de {t}", f"Dirección General de Tráfico", f"Diputación de {t}", f"Oficina de Turismo de {t}"],
                "council": [f"Ayuntamiento de {t}", f"Concejo de {t}", f"Junta Vecinal de {t}", f"Municipalidad de {t}", f"Cabildo de {t}", f"Alcaldía de {t}", f"Consejo Comarcal de {t}"],
                "court": [f"Juzgado de Primera Instancia n.º {r.randint(1, 60)} de {t}", f"Juzgado de lo Social n.º {r.randint(1, 40)} de {t}", f"Audiencia Provincial de {t}", f"Tribunal Superior de Justicia de {t}", f"Juzgado de Paz de {t}", f"Tribunal Supremo", f"Juzgado de lo Penal n.º {r.randint(1, 30)} de {t}"],
                "insurer": [f"Seguros {s}", f"Mutua {s}", f"{s} Seguros", f"Mutualidad de {t}", f"Aseguradora {s}", f"{self.r.choice(self.org_base)} Seguros"],
                "company": [f"{r.choice(['Transportes', 'Construcciones', 'Talleres', 'Distribuciones', 'Asesoría', 'Inmobiliaria'])} {s} S.L.", f"{self.r.choice(self.org_base)} Ibérica S.A."],
            }
        else:
            pats = {
                "bank": [f"Bank of {t}", f"{s} Bank", f"First National Bank of {t}", f"{t} Savings Bank", f"{t} Credit Union", f"{s} & Co. Bank", f"{t} Building Society"],
                "hospital": [f"{t} General Hospital", f"{r.choice(SAINTS_EN)} Hospital", f"{s} Clinic", f"{t} Medical Center", f"{t} Royal Infirmary", f"{t} Children's Hospital", f"{s} Dental Practice", f"{t} Community Health Centre"],
                "university": [f"University of {t}", f"{t} State University", f"{t} Community College", f"{s} College", f"{t} Institute of Technology", f"{t} Polytechnic"],
                "school": [f"{t} High School", f"{s} Academy", f"{r.choice(SAINTS_EN)} Primary School", f"{t} Grammar School", f"{s} Elementary School", f"{t} Middle School"],
                "government": [f"Ministry of {r.choice(AREAS_EN)}", f"Department of {r.choice(AREAS_EN)}", "HM Revenue & Customs", "Internal Revenue Service", "Social Security Administration", f"{t} Housing Authority", f"{t} Police Department", f"{t} Department of Public Works"],
                "council": [f"{t} City Council", f"{t} County Council", f"{t} Borough Council", f"{t} Town Council", f"City of {t}", f"{t} District Council", f"{t} Parish Council"],
                "court": [f"{t} Crown Court", f"{t} County Court", f"{t} Magistrates' Court", f"{t} District Court", f"Superior Court of {t}", f"{t} Family Court", "Court of Appeal"],
                "insurer": [f"{s} Insurance", f"{t} Mutual Insurance", f"{s} Assurance", f"{s} Life", f"{t} Insurance Group", f"{self.r.choice(self.org_base)} Insurance"],
                "company": [f"{s} {r.choice(['Logistics', 'Builders', 'Consulting', 'Plumbing', 'Holdings'])} Ltd", f"{self.r.choice(self.org_base)} Inc."],
            }
        return r.choice(pats[kind])

    # ---------------------------------------------------------------- sentences

    def put_org(self, d: Doc, kind: str, prep: str = "", bare: bool = False) -> None:
        """Writes a preposition and article that fit the name, then the name as an org span.
        `bare` writes the name alone, as after a form label."""
        v = self.org(kind, d.lang)
        head = v.split()[0]
        if bare:
            pass
        elif d.lang == "es":
            art = "el" if head in MASC else "la" if head in FEM else ""
            if prep == "de" and art == "el":
                d.add("del ")
            elif prep == "a" and art == "el":
                d.add("al ")
            else:
                lead = " ".join(x for x in (prep, art) if x)
                if lead and (not d.text or d.text.endswith(("\n", ". "))):
                    lead = lead.capitalize()
                d.add(lead + (" " if lead else ""))
        else:
            needs_the = head in ("University", "Bank", "Ministry", "Department", "Court", "City", "Superior", "Internal", "Social") or v.startswith("First National")
            lead = " ".join(x for x in (prep, "the" if needs_the else "") if x)
            if lead and (not d.text or d.text.endswith(("\n", ". "))):
                lead = lead.capitalize()
            d.add(lead + (" " if lead else ""))
        if self.r.random() < 0.04:
            v = v.upper()
        d.ent("org", v)

    def sentence(self, d: Doc, topic: str) -> None:
        """One sentence about a topic. `T` town, `O` org, `P` person, `R` region (O), `C` country (O)."""
        r, es = self.r, d.lang == "es"
        P = lambda: d.ent("person", self.person(d.lang))  # noqa: E731
        T = lambda: d.ent("place", self.town(d.lang))  # noqa: E731
        A = lambda s: d.add(s)  # noqa: E731
        O = lambda kind, prep="": self.put_org(d, kind, prep)  # noqa: E731
        D = lambda: A(self.date(d.lang))  # noqa: E731
        M = lambda: A(self.money(d.lang))  # noqa: E731
        R = lambda: A(self.region())  # noqa: E731
        C = lambda: A(self.country())  # noqa: E731
        k = r.randrange(8)
        if topic == "bank":
            if es:
                [lambda: (A("Te confirmo la transferencia de "), M(), A(" "), O("bank", "de"), A(".")),
                 lambda: (A("He abierto una cuenta en "), O("bank", "en"), A(" para la comunidad.")),
                 lambda: (A("El recibo lo pasará "), O("bank", ""), A(" el día 5 de cada mes.")),
                 lambda: (A("Recibimos una transferencia "), O("bank", "de"), A(" a nombre de "), P(), A(".")),
                 lambda: (A("La hipoteca está con "), O("bank", ""), A(", oficina de "), T(), A(".")),
                 lambda: (A("Entidad: "), self.put_org(d, "bank", bare=True), A("\n")),
                 lambda: (A("Ayer fui a la sucursal "), O("bank", "de"), A(" en "), T(), A(" y no tenían el certificado.")),
                 lambda: (A("¿Me pasas el justificante "), O("bank", "de"), A("? Lo necesito antes "), A("del " + r.choice(DAYS_ES)), A(".")),
                 ][k]()
            else:
                [lambda: (A("The payment of "), M(), A(" was sent from my account at "), O("bank"), A(".")),
                 lambda: (A("I opened a joint account with "), O("bank"), A(" last week.")),
                 lambda: (A("Please wire the deposit to "), O("bank"), A(", sort code 20-"), A(str(r.randint(10, 99))), A("-"), A(str(r.randint(10, 99))), A(".")),
                 lambda: (A("We received a transfer from "), O("bank"), A(" on behalf of "), P(), A(".")),
                 lambda: (A("Our mortgage is with "), O("bank"), A(", the "), T(), A(" branch.")),
                 lambda: (A("Bank: "), self.put_org(d, "bank", bare=True), A("\n")),
                 lambda: (A("I went into "), O("bank"), A(" in "), T(), A(" but they could not print the statement.")),
                 lambda: (A("Can you forward the letter from "), O("bank"), A("? I need it by "), A(r.choice(DAYS_EN)), A(".")),
                 ][k]()
        elif topic == "hospital":
            if es:
                [lambda: (A("Mi padre está ingresado "), O("hospital", "en"), A(" desde el "), A(r.choice(DAYS_ES)), A(".")),
                 lambda: (A("Tengo cita "), O("hospital", "en"), A(" el "), D(), A(" a las "), A(f"{r.randint(8, 19)}:{r.choice(['00', '15', '30', '45'])}"), A(".")),
                 lambda: (A("Adjunto el informe de alta "), O("hospital", "de"), A(".")),
                 lambda: (A("La doctora "), P(), A(" pasa consulta "), O("hospital", "en"), A(" los martes.")),
                 lambda: (A("Centro: "), self.put_org(d, "hospital", bare=True), A("\n")),
                 lambda: (A("Nos derivaron "), O("hospital", "a"), A(" porque en "), T(), A(" no había especialista.")),
                 lambda: (A("La operación fue "), O("hospital", "en"), A(" y salió bien.")),
                 lambda: (A("Llamaron "), O("hospital", "de"), A(" para cambiar la fecha de la resonancia.")),
                 ][k]()
            else:
                [lambda: (A("My mother was admitted to "), O("hospital"), A(" on "), D(), A(".")),
                 lambda: (A("Your appointment at "), O("hospital"), A(" is confirmed for "), D(), A(".")),
                 lambda: (A("I attach the discharge letter from "), O("hospital"), A(".")),
                 lambda: (A("Dr "), P(), A(" sees patients at "), O("hospital"), A(" on Tuesdays.")),
                 lambda: (A("Provider: "), self.put_org(d, "hospital", bare=True), A("\n")),
                 lambda: (A("They referred us to "), O("hospital"), A(" because there was no specialist in "), T(), A(".")),
                 lambda: (A("The surgery took place at "), O("hospital"), A(" and went well.")),
                 lambda: (A("Someone from "), O("hospital"), A(" called to move the scan.")),
                 ][k]()
        elif topic == "university":
            if es:
                [lambda: (A("Estudié Derecho "), O("university", "en"), A(".")),
                 lambda: (A("Adjunto el certificado académico expedido por "), O("university"), A(".")),
                 lambda: (P(), A(" es profesora titular "), O("university", "en"), A(".")),
                 lambda: (A("La matrícula "), O("university", "de"), A(" vence el "), D(), A(".")),
                 lambda: (A("Centro de estudios: "), self.put_org(d, "university", bare=True), A("\n")),
                 lambda: (A("Mi hija se va a estudiar "), O("university", "a"), A(", en "), T(), A(".")),
                 lambda: (A("Han publicado las notas de acceso "), O("university", "de"), A(".")),
                 lambda: (A("El congreso se celebra "), O("university", "en"), A(" en "), A(r.choice(MONTHS_ES)), A(".")),
                 ][k]()
            else:
                [lambda: (A("I studied law at "), O("university"), A(".")),
                 lambda: (A("Please find attached my transcript from "), O("university"), A(".")),
                 lambda: (P(), A(" is a senior lecturer at "), O("university"), A(".")),
                 lambda: (A("Tuition at "), O("university"), A(" is due on "), D(), A(".")),
                 lambda: (A("Institution: "), self.put_org(d, "university", bare=True), A("\n")),
                 lambda: (A("Our son starts at "), O("university"), A(" in "), T(), A(" this autumn.")),
                 lambda: (A("The offer letter from "), O("university"), A(" arrived today.")),
                 lambda: (A("The conference is hosted by "), O("university"), A(" in "), A(r.choice(MONTHS_EN)), A(".")),
                 ][k]()
        elif topic == "school":
            if es:
                [lambda: (A("Los niños empiezan "), O("school", "en"), A(" en septiembre.")),
                 lambda: (A("La reunión de padres "), O("school", "de"), A(" es el "), A(r.choice(DAYS_ES)), A(".")),
                 lambda: (A("Te reenvío la circular "), O("school", "de"), A(".")),
                 lambda: (A("Centro educativo: "), self.put_org(d, "school", bare=True), A("\n")),
                 ][k % 4]()
            else:
                [lambda: (A("The kids start at "), O("school"), A(" in September.")),
                 lambda: (A("Parents' evening at "), O("school"), A(" is on "), A(r.choice(DAYS_EN)), A(".")),
                 lambda: (A("Forwarding the newsletter from "), O("school"), A(".")),
                 lambda: (A("School: "), self.put_org(d, "school", bare=True), A("\n")),
                 ][k % 4]()
        elif topic == "government":
            if es:
                [lambda: (A("Hemos recibido una notificación "), O("government", "de"), A(".")),
                 lambda: (A("Según "), O("government"), A(", el plazo termina el "), D(), A(".")),
                 lambda: (A("Presenté la solicitud "), O("government", "en"), A(" por registro electrónico.")),
                 lambda: (A("Organismo: "), self.put_org(d, "government", bare=True), A("\n")),
                 ][k % 4]()
            else:
                [lambda: (A("We have had a letter from "), O("government"), A(".")),
                 lambda: (A("According to "), O("government"), A(", the deadline is "), D(), A(".")),
                 lambda: (A("I filed the form with "), O("government"), A(" online.")),
                 lambda: (A("Agency: "), self.put_org(d, "government", bare=True), A("\n")),
                 ][k % 4]()
        elif topic == "council":
            if es:
                [lambda: (O("council", ""), A(" ha concedido la licencia de obra.")),
                 lambda: (A("Pagué el IBI "), O("council", "a"), A(" en marzo.")),
                 lambda: (A("Me empadroné "), O("council", "en"), A(" el mes pasado.")),
                 lambda: (A("La sede "), O("council", "de"), A(" está cerrada por obras.")),
                 ][k % 4]()
            else:
                [lambda: (O("council"), A(" has approved the planning application.")),
                 lambda: (A("I paid the council tax to "), O("council"), A(" in March.")),
                 lambda: (A("The bin collection is run by "), O("council"), A(".")),
                 lambda: (A("A parking permit from "), O("council"), A(" costs "), M(), A(" a year.")),
                 ][k % 4]()
        elif topic == "court":
            if es:
                [lambda: (A("La vista se celebrará "), O("court", "en"), A(" el "), D(), A(".")),
                 lambda: (A("Recibimos la sentencia "), O("court", "de"), A(".")),
                 lambda: (A("El procedimiento sigue "), O("court", "en"), A(", con el abogado "), P(), A(".")),
                 lambda: (A("Órgano judicial: "), self.put_org(d, "court", bare=True), A("\n")),
                 ][k % 4]()
            else:
                [lambda: (A("The hearing at "), O("court"), A(" is listed for "), D(), A(".")),
                 lambda: (A("We received the judgment from "), O("court"), A(".")),
                 lambda: (A("The claim is with "), O("court"), A(", and "), P(), A(" is acting for us.")),
                 lambda: (A("Court: "), self.put_org(d, "court", bare=True), A("\n")),
                 ][k % 4]()
        elif topic == "insurer":
            if es:
                [lambda: (A("Mi póliza con "), O("insurer"), A(" vence el "), D(), A(".")),
                 lambda: (A("He dado el parte del siniestro a "), O("insurer"), A(".")),
                 lambda: (O("insurer"), A(" nos cubre la reparación del techo.")),
                 lambda: (A("Compañía aseguradora: "), self.put_org(d, "insurer", bare=True), A("\n")),
                 ][k % 4]()
            else:
                [lambda: (A("My policy with "), O("insurer"), A(" renews on "), D(), A(".")),
                 lambda: (A("I reported the claim to "), O("insurer"), A(" yesterday.")),
                 lambda: (O("insurer"), A(" will cover the roof repair.")),
                 lambda: (A("Insurer: "), self.put_org(d, "insurer", bare=True), A("\n")),
                 ][k % 4]()
        elif topic == "company":
            if es:
                (A("El presupuesto de "), O("company"), A(" es de "), M(), A("."))
            else:
                (A("The quote from "), O("company"), A(" comes to "), M(), A("."))
        elif topic == "town":
            if es:
                [lambda: (A("Vivo en "), T(), A(" desde hace "), A(str(r.randint(2, 30))), A(" años.")),
                 lambda: (P(), A(" nació en "), T(), A(" en "), A(str(r.randint(1950, 2005))), A(".")),
                 lambda: (A("Nos mudamos de "), T(), A(" a "), T(), A(" el año pasado.")),
                 lambda: (A("Mañana salgo para "), T(), A(" y vuelvo el "), A(r.choice(DAYS_ES)), A(".")),
                 lambda: (A("La reunión será en "), T(), A(", "), R(), A(".")),
                 lambda: (A("Localidad: "), T(), A("\nProvincia: "), R(), A("\n")),
                 lambda: (A("Te escribo desde "), T(), A(", aquí hace un calor horrible.")),
                 lambda: (A("El envío sale de "), T(), A(" con destino a "), T(), A(".")),
                 ][k]()
            else:
                [lambda: (A("I have lived in "), T(), A(" for "), A(str(r.randint(2, 30))), A(" years.")),
                 lambda: (P(), A(" was born in "), T(), A(", "), R(), A(".")),
                 lambda: (A("We moved from "), T(), A(" to "), T(), A(" last year.")),
                 lambda: (A("I fly to "), T(), A(" tomorrow and come back on "), A(r.choice(DAYS_EN)), A(".")),
                 lambda: (A("The meeting will be in "), T(), A(", "), C(), A(".")),
                 lambda: (A("City: "), T(), A("\nState: "), R(), A("\n")),
                 lambda: (A("Greetings from "), T(), A(", where it has not stopped raining.")),
                 lambda: (A("The parcel ships from "), T(), A(" to "), T(), A(".")),
                 ][k]()
        elif topic == "address":
            if es:
                (A(r.choice(["Dirección: ", "Domicilio: ", "Enviar a: "])), d.ent("place", self.street("es")), A("\n"))
            else:
                (A(r.choice(["Address: ", "Ship to: ", "Home address: "])), d.ent("place", self.street("en")), A("\n"))
        elif topic == "negative":
            if es:
                [lambda: (A(r.choice(ROLES_ES).capitalize()), A(" se compromete a abonar las cuotas en plazo.")),
                 lambda: (A("Mañana tengo que ir a "), A(r.choice(GENERIC_ES)), A(" a primera hora.")),
                 lambda: (A("La oficina central está en "), C(), A(".")),
                 lambda: (A("Escríbeme a "), A(r.choice(DEPTS_ES)), A(" si tienes dudas.")),
                 lambda: (A("Las obras empiezan en "), A(r.choice(MONTHS_ES)), A(" y duran hasta "), A(r.choice(MONTHS_ES)), A(".")),
                 lambda: (A("Tenemos clientes en toda "), R(), A(" y en "), C(), A(".")),
                 lambda: (A("Si "), A(r.choice(ROLES_ES)), A(" no paga, "), A(r.choice(ROLES_ES)), A(" podrá resolver el contrato.")),
                 lambda: (A("Lo hablamos el "), A(r.choice(DAYS_ES)), A(" con calma.")),
                 ][k]()
            else:
                [lambda: (A(r.choice(ROLES_EN).capitalize()), A(" shall repay the loan in monthly instalments.")),
                 lambda: (A("I need to go to "), A(r.choice(GENERIC_EN)), A(" first thing tomorrow.")),
                 lambda: (A("Head office is in "), C(), A(".")),
                 lambda: (A("Contact "), A(r.choice(DEPTS_EN)), A(" if you have any questions.")),
                 lambda: (A("Works start in "), A(r.choice(MONTHS_EN)), A(" and run until "), A(r.choice(MONTHS_EN)), A(".")),
                 lambda: (A("We have customers across "), R(), A(" and "), C(), A(".")),
                 lambda: (A("If "), A(r.choice(ROLES_EN)), A(" fails to pay, "), A(r.choice(ROLES_EN)), A(" may end the agreement.")),
                 lambda: (A("Let's talk it through on "), A(r.choice(DAYS_EN)), A(".")),
                 ][k]()

    # ---------------------------------------------------------------- documents

    TOPICS = ["bank", "hospital", "university", "school", "government", "council", "court", "insurer", "town", "town", "town", "negative", "negative", "address", "company"]

    def doc(self, i: int) -> dict:
        r = self.r
        x = r.random()
        lang = "es" if x < 0.55 else "en" if x < 0.92 else "mixed"
        base = r.choice(["es", "en"]) if lang == "mixed" else lang
        d = Doc(r, base)
        frame = r.choices(["email", "letter", "form", "note", "chat"], [40, 15, 15, 20, 10])[0]
        n = r.randint(2, 6)
        topics = [r.choice(self.TOPICS) for _ in range(n)]
        if frame == "form":
            for t in topics:
                d.lang = base if lang != "mixed" else r.choice(["es", "en"])
                self.form_line(d, t)
        else:
            if frame in ("email", "letter"):
                self.greeting(d, frame)
            if frame == "letter" and r.random() < 0.6:
                d.ent("place", self.town(d.lang))
                d.add(", " + self.date(d.lang) + "\n\n")
            for j, t in enumerate(topics):
                if lang == "mixed":
                    d.lang = r.choice(["es", "en"])
                self.sentence(d, t)
                if not d.text.endswith("\n"):
                    d.add("\n" if frame == "chat" else ("\n\n" if r.random() < 0.3 else " "))
            if frame in ("email", "letter"):
                self.signature(d)
        return {"id": f"synth/{i}", "source": "synth", "lang": lang, "text": d.text.strip() + "\n", "spans": d.spans}

    def form_line(self, d: Doc, t: str) -> None:
        if t in ("town", "address", "negative"):
            self.sentence(d, "town" if t != "address" else "address")
            if not d.text.endswith("\n"):
                d.add("\n")
            return
        lab = {"es": {"bank": "Entidad bancaria", "hospital": "Centro sanitario", "university": "Universidad", "school": "Centro escolar", "government": "Organismo", "council": "Ayuntamiento", "court": "Juzgado", "insurer": "Aseguradora", "company": "Empresa"},
               "en": {"bank": "Bank name", "hospital": "Hospital", "university": "University", "school": "School", "government": "Issuing authority", "council": "Local authority", "court": "Court", "insurer": "Insurance provider", "company": "Employer"}}[d.lang][t]
        d.add(f"{lab}: ")
        self.put_org(d, t, bare=True)
        d.add("\n")

    def greeting(self, d: Doc, frame: str) -> None:
        r = self.r
        if d.lang == "es":
            g = r.choice(["Hola ", "Buenos días, ", "Estimado ", "Estimada ", "Querida ", "Hola, "])
            d.add(g)
            if r.random() < 0.5:
                d.ent("person", self.first("es"))
            else:
                d.add(r.choice(["Sr. ", "Sra. ", "Dr. ", ""]))
                d.ent("person", self.person("es"))
            d.add(":\n\n" if g.startswith("Estimad") else ",\n\n")
        else:
            d.add(r.choice(["Hi ", "Dear ", "Hello ", "Morning "]))
            if r.random() < 0.5:
                d.ent("person", self.first("en"))
            else:
                d.add(r.choice(["Mr ", "Ms ", "Dr ", "Mrs ", ""]))
                d.ent("person", self.person("en"))
            d.add(",\n\n")

    def signature(self, d: Doc) -> None:
        r = self.r
        d.add("\n\n" + r.choice(["Un saludo,", "Gracias,", "Atentamente,", "Saludos"] if d.lang == "es" else ["Best,", "Thanks,", "Kind regards,", "Cheers,"]) + "\n")
        d.ent("person", self.person(d.lang))
        if r.random() < 0.5:
            d.add("\n" + r.choice(DEPTS_ES if d.lang == "es" else DEPTS_EN) + "\n")
            self.put_org(d, r.choice(["bank", "hospital", "university", "school", "government", "council", "court", "insurer", "company"]), bare=True)
        if r.random() < 0.4:
            d.add("\n")
            d.ent("place", self.town(d.lang))
            if r.random() < 0.5:
                d.add(", " + (self.region() if r.random() < 0.6 else self.country()))


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 24000
    g = Gen(SEED)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    kinds: dict[str, int] = {}
    with OUT.open("w", encoding="utf8") as f:
        for i in range(n):
            rec = g.doc(i)
            for s in rec["spans"]:
                assert rec["text"][s["start"]:s["end"]].strip() == rec["text"][s["start"]:s["end"]], rec
                kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"wrote {n} documents to {OUT}: spans {kinds}")


if __name__ == "__main__":
    main()
