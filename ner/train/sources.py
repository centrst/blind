"""Every upstream file the training and the held-out scores read, pinned by revision and SHA-256.

    python -I ner/train/sources.py        # fetch what is missing into .local/hf, check every hash

Licences were read on each card at the pinned revision (see ner/TRAINED.md). Nothing NC,
nothing without a licence, nothing from ai4privacy or Isotonic.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HF = ROOT / ".local" / "hf"

SOURCES = {
    "mdeberta": {
        "repo": "microsoft/mdeberta-v3-base", "type": "model", "license": "MIT",
        "revision": "a0484667b22365f84929a935b5e50a51f71f159d",
        "files": {
            "config.json": "bcffcd343dc5efa5ef2d5a58d2b405eed108f01cc45b48d0a907b333ec41801f",
            "spm.model": "13c8d666d62a7bc4ac8f040aab68e942c861f93303156cc28f5c7e885d86d6e3",
            "tokenizer_config.json": "3f3978e0c036f2c2588cac34a6047cbb0af0b0dc1814254e291028529805496d",
            "pytorch_model.bin": "6f89419baf0f1aaad5cab7d53901e36a8c1af8f6b4ab58b15db9af32df656ead",
        },
    },
    "gretel_finance": {
        "repo": "gretelai/synthetic_pii_finance_multilingual", "type": "dataset", "license": "Apache-2.0",
        "revision": "7b844d16738527a04264f50214cb426a4cea0897",
        "files": {"data/train-00000-of-00001.parquet": "89bfe27e37e50098347f47f974e5e43f64a521f38171b618600ea7aa9b4fa430"},
    },
    "gretel_masking": {
        "repo": "gretelai/gretel-pii-masking-en-v1", "type": "dataset", "license": "Apache-2.0",
        "revision": "e06eb1499ca8d54470f085021cd8e54f9efac7fd",
        "files": {"data/train-00000-of-00001.parquet": "93169003eaa23d0499dbbe26794514216af22bc1bbee71b7b1e1f23edca5ce79"},
    },
    "nemotron": {
        "repo": "nvidia/Nemotron-PII", "type": "dataset", "license": "CC-BY-4.0",
        "revision": "b70ffaf5ff39e079776134c5bf4381f00a9fd1ed",
        "files": {
            "data/train-00000-of-00001.parquet": "9cb1a88c339ab84ddbc35ccdde4f6bb713300f5585881f9e02b8db1e0dfdbece",
            "data/test-00000-of-00001.parquet": "1a4b0512ecb5370f0992d29d0f9c07351e6de13f0d7ea33bb18cecb984780247",
        },
    },
    # Held out from every variant. Never read by build.
    "neutral": {
        "repo": "urchade/synthetic-pii-ner-mistral-v1", "type": "dataset", "license": "Apache-2.0",
        "revision": "392d6853aaec28075253565350e0d17b9e0ffc0d",
        "files": {"data.json": "78680af45ca6b1175c502db2eec441933de7383f440fc0f0bae46a72be13c0c7"},
    },
    "privy": {
        "repo": "beki/privy", "type": "dataset", "license": "MIT",
        "revision": "dc137a6a976f6b5bb8768e9bb51ec58df930ccd1",
        "files": {"privy-dataset.zip": "ad4ffbc8f7102a92f01f8d8023ddf4f5244fea6b23c3f116641fe6bbd8cbbde4"},
    },
}


def local_dir(name: str) -> Path:
    return HF / SOURCES[name]["repo"].replace("/", "__")


def path(name: str, file: str) -> Path:
    return local_dir(name) / file


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check(name: str) -> None:
    for f, want in SOURCES[name]["files"].items():
        p = path(name, f)
        got = sha256(p) if p.exists() else None
        if got != want:
            raise SystemExit(f"{p}: SHA-256 {got}, expected {want}. Run python -I ner/train/sources.py")


def fetch() -> None:
    from huggingface_hub import hf_hub_download

    for name, s in SOURCES.items():
        for f, want in s["files"].items():
            p = path(name, f)
            if not (p.exists() and sha256(p) == want):
                hf_hub_download(s["repo"], f, repo_type=s["type"], revision=s["revision"], local_dir=str(local_dir(name)))
            got = sha256(p)
            if got != want:
                raise SystemExit(f"{name} {f}: checksum mismatch ({got})")
            print(f"ok {name} {f}")


if __name__ == "__main__":
    fetch() if len(sys.argv) == 1 else [check(n) for n in sys.argv[1:]]
