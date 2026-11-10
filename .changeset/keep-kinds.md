---
"@centrst/blind": minor
---

`blind` takes a `keep` option, a list of kinds to leave as written, and the CLI takes `--keep amount,date`. With `keep: ['amount', 'date']` names, addresses and ids are still replaced but amounts and dates go out real, so the model reasons from true figures and public facts such as a tax deadline are not moved. A kept value gets no pair, is not counted in `replaced`, and is neither a leak hit nor a paranoid suspect. A `known` or `deny` entry is still reported.

The mapping records the kinds in `keep`. A later turn that passes the mapping keeps them, and a different `keep` with that mapping throws `invalid-option`. `unblind`, `prepareUnblinder` and `createUnblinder` read it too: when amounts or dates are kept, one in the answer that the mapping does not know stays as written and is not listed in `invented`. Without `keep`, nothing changes.
