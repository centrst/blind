---
"@centrst/blind": minor
---

A name from an earlier turn no longer turns ordinary words into names. With a mapping passed in, blind used to look for every word of every person and company it had met, in any letter case. After a sender called `Work From Home` or `Will Harrow`, the words `work`, `from`, `home` and `will` were replaced by fake names in every later text. A person or company from an earlier turn is now found again, and leak-checked, where it is written with a capital. All in lower case it is left as written and not reported. A value in `known` is matched in any letter case as before, and so are addresses, hosts, phones, ids and places from earlier turns, names in scripts without letter case and names inside a link. A name the same call finds itself, in a sender line or a greeting, is still reported in lower case in that call.

The leak check no longer reports a fake as a leak. A fake from an earlier turn can spell a name the conversation meets later, and that copy used to make `leaks.ok` false although the text held nothing private there. A name or company read inside a fake blind wrote over another value is now no hit. It stays a hit when the value written over holds the name, when the copy stands outside what blind wrote, and when the name is in `known`.

Upgrading: a name blind learned in an earlier turn and a later turn writes all in lower case (`thanks, priya`) now goes out as written unless that turn finds the name itself. List the people and companies you know in `known` on every turn to keep them matched in any letter case. The mapping format is unchanged. This is a minor release because the blind text changes for the same input and mapping.
