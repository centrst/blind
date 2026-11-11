# blind

blind rewrites private text into a blind copy before it goes to a model or another service, then maps the answer back to the real values. Emails, web addresses, phone numbers, IBANs, cards, tax and identity numbers, IP addresses, amounts and dates become consistent fakes of the same kind and shape, and so do the names, companies and places it finds. Wording and arithmetic stay intact, so the service can still work with the text.

<!-- example:opening -->
```
real   From: Sophia Ward <sophia@ward-bookkeeping.example>
       Total: £1,240.80 (£1,034.00 + 20% VAT), due on 3 March 2026.
blind  From: Hilary Brierley <hilary@harbour-clinic.example>
       Total: £802.80 (£669.00 + 20% VAT), due on 23 December 2025.
```
<!-- /example -->

All values above are invented, and the blind side is real output. The real text and the mapping stay on your machine. The service sees the blind copy, and you map its answer back locally. [What it looks like](#what-it-looks-like) shows a longer example.

blind has no runtime dependencies (C8), makes no network calls (C7) and runs on standard JavaScript (C19). That is the design. There is no model to download, no native code to build and nothing else to audit, and nothing leaves your process. CI tests it on Node 22, 24 and 26. Browsers, Workers, Deno and Bun offer the same standard APIs but are not tested in CI. The `blind` and `unblind` commands cover terminal use.

The trade is names. Without a model, blind finds a person, company or place in two ways. You list it in `known`, or the text gives it away where mail usually puts a name: a sender line such as `Sophia Ward <sophia@ward-bookkeeping.example>`, a greeting (`Dear Margaret,`), the line after a closing (`Kind regards,`), a label (`Patient:`), a title such as `Dr.` or `Sra.`, a legal suffix (`Finchley Dental Ltd`), the words of a private address (`margaret.holloway@finchley-dental.example`), or a later mention of a name it already found. A name that appears only in plain prose goes out unchanged, and the leak check cannot report it, because nothing found it. On blind's test corpus of 381 synthetic texts, mostly emails, it found 85.1% of people, 98.2% of companies and none of the places with nothing passed in. With one person per email listed in `known`, it found 99.3% of all the people. The corpus is home ground: its emails were written with these same greetings and signatures, so expect less on mail that writes names elsewhere.

So list every person, company and place you know is private in `known`. A listed value is replaced and leak-checked in any letter case (C3). A long list is cheap: an entry the text does not contain costs about 15 microseconds, so 10,000 contacts add about 0.15 s to a call (C55). The few exceptions, such as stop words and one-letter parts of a name, are named in `leaks.unenforced`. For text you cannot list in advance, turn on [paranoid mode](#paranoid-mode). It flags anything blind left that still looks private, such as an unfound capitalised name, a long digit run or an encoded block, and makes `assertNoLeaks` throw until each one is listed or cleared (C50, C51). It over-flags, so plan for a review step. Read the blind copy before you send it either way.

A separate package with a named-entity detector is in development. It finds more names in plain prose, but it needs a 1.1 GB model and native dependencies, so it stays out of this one. With just this package, use `known` and paranoid mode.

Contents: [Install](#install) · [Quick start](#quick-start) · [What it looks like](#what-it-looks-like) · [What it finds](#what-it-finds) · [Paranoid mode](#paranoid-mode) · [Limits](#limits) · [Conversations](#conversations) · [Streaming](#streaming) · [Fakes, placeholders or random values](#fakes-placeholders-or-random-values) · [Model SDKs](#with-model-sdks) · [Request handler](#in-a-request-handler) · [CLI](#command-line) · [API](#api) · [Detectors](#detectors) · [Language support](#language-support) · [Where it runs](#where-it-runs) · [Signed receipts](#signed-receipts) · [Compared](#compared-with-other-tools) · [Claims](#claims) · [Development](#development)

## Install

```sh
npm install @centrst/blind
```

Node 22 or newer. Before 1.0, a minor version can change the API or the mapping format, and the changelog says when it does. `npm install @centrst/blind@next` installs the newest prerelease instead.

This README describes the source revision you are reading. Each published version bundles its own copy.

## Quick start

```ts
import { blind, unblind, assertNoLeaks } from '@centrst/blind';

const result = blind([email], {
  known: [
    { kind: 'person', value: 'Sophia Ward' },
    { kind: 'org', value: 'Moorcroft Joinery Ltd.' },
  ],
  deny: ['*@my-domain.example', 'Project Falcon'],
});

assertNoLeaks(result);                    // throws if a value it found or was given survived
const answer = await askTheModel(result.texts[0]);
const { text, invented } = unblind(answer, result.mapping);
```

`text` is the answer with real names, amounts and dates back in place. `invented` is a heuristic: it lists amounts, dates, emails and names in the answer that no real value stands behind, and it only recognises a name whose first word is on blind's built-in first-name list. A made-up phone number, company or `Thaddeus Okonkwo` is not listed. The mapping holds real values: keep it local and never send it anywhere.

## What it looks like

Real output for one invented email, with `Ben Carver` passed as `known` and a fixed seed so the output is reproducible. A test in the repository fails if this section and the code disagree.

<!-- example:full -->
```
real
From: Sophia Ward <sophia@ward-bookkeeping.example>
Hi Ben, here is the invoice from Moorcroft Joinery Ltd.
Total: £1,240.80 (£1,034.00 + 20% VAT), due on 3 March 2026.
IBAN GB82 WEST 1234 5698 7654 32, card 4111 1111 1111 1111 12/28.
Policy number 48213907. Call me on +44 7700 900123. Thanks, Sophia

blind
From: Hilary Brierley <hilary@harbour-clinic.example>
Hi Barry, here is the invoice from Copperfield Labs Ltd.
Total: £802.80 (£669.00 + 20% VAT), due on 23 December 2025.
IBAN GB50 SLGZ 8496 0974 3683 54, card 4111 1150 5986 1850 12/28.
Policy number 84733788. Call me on +44 7700 900570. Thanks, Hilary
```
<!-- /example -->

- The base and the total still add up: the blind total is the blind base plus 20% VAT. One factor scales every amount, and one shift of whole weeks moves every date.
- The IBAN and card fakes pass their own checksums and keep their country, network and format. The policy number keeps its length and layout, and the UK mobile stays a UK mobile. The expiry date after the card is left alone.
- No one can be reached at a fake address (C58). A private host becomes an invented host under `.example`, and a fake mailbox at a public provider moves to the provider's name under `.example` (`claire.hayes@gmail.example`), a name RFC 2606 reserves. The provider itself stays only when the address is written unchanged (`info@gmail.com`) or the provider could never issue the fake (an underscore at Gmail).
- A fake number is drawn from a range no one holds wherever such a range exists (C58): every UK number blind finds or you list in `known` goes to the Ofcom drama range for its kind of line (020 7946 0xxx in London, 0113 496 0xxx in Leeds, 07700 900xxx for mobiles, 0808 157 0xxx for freephone, 01632 960xxx where its area has none), every ten-digit North American number to NXX-555-01XX (kept for fiction), Spanish mobiles to 75 to 79 (kept in reserve and not yet given to any operator), and IP addresses to documentation addresses. The built-in detector finds a UK number written with `+44` or `0044`, and a mobile written with `07`, but not a landline written with its 0 (`020 7946 0958`), so list those in `known`. A fake can only coincide with a real number where there is no such range: Spanish landlines and special-rate numbers, numbers from other countries, IBANs, SSNs, DNI, NIE and CIF, VAT numbers and policy or invoice ids. Cards use the first six digits of the networks' published test numbers (4111 11 for Visa, 5555 55 for Mastercard and so on), but no card range is reserved, so a fake card can still match an issued one. Check the fakes before a downstream system calls, pays or writes to them.
- The email is English, so the fakes are too: a woman's English name for Sophia, an English surname and an English host (C31).
- "Sophia" in the sign-off gets the same fake as the sender, because a name found once is found again.
- "Moorcroft Joinery Ltd." became another company because it ends in a legal suffix. A company named in prose without one (`Moorcroft Joinery`), and a person named in prose away from a greeting, a signature, a label or a title, is not found unless it is in `known`. The leak check cannot report it either, since nothing found it. Paranoid mode flags it for review. This is the main thing to plan for.

Pass the mapping to the next call and the conversation stays consistent:

<!-- example:turn -->
```
next turn, real    Has Sophia paid the £1,034.00 yet?
next turn, blind   Has Hilary paid the £669.00 yet?
```
<!-- /example -->

And the model's answer comes back with real values. The model invented a card fee, so it is scaled back and listed in `invented`:

<!-- example:answer -->
```
model answer   Yes, Hilary paid £802.80 on 23 December 2025. A card fee of £25.00 is still unpaid.
unblinded      Yes, Sophia paid £1,240.80 on 3 March 2026. A card fee of £38.64 is still unpaid.
invented       ["£25.00"]
```
<!-- /example -->

The fixed seed is only there to make this example reproducible. Leave `seed` out in real use: the default is a fresh random seed per conversation, so the same person gets unrelated fakes in different conversations. Reusing one seed everywhere makes those fakes linkable, and anyone who knows the seed can try candidate names until one comes out as the fake.

## What it finds

**Scope.** What is tested is plain text in English and Spanish prose: emails, threads, invoices and the like. JSON, CSV and other structured formats pass through as text. Detection inside them is weaker, and field names such as `"name":` or a `surname` column are not used to find values. Other locales are not found: a German or French date (`7. April 2026`, `7 avril 2026`), a German or French phone layout (`(030) 123 45 67`, `01 23 45 67 89`) and titles such as `Herr`, `Frau`, `M.` or `Mme` go out as written. Each text may be at most 1,048,576 UTF-16 code units (`text.length`) by default. A longer one makes `blind` throw a `BlindError` with kind `input-too-large`, the index of the text, its length and the limit, never its content, before any work is done (C32). The `maxTextLength` option changes the limit, and `Infinity` turns it off. Time grows about linearly with the text. A test fails if 800 KB takes more than six times the CPU time of 200 KB (C41). An answer given to `unblind`, or every chunk pushed to one `createUnblinder` together, has the same limit by default, set by a last argument `{ maxTextLength }`, and a longer one throws the same `input-too-large` error with index 0, while unblind time grows about linearly with the answer and stays below the time it took to blind the text (C32, C49).

- **Names, orgs, places.** Found through your `known` list, `Name <address>` anywhere in the text, titles such as `Dr.`, `Sra.` or `Mrs` before a name, values carried from earlier turns, and any `Detector` you add. Ordinary mail gives more away (C54). At the start of a line, one to three capitalised words after a greeting (`Dear Margaret,`, `Hi Ana, Luis and Marta,`, `Hola Belén:`, `Estimado/a Cayetano,`, `Buenos días Isidro,`) are a person, and so is a name after a label (`Name:`, `Patient:`, `Customer:`, `Client:`, `Contact:`, `Attn:`, `Nombre:`, `Paciente:`, `Cliente:`), while `Company:`, `Organisation:` and `Empresa:` label an org when the rest of the line is only the company name (`Company: Dorsal Partners (billing)` labels nothing). The line right after a closing (`Regards,`, `Kind regards,`, `Best,`, `Thanks,`, `Cheers,`, `Sincerely,`, `Saludos,`, `Un saludo,`, `Atentamente,`, `Gracias,`) holding only one to four capitalised words is a person, and then the first of the next three lines that holds only a company name with a company word or legal suffix is an org, unless a blank line comes first. A name line with anything else on it (`Odette Ashworth, CEO`) starts neither. Quoted lines (`> > Kind regards,`) count too. Group, role and common words keep these from counting: `Hi all`, `Hi team`, `Dear Sir`, `Dear Customer`, `Hola a todos`, a closing followed by `Accounts` or `Sent from my iPhone`. Anywhere in the text, capitalised words before a legal suffix (`Ltd`, `LLC`, `Inc`, `GmbH`, `PLC`, `Corp`, `S.L.`, `S.A.`) are an org, without a word that only opens the sentence (`Regarding`). The words of a private address count as well: the parts of its local part, three letters or more, not role words such as `info`, `sales` or `no-reply`, not common words such as `will` and not words of the private hosts, are found again wherever the text writes them capitalised as words of their own (`Margaret` for `margaret.holloway@...`), and the words of its host written as capitalised words (`Finchley Dental` for `finchley-dental.example`, with or without a legal suffix) are an org when the host label has two to six hyphenated words. A one-word host (`dorsal.example`) marks nothing. An address at a public provider (`gmail.com`) says nothing. A person found once is also found wherever the name appears again bare, in any text of the call, unless the text also uses that word in lower case as an ordinary word. A name word of one or two letters (`Li`) is not, so list the full name in `known` (`Li Na`), since a single Latin letter alone is refused there. A sender with company words (`Clínica`, `Asesores`, `Labs`, `S.L.`, `Inc`) is an org, and an org found once is found again by its full name. Fakes come from small built-in English and Spanish lists, in the language of the value: an English name, company, place or host gets an English fake and a Spanish one a Spanish fake, and a value that says nothing about its language (`Mena`, `Daniel`) follows the paragraph around it. A first name keeps its gender (C31). Email local parts follow the fake name. Casing (ALL CAPS, lower case) is carried over.
- **Emails, domains, URLs.** Domains become `*.example`. URL paths keep their shape, long ids in paths and query strings are scrambled, emails in query strings are rewritten. Public platforms (gmail.com, google.com, outlook.com, icloud.com, booksy.com, fresha.com, calendly.com, github.com and a few more) are left alone.
- **Phones, IBANs.** Same length and format, separators kept. A UK, Spanish or North American mobile stays a mobile of its country, and a landline a landline (C31). A nine-digit UK number gets a ten-digit fake, since no drama range has nine (C58). Fake IBANs carry valid check digits.
- **Typed ids.** Payment cards (Luhn and network checked, in any one separator style), US SSNs (dashed), Spanish DNI, NIE and CIF (control character checked), EU VAT numbers, and IPv4 and IPv6 addresses. Each fake passes the same check as the original and keeps what says what it is: the card network, the NIE letter, the CIF organisation type, the VAT country. IP addresses become documentation addresses (RFC 5737 and RFC 3849). The same number written two ways gets one fake (C20).
- **Other ids.** Six digits or more in a row, letters mixed with four digits or more, and a value with three digits or more after a label such as `DNI`, `SSN`, `pasaporte`, `póliza`, `NHC` or `policy number`. Same length and layout.
- **Amounts.** One factor in [0.6, 1.6] per conversation, rounded to the original precision, currency and number format kept exactly (`1.234,56 €`, `$1,234.56`, `1 240,80 €`, `USD 12.00`, `15 euros`). Thousands grouped with a plain, no-break or thin space are read as one number, so `12 500 €` is twelve thousand five hundred. When the text shows a relation, the derived amount is recomputed from the scaled operands: a base with a percentage and its surcharge, a base plus a VAT line, `a + b = c`. An amount in two relations keeps both, since the factor is drawn again until one rounds both to the same cent, and when no draw does, or a later turn keeps the first factor, it keeps the first relation found, a percentage before a sum before a surcharge. Everything else is scaled alone, so it can be off by one unit of the last digit (C4).
- **Dates.** One shift per conversation, a nonzero multiple of 7 days up to 70 either way, so weekdays and intervals hold (C5). ISO, `April 7, 2026`, `7 April 2026`, `9 de abril de 2026`, `6 de octubre` and slash dates are re-rendered in the same format and language. Times of day are untouched. Dates without a year stay without one.
- **Leak check.** After rewriting, the output is scanned for every original value found, every `known` value, every value from earlier turns and every `deny` entry (C2, C3). A `known` value made only of stop words (`Al`, `De`) is matched as written or in capitals, so its lower-case copy (`al` in `fue al banco`) is an ordinary word and is neither replaced nor reported as a hit, and so is the lower-case copy of a part on the stop list that a full name writes capitalised (`al` of `Al Brenner` in Spanish text) or of a one-letter part of a full name (`o` of `O Li`). A two-syllable Korean value is matched only where a word starts, so a copy inside a longer word (`지원` in `우리팀지원님`) is neither replaced nor reported as a hit. The report names each such entry instead: `leaks.unenforced` holds `{ kind, index, reason }` per entry, `index` its place in `known` and `reason` `stop-word`, `stop-word-part`, `one-letter-part` or `hangul-inside-word`, never the value, whether or not the text writes such a copy. It never sets `ok` to false, `assertNoLeaks` throws only on hits, and the CLI prints each entry by index and kind on stderr (C3, C40). A value in a script without word spaces (Chinese, Japanese) is checked as a plain substring, a Hebrew or Arabic value also behind a glued prefix at a word start (`לדוד`, `ومحمد`), reported by kind and the offset of the value (C3, C40), and a `known` value that is empty or one character makes `blind` throw with its index and kind, since it cannot be checked. One character of a script without word spaces (`华`) is matched as a substring and replaced like any known value as a `person`, `org`, `place` or `domain`, and refused with `invalid-known`, its index and kind as an `email` or `id`, which have no fake for it (C40). A one-character word of a known full name is replaced inside the name in both scripts: a Latin one (`O` of `O Li`) is also found bare as written or in capitals, and one of a script without word spaces (`华` of `李 华`) is not looked for bare, so the leak check holds a bare copy back (C40). A known `id` with no ASCII letter or digit and a known `email` without an `@` that has text on both sides are refused the same way at any length, since their fakes rewrite exactly those (C40). A value none of these cover is not checked.

## Paranoid mode

The leak check only knows values blind found or you gave it. A name nothing found goes out as written, and nothing reports it. `paranoid: true` adds a review gate for that case. Before the blind copy is used, a sweep reads the text blind leaves as written and flags anything that still looks private (C50):

- `name`: capitalised words that are not common ones, a run of them anywhere (`Patient Ana Ruiz`), a single one anywhere but the start of a sentence, a line or a subject line (`Nos vemos con Lucía`). A single one right after an opening bracket, a quotation mark, a dash, a bullet or a `>` quote marker counts as starting a sentence, so `(Zorina)` and `"Zorina"` are not flagged. Function words, months, weekdays, mail headers, greetings and the public platforms' names are left alone.
- `number`: five digits or more in groups (`123 45 6789`, `ES91 210 0041 8450`).
- `handle`: `@` or `#` before a word (`@AnaRuiz_Design`), including the tail of an address the detector did not take whole.
- `encoded`: MIME encoded words, quoted-printable escapes and base64 runs, which hide text from every pattern.
- `address`: an address spelled out (`ana at gestoria dot example`, `[at]`, `[dot]`).

Each suspect is listed in `leaks.suspects` by kind, text index and offsets in the input text, so a reviewer can find it in what they hold. The value is never in the report. Any suspect makes `leaks.ok` false, so `assertNoLeaks` throws and the CLI exits 2 with nothing written. The blind copy and the mapping are the same with or without the sweep.

The review loop: put a suspect that is private in `known`, so it is replaced, and one that is not in `allow`, matched whole without regard to case or accents, and run again (C51). An `allow` list kept across documents is how a team's review gets faster.

```ts
const res = blind([note], { paranoid: true, known, allow: ['Seguridad Social'] });
assertNoLeaks(res);   // throws until every suspect is replaced or cleared
```

How much it catches and what it costs, measured 2026-11-09:

- On the labelled corpus it flags at least 97% of the values that survive detection (C52): 390 of 399 in bare mode and 183 of 185 with the known lists, measured 2026-11-10. Before blind read greetings, signatures, labels and legal suffixes, 1,106 values survived in bare mode and it flagged 1,097. It misses the same values as then, so the share is lower only because fewer survive. In bare mode it misses 9 values. Seven are Hebrew and Arabic names, which have no capitals. One is a place name alone at the start of a line. One is the title `Dr.`, which the scorer counts as part of a name. With the known lists it misses 2, the place name and the title. 21% of corpus runs also carry a false alarm. The common-word list was tuned on this corpus, so that rate is a best case.
- On the 888 Gretel finance documents, which blind was not tuned on, it flagged 2,891 of the 3,365 labelled values blind left (86%) and held 877 of the 888 documents. Contracts capitalise terms such as `Policy`, `Borrower` and `Agreement`, so about 15 suspects per document match no label. Gretel's labels are incomplete, so some of those are private too. The run is recorded in [RESULTS-paranoid.md](scripts/bench/RESULTS-paranoid.md).
- Of the 28 known misses in the adversarial set it flags 16: an unlabelled name in prose, a signature a blank line below its closing or with a job title after the name, a company in prose without a legal suffix or named only by a one-word host, split IBANs, a spaced SSN, handles, hashtags, encoded words and base64, and spelled-out addresses (C52). Prose numbers and dates, words split by a soft break or a wrap, and an underscored handle in lower case still go through.

Use it where a human reviews what leaves, or where a held document is cheaper than a leaked one. With `replaceWith: 'placeholder'` nothing in the blind copy reads like real data. Every value blind replaced is marked, and a reviewer has looked at every value it left.

## Limits

blind lowers what leaves your machine. It is not 100%, so check the blind copy before you send it. Anything it misses goes out as written, and the leak check only reports values it found somewhere or that you gave it in `known` and `deny`. It also does not make the text safe to publish.

[THREAT-MODEL.md](docs/THREAT-MODEL.md) says who the adversary is, what is replaced, what is only scaled or shifted, and when to use `placeholder` or `random` instead.

- Amounts are scaled by one factor and dates shifted by one shift for the whole conversation, so relations between them hold. One known amount gives away every amount, and one known date every date. When the service does not need to compute with them, use `replaceWith: 'placeholder'` or `'random'`.
- In `fake` mode `unblind` treats every amount and date it does not know as computed from fakes. One the model adds from general knowledge is rescaled or shifted too. With the seed of the example above, `The VAT registration threshold is £90,000` can come back as `£139,104`, and `The tax year ends on 5 April 2026` as `14 June 2026`. Both are listed in `invented`, but the text has already changed. A month, quarter or year the model derives from a shifted date is not mapped back and not listed: `due in December 2025, i.e. Q4 2025` stays that way when the real date is 3 March 2026. When amounts and dates need not be hidden, pass `keep: ['amount', 'date']` (C53).
- Chat apps with memory (ChatGPT, Claude on the web) remember across chats, while each new conversation gets new fakes. Memory can then hold one real person under several fake names, or two real people under one fake name, and a name the model recalls from memory does not map back. Turn memory off, or keep related work in one conversation and pass its mapping along.
- A fixed `seed` reused across conversations makes fakes linkable and lets anyone who knows it test guesses. Use it for tests and examples only.
- Writing style, rare situations and context can still identify people.
- A value the detectors miss goes through unchanged. The leak check catches the ones it knows about, so pass your own names, addresses and client domains in `known` and `deny`. [Paranoid mode](#paranoid-mode) flags most of the rest for review, but not names in scripts without capitals (Hebrew, Arabic, Chinese, Japanese, Korean), a single unknown word at the start of a sentence or line or right after an opening bracket, quotation mark, dash or bullet, or numbers under five digits. Read the blind copy before you send it.
- Colons count as separators in ID leak checks only when the original ID contained one, as in an IPv6 address. This avoids treating `10:00:00` as code `100000`, but an ID reformatted with new colons may go unreported.
- A text longer than `maxTextLength` (1,048,576 UTF-16 code units by default) is refused with an `input-too-large` error (C32). Time grows about linearly with the text (C41), so the limit bounds the work of one call.
- An amount the model computes from fakes, such as a difference or a total, comes back close but not always exact. Each fake is rounded to the precision it is written in, and `unblind` divides the computed result by the factor, which carries that rounding through. Over 500 seeds, the difference between `EUR 200` and `EUR 100` came back as `EUR 99` or `EUR 101` in 150 of them. A total of many amounts can drift further, since each operand brings its own rounding. A computed amount is listed in `invented` unless it equals the fake of an amount in the mapping. Then `unblind` restores that amount's real value and does not list it, even when the model meant a different number. If the mapping also holds `EUR 99`, the answer `EUR 149 - EUR 75 = EUR 74` can come back as `EUR 200 - EUR 100 = EUR 99` with `invented` empty. A negative amount with the minus after a currency code, such as `EUR -74`, is not read as an amount at all. It comes back unchanged and is not listed, so a computed negative difference can look right when it is not. The same layout in your text, `EUR -100`, goes out unscaled. `-100 €`, `-€100.00` and `-$1,234.56` are scaled. Check a computed total against your own figures, or use `replaceWith: 'placeholder'` when exact totals matter.
- A date the model moves by days or weeks maps back exactly, since every date shifts by the same whole number of days. A date it moves by months can come back a few days off, because the months around the fake and the real date differ in length. `25 January 2026` blinded to `15 February 2026`, and the model's one month later, `15 March 2026`, came back as `22 February 2026`, listed in `invented`. Like an amount, a computed date that equals the fake of a date in the mapping comes back as that date's real value without being listed. A date written without a year is restored in the mapping's reference year, so one the model moves across a year end can come back a day off. `10 December`, blinded to `31 December` and moved 60 days to `1 March`, came back as `9 February` instead of `8 February`.
- Bare numbers without a currency are not scaled, and prose numbers ("twenty euros") are not detected.
- A name that appears only in plain prose, with no sender line, greeting, signature, label, title or earlier mention, goes through unless you list it in `known`, and so does a company in prose without a legal suffix. In documents with none of these, such as CSV, EDI or bank statements, the core has nothing to start from, and it found 3.6% of names on the Gretel sample in the 24 October run. A name that is also an ordinary lower-case word in the same text (Rose and rose) is not carried to its bare mentions. The leak check still reports those when blind found the name in a span such as a sender line, but a name it took only from an email address (`rosa@casa-verde.example`) is then not found at all, so list it in `known`.
- SWIFT and BIC codes, and phone layouts such as Mexican `(55) 1234-5678` or Swedish `08-41 19 42`, are missed. Durations and frequencies such as "monthly" or "30 years" are not dates to blind and stay as written.
- Typed ids are checked by their rules, so a card number with a wrong Luhn digit or a DNI with the wrong letter is treated as a generic id, or missed when its shape is too weak. An SSN written with spaces and no label is missed. A version tag such as `1.2.3.4` reads as an IPv4 address and is replaced.
- A phone, IBAN or id fake the model writes in another layout (a card number without its spaces, a phone with dashes) is mapped back in that layout when it has eight letters and digits or more. A shorter one is matched only as written, since six digits written `12.03.26` could be a date. A phone the model rewrites in another form (`07700 900123` for `+44 7700 900123`) is not mapped back.
- Dates written without a year can land in the neighbouring year after a shift, since the year is not shown.
- Thresholds in the text ("free shipping over 50") scale with everything else, so they stay consistent with each other, but the real-world meaning of the number is gone.
- Two different amounts never share a fake, so each maps back to itself. To keep them apart a fake can move off the amount times the factor by the smallest unit, a cent or a whole unit, and by a few units when the factor is below 1 and many amounts sit one unit apart. One date written two ways (`1 Jun` and `1 June`) can shift onto one string when both land in May, where the short and long names match, so the second spelling gets the same date written another way (`11th May`) and each comes back as written. Amounts work the same way: an amount written with and without its thousands separator, or with full-width digits, keeps that spelling in its fake (`1.234,56 €` and `１.２３４,５６ €` become, say, `1.723,45 €` and `１.７２３,４５ €`), and where two spellings would still render alike, such as `1.234 €` and `1234 €` both scaled below 1,000, the second gets the same scaled value written another way (`864 €` and `864.00 €`), so each comes back as written and sums still add up (C43).
- A value written in another letter case keeps its fake in that case (`ONDARA`, `Ondara` and `ondara` become `NORVALE`, `Norvale` and `norvale`). A name written with and without its accent, or with a look-alike letter, gets one fake per spelling, so each spelling comes back as written but the model sees two names.
- Look-alike letters, full-width digits, accents, combining marks and zero-width characters are folded before matching, so `Вen` with a Cyrillic В still counts as `Ben`. Words written wholly in Cyrillic or Greek go through the same fold, and so does a known value before it is matched, so `Иван` and `ИВАН` still find each other; a Greek `ν` is read as `v` only when no Greek letter without a Latin look-alike stands right beside it, so the `ν` of `Γιάννης` stays Greek and matches its capital. The mapping keeps each value as it was written, so `unblind` puts the original spelling back, not the folded one. A detector of your own sees the folded text; `foldLookalikes` is exported so it can fold its own lookups the same way, and `knownDetector` so it can keep clear of the known values in `DetectContext.known`. Text hidden in base64 or quoted-printable, names split by a line break inside a word, and numbers or dates spelled out in words are not seen. The full list is in [known-misses.md](corpus/adversarial/known-misses.md).

## Conversations

Pass the mapping from the last call into the next one. Every value seen before keeps its fake, amounts keep the same scale and dates the same shift, and a value from an earlier turn is found again wherever it shows up, even bare (C21). The mapping holds only values some text wrote: a `known` value no text of the call contains gets no pair, so the mapping never carries it, and a later turn finds it only if that turn passes it in `known` again. Pass your `known` list on every turn, as below.

```ts
let mapping: Mapping | undefined;

async function turn(userText: string): Promise<string> {
  const b = blind([userText], { known, mapping });
  assertNoLeaks(b);
  mapping = b.mapping;                    // holds every pair so far
  const answer = await askTheModel(b.texts[0]);
  return unblind(answer, mapping).text;
}
```

So "Sophia Ward <sophia@ward-bookkeeping.example>" in the first message and a plain "Sophia" in the third both become the same fake, and the model can follow the thread.

## Streaming

`createUnblinder` takes the answer chunk by chunk. A fake name or amount can arrive split across two chunks, so it holds back the tail of the stream until nothing in it can still be part of a value. The pieces joined are exactly what `unblind` returns for the whole answer, for any chunking (C22). It keeps the whole answer in memory until `end`, because the `invented` list is worked out over the whole answer so it matches what `unblind` reports.

```ts
const u = createUnblinder(mapping);
for await (const chunk of modelStream) show(u.push(chunk));
const { text, invented } = u.end();       // the rest, and what the whole answer invented
show(text);
```

As a web `TransformStream`:

```ts
function unblindStream(mapping: Mapping): TransformStream<string, string> {
  const u = createUnblinder(mapping);
  return new TransformStream({
    transform: (chunk, out) => out.enqueue(u.push(chunk)),
    flush: (out) => out.enqueue(u.end().text),
  });
}
```

## Fakes, placeholders or random values

`replaceWith` picks what each value blind finds becomes. The same email in each mode, sender and total lines only:

<!-- modes -->
```
real         From: Sophia Ward <sophia@ward-bookkeeping.example>
             Total: £1,240.80 (£1,034.00 + 20% VAT), due on 3 March 2026.
fake         From: Hilary Brierley <hilary@harbour-clinic.example>
             Total: £802.80 (£669.00 + 20% VAT), due on 23 December 2025.
placeholder  From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>
             Total: £[REDACTED_AMOUNT_1] (£[REDACTED_AMOUNT_2] + 20% VAT), due on [REDACTED_DATE_1].
random       From: Hilary Brierley <hilary@harbour-clinic.example>
             Total: £6,322.90 (£4.29 + 20% VAT), due on 15 December 2026.
```
<!-- /modes -->

- **`fake`**, the default, is what the rest of this README shows. Each fake keeps the kind and shape of its value, amounts keep their relations, dates keep their weekdays, and ids pass their checksums. The service can still do arithmetic. A date it moves by days or weeks maps back exactly, but one it moves by months can come back a few days off. An amount it works out comes back close but not always exact. Both are usually listed in `invented`, and [Limits](#limits) says when they are not. What you lose: a fake reads like real data, so nothing in the text shows what was replaced.
- **`placeholder`** writes `[REDACTED_PERSON_1]`, `[REDACTED_EMAIL_1]` and so on: the kind in upper case and a number per kind, counted in order of first appearance. One value keeps one placeholder across the texts of a call and across turns (C26). A placeholder already written in the input, such as a text redacted once before, is left alone and its number is never given to a value, in that call or a later turn (the mapping records it in `literals`). Placeholder output matches LLM Guard's `[REDACTED_PERSON_1]` format, so code written against it reads the same. What you lose: everything about a value but its kind. Amounts and dates become placeholders too, so the service cannot add, compare or count days, and a total it works out has no real value to map back to. Each spelling keeps its own token for exact restoration. The `identities` legend links related name and email placeholders for the reader, as shown below.
- **`random`** writes an unrelated random value of the same kind. Names, companies, places, emails and URLs come from the same lists as `fake`. Phones, IBANs and ids become random digits in one fixed layout with no checksum, and IP addresses become documentation addresses. Amounts get unrelated random amounts and dates unrelated random dates (C28). What you lose: shape, format, checksums, amount scaling and week-aligned date shifts. Above, the base came out larger than the total. An amount or date the service computes from the fakes cannot be mapped back, so `unblind` leaves it as written and lists it in `invented`.

In every mode one value gets one replacement within a call and across turns, the seed decides them, `unblind` and `createUnblinder` put the real values back (C27), and the leak check works the same way (C30). The mapping records the mode, so a later turn that passes it back keeps the mode without being told. Passing a different `replaceWith` with that mapping throws an error that names the field (C29).

```ts
const b = blind([email], { known, replaceWith: 'placeholder' });
const next = blind([followUp], { known, mapping: b.mapping });   // still placeholders
```

When only names, addresses and ids need hiding, `keep` leaves kinds as written in any mode: `keep: ['amount', 'date']` sends real amounts and dates, so the service reasons from true figures and public facts such as a tax deadline stay right. A kept value gets no pair and is not a leak hit or a paranoid suspect, though a `known` or `deny` entry still is. The mapping records the kinds, a later turn keeps them, and a different `keep` with that mapping throws. `unblind` then leaves an amount or date it does not know as written and does not list it in `invented` (C53).

### Related person placeholders

In placeholder mode, `identities` groups related tokens without including original values. Send it beside `texts` so a reader can connect a full name, its short form and an explicitly associated address. Keep `mapping` local.

```ts
const b = blind([
  'From: Dana Whitfield <dana.whitfield@mail.example>\n\nThanks, Dana',
], {
  known: [{ kind: 'person', value: 'Dana Whitfield' }],
  replaceWith: 'placeholder',
});
assertNoLeaks(b);
const message = JSON.stringify({ texts: b.texts, identities: b.identities });
// Send message to the model. Keep b.mapping for unblind.
```

The legend for that input is:

```json
[
  {
    "names": ["[REDACTED_PERSON_1]", "[REDACTED_PERSON_2]"],
    "emails": ["[REDACTED_EMAIL_1]"]
  }
]
```

Each group means those tokens refer to the same person according to the available evidence. Each token still restores its own original form. A short name can appear before the full name or in another text in the batch. Case, accents and look-alike spellings follow the same normalization as name detection.

Full names from `known`, detected person spans and the previous mapping supply candidates. A first name links only if no other candidate has that name as any part. Initials, stop words, surnames alone and separately listed single-name people do not establish links. Two known people called Dana therefore leave a bare Dana unlinked, even if only one full name appears in the text. An email links only through a detected `Full Name <address>` mailbox, including a quoted display name. Matching local parts, shared domains and nearby prose supply no evidence. Conflicting display names leave a shared mailbox unlinked. Different address spellings stay separate.

The legend contains only tokens used in this call and omits groups with fewer than two tokens. It recomputes links for every batch, so later evidence can remove an ambiguous link without changing existing tokens. Mailbox associations from earlier calls are not retained. These links express textual evidence, not verified ownership, and cannot distinguish two people with the same full name. Plain CLI output contains only the blind text; `--json` includes the legend. `fake` and `random` modes return an empty `identities` array.

## With model SDKs

blind does not call any model. These are the usual places to put it.

**Anthropic SDK**

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const b = blind([email], { known });
assertNoLeaks(b);

const stream = client.messages.stream({
  model: 'claude-opus-5-5',
  max_tokens: 64000,
  messages: [{ role: 'user', content: `${question}\n\n${b.texts[0]}` }],
});
const u = createUnblinder(b.mapping);
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(u.push(event.delta.text));
  }
}
process.stdout.write(u.end().text);
```

**OpenAI SDK**

```ts
import OpenAI from 'openai';

const client = new OpenAI();
const stream = await client.chat.completions.create({
  model: yourModel,
  stream: true,
  messages: [{ role: 'user', content: `${question}\n\n${b.texts[0]}` }],
});
const u = createUnblinder(b.mapping);
for await (const chunk of stream) process.stdout.write(u.push(chunk.choices[0]?.delta?.content ?? ''));
process.stdout.write(u.end().text);
```

**Vercel AI SDK**

```ts
import { streamText } from 'ai';

const result = streamText({ model, prompt: `${question}\n\n${b.texts[0]}` });
const u = createUnblinder(b.mapping);
for await (const delta of result.textStream) process.stdout.write(u.push(delta));
process.stdout.write(u.end().text);
```

The same shape works for any provider: blind the prompt, assert that no value it found or was given survived, unblind the reply.

## In a request handler

Put blind at the start of a request handler. The handler receives private text, rewrites it before anything else processes it, sends the blind copy to your service, then restores real values in the answer. The service can log, store or forward that text, because the names, ids and other values blind found are now fakes. Amounts are scaled and dates shifted, not hidden: anyone who knows one real amount or date can work out the rest. What blind can miss is listed under [Limits](#limits), and who it protects against is in [THREAT-MODEL.md](docs/THREAT-MODEL.md).

The repository's [examples/](examples/README.md) folder has this pattern as a handler for Cloudflare Workers, Deno and AWS Lambda, with caller authentication, a leak check that stops forwarding, and size and time limits. The examples are source to copy and adapt. They are not part of the package.

## Command line

The `blind` and `unblind` commands give you a terminal workflow. `blind` writes the blind text and stores the mapping on disk for `unblind` to use later.

### The workflow

You have an email you want a frontier model to read, and you do not want it to see who is in it.

1. List what you already know is private. Names and companies are found next to an address, after a title, and where a name found once appears again. A name that only ever appears in plain prose needs your list.

   ```
   $ cat known.json
   [
     { "kind": "person", "value": "Martha Quayle" },
     { "kind": "org", "value": "Quayle Roofing Ltd." },
     { "kind": "place", "value": "Wrenfield" }
   ]
   $ cat deny.txt
   # one string per line, checked after rewriting
   Project Falcon
   *@quayle-roofing.example
   ```

2. Blind the email. The blind text goes to stdout, the run id goes to stderr.

   ```
   $ blind --known known.json --deny deny.txt email.txt > blind.txt
   blind: run 20261008T113545Z-2aacb9bb
   ```

3. Paste `blind.txt` to the lab. Ask your question. Save the answer as `answer.txt`.

4. Put the real values back. Anything the lab made up is listed on stderr.

   ```
   $ unblind --run 20261008T113545Z-2aacb9bb answer.txt > answer-real.txt
   unblind: 1 value(s) the lab invented, not from your text:
     "£300.00"
   ```

5. When you are done, delete the mapping: `unblind --forget 20261008T113545Z-2aacb9bb`. Runs do not expire, so anything you do not forget stays on disk.

Both commands read stdin when you give no file, so `pbpaste | blind | pbcopy` works for a quick one.

### What blind does with a leak

If the leak check finds a value it found or was given in the output, `blind` exits with code 2. It prints the kind and offset of each hit on stderr, never the value. It writes nothing to stdout and saves no run, so there is nothing to paste by accident. Add the value to `--known` or `--deny` and run again.

### `blind`

```
blind [--known known.json] [--deny deny.txt] [--seed s] [--date-order dmy|mdy] [--replace-with fake|placeholder|random] [--keep kinds] [--paranoid [--allow allow.txt]] [--json] [files...]
```

| Option | Meaning |
| --- | --- |
| `--known` | JSON array of `{ "kind", "value" }`. Kinds: person, org, email, domain, phone, place, id. |
| `--deny` | One string per line, or `*@domain`. Blank lines and `#` comments are skipped. |
| `--seed` | Same seed and input give the same output. Default is random. |
| `--date-order` | `dmy` (default) or `mdy` for dates like `07/04/2026`. |
| `--replace-with` | `fake` (default), `placeholder` or `random`. The run file stores the mode, so `unblind` reads it from there. |
| `--keep` | Comma-separated kinds to leave as written, such as `amount,date`. The run file stores them, so `unblind` needs no flag. |
| `--paranoid` | Also exit 2 on any suspect the [paranoid sweep](#paranoid-mode) flags, listed on stderr by text, input offsets and kind. |
| `--allow` | With `--paranoid`, one cleared word or phrase per line. Blank lines are skipped, and so are comments: `#` alone or followed by a space, so a cleared hashtag such as `#launch` can be listed. |
| `--json` | Write `{ "runId", "texts", "identities" }` instead of plain text. The identity legend contains placeholders only. |

With several files they are blinded in one call, so the same person gets the same fake in all of them. The texts are separated by `===== text N =====` lines that carry no file names. Exit codes: 0 done, 1 usage or file error, 2 leak check hit or paranoid suspect. The mapping file permissions, the exit code and the silence about values on stderr are tested (C12).

### `unblind`

```
unblind --run <id> [file]
unblind --forget <id>
unblind --list
unblind --forget-all
```

Reads the answer from the file or stdin, writes the text with real values to stdout and lists invented values on stderr.

`--list` prints one line per saved run: its id, when it was made and its mode. It never prints a value. A run file that cannot be read shows as `damaged`.

```
$ unblind --list
20261008T113545Z-2aacb9bb  2026-10-08T11:35:45.120Z  fake
20261009T081210Z-5e01d7a4  2026-10-09T08:12:10.874Z  placeholder
```

`--forget-all` says how many runs it deletes, then deletes every one.

```
$ unblind --forget-all
unblind: forgetting 2 run(s)
```

### Where the mapping lives

`$BLIND_HOME/runs/<run-id>.json`, with `BLIND_HOME` defaulting to `~/.blind`. Each file is plaintext JSON that holds the real values and the seed. It is not encrypted. Anyone who can read it can undo the blind copy.

- The only protection is POSIX file permissions. `blind` creates the directories with mode 0700 and the files with 0600. If `BLIND_HOME` or `runs/` already exists with access for group or others, `blind` sets it to 0700 and names the path on stderr. If either belongs to another user, `blind` refuses to save the run and exits 1.
- On Windows there is no such protection. The mode bits do nothing there, so the files get whatever access your default ACL gives them, and `blind` cannot check the owner.
- Runs stay until you delete them with `unblind --forget <id>` or `unblind --forget-all`. Nothing expires.
- Backup and sync tools (Time Machine, iCloud Drive, Dropbox, OneDrive and the like) copy the files with everything else. If your home directory is backed up or synced, point `BLIND_HOME` somewhere that is not, or forget runs as soon as you are done.

## API

`blind(texts, opts) -> { texts, mapping, leaks, replaced, identities }` rewrites one or more texts and returns their blind copies, the mapping, the leak check report (values it found or was given in `known` and `deny` that survived, and the `known` entries it enforces only as written or in capitals), `replaced`, how many spans of each kind this call replaced, and `identities`, the placeholder legend described under [Related person placeholders](#related-person-placeholders).

One mapping per call, consistent across every text in the call, so a thread of several emails still lines up.

| Option | Meaning |
| --- | --- |
| `known` | Values you already know are private: `{ kind: 'person' \| 'org' \| 'email' \| 'domain' \| 'phone' \| 'place' \| 'id', value }`. Any other kind (`Person`, `name`), a value that is not a string, and an empty or whitespace-only value make `blind` throw `invalid-known` with the entry's index before anything is detected. An `id` needs at least one ASCII letter or digit and an `email` needs an `@` with text on both sides, since those are what their fakes rewrite, so `日本` as either is refused with `invalid-known`, its index and kind, while `日本` as an `org` or `place` is replaced. A known id or phone is leak-checked from two characters, with any spacing or punctuation between them. Matched case-insensitively: as a whole word in scripts that put spaces between words (Latin, Cyrillic, Greek, Armenian, Georgian, Hebrew, Arabic, Devanagari), and as a plain substring in scripts without them (Chinese, Japanese). A Cyrillic or Greek value is folded like the text (see the look-alike note below), so it matches itself and its capitals (`ИВАН ПЕТРОВ` for `Иван Петров`), and a Greek final sigma counts as sigma. The fakes come from English and Spanish lists, so a name in another script gets an English or Spanish fake by the language rules of the text around it, English when nothing there decides (`Иван Петров` becomes two English fake words). Korean is compared by whole syllables and matched where a word starts, with anything glued on after it (`김민수는`, `김민수회사`), and a value of three syllables or more inside a word too; the fake keeps what was glued on (`김민수는` becomes a fake followed by `는`). Hebrew and Arabic glue one-letter words onto the front of the next word, so a value in those scripts is also matched, and each word of a known person, where the rest of a word after a chain of them is exactly the value: Hebrew `ו`, `ה`, `ב`, `ל`, `מ`, `ש` and `כ`, up to three (`ול`, `ולל`), and Arabic `و` or `ف`, then `ب`, `ل` or `ك`, the article `ال` or `لل` (`وال`, `فال`, `ولل`). The fake keeps the prefix (`לדוד` becomes `ל` followed by a fake), a value that starts with one of those letters (`לאה`, `ولید`) is matched whole where the word starts, and a longer word (`לדודו`) stays. Hebrew has no capitals, and a value ending in a final-form letter (`ם`, `ן`) matches as written. A two-syllable Korean value is not matched inside a longer word (`지원` in `우리팀지원님`), where two syllables are often an ordinary part of that word, so `leaks.unenforced` lists it by kind and index with reason `hangul-inside-word`, whether or not the text writes such a copy. A one-syllable Korean value is refused. A value is matched as given even when it is a common word or particle (`Al`, `De`), but then only as written or in capitals, so a known `Al` leaves the Spanish `al` alone: its lower-case copy is an ordinary word and is neither replaced nor reported as a hit. The leak report says so instead: `leaks.unenforced` lists such an entry by kind and index with reason `stop-word`, whether or not the text writes the lower-case copy, so you can pass `replaceWith: 'placeholder'`, add a `deny` entry or accept it. People match in full, first and last form. A part of a full name that is two letters (`Li` of `Li Na`), one letter (`O` of `O Li`, `J.` of `J. Orvane`) or on the stop list (`Al` of `Al Brenner`) is found bare as written or in capitals (`Al`, `AL`), even where the text also writes it in lower case. A two-letter part is found in lower case too (`li`), except where the language of the text there writes it as a word (`al` in `Fue al banco`, `an` in English). A full name with a part on the stop list that it writes capitalised (`Al Brenner`, `An Lark`) is listed in `leaks.unenforced` by kind and index with reason `stop-word-part`, since a lower-case copy of that part (`con al ayer`) can stay without a hit. A full name with a one-letter part (`O Li`, `Y Vega`) is listed with reason `one-letter-part` instead: the letter gets a fake with the rest of the name (`O Li` becomes two fake words) and is never matched in lower case, so `o`, `y`, `a` and `e` in Spanish and `a` in English stay ordinary words without a hit. One letter of a script without word spaces (`华` of `李 华`) is replaced inside the name too, but is not looked for bare, so the leak check holds a bare copy back. A particle the name writes capitalised gets a fake with the rest of the name (`Al Brenner` becomes two fake words); one it writes in lower case (`de` of `Ana de la Cruz`) is kept and not matched bare. A known value no text of the call writes gets no pair, so it is not in the mapping (C21). |
| `deny` | Strings that must not appear in the output, plain or `*@domain`. Checked after rewriting. A `*@domain` entry also removes that domain from the public allowlist. |
| `seed` | Same seed and input give the same output (C6). Omitted means a random seed from Web Crypto. |
| `replaceWith` | `'fake'` (default), `'placeholder'` or `'random'`: what each value found becomes. See [Fakes, placeholders or random values](#fakes-placeholders-or-random-values). With a `mapping` the mode comes from it, and a different value throws. |
| `keep` | Kinds to leave as written, such as `['amount', 'date']` (C53). See [Fakes, placeholders or random values](#fakes-placeholders-or-random-values). An entry that is not a kind throws `invalid-option` with its index. With a `mapping` the kinds come from it, and a different list throws. |
| `mapping` | The mapping of an earlier call, to continue a conversation (C21). The seed, date order, `replaceWith` and `keep` then come from it. It must keep blind's invariants (`checkMapping`), or `blind` throws an error that names the field. |
| `now` | Only picks a year for dates written without one. |
| `dateOrder` | `'dmy'` (default) or `'mdy'` for `07/04/2026`. |
| `allowDomains` | Extra public domains left untouched. |
| `detectors` | Extra `Detector`s that run next to the built-in ones. See [Detectors](#detectors). |
| `paranoid` | `true` to fail closed on text left as written that looks private. See [Paranoid mode](#paranoid-mode). The suspects go into `leaks.suspects`, which is left out otherwise. |
| `allow` | With `paranoid`, words and phrases a reviewer cleared as not private. Not an array of strings throws `invalid-option` with the entry's index. |

`unblind(text, mapping) -> { text, invented, collisions }` restores mapped values in an answer and reports invented values. The mapping must keep blind's invariants (`checkMapping`), or `unblind`, `createUnblinder` and `prepareUnblinder` throw `invalid-mapping` with the field.

Surrogates go back to real values, so `unblind(blind(x))` is exactly `x` (C1), letter for letter, with each spelling of a value written as it was. `collisions` lists, by kind and index, any amount or date pair whose fake an earlier pair with another spelling holds, since that one would come back in the earlier spelling. `blind` gives every spelling of an amount or a date its own fake (C43), so the list stays empty unless every other way to write that value is taken or a mapping was edited by hand, and `blind` returns the same list for its new mapping. With `fake` output, amounts the model computed itself are divided by the call's factor and dates are shifted back, and both are listed in `invented`. A computed amount comes back close, not always exact, because each fake was rounded to its written precision. An amount or date that equals a fake comes back as that fake's real value without being listed, so an empty `invented` does not prove a computed value right. With `placeholder` and `random` output nothing was scaled or shifted, so such amounts and dates stay as written and are listed in `invented`, and so is a placeholder the mapping does not know. `invented` is a heuristic over values the library can recognise in an answer: amounts, dates, emails, unknown placeholders, and names, where a name counts only when it is two or more capitalised words and the first is on blind's built-in first-name list. It flags those that have no surrogate behind them, so you can distrust that part of the answer. It does not catch every invention: for an answer that says "ask Thaddeus Okonkwo at Brightwater Ltd on +44 7700 900123", none of the three is listed, because the first name is not on the list and invented companies and phone numbers are not checked.

`createUnblinder(mapping) -> { push(chunk), end() }` restores values from a streamed answer.

Streaming `unblind`. `push` returns the text that is safe to show so far, possibly empty. `end` returns the rest and the `invented` list for the whole answer (C22).

`prepareUnblinder(mapping, { maxTextLength }?) -> { unblind(text) }` prepares a mapping once for repeated independent answers or structured fields. Each call returns the same `{ text, invented, collisions }` as one-shot `unblind`, with a separate text limit and fresh result arrays. It snapshots the mapping. Prepare again after extending a conversation mapping.

```ts
import { prepareUnblinder } from '@centrst/blind';

const prepared = prepareUnblinder(mapping);
const restored = blindTexts.map((text) => prepared.unblind(text).text);
```

Pass structured fields to `blind` as separate texts and restore them separately. Joining fields can change detection context or create matches across field boundaries. The [multi-text benchmark](docs/MULTI-TEXT-PERFORMANCE.md) records the leak-check scaling fix and reusable restoration measurements.

`assertNoLeaks(result)` throws `LeakError` when `result.leaks` has hits. A `known` entry the check enforces only as written or in capitals, or a two-syllable Korean one only where a word starts, is listed in `leaks.unenforced` and does not make it throw. The check covers the values blind found and the ones it was given in `known` and `deny`, not every private value: one that nothing found and nobody listed is neither replaced nor reported. A hit carries a kind, a text index and an offset, never the value.

Every error blind throws itself is a `BlindError` with a `kind`. A call it cannot read as meant throws `invalid-option` before any work: texts that are not an array of strings (`blind(text)` instead of `blind([text])`), an option it does not know, so a misspelt `known` is never silently ignored, or a `seed`, `dateOrder` or `now` of the wrong type. `LeakError` is an exported subclass, and a text over the limit throws one of kind `input-too-large`. Its message names a field, a kind or an index, never a value. Any other error raised inside `blind` or `unblind`, a custom detector's included, is replaced by a `BlindError` of kind `internal` that names only the stage, even when its message starts with `blind: ` (C42). A detector's error never reaches the caller as thrown, not even a `BlindError`: only its kind does. `blind` throws a new `BlindError` with the same kind and the message `blind: detector error while detecting values (<kind>)`, and drops the detector's message, stack and cause, so a detector that needs to tell the caller something throws a `BlindError` with the matching kind (C42).

`signReceipt({ result, returned, runtime, privateKey, publicKey, requestId?, issuedAt? })` and `verifyReceipt(receipt, publicKey, { sent?, returned?, runtimes?, requestId?, maxAgeMs?, maxSkewMs?, now? })` sign and check proxy receipts (C23). `requestId` ties a receipt to your request, `maxAgeMs` refuses a stale one and `maxSkewMs` (60,000 ms by default) one dated too far in the future (C34, C45). `generateReceiptKeys`, `exportReceiptKeys`, `importReceiptKeys` and `importReceiptPublicKey` handle Ed25519 keys as JWK. `sha256Hex` and `canonicalJson` are the hashing and serialization the receipts use.

The mapping is a plain JSON-serializable object holding the real values. Store it where you store the private text, never next to the model call's logs.

## Detectors

Built-in detection is deterministic: known values, patterns with checksums, and context words. It does not find a name in plain prose with no greeting, signature, label, title, legal suffix, address or list entry, so pass those in `known`. `Detector` is a small interface (`detect(text, ctx) -> Span[]`) for detection of your own. Your detectors run next to the built-in ones, and the replacement, scaling, shifting and leak code treats their spans the same way.

## Language support

blind's built-in fakes and formats cover English and Spanish. Each fake follows the language of the value it replaces, read from the name lists, accents, company suffixes, country domains and spelling. A value that says nothing follows its paragraph, then the whole text, and is English when nothing says (C31). Spanish-specific handling includes checked DNI, NIE and CIF numbers, Spanish date and amount formats, and titles such as `Sra.` Spanish company words such as `S.L.`, `Asesores` and `Clínica` help identify sender organizations, and Spanish greetings, closings and labels (`Hola`, `Estimada`, `Un saludo`, `Paciente:`) are read like the English ones. Mixed English and Spanish text was also measured. Other languages are not covered by these built-in lists or tested in these benchmarks. A Korean `known` value is found and leak-checked where a word starts, with a particle or another word glued on after it (`김민수는`, `김민수회사`), and a value of three syllables or more also inside a word; a two-syllable value is not found inside a word and is listed in `leaks.unenforced` with reason `hangul-inside-word`, and a one-syllable one is refused. A Korean name is not split into parts, so the given name alone (`민수`) is found only when it is passed in `known` too.

Strict recall with nothing passed in `known`. The corpus columns were measured on 2026-11-10 on the 381-file corpus (the Hebrew and Arabic cases are in no row). The Gretel column is from the 24 October 2026 benchmark run, before greetings, signatures, labels, legal suffixes and address words were read, and has not been rerun since. The corpus is home ground. The Gretel finance sample is not. Round trip means exact restoration.

| Language | Corpus files | Person recall | Company recall | ID / date recall | Round trip | Gretel person recall, 24 October |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| English | 116 | 87.9% | 99.5% | 100% / 100% | 116/116 | 4.5% |
| Spanish | 164 | 82.6% | 98.2% | 100% / 100% | 164/164 | 3.0% |
| Mixed | 99 | 86.9% | 98.3% | 100% / 100% | 99/99 | not measured |

Gretel has 444 English and 444 Spanish documents. They rarely carry sender lines or titles, which is why the core finds so few of their names. Its Spanish person labels are noisy. See the [Spanish language page](docs/languages/spanish.md), the [corpus benchmark](scripts/bench/RESULTS.md) and the [LLM Guard and Gretel benchmark](scripts/bench/RESULTS-llmguard-gretel.md) for methods and caveats.

## Where it runs

| | Node 22+ | Deno | Bun | Browsers | Workers, edge |
| --- | --- | --- | --- | --- | --- |
| `@centrst/blind` (core) | yes | expected to run, not tested in CI | expected to run, not tested in CI | expected to run, not tested in CI | expected to run, not tested in CI |
| Receipts | yes | expected to run, not tested in CI | expected to run, not tested in CI | expected to run in recent versions with Ed25519 in Web Crypto, not tested in CI | expected to run, not tested in CI |

The core uses standard JavaScript, Web Crypto, `TextEncoder`, `atob` and `btoa`. CI runs it on Node 22, 24 and 26. A test loads the built library into a bare JavaScript realm that has those globals and no Node global, and blinds and unblinds a text there (C19). That is the surface browsers and edge runtimes provide, but the realm runs inside Node's V8, so it is not a run in a browser or in a Workers runtime. A local smoke test (D1) runs the built library under Deno when `deno` is on PATH and skips otherwise. Bun has no test.

## Signed receipts

When blind runs inside a service that other callers use, the service can sign a receipt for each answer:

```json
{ "body": { "v": 2, "lib": "@centrst/blind@0.2.0", "runtime": "sha256:<bundle>", "issuedAt": "...", "requestId": "...",
            "sent": "<sha256 of the blind texts>", "returned": "<sha256 of the blind answer>",
            "leaksOk": true, "replaced": { "person": 3, "amount": 2, "date": 1 } },
  "keyId": "1bb8f2e1aee64bba", "sig": "<Ed25519, base64url>" }
```

The caller checks it against the proxy's published key, the blind texts it was shown, the blind answer the upstream gave, its own request id and the receipt's age:

```ts
const ok = await verifyReceipt(receipt, pinnedKey, { sent, returned, requestId, maxAgeMs: 60_000, runtimes: [pinnedDigest] });
```

A receipt holds hashes and counts, never a value (C23). `returned` hashes the blind answer, not the real one, so a receipt cannot be used to test guesses at a short answer, and the request id and age check stop an old receipt being replayed (C34). The body is signed in its RFC 8785 canonical form, so any language can verify it (C35). `generateReceiptKeys()` makes a key pair.

Be precise about what this proves. A valid receipt shows that the holder of the key issued it and committed to exactly that blind text and that blind answer. It does not show which code ran, because `runtime` is the operator's claim. [docs/PROXY.md](docs/PROXY.md) covers the format, verification and key rotation.

## Compared with other tools

What each tool can do with a value it finds, as it can be configured, not only as it ships. Cells marked *measured* come from blind's benchmarks, which ran Presidio and LLM Guard with their defaults. The rest come from each tool's own documentation, checked on 5 November 2026 and linked below each table.

| | blind | Presidio | LLM Guard | Google Sensitive Data Protection | AWS Comprehend | Limina, formerly Private AI |
| --- | --- | --- | --- | --- | --- | --- |
| Runs | In your process: Node 22, 24 and 26, tested in CI. Browsers, edge, Deno and Bun not tested | Python library or self-hosted server | Python library | Cloud API | Cloud API | Self-hosted container or SaaS |
| Replaces a value with | A consistent fake of the same shape, a placeholder or a random value | Built in: placeholder, redaction, mask, hash or encryption. A `custom` operator can return anything, such as a Faker value | Numbered placeholder or random fake | Redaction, mask, hash, format-preserving encryption or a random word from a word list | Mask or entity type, in batch jobs | Marker, mask, or a synthetic value in beta |
| Maps an answer back | Yes, local mapping *(measured)* | Built in, only values it encrypted, through `decrypt` with the key. With an operator and a deanonymizer you write, yes: its pseudonymization sample keeps a mapping you hold and maps numbered placeholders back | Yes, through its vault *(measured)* | Only values it encrypted (format-preserving or deterministic), with the key | Not stated | Yes, through a re-identify endpoint |
| Amounts still usable for arithmetic | Yes, one factor for every amount *(measured)* | No, with its default operator *(measured)* | No *(measured)* | Not stated | Not stated | Not stated |
| Dates | Shifted by whole weeks | Placeholder, with its default operator *(measured)* | Placeholder *(measured)* | Shifted by random days, the same shift per person | Detected only | Not stated |
| Licence | MIT | MIT | MIT. Its repository was archived on 9 July 2026, and its default model is CC BY-NC 4.0, so not for commercial use | Paid | Paid | Paid, with a free tier |

Sources: [Presidio](https://github.com/data-privacy-stack/presidio), now maintained by Data Privacy Stack, its [anonymizer and operators](https://presidio.dataprivacystack.org/anonymizer/), [custom operators](https://presidio.dataprivacystack.org/anonymizer/adding_operators/), the [pseudonymization sample](https://presidio.dataprivacystack.org/samples/python/pseudonymization/) and the [Faker sample](https://github.com/data-privacy-stack/presidio/blob/main/docs/samples/python/example_custom_lambda_anonymizer.py). [LLM Guard](https://github.com/protectai/llm-guard), which shows the archive date, its [Anonymize scanner](https://protectai.github.io/llm-guard/input_scanners/anonymize/), its [Deanonymize scanner](https://protectai.github.io/llm-guard/output_scanners/deanonymize/) and the [default model's licence](https://huggingface.co/Isotonic/deberta-v3-base_finetuned_ai4privacy_v2). Google's [transformations](https://docs.cloud.google.com/sensitive-data-protection/docs/transformations-reference) and [date shifting](https://docs.cloud.google.com/sensitive-data-protection/docs/concepts-date-shifting). AWS's [PII detection](https://docs.aws.amazon.com/comprehend/latest/dg/how-pii.html) and [redaction](https://docs.aws.amazon.com/comprehend/latest/APIReference/API_RedactionConfig.html). Limina's [redaction options](https://docs.private-ai.com/latest/process-text), [synthetic values in beta](https://docs.private-ai.com/introduction), [re-identify endpoint](https://docs.private-ai.com/latest/reidentify-text) and [pricing](https://www.getlimina.ai/en/pricing).

Two JavaScript libraries do the closest job to blind's:

| | blind | rehydra | Arcjet Redact |
| --- | --- | --- | --- |
| Language and runtimes | TypeScript. Node 22, 24 and 26, tested in CI. Browsers, edge, Deno and Bun not tested | TypeScript types on npm. Node, Bun and browsers | JavaScript and TypeScript on npm, Node; also a Go SDK. The detection runs in WebAssembly |
| Replaces a value with | A consistent fake of the same shape, a placeholder or a random value | A placeholder such as `<PII type="PERSON" id="1"/>`, the same id for the same value across a session | A placeholder such as `<Redacted email #0>`, or what a `replace` function you pass returns |
| Maps an answer back | Yes, local mapping *(measured)* | Yes, from a PII map it encrypts with AES-256-GCM, kept in memory, SQLite or IndexedDB | Yes, through the `unredact` function that `redact` returns |
| Streams an answer back | Yes, `createUnblinder` | Yes, through its LLM proxy wrapper, which buffers placeholders split across chunks. Its streaming anonymizer is Node and Bun only | Not stated |
| Detects with | Patterns with checksums, context words and your `known` list, plus `Detector`s you add | Regex patterns, secret patterns, and an on-device ONNX NER model (about 280 MB quantized, 1.1 GB full, or your own) | Built-in email, phone number, IP address and card number detection, plus a `detect` function you pass |
| Amounts and dates | Amounts scaled by one factor, dates shifted by whole weeks | Dates detected and replaced by a placeholder; amounts not stated | Not stated |
| Licence | MIT | MIT | Apache 2.0 |

Sources: rehydra's [README on npm](https://www.npmjs.com/package/rehydra) (version 0.16.5), its [modes](https://docs.rehydra.ai/concepts/anonymization-pipeline), [PII types](https://docs.rehydra.ai/concepts/pii-types), [encryption](https://docs.rehydra.ai/concepts/encryption), [NER models](https://docs.rehydra.ai/guides/ner-detection), [streaming anonymizer](https://docs.rehydra.ai/guides/streaming) and [LLM proxy](https://docs.rehydra.ai/guides/llm-proxy). Arcjet's [Redact quick start](https://docs.arcjet.com/redact/quick-start), [reference](https://docs.arcjet.com/redact/reference) and [package README](https://github.com/arcjet/arcjet-js/tree/main/redact) (version 1.15.0). Neither tool was benchmarked here.

### Measured

Presidio and LLM Guard ran next to blind on two datasets. blind's own corpus had 379 synthetic emails in English and Spanish when these numbers were measured (two handwritten cases in Hebrew and Arabic were added later), all written by blind's authors, so treat it as home ground. The Gretel sample is 888 synthetic finance documents in English and Spanish that nobody here wrote. Gretel labels only some entities, so precision there is a floor.

Recall and precision on the Gretel sample, with nothing passed in `known`, from the 24 October 2026 run. blind's row predates its reading of greetings, signatures, labels, legal suffixes and address words, and has not been rerun.

| | names | companies | places | ids | calendar dates, recall |
| --- | --- | --- | --- | --- | --- |
| Presidio | 54.5% / 54.3% | 54.3% / 17.6% | 83.8% / 31.3% | 48.9% / 14.3% | 84.9% |
| LLM Guard | 40.9% / 82.3% | 24.4% / 88.3% | 91.0% / 58.4% | 68.0% / 6.8% | 97.7% |
| blind core | 3.6% / 76.3% | 0.5% / n/a | 2.1% / n/a | 82.3% / 11.2% | 97.0% |

What a model can still use, on blind's corpus, and whether answers map back on both datasets.

| | ids replaced | amounts scaled and usable | dates shifted and usable | answers that map back |
| --- | --- | --- | --- | --- |
| Presidio | 33.9% | 0% | 0% | not with its default operators, which keep no mapping |
| LLM Guard | 16.3% | 0% | 0% | 379 of 379, 888 of 888 |
| blind core | 100% | 100% | 99.9% | 379 of 379, 888 of 888 |

blind's core took 0.3 ms per file. Presidio took about 20 to 30 ms, and LLM Guard 44 to 79 ms on a GPU and 75 to 117 ms on a CPU. Every number, configuration and caveat is in [RESULTS.md](scripts/bench/RESULTS.md) and [RESULTS-llmguard-gretel.md](scripts/bench/RESULTS-llmguard-gretel.md), and in a clone of the repository `pnpm bench:presidio` and `pnpm bench:gretel` rerun the supported comparisons. LLM Guard execution has been retired because its archived release pins vulnerable dependencies; its source and historical results remain available.

### Where another tool fits better

- Presidio, for Python pipelines and for redacting stored data. It can also map answers back if you write the operator and deanonymizer pair its pseudonymization sample shows. On English names in the Gretel sample it found 70.1%, where blind's core, with nothing passed in, found 4.5% in the 24 October run.
- LLM Guard had the best name precision on the Gretel sample. Its repository was archived on 9 July 2026, so fixes will not come, and its default model is licensed for non-commercial use only.
- Google and AWS, when the data already lives in that cloud and the work is batch redaction at scale.
- Limina, for a managed service with support and many languages.
- rehydra, for a ready local proxy in front of a coding agent, a browser extension for chat sites, and detection of secrets such as API keys and JWTs.
- Arcjet Redact, when you already use Arcjet or need a Go SDK, and the values are emails, phone numbers, IP addresses and card numbers.
- blind, when a JavaScript app sends text to a model and needs the answer back with real values, amounts that still add up, and nothing leaving the process.

## Claims

Each behaviour this file promises carries a claim ID, such as C3, and a test with that ID in its name backs it. The benchmark numbers come from the scripts named in their sections. [TESTING.md](TESTING.md) says how each claim is proved: property tests, a labelled corpus with recall and precision floors, an adversarial set with its known misses, mutation testing, a no-network suite and build checks. Detection recall per kind has a published floor (C9). Every known miss is listed and its test is marked expected-to-fail (C10). The tests themselves are checked by mutation testing against a floor (C11). That run takes hours, so it sits outside the release gate and runs with `pnpm verify --full`. In the repository, `pnpm claims` writes [CLAIMS.md](CLAIMS.md) from the test report and fails when a core claim has no passing test, and `pnpm evidence` puts all of it on one page.

## Development

To work on blind itself, clone the repository. [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the gate every change passes and the deeper release suites. [RELEASING.md](RELEASING.md) covers versions and publishing. To report a way past blind's protection, follow [SECURITY.md](SECURITY.md) and report it privately.

## License

MIT, copyright Centrst. The package bundles no third-party code, and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) covers the rest of the repository.
