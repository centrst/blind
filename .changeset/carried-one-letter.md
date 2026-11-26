---
"@centrst/blind": patch
---

A mapping blind wrote is always taken on the next turn. Blind could write a pair it then refused: the one letter of a name given in `known` with an initial (`J` of `Dana J. Mercer`, in `fake` and `random` mode), and one character or an id with no ASCII letter or digit that a caller's detector marked. Passing that mapping back made every later call throw `invalid-known`, which ended the conversation. Such a pair now stays in the mapping and restores as before, and blind does not look for its value bare in later turns. Give the whole name in `known` again to have the initial replaced with it. The mapping format is unchanged.
