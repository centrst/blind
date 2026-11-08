"""Fine-tunes mdeberta-v3-base as a BIO token classifier for person, organization and location.

    python -I ner/train/train.py --variant full      # reads .local/train/full, writes ner/models/blind-ner-deberta-full/pt
    python -I ner/train/train.py --variant nogretel

PyTorch on Apple's MPS GPU (CPU when MPS is missing), fp32. Long texts are cut into windows of
at most 512 tokens with 48 words of overlap, the same windows the TypeScript runner uses. A
word's label sits on its first sub-token; the other sub-tokens are ignored by the loss.
Early stopping on entity F1 (person, org, place, exact word span) over a validation split
taken from the training sources (prepare.py, 3% by a hash of each record id).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path

import numpy as np

# Cap MPS at half the recommended working set (about 24 GB on a 64 GB Mac), so running out is an
# error instead of a stall in swap. Set before torch is imported.
os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.5")
os.environ.setdefault("PYTORCH_MPS_LOW_WATERMARK_RATIO", "0.4")
import torch  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import ROOT, check, local_dir  # noqa: E402
from words import KINDS, LABEL2ID, LABELS, MAX_LEN, encode_words, ignored_words, split_words, windows, word_labels  # noqa: E402

DATA = ROOT / ".local" / "train"


def tokenizer_from_base():
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(str(local_dir("mdeberta")))


def featurize(records: list[dict], tok) -> list[dict]:
    """One example per window: input ids with CLS and SEP, label ids on first sub-tokens, and
    for evaluation the record index and the word range."""
    out = []
    budget = MAX_LEN - 2
    for ri, r in enumerate(records):
        words = split_words(r["text"])
        if not words:
            continue
        labs = word_labels(words, r["spans"])
        for i in ignored_words(words, r.get("ignore", ())):
            if labs[i] == 0:
                labs[i] = -100
        ids = encode_words(tok, [w[0] for w in words])
        for a, b in windows(ids):
            x = [tok.cls_token_id]
            y = [-100]
            first = []
            for i in range(a, b):
                piece = ids[i][:budget - (len(x) - 1)] if b - a == 1 else ids[i]
                x.extend(piece)
                y.extend([labs[i]] + [-100] * (len(piece) - 1))
                first.append(len(x) - len(piece))
            x.append(tok.sep_token_id)
            y.append(-100)
            out.append({"ids": x, "labels": y, "firsts": first, "rec": ri, "words": (a, b)})
    return out


PAD_TO = 64
"""Lengths are padded up to a multiple of this, and each length gets a fixed row count, so the
MPS backend sees a handful of shapes. A new shape costs it a kernel compile, which made
unbucketed batches three times slower."""


def padded_len(n: int) -> int:
    return min(MAX_LEN, -(-n // PAD_TO) * PAD_TO)


def batches(examples: list[dict], max_tokens: int, max_rows: int, rng: random.Random) -> list[list[int]]:
    """Batches of one padded length each, under a padded-token budget, in a shuffled order."""
    buckets: dict[int, list[int]] = {}
    for i, e in enumerate(examples):
        buckets.setdefault(padded_len(len(e["ids"])), []).append(i)
    out = []
    for L, idx in sorted(buckets.items()):
        rng.shuffle(idx)
        rows = max(1, min(max_rows, max_tokens // L))
        out.extend(idx[j:j + rows] for j in range(0, len(idx), rows))
    rng.shuffle(out)
    return out


def clip_grad(params: list, max_norm: float) -> None:
    """clip_grad_norm_ without vector_norm, which takes 0.4 s per step on MPS for the 192M-weight
    embedding table. square().sum() gives the same norm in about 15 ms."""
    grads = [p.grad for p in params if p.grad is not None]
    total = torch.stack([g.square().sum() for g in grads]).sum().sqrt()
    coef = torch.clamp(max_norm / (total + 1e-6), max=1.0)
    for g in grads:
        g.mul_(coef)


def collate(examples: list[dict], idx: list[int], pad: int, device) -> dict:
    n = padded_len(max(len(examples[i]["ids"]) for i in idx))
    ids = torch.full((len(idx), n), pad, dtype=torch.long)
    lab = torch.full((len(idx), n), -100, dtype=torch.long)
    mask = torch.zeros((len(idx), n), dtype=torch.long)
    for r, i in enumerate(idx):
        e = examples[i]
        ids[r, : len(e["ids"])] = torch.tensor(e["ids"])
        lab[r, : len(e["labels"])] = torch.tensor(e["labels"])
        mask[r, : len(e["ids"])] = 1
    return {"input_ids": ids.to(device), "attention_mask": mask.to(device), "labels": lab.to(device)}


# ------------------------------------------------------------------ decoding, shared with export.py


def decode(probs: np.ndarray, threshold: float = 0.5) -> list[tuple[int, int, str, float]]:
    """Word spans from per-word label probabilities [words, labels]. The same rule as
    ner/src/token-classifier.ts: a word is part of an entity when 1 - P(O) >= threshold, its kind
    is the kind with the highest B + I probability, and a span starts at a B, at a change of kind,
    or after an O. Returns (first word, last word + 1, kind label, mean entity probability)."""
    spans = []
    cur = None
    for w in range(probs.shape[0]):
        p = probs[w]
        ent = 1.0 - float(p[0])
        if ent < threshold:
            cur = None
            continue
        best, kind, tag = -1.0, "", "B"
        for k in KINDS:
            b, i = float(p[LABEL2ID[f"B-{k}"]]), float(p[LABEL2ID[f"I-{k}"]])
            if b + i > best:
                best, kind, tag = b + i, k, ("B" if b >= i else "I")
        if cur is not None and tag == "I" and cur[2] == kind:
            cur[1] = w + 1
            cur[3].append(ent)
        else:
            cur = [w, w + 1, kind, [ent]]
            spans.append(cur)
    return [(a, b, k, sum(s) / len(s)) for a, b, k, s in spans]


def word_probs(model, examples: list[dict], records: list[dict], device, max_tokens: int = 4096) -> list[np.ndarray]:
    """Per-word probabilities for every record. A word seen in two windows takes the window
    where it is furthest from an edge, as the runner does."""
    nwords = {}
    for e in examples:
        nwords[e["rec"]] = max(nwords.get(e["rec"], 0), e["words"][1])
    probs = {ri: np.zeros((n, len(LABELS)), dtype=np.float32) for ri, n in nwords.items()}
    best = {ri: np.full(n, -1, dtype=np.int64) for ri, n in nwords.items()}
    model.eval()
    order = batches(examples, max_tokens, 16, random.Random(0))
    with torch.no_grad():
        for idx in order:
            b = collate(examples, idx, 0, device)
            logits = model(input_ids=b["input_ids"], attention_mask=b["attention_mask"]).logits
            p = torch.softmax(logits.float(), -1).cpu().numpy()
            for r, i in enumerate(idx):
                e = examples[i]
                a, z = e["words"]
                for j, t in enumerate(e["firsts"]):
                    w = a + j
                    margin = min(w - a, z - 1 - w)
                    if margin > best[e["rec"]][w]:
                        best[e["rec"]][w] = margin
                        probs[e["rec"]][w] = p[r, t]
    return [probs.get(ri, np.zeros((0, len(LABELS)), dtype=np.float32)) for ri in range(len(records))]


def evaluate(model, examples, records, device, threshold: float = 0.5) -> dict:
    tp = {k: 0 for k in KINDS}
    fp = dict(tp)
    fn = dict(tp)
    for r, p in zip(records, word_probs(model, examples, records, device)):
        words = split_words(r["text"])
        labs = word_labels(words, r["spans"])
        gold = {(a, b, k) for a, b, k, _ in decode(np.eye(len(LABELS), dtype=np.float32)[labs], 0.5)} if labs else set()
        skip = ignored_words(words, r.get("ignore", ()))
        # A prediction that lies wholly on ignored words is neither right nor wrong.
        pred = {(a, b, k) for a, b, k, _ in decode(p, threshold) if not all(w in skip for w in range(a, b))}
        for k in KINDS:
            g = {s for s in gold if s[2] == k}
            q = {s for s in pred if s[2] == k}
            tp[k] += len(g & q)
            fp[k] += len(q - g)
            fn[k] += len(g - q)
    res = {}
    for k in KINDS:
        pr = tp[k] / max(1, tp[k] + fp[k])
        rc = tp[k] / max(1, tp[k] + fn[k])
        res[k] = {"p": round(pr, 4), "r": round(rc, 4), "f1": round(2 * pr * rc / max(1e-9, pr + rc), 4)}
    T, F, N = sum(tp.values()), sum(fp.values()), sum(fn.values())
    pr, rc = T / max(1, T + F), T / max(1, T + N)
    res["micro_f1"] = round(2 * pr * rc / max(1e-9, pr + rc), 4)
    return res


def read_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text("utf8").splitlines() if l.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--epochs", type=float, default=3)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--warmup", type=float, default=0.06)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--max-tokens", type=int, default=4096, help="padded tokens per batch")
    ap.add_argument("--max-rows", type=int, default=16)
    ap.add_argument("--evals-per-epoch", type=int, default=4)
    ap.add_argument("--patience", type=int, default=3, help="evaluations without a better F1 before stopping")
    ap.add_argument("--seed", type=int, default=20261024)
    ap.add_argument("--limit", type=int, default=0, help="debug: use only this many training records")
    a = ap.parse_args()

    random.seed(a.seed)
    np.random.seed(a.seed)
    torch.manual_seed(a.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    out = Path(a.out or ROOT / "ner" / "models" / f"blind-ner-deberta-{a.variant}")
    (out / "pt").mkdir(parents=True, exist_ok=True)
    log = (out / "train-log.jsonl").open("a", encoding="utf8")

    def say(**kw):
        kw["t"] = round(time.time() - t0, 1)
        print(json.dumps(kw), flush=True)
        log.write(json.dumps(kw) + "\n")
        log.flush()

    t0 = time.time()
    check("mdeberta")
    from transformers import AutoModelForTokenClassification

    tok = tokenizer_from_base()
    train_recs = read_jsonl(DATA / a.variant / "train.jsonl")
    val_recs = read_jsonl(DATA / a.variant / "val.jsonl")
    if a.limit:
        train_recs = train_recs[: a.limit]
        val_recs = val_recs[: max(50, a.limit // 30)]
    train_ex = featurize(train_recs, tok)
    val_ex = featurize(val_recs, tok)
    say(event="data", train_records=len(train_recs), train_windows=len(train_ex), train_tokens=sum(len(e["ids"]) for e in train_ex), val_records=len(val_recs), val_windows=len(val_ex), device=str(device))

    model = AutoModelForTokenClassification.from_pretrained(
        str(local_dir("mdeberta")), num_labels=len(LABELS), id2label=dict(enumerate(LABELS)), label2id=LABEL2ID, dtype=torch.float32
    ).to(device)
    no_decay = ("bias", "LayerNorm.weight", "layernorm", "norm.weight")
    groups = [
        {"params": [p for n, p in model.named_parameters() if not any(x in n for x in no_decay)], "weight_decay": a.weight_decay},
        {"params": [p for n, p in model.named_parameters() if any(x in n for x in no_decay)], "weight_decay": 0.0},
    ]
    opt = torch.optim.AdamW(groups, lr=a.lr)
    params = [p for p in model.parameters() if p.requires_grad]
    rng = random.Random(a.seed)
    steps_per_epoch = len(batches(train_ex, a.max_tokens, a.max_rows, random.Random(a.seed)))
    total = math.ceil(steps_per_epoch * a.epochs)
    warm = int(total * a.warmup)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: (s + 1) / max(1, warm) if s < warm else max(0.0, (total - s) / max(1, total - warm)))
    eval_every = max(1, steps_per_epoch // a.evals_per_epoch)
    say(event="plan", steps_per_epoch=steps_per_epoch, total_steps=total, warmup=warm, eval_every=eval_every, args=vars(a))

    best, bad, step, done = -1.0, 0, 0, False
    run_loss, run_n = 0.0, 0
    epoch = 0
    while not done:
        for idx in batches(train_ex, a.max_tokens, a.max_rows, rng):
            model.train()
            b = collate(train_ex, idx, tok.pad_token_id, device)
            loss = model(**b).loss
            loss.backward()
            clip_grad(params, 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            if device.type == "mps" and step % 25 == 0:
                # The MPS caching allocator keeps a pool per batch shape and does not give memory back
                # on its own. Without this the first run grew to 61 GB and stalled in swap.
                torch.mps.empty_cache()
            run_loss += float(loss.detach())
            run_n += 1
            if step % 100 == 0:
                say(event="train", step=step, epoch=epoch, loss=round(run_loss / run_n, 4), lr=sched.get_last_lr()[0])
                run_loss, run_n = 0.0, 0
            if step % eval_every == 0 or step >= total:
                m = evaluate(model, val_ex, val_recs, device)
                if device.type == "mps":
                    torch.mps.empty_cache()
                improved = m["micro_f1"] > best
                say(event="eval", step=step, epoch=round(step / steps_per_epoch, 2), improved=improved, **m)
                if improved:
                    best, bad = m["micro_f1"], 0
                    model.save_pretrained(out / "pt")
                    tok.save_pretrained(out / "pt")
                    (out / "pt" / "best.json").write_text(json.dumps({"step": step, "epoch": round(step / steps_per_epoch, 2), **m}, indent=1) + "\n")
                else:
                    bad += 1
                    if bad >= a.patience:
                        say(event="early_stop", step=step, best=best)
                        done = True
                        break
            if step >= total:
                done = True
                break
        epoch += 1
    say(event="done", step=step, best=best)


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
