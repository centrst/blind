---
"@centrst/blind": minor
---

`blind` refuses a call it cannot read as meant, with `invalid-option` and before any work: texts that are not an array of strings (`blind(text)` instead of `blind([text])` used to fail as an internal error), an option it does not know (a misspelt `known` used to be ignored, so its values went out with a clean leak check), a list option of the wrong type, and a `seed`, `dateOrder` or `now` that no mapping can hold. A numeric `seed` now throws: pass a string.

`unblind`, `createUnblinder` and `prepareUnblinder` check the mapping the way `blind` does and throw `invalid-mapping` with the field. A mapping with a factor of 0 used to write `Infinity` into the answer, and a damaged one failed as an internal error.

An amount whose thousands are grouped with a space (`1 240,80 €`, also with a no-break, narrow no-break or thin space) is scaled as one number and keeps its separator. Only its last group was scaled before, so the same value written `1.240,80 €` and `1 240,80 €` got two different fakes and sums broke.

A phone, IBAN or id fake that the model writes in another layout (`+447700900692`, a card number with dashes) is restored in that layout when it has eight letters and digits or more. It used to stay in the answer as a fake, unreported.

One word after a title that takes a surname (`Mr Holloway`, `Sra. Ruiz`) gets a surname as its fake instead of a first name, and a titled name ends at a full stop (`Dr. Okafor. Thanks` is one name and a new sentence).
