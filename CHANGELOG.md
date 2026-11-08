# Changelog

All notable changes to this project are written down here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
