"""Exports a trained checkpoint to the directory `TokenClassifierModel.load` reads.

    python -I ner/train/export.py ner/models/blind-ner-deberta-full [variant]

Writes, next to `pt/`:
    onnx/model.onnx        fp32, inputs input_ids and attention_mask (int64 [batch, tokens]), output logits
    onnx/model_int8.onnx   weight-only int8: MatMul weights int8 (block 32), the embedding table uint8, float activations
    onnx/model_int8_dynamic.onnx  dynamic int8 (activations quantized at run time), measured for comparison, not shipped
    tokenizer.json, tokenizer_config.json, config.json
    labels.json            label order, the kind each label names, window settings, special token ids
    parity.json            spans the Python pipeline finds with the fp32 file, which the TypeScript runner must reproduce
    manifest.json          SHA-256 and size of every file, and the parity check below

Parity: both ONNX files run over the validation split in the same windows, and the script
reports word-level label agreement with PyTorch and the validation F1 of each.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import ROOT  # noqa: E402
from train import DATA, decode, featurize, read_jsonl, word_probs  # noqa: E402
from words import KINDS, LABELS, MAX_LEN, STRIDE_WORDS, ignored_words, split_words, word_labels  # noqa: E402


def sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


class OrtModel(torch.nn.Module):
    """Stands in for the PyTorch model in word_probs, running an ONNX file on the CPU."""

    def __init__(self, path: Path):
        super().__init__()
        import onnxruntime as ort

        self.sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])

    def forward(self, input_ids, attention_mask):
        out = self.sess.run(["logits"], {"input_ids": input_ids.cpu().numpy(), "attention_mask": attention_mask.cpu().numpy()})[0]
        return type("O", (), {"logits": torch.from_numpy(out)})()


def f1(records, probs) -> dict:
    tp = fp = fn = 0
    per = {k: [0, 0, 0] for k in KINDS}
    eye = np.eye(len(LABELS), dtype=np.float32)
    for r, p in zip(records, probs):
        words = split_words(r["text"])
        labs = word_labels(words, r["spans"])
        gold = {(a, b, k) for a, b, k, _ in decode(eye[labs], 0.5)} if labs else set()
        skip = ignored_words(words, r.get("ignore", ()))
        pred = {(a, b, k) for a, b, k, _ in decode(p, 0.5) if not all(w in skip for w in range(a, b))}
        for k in KINDS:
            g = {s for s in gold if s[2] == k}
            q = {s for s in pred if s[2] == k}
            per[k][0] += len(g & q)
            per[k][1] += len(q - g)
            per[k][2] += len(g - q)
    tp, fp, fn = (sum(v[i] for v in per.values()) for i in range(3))
    pr, rc = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return {"micro_f1": round(2 * pr * rc / max(1e-9, pr + rc), 4), **{k: round(2 * v[0] / max(1, 2 * v[0] + v[1] + v[2]), 4) for k, v in per.items()}}


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    variant = sys.argv[2] if len(sys.argv) > 2 else root.name.removeprefix("blind-ner-deberta-")
    from transformers import AutoModelForTokenClassification, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(str(root / "pt"))
    model = AutoModelForTokenClassification.from_pretrained(str(root / "pt"), dtype=torch.float32).eval()
    (root / "onnx").mkdir(exist_ok=True)
    fp32 = root / "onnx" / "model.onnx"
    ids = torch.tensor([[tok.cls_token_id] + [100] * 30 + [tok.sep_token_id]] * 2)
    am = torch.ones_like(ids)
    torch.onnx.export(
        model, (ids, am), str(fp32), input_names=["input_ids", "attention_mask"], output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch", 1: "tokens"}, "attention_mask": {0: "batch", 1: "tokens"}, "logits": {0: "batch", 1: "tokens"}},
        opset_version=17, dynamo=False, do_constant_folding=True,
    )
    for extra in list((root / "onnx").glob("*.data")):
        print("note: external data file", extra.name)

    import subprocess

    from onnxruntime.quantization import QuantType, quantize_dynamic

    # The shipped int8 file: weight-only 8-bit MatMul (MatMulNBits, block 32, symmetric) and the
    # embedding table in uint8, activations in float. The recipe docs/BROWSER-NER.md settled on for
    # GLiNER, built by ner/scripts/convert-model.py.
    int8 = root / "onnx" / "model_int8.onnx"
    subprocess.run([sys.executable, "-I", str(ROOT / "ner" / "scripts" / "convert-model.py"), "wo8m-gu8", str(fp32), str(int8)], check=True)
    # For comparison only: ONNX Runtime's dynamic quantization, which also quantizes activations at run time.
    dyn = root / "onnx" / "model_int8_dynamic.onnx"
    tmp = root / "onnx" / "model_int8_matmul.tmp.onnx"
    quantize_dynamic(str(fp32), str(tmp), op_types_to_quantize=["MatMul"], per_channel=True, weight_type=QuantType.QInt8)
    quantize_dynamic(str(tmp), str(dyn), op_types_to_quantize=["Gather"], weight_type=QuantType.QUInt8)
    tmp.unlink()

    tok.save_pretrained(str(root))
    shutil.copy(root / "pt" / "config.json", root / "config.json")
    (root / "labels.json").write_text(json.dumps({
        "labels": LABELS,
        "kinds": {k: k for k in KINDS},
        "scheme": "BIO, label on the first sub-token of each word",
        "maxLen": MAX_LEN,
        "strideWords": STRIDE_WORDS,
        "special": {"cls": tok.cls_token_id, "sep": tok.sep_token_id, "pad": tok.pad_token_id, "unk": tok.unk_token_id},
        "words": "ner/src/gliner.ts splitWords, each word tokenized on its own",
    }, indent=1) + "\n")

    # Parity on the validation split.
    val = read_jsonl(DATA / variant / "val.jsonl")
    ex = featurize(val, tok)
    ref = word_probs(model, ex, val, torch.device("cpu"))
    parity = {"validationRecords": len(val), "pytorch": f1(val, ref)}
    for name, p in (("fp32", fp32), ("int8", int8), ("int8_dynamic", dyn)):
        got = word_probs(OrtModel(p), ex, val, torch.device("cpu"))
        agree = np.mean(np.concatenate([a.argmax(-1) == b.argmax(-1) for a, b in zip(ref, got) if len(a)]))
        maxdiff = max(float(np.abs(a - b).max()) for a, b in zip(ref, got) if len(a))
        parity[name] = {"wordLabelAgreement": round(float(agree), 5), "maxProbDiff": round(maxdiff, 5), **f1(val, got)}
        print(name, parity[name], flush=True)
    # Spans the Python pipeline finds with the fp32 ONNX file, for ner/test/token-classifier.test.ts:
    # the TypeScript runner must find exactly these. Includes one long text that needs many windows.
    cases = val[:60] + [{"text": "\n\n".join(r["text"] for r in val[60:72]), "spans": []}]
    cex = featurize(cases, tok)
    cprobs = word_probs(OrtModel(fp32), cex, cases, torch.device("cpu"))
    dump = []
    for r, p in zip(cases, cprobs):
        w = split_words(r["text"])
        u = [0]
        for ch in r["text"]:
            u.append(u[-1] + (2 if ord(ch) > 0xFFFF else 1))
        for th in (0.3, 0.5):
            dump.append({"text": r["text"], "threshold": th, "spans": [[u[w[a][1]], u[w[b - 1][2]], k] for a, b, k, _ in decode(p, th)]})
    (root / "parity.json").write_text(json.dumps({"file": "onnx/model.onnx", "cases": dump}, ensure_ascii=False) + "\n", "utf8")
    files = {}
    for f in sorted(root.rglob("*")):
        if f.is_file() and "pt" not in f.relative_to(root).parts[:1] and f.name != "manifest.json" and f.suffix != ".jsonl":
            files[str(f.relative_to(root))] = {"sha256": sha(f), "bytes": f.stat().st_size}
    (root / "manifest.json").write_text(json.dumps({"variant": variant, "parity": parity, "files": files}, indent=1) + "\n")
    print(json.dumps(parity, indent=1))
    print(json.dumps(files, indent=1))


if __name__ == "__main__":
    main()
