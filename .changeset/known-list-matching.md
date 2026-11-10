---
"@centrst/blind": patch
---

`blind` is fast with a long `known` list. Each entry used to compile its own pattern and scan the text on every call, so 4,000 people took about 4 seconds on a one-line text and 22 seconds on a 200 KB one. Now an entry's pattern is built and run only when the text contains one of its words, and the language of each known person's fake is looked up once per call instead of once per name found. 10,000 people take about a tenth of a second on a short text. The output is the same for every input.
