# Changelog

All notable changes to this project are written down here. Changesets writes each version's entry from the notes in `.changeset`, grouped as major, minor and patch changes. The project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

First stable release.

### Added

- `paranoid: true` (`--paranoid` on the command line) holds a text for review while blind leaves something that still looks private as written: a run of uncommon capitalised words, or a single one anywhere but the start of a sentence, a line or a subject line; a long number; a handle; an encoded run; or a spelled-out address. A single unknown name at the start of a sentence or line is not flagged. Each suspect stays until it is put in `known` or cleared in `allow`. On contract-style text it holds nearly every document, so it is a review step, not a filter.

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
