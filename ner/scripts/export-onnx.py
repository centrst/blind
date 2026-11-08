"""
Exports a GLiNER span model from the Hugging Face Hub to the layout GlinerModel.load reads:
  <out>/onnx/model.onnx, <out>/tokenizer.json, <out>/tokenizer_config.json, <out>/gliner_config.json
  python -I ner/scripts/export-onnx.py <repo> <revision> <out dir> [--opset 14]
Needs the venv in ner/CANDIDATES.md (gliner 0.2.29, torch 2.14.1, onnx 1.23.2, onnxruntime 1.31.0).

It uses gliner's own export_to_onnx, which runs the TorchScript exporter (dynamo=False) with the
input names and dynamic axes of the onnx-community export of gliner_multi-v2.1. Opset 14 matches
that export. After the export it runs the same batch through PyTorch and through ONNX Runtime and
fails when the logits differ by more than 1e-3, then prints the SHA-256 of every file it wrote.
"""
import argparse, hashlib, json, os, shutil, sys, tempfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('repo')
ap.add_argument('revision')
ap.add_argument('out')
ap.add_argument('--opset', type=int, default=14)
a = ap.parse_args()

import numpy as np
import onnxruntime as ort
import torch
from gliner import GLiNER

out = Path(a.out)
if (out / 'onnx' / 'model.onnx').exists():
    sys.exit(f'{out} already has onnx/model.onnx, remove it first')

model = GLiNER.from_pretrained(a.repo, revision=a.revision, load_tokenizer=True)
model.eval()

with tempfile.TemporaryDirectory(dir=out.parent if out.parent.exists() else None) as tmp:
    model.export_to_onnx(tmp, onnx_filename='model.onnx', quantize=False, opset=a.opset)
    (out / 'onnx').mkdir(parents=True, exist_ok=True)
    shutil.move(os.path.join(tmp, 'model.onnx'), out / 'onnx' / 'model.onnx')
    for f in ('gliner_config.json', 'tokenizer.json', 'tokenizer_config.json'):
        if not os.path.exists(os.path.join(tmp, f)):
            sys.exit(f'export wrote no {f}')
        shutil.move(os.path.join(tmp, f), out / f)

# Same batch through PyTorch and ONNX Runtime. Synthetic text, invented names.
text = 'Estimada Pilar Gómez Arranz, le escribe Tomás Ferrer de Gestoría Nortevía S.L. desde Valladolid sobre la factura de marzo.'
labels = ['person', 'organization', 'location']
batch = model._build_dummy_batch(labels=labels, text=text)
names = ['input_ids', 'attention_mask', 'words_mask', 'text_lengths', 'span_idx', 'span_mask']
with torch.no_grad():
    ref = model.model(**{k: batch[k] for k in names}).logits.numpy()
sess = ort.InferenceSession(str(out / 'onnx' / 'model.onnx'), providers=['CPUExecutionProvider'])
got = sess.run(['logits'], {k: batch[k].numpy() for k in names})[0]
diff = float(np.abs(ref - got).max())
print(f'logits shape {got.shape}, max abs diff PyTorch vs ONNX Runtime {diff:.2e}')
if diff > 1e-3:
    sys.exit('ONNX output does not match PyTorch')

def sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

files = {str(p.relative_to(out)): {'bytes': p.stat().st_size, 'sha256': sha(p)} for p in sorted(out.rglob('*')) if p.is_file()}
meta = {'repo': a.repo, 'revision': a.revision, 'opset': a.opset, 'maxAbsDiff': diff, 'files': files}
(out / 'export-meta.json').write_text(json.dumps(meta, indent=2) + '\n')
print(json.dumps(meta, indent=2))
