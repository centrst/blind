---
"@centrst/blind": minor
---

Fake addresses and UK and North American numbers can no longer reach anyone. A fake mailbox at a public provider now moves to the provider's name under `.example` (`claire.hayes@gmail.example` instead of a Gmail address someone may hold), unless the address is unchanged or the provider could never issue it. Every UK number now becomes a number in the Ofcom drama range for its kind of line, including landlines, freephone, premium-rate and `+44 (0)` numbers, and a nine-digit UK number gets a ten-digit fake. Every ten-digit North American number now becomes NXX-555-01XX. The mapping format is unchanged, and a mapping from 0.2.0 keeps its earlier fakes in later turns. This is a minor release because the blind text changes for the same input and seed.
