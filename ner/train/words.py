"""Word splitting, labels and windows shared by prepare.py, train.py and export.py.

The splitter is the one in ner/src/gliner.ts (`splitWords`), so the model is trained on
the same words the TypeScript runner feeds it. Each word is tokenized on its own, the way
`tokenizer(words, is_split_into_words=True)` does it and the way the runner calls
`tokenizer.encode(word)`. The label of a word sits on its first sub-token.
"""

from __future__ import annotations

import regex

# Same pattern as WORD_RE in ner/src/gliner.ts. Offsets here are code points; the runner's are
# UTF-16, but both split at the same characters.
WORD_RE = regex.compile(r"[\p{L}\p{N}\p{M}_]+(?:[-_][\p{L}\p{N}\p{M}_]+)*|\S")

KINDS = ("person", "organization", "location")
LABELS = ["O"] + [f"{p}-{k}" for k in KINDS for p in ("B", "I")]
LABEL2ID = {l: i for i, l in enumerate(LABELS)}

# blind's kinds onto the label names the detector sends by default (DEFAULT_LABELS in detector.ts).
KIND_TO_LABEL = {"person": "person", "org": "organization", "place": "location"}

MAX_LEN = 512
"""Model window in tokens, special tokens included."""
STRIDE_WORDS = 48
"""Words of overlap between windows of a long text."""


def split_words(text: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in WORD_RE.finditer(text)]


def word_labels(words: list[tuple[str, int, int]], spans: list[dict]) -> list[int]:
    """BIO label id per word. A word takes the first span it overlaps. Spans carry blind kinds."""
    out = [0] * len(words)
    spans = sorted(spans, key=lambda s: (s["start"], -s["end"]))
    owner = [-1] * len(words)
    j = 0
    for si, s in enumerate(spans):
        first = True
        # words are sorted by start; a linear scan from the last start is enough for these sizes
        while j < len(words) and words[j][2] <= s["start"]:
            j += 1
        k = j
        while k < len(words) and words[k][1] < s["end"]:
            if owner[k] == -1:
                owner[k] = si
                lab = KIND_TO_LABEL[s["kind"]]
                out[k] = LABEL2ID[("B-" if first else "I-") + lab]
            first = False
            k += 1
    return out


def ignored_words(words: list[tuple[str, int, int]], ranges) -> set[int]:
    """Indexes of the words that overlap an ignore range [start, end) (code points)."""
    out = set()
    for a, b in ranges:
        for i, (_, s, e) in enumerate(words):
            if s < b and a < e:
                out.add(i)
    return out


def encode_words(tokenizer, words: list[str]) -> list[list[int]]:
    """Token ids per word, no special tokens. A word the tokenizer drops entirely becomes
    one unknown token, so every word has a first sub-token to carry its label. The runner
    does the same."""
    if not words:
        return []
    enc = tokenizer(words, add_special_tokens=False)["input_ids"]
    return [list(x) if len(x) else [tokenizer.unk_token_id] for x in enc]


def windows(word_ids: list[list[int]], max_len: int = MAX_LEN, stride: int = STRIDE_WORDS) -> list[tuple[int, int]]:
    """Word ranges [a, b) whose tokens fit max_len - 2, overlapping by up to `stride` words.
    Same rule as the TypeScript runner, so training sees the windows inference sees."""
    budget = max_len - 2
    out: list[tuple[int, int]] = []
    n = len(word_ids)
    a = 0
    while a < n:
        used = 0
        b = a
        while b < n and used + len(word_ids[b]) <= budget:
            used += len(word_ids[b])
            b += 1
        if b == a:
            b = a + 1  # one oversized word still advances; its tokens are cut to the budget
        out.append((a, b))
        if b >= n:
            break
        a = max(a + 1, b - stride)
    return out
