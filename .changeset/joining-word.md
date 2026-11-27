---
"@centrst/blind": patch
---

The leak check no longer reports the joining word of a name. A sender called `Anna from Harborview` made every `from` in the other texts of the call a `person` hit, so `leaks.ok` was false on text that held nothing of the name. A word a person's name writes in lower case between two capitalised ones now joins the name as `de la` does and is not looked for alone. The other words of the name are checked as before, and so is every word of a name written all in lower case or with a lower-case first or last word. The blind text and the mapping are unchanged.
