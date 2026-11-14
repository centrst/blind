# Known misses

Generated from `corpus/adversarial/*.json` by `pnpm known-misses`. Do not edit by hand.

26 inputs slip through silently. 63 more in the same set are caught, either replaced or reported by the leak check. Each miss below has a test marked expected-to-fail, so the build notices the day one starts working and this list gets shorter.

A miss is silent when the value stays in the blind text and the leak check has nothing recorded to look for. When the leak check can see the value it reports it and the CLI exits 2, which counts as caught.

| ID | Category | Input | What slips and why |
| --- | --- | --- | --- |
| X6 | context | `"Usuario: ana_ruiz en la plataforma"` | An underscore counts as a word character, so the name is not a whole word. The leak check applies the same rule. |
| X7 | context | `"Handle: @AnaRuiz_Design"` | Camel case glues the two names into one word, which the whole-word rule skips. |
| X8 | context | `"Gracias #anaruiz por todo"` | Joined lower-case names are one token, not a known form. |
| X15 | context | `"The retainer for Strand & Partners is due on Friday."` | In prose only a legal suffix marks a company. A company word alone (Partners, Group, Studio) is too common in ordinary sentences to count, so a known list or a NER detector finds it. |
| X17 | context | `"From: ana@dorsal.example\n\nThe Dorsal team will call."` | Only a host label of two to six hyphenated words marks a company in the text. A one-word label is too often an ordinary word to take as a name. |
| E2 | encodings | `"Hola Ana R=\nuiz, adjunto."` | The soft break splits the surname, so the known name pattern fails on it. The first name is still replaced. |
| E3 | encodings | `"From: =?UTF-8?Q?Mar=C3=ADa_Garc=C3=ADa?= says hi"` | The encoded-word form hides the name from every pattern and from the leak check. |
| E4 | encodings | `"Content-Transfer-Encoding: base64\n\nUGFyYSBBbmEgUnVpeg=="` | Encoded payloads are opaque to text patterns. Decode them first if they carry private text. |
| E7 | encodings | `"Total: &euro;247,80 con IVA"` | The currency entity is not read as a currency sign, so the bare number is not an amount. |
| F13 | formats | `"Patient Ana Ruiz was seen on Tuesday and sent home."` | A name in plain prose with no title, address or known list entry has nothing a pattern can hold on to. A NER detector (the optional @centrst/blind-ner package) or a known list finds it. |
| F14 | formats | `"Reference 123 45 6789 is on the form."` | Three short digit groups separated by spaces look like many other numbers. Only the dashed form, or the spaced form after a label such as SSN, counts as an SSN. |
| F17 | formats | `"A refund of EUR -100 was booked against the old order."` | The amount pattern reads a sign before the currency or the number, not between a currency code and the number, so EUR -100 is not an amount to blind. It goes out unscaled, and a computed EUR -74 in an answer comes back unchanged without being listed in invented. -100 €, -€100.00 and -$1,234.56 are scaled. |
| O1 | obfuscated | `"Write to ana at gestoria dot example before Friday."` | Spelled-out "at" and "dot" are prose, not an address. The known domain never appears in its dotted form, so neither the detectors nor the leak check see it. |
| O3 | obfuscated | `"Write to ana@gestoria .example before Friday."` | A space inside the domain breaks the address pattern and the known domain pattern. The local part is caught through the known name only. |
| O4 | obfuscated | `"Contact: ana [at] gestoria [dot] example"` | Bracketed "at" and "dot" words are not an address, and the known domain is not written out. |
| S2 | splits | `"Pagar a ES91 210 0041 8450 2000 5133 2 hoy."` | The IBAN pattern wants groups of four. Irregular grouping is not recognised, and the leak check only watches values it already found. |
| S3 | splits | `"Llama al +34 791 123\n456 por la tarde."` | Separators in a phone number may be spaces, dots or dashes, not newlines. The first digits are replaced and the tail stays. |
| S4 | splits | `"Escribe a ana@gestoria-\nnorte.example si hay dudas."` | The address pattern does not cross a line break, so the end of the domain survives the wrap. |
| S5 | splits | `"Cuenta: ES91 2100 0418\n4502 0005 1332 gracias"` | Same grouping rule as S2, the newline breaks the run of groups. The tail is caught as a number, the head is not. |
| S6 | splits | `"Contacto: Ana Ru-\niz de Gestoría"` | A hyphen and a line break inside a surname split it. The first name is replaced, the surname is not a known form. |
| W1 | words | `"El importe es doscientos euros más IVA."` | Prose numbers are not detected. This is listed under Limits in the README. |
| W2 | words | `"The fee is twenty euros per month."` | Prose numbers are not detected. |
| W3 | words | `"Nos vemos el tres de marzo en la oficina."` | Dates need digits. A day spelled out as a word is not parsed. |
| W4 | words | `"The deadline is March third."` | Ordinal words are not parsed as days. |
| W5 | words | `"Vence el próximo viernes."` | A relative date carries no number to shift and holds no calendar fact. |
| W6 | words | `"Mi número es seis cero cero uno dos tres cuatro cinco seis."` | Digits spelled as words are not detected. |
