# Changelog

All notable changes to this project are written down here. Changesets writes each version's entry from the notes in `.changeset`, grouped as major, minor and patch changes. The project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.3.0

Upgrading from 0.2.0 does not repair existing mappings. Inspect the `email` entries in `mapping.pairs`, grouping them by `fake.toLowerCase()`. A group assigned to different original addresses, rather than alternate spellings of the same address, is affected. Such mappings can still restore a case-changed reply to the wrong address without reporting a collision.

For an affected mapping, start a new conversation with a fresh mapping and the original source text. Do not apply the new mapping to old substituted text or replies. Check addresses in previously restored replies against the original mail and correct any misattributions before using them.

### Minor Changes

- 37829a2: A sign-off name is found one blank line below its closing (`Kind regards,`, a blank line, `Priya Raman`) and with a job title after a comma (`Odette Ashworth, CEO`), and the company line under it is found as before. Both used to go out as written.

  Technical text is no longer replaced as an id. A lower-case git SHA, a UUID, a hex colour after `#`, a value of up to 24 characters marked as a SKU (`SKU-4417-BLK`), and a lower-case model, release or file name made of words, version pieces and dates (`gpt-4o-2024-08-06`, `claude-3-5-sonnet-20241022`, `release-2026-01-15`, `src/v2024/parser1234.ts`) now stay as written. They used to become look-alikes such as `tci-7a-2283-14-27`. Order references in capitals, a lower-case one whose number is not a date, digits after `#`, product codes without the SKU mark and every typed id (cards, SSN, IBAN, DNI, NIE, CIF, VAT) are replaced as before, a typed id inside a SKU included (`SKU-12345678Z` keeps its mark and gets the DNI's fake).

  An explicit private-id label replaces the whole value even when it looks like a long technical token, so a UUID's numeric suffix cannot escape replacement.

### Patch Changes

- c15d891: Two different addresses no longer get two letter cases of one fake. A second address at a host that already had a fake, met in a later call or drawing the same word by chance, used to get the first address's fake in capitals. A reader took the two for one mailbox, and a reply that wrote the fake in another case came back as the wrong address. Each address now gets a fake of its own, numbered when a host has more addresses than there are words to draw. One address written in two letter cases still gets two cases of one fake.

## 0.2.0

Upgrading from 0.1.0: a call blind cannot read as meant now throws `invalid-option` (texts that are not an array of strings, an unknown option, a numeric `seed`), and a damaged mapping throws `invalid-mapping`. blind also finds names and companies it used to leave as written, so the same seed gives a different blind copy than 0.1.0 did. A mapping from 0.1.0 still unblinds and continues a conversation, unless it was made with a numeric `seed`, which the types never allowed: set `mapping.seed = String(mapping.seed)` first.

### Minor Changes

- 2f448f2: `blind` refuses a call it cannot read as meant, with `invalid-option` and before any work: texts that are not an array of strings (`blind(text)` instead of `blind([text])` used to fail as an internal error), an option it does not know (a misspelt `known` used to be ignored, so its values went out with a clean leak check), a list option of the wrong type, and a `seed`, `dateOrder` or `now` that no mapping can hold. A `known` that is not an array throws `invalid-known`, as a bad `known` entry already did. A numeric `seed` now throws: pass a string.
  
  `unblind`, `createUnblinder` and `prepareUnblinder` check the mapping the way `blind` does and throw `invalid-mapping` with the field. A mapping with a factor of 0 used to write `Infinity` into the answer, and a damaged one failed as an internal error.
  
  An amount whose thousands are grouped with a space (`1 240,80 €`, also with a no-break, narrow no-break or thin space) is scaled as one number and keeps its separator. Only its last group was scaled before, so the same value written `1.240,80 €` and `1 240,80 €` got two different fakes and sums broke.
  
  A phone, IBAN or id fake that the model writes in another layout (`+447700900692`, a card number with dashes) is restored in that layout when it has eight letters and digits or more. It used to stay in the answer as a fake, unreported. An IP address is left out, since its dots carry the value, and so is a fake whose letters and digits another fake shares, since only its layout tells the two apart.
  
  One word after a title that takes a surname (`Mr Holloway`, `Sra. Ruiz`) gets a surname as its fake instead of a first name, and a titled name ends at a full stop (`Dr. Okafor. Thanks` is one name and a new sentence).
  
  An amount of fifteen digits comes back when its fake is a digit longer. `unblind` used to leave that fake in the answer. Digits an amount holds are no longer read as a phone number, so `650.000.000 €` and `850 000 000 EUR` are scaled as amounts.
- 4805405: `blind` takes a `keep` option, a list of kinds to leave as written, and the CLI takes `--keep amount,date`. With `keep: ['amount', 'date']` names, addresses and ids are still replaced but amounts and dates go out real, so the model reasons from true figures and public facts such as a tax deadline are not moved. A kept value gets no pair, is not counted in `replaced`, and is neither a leak hit nor a paranoid suspect. A `known` or `deny` entry is still reported.
  
  The mapping records the kinds in `keep`. A later turn that passes the mapping keeps them, and a different `keep` with that mapping throws `invalid-option`. `unblind`, `prepareUnblinder` and `createUnblinder` read it too: when amounts or dates are kept, one in the answer that the mapping does not know stays as written and is not listed in `invented`. Without `keep`, nothing changes.
- 567ca5b: `blind` finds more names and companies in ordinary emails with nothing in `known`. Before, a person was found only through `known`, a `Name <address>` sender line, a title such as `Dr.`, or a repeat of a name already found, so `Dear Margaret,` and a signature went out as written with a clean leak check. Now these count too:
  
  - A greeting at the start of a line (`Dear Margaret,`, `Hi Ana, Luis and Marta,`, `Hola Belén:`, `Estimado/a Cayetano,`, `Buenos días Isidro,`) names a person. `Hi all`, `Hi team`, `Dear Sir`, `Dear Customer` and `Hola a todos` name no one.
  - The line right after a closing (`Kind regards,`, `Thanks,`, `Un saludo,`, `Atentamente,`) holding only capitalised words is a person, and the first company line below it an org. `Regards,` above `Accounts` or `Sent from my iPhone` names no one.
  - A label (`Name:`, `Patient:`, `Customer:`, `Nombre:`, `Paciente:`) before a name is a person, and `Company:` or `Empresa:` before one an org.
  - Capitalised words before a legal suffix (`Ltd`, `LLC`, `Inc`, `GmbH`, `PLC`, `Corp`, `S.L.`, `S.A.`) are an org anywhere in the text, so `Moorcroft Joinery Ltd.` in prose is now replaced.
  - The words of a private address name its person and company: `margaret.holloway@finchley-dental.example` makes a later `Margaret` a person and `Finchley Dental` an org.
  
  On the test corpus with nothing in `known`, people found went from 67.1% to 85.1% and companies from 29.7% to 98.2%, and precision rose for both. Text that used to pass through unchanged can now have a fake name or company in it, so outputs for the same seed differ from earlier versions.

### Patch Changes

- 4f93cc2: `blind` is fast with a long `known` list. Each entry used to compile its own pattern and scan the text on every call, so 4,000 people took about 4 seconds on a one-line text and 22 seconds on a 200 KB one. Now an entry's pattern is built and run only when the text contains one of its words, and the language of each known person's fake is looked up once per call instead of once per name found. 10,000 people take about a tenth of a second on a short text. The output is the same for every input.

## 0.1.0

First stable release.

### Added

- `paranoid: true` (`--paranoid` on the command line) holds a text for review while blind leaves something that still looks private as written: a run of uncommon capitalised words, or a single one anywhere but the start of a sentence, a line or a subject line; a long number; a handle; an encoded run; or a spelled-out address. A single unknown name at the start of a sentence or line, or right after an opening bracket, a quotation mark, a dash or a bullet, is not flagged, so read the blind copy before sending it. Each suspect stays until it is put in `known` or cleared in `allow`. The command line writes nothing and exits 2 while a suspect remains. `blind()` still returns the blind texts and sets `leaks.ok` to false, so a library caller must check `leaks.ok` or call `assertNoLeaks` before sending them. On contract-style text it holds nearly every document, so it is a review step, not a filter.

### Changed

- The README states that an amount the model computes from fakes comes back close but not always exact. It is listed in `invented` unless it equals another fake, and then `unblind` restores that fake's real amount with `invented` empty, so an empty list does not verify a computed total. Exact restoration of derived amounts is issue #25.
- `EUR -100`, a minus between a currency code and the number, is not read as an amount, so it goes out unscaled. It is listed as known miss F17.
- `pnpm verify` is the release gate for the published core and takes about 12 minutes. The NER package and mutation testing moved to `pnpm verify --full`.
- Release notes are batched with Changesets. Publishing supports explicit `next` and stable channels through GitHub Actions and npm trusted publishing. The workflow stages each version on npm, and a maintainer approves it with 2FA before it is public.
- Installation, security support and release documentation now describe the published core prerelease and the private NER package separately.
- The README now describes only what the package ships. Names, companies and places come from `known`, context and paranoid mode, and the NER detector is mentioned once as separate work in development.

## 0.1.0-next.20261109.1 - 2026-11-09

First usable npm prerelease, published to `next` from source commit `ad1bdbe583ad65245d1077a3f8cd5dd940267564`. npm also initially pointed `latest` at this build. The earlier `0.0.0-stage` version only bootstrapped the registry package.

### Added

- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and a CI workflow prepared for the first public import.

- `blind` rewrites names, companies, places, emails, domains, URLs, phones, IBANs, payment cards, SSNs, Spanish DNI, NIE and CIF, EU VAT numbers, IP addresses and other ids into consistent fakes of the same kind and shape, in the language of the value they replace.
- Amounts are scaled by one factor per conversation with derived totals recomputed, and dates are shifted by one whole number of weeks, so arithmetic and weekdays hold.
- A leak check after rewriting, `assertNoLeaks`, and leak reports that carry a kind and an index, never the value.
- `unblind` and the streaming `createUnblinder` map an answer back locally; a previous `mapping` continues a conversation with the same fakes.
- `replaceWith` modes beside `fake`: numbered placeholders and unrelated random values.
- The `Detector` interface for adding detectors, with the optional `@centrst/blind-ner` GLiNER package plugging in there.
- Ed25519 receipts for proxy mode, using Web Crypto only.
- The `blind` and `unblind` commands, which keep real values off stdout and stderr on a leak.
- No runtime dependencies, no network calls, and a core tested on Node in public Ubuntu CI. Browser and edge compatibility checks are described in `TESTING.md`.
