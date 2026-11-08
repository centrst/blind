# Security policy

blind exists to keep private values from leaving your machine. A way to get a value past it that it claims to catch is a security issue, and we would rather hear about it privately first.

## Supported versions

| Version | Supported |
| --- | --- |
| Current source on `main` | yes |
| npm releases | none yet |

After the first npm release, fixes will target the latest minor release until 1.0.

## Reporting a vulnerability

Report it privately through either channel:

- GitHub's private vulnerability reporting for this repository: open the **Security** tab of [centrst/blind](https://github.com/centrst/blind/security) and choose **Report a vulnerability**. Only the maintainers see the report.
- Email to [security@centrst.com](mailto:security@centrst.com), if you cannot reach the GitHub page or prefer email. Only the maintainers read that address.

The same response times apply to both. Never include real private values in a report, whichever channel you use.

Please do not open a public issue, pull request or discussion for a security problem.

A good report has:

- the version or commit you tested,
- the smallest input that shows the problem, written with invented values (`.example` domains, made-up names and numbers), never real text,
- the options you passed (`known`, `deny`, `detectors`, `replaceWith`, `seed`),
- what you expected and what you saw.

## What we commit to

- We acknowledge a report within 3 working days.
- We send a first assessment (accepted, need more information, or out of scope, with the reason) within 10 working days.
- For an accepted report we agree a disclosure date with you, normally within 90 days of the report, and sooner when a fix is ready. We publish a GitHub security advisory with the fix and credit you unless you ask us not to.

## What counts

- **A value that survives blinding that the detectors claim to find.** Something the README's [What it finds](README.md#what-it-finds) section, a claim in [TESTING.md](TESTING.md), or a `known` or `deny` entry says is replaced, and that appears unchanged (or trivially recoverable) in the blind copy without the leak check reporting it.
- **A real value in an error message, a leak report or CLI output.** Errors and leak reports carry a kind and an index, never the value. The CLI prints kinds and offsets only.
- **A receipt forgery.** A proxy-mode receipt ([docs/PROXY.md](docs/PROXY.md)) that verifies but was not signed by the key it names, or that verifies for a body it does not describe.
- **A network call from the core**, or a way to make `src` reach the network.
- **A mapping that unblinds to the wrong real value** in a way an attacker controlling the model's answer could use to plant one real value where another belongs.

## What does not count

- **A value the detectors do not claim to find.** The [Limits](README.md#limits) section and [corpus/adversarial/known-misses.md](corpus/adversarial/known-misses.md) list what blind misses today, such as a name in plain prose with no title, address or list entry, numbers spelled out in words, or text hidden in base64. A new miss of that kind is welcome as a regular issue or a pull request that adds an adversarial case.
- Re-identification from writing style or context, which the README says blind does not prevent.
- Linkable fakes from a fixed `seed` reused across conversations, which the README warns about.
- Problems in a detector you wrote yourself, or in the optional NER model's accuracy within its published floors.
