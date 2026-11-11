# Spanish language support

Blind's built-in patterns and fake lists cover English and Spanish. Recall is strict. Every person name token of at least three letters must be gone.

## What Blind handles

Detectors recognize DNI, NIE and CIF numbers with valid control characters. Their fakes pass the same check. Other id patterns include labelled `pasaporte` and `póliza`. Phones and IBANs keep their layout, and fake IBANs pass their check digits.

Amounts keep format, currency and arithmetic. `1.234,56 €` stays in Spanish format. A base, percentage and total are recomputed together. Dates such as `9 de abril de 2026` and `6 de octubre` shift by whole weeks. `Sra.` and `Dr.` anchor names, and so do a greeting (`Hola Belén,`, `Estimada Remedios:`, `Buenos días Isidro,`), the line after a closing (`Un saludo,`, `Atentamente,`) and a label (`Nombre:`, `Paciente:`, `Cliente:`). A run of capitalised words before `S.L.` or `S.A.` is an organization anywhere in the text, and so is `Empresa:` before a name. In a sender's display name, words such as `S.L.`, `Asesores` and `Clínica` mark it as an organization. Fake names, companies, places and hosts come from small Spanish and English lists, in the language of the value: a Spanish name or company gets a Spanish fake, even inside English text, and a value that says nothing about its language follows the paragraph around it. A first name keeps its gender, and a mobile starting with 6 or 71 to 74 stays a Spanish mobile.

Blind carries names and companies found in headers, greetings, signatures, labels, titles or `known` into later mentions. Plain prose names, and companies without a legal suffix, may pass through, so pass private values in `known`. Optional `@centrst/blind-ner` adds local multilingual GLiNER. Only English and Spanish are measured.

## Spanish recall

The corpus has 164 Spanish files. Presidio uses its fair configuration with organizations on and `.example` domains rewritten. LLM Guard uses `all_tld`. Gretel has 444 synthetic Spanish finance documents. It uses Presidio `with_org` and LLM Guard `all`. Every GLiNER number on this page comes from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

| Dataset | Tool | Person | Organization | Place |
| --- | --- | ---: | ---: | ---: |
| Blind corpus | Blind core | 82.6% | 98.2% | 0% |
| Blind corpus | Blind + GLiNER | 99.8% | 98.9% | 98.7% |
| Blind corpus | Presidio | 48.1% | 45.2% | 89.5% |
| Blind corpus | LLM Guard | 77.4% | 18.5% | 100% |
| Gretel | Blind core | 17.7% | 29.1% | 2.7% |
| Gretel | Blind + GLiNER | 69.0% | 99.7% | 97.9% |
| Gretel | Presidio | 42.9% | 50.1% | 83.7% |
| Gretel | LLM Guard | 35.5% | 18.5% | 85.5% |

Blind core person recall is 82.6% in Spanish and 87.9% in English. GLiNER raises it to 99.8%, the same as on English. On Gretel, GLiNER finds 69.0% of Spanish person labels against 94.1% on English. This is the known limit of the NER package in Spanish. Of 40 sampled Spanish person labels in Gretel, 18 were not names.

LLM Guard ran its English setup on Spanish. Its measured configuration supports English and Chinese. On the corpus, Blind core found more people and organizations than Presidio, and Presidio found more places. On Gretel, Presidio found more of all three. Presidio found 28.2% of corpus dates and 13.0% of ids. Its date patterns are English, and the Spanish spaCy model has no date label. Only 4 of 34 NIF-shaped ids had valid check letters, partly explaining the gap.

## Structured values

Gretel has no amount labels. Its date labels include durations, frequencies, years and phrases, not only calendar dates.

| Dataset | Tool | ID | Date | Amount | Phone | IBAN |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Blind corpus | Blind core | 100% | 100% | 100% | 100% | 100% |
| Blind corpus | Blind + GLiNER | 100% | 100% | 100% | 100% | 100% |
| Blind corpus | Presidio | 13.0% | 28.2% | 0% | 53.4% | 87.2% |
| Blind corpus | LLM Guard | 16.2% | 100% | 0% | 86.4% | 100% |
| Gretel | Blind core | 77.9% | 60.8% | not labeled | 85.9% | 100% |
| Gretel | Blind + GLiNER | 78.6% | 61.2% | not labeled | 85.9% | 100% |
| Gretel | Presidio | 32.1% | 40.9% | not labeled | 77.5% | 100% |
| Gretel | LLM Guard | 68.7% | 62.7% | not labeled | 94.4% | 100% |

The `Blind + GLiNER` rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

The Blind corpus is home ground. Gretel is synthetic and its labels are incomplete. Replaced but unlabelled values count against precision, so its precision is a floor. On Gretel, in the October run, Blind with GLiNER had 48.4% Spanish person precision. Spanish person labels are noisy too.

## Example

This is real output of the current code. It uses the fixed seed `readme` and passes `Pablo Mena` as a known person. `pnpm readme:example` regenerates it from the input in `test/support/readme-example.ts`, and a test fails if this block and the code disagree. All values and `.example` addresses are invented.

<!-- example:spanish -->
```
real
From: Ana Ruiz <ana@gestoria-norte.example>
Hola Pablo, te paso la factura de Gestoría Norte S.L.
Total: 247,80 € (cuota 206,50 € + 20 %), vence el 3 de marzo de 2026.
IBAN ES91 2100 0418 4502 0005 1332, tarjeta 4111 1111 1111 1111 12/28.
DNI 12345678Z. Llámame al +34 761 234 508. Un saludo, Ana

blind
From: Soraya Andrade <soraya@despacho-altavia.example>
Hola Justino, te paso la factura de Gestión Palvera S.L.
Total: 160,33 € (cuota 133,61 € + 20 %), vence el 23 de diciembre de 2025.
IBAN ES68 4960 9743 6835 4847 3378, tarjeta 4111 1150 5986 1850 12/28.
DNI 89584015G. Llámame al +34 777 064 298. Un saludo, Soraya
```
<!-- /example -->

The fake total equals the fake cuota plus 20%. DNI and IBAN fakes pass their checks. The names, the host and the mobile stay Spanish. `Gestoría Norte S.L.` appears only in prose, but its legal suffix and the sender's host `gestoria-norte.example` both mark it as a company, so it gets a Spanish fake company. Without either cue, a company named only in prose passes through unchanged: add it to `known` to replace it.

## Benchmark limits

Reports ran on 2026-10-24 at commit `4f5183f`. The Blind recall rows were measured again with core 0.2.0, after greetings, signatures, labels, legal suffixes and address words were added: the person, organization and place rows of the corpus on 2026-11-10, the rest of the Blind rows on 2026-11-11 at commit `5369e57`. The person precision figure is from the October run. The other tools were not rerun. Blind's corpus is home ground. Gretel is synthetic, outside the corpus and not neutral truth. Its incomplete labels make precision a floor. Blind round tripped 381 corpus and 888 Gretel files. See [RESULTS.md](../../scripts/bench/RESULTS.md) and [RESULTS-llmguard-gretel.md](../../scripts/bench/RESULTS-llmguard-gretel.md).
