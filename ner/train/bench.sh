#!/bin/zsh
# Scores GLiNER and the trained token classifiers on every dataset in ner/TRAINED.md, one after
# another, so the model times are measured on a quiet machine. Run from the repository root after
# training and export:
#   zsh ner/train/bench.sh
# Needs: ner/models/gliner_multi-v2.1 (pnpm ner:download), ner/models/blind-ner-deberta-{full,nogretel,full2},
# .local/train-venv (pnpm ner:train:setup), and the pinned Gretel test parquet (pnpm bench:gretel:setup).
# LLM Guard execution is retired; existing historical raw results can still be scored.
# Model output is cached in .local/bench-*-cache-*.json. Delete those files for uncached times.
set -e
FULL=ner/models/blind-ner-deberta-full
NOG=ner/models/blind-ner-deberta-nogretel
R2=ner/models/blind-ner-deberta-full2
TC=(--tc "DeBERTa=$FULL" --tc "DeBERTa int8=$FULL,onnx/model_int8.onnx" --tc "DeBERTa 0.5=$FULL,onnx/model.onnx,0.5" --tc "DeBERTa no-Gretel=$NOG"
    --tc "DeBERTa r2=$R2" --tc "DeBERTa r2 int8=$R2,onnx/model_int8.onnx" --tc "DeBERTa r2 0.5=$R2,onnx/model.onnx,0.5")
PY=.local/train-venv/bin/python

# Held-out inputs (never trained on) and the Gretel sample.
$PY -I ner/train/prepare.py evalsets --per-lang 500
$PY -I scripts/bench/gretel_sample.py

pnpm exec tsx --tsconfig ner/tsconfig.json scripts/bench/score.ts --out reports/tc-corpus-bench.json "${TC[@]}" | tee reports/tc-corpus-bench.txt
pnpm exec tsx --tsconfig ner/tsconfig.json scripts/bench/score-gretel.ts --out reports/tc-gretel-bench.json "${TC[@]}" | tee reports/tc-gretel-bench.txt
for d in neutral privy nemotron; do
  pnpm exec tsx --tsconfig ner/tsconfig.json scripts/bench/score-gretel.ts --input reports/$d-input.json --out reports/tc-$d-bench.json --raw-prefix $d "${TC[@]}" | tee reports/tc-$d-bench.txt
done

# Speed and memory, uncached, one process per model, on the corpus and on the Gretel sample.
for input in "" "--input reports/gretel-input.json"; do
  for args in "ner/models/gliner_multi-v2.1" "$FULL --backend tc" "$FULL --backend tc --file onnx/model_int8.onnx" "$R2 --backend tc" "$R2 --backend tc --file onnx/model_int8.onnx"; do
    pnpm exec tsx --tsconfig ner/tsconfig.json ner/scripts/bench.ts ${=args} ${=input}
  done
done | tee reports/tc-speed.txt

# Role words tagged as person or org on the Gretel sample, from the cached raw spans.
$PY -I ner/train/roles.py "GLiNER 0.3=.local/bench-ner-cache-0.3.json" "GLiNER 0.5=.local/bench-ner-cache-0.5.json" "DeBERTa=.local/bench-tc-cache-blind-ner-deberta-full-model-0.3.json" \
  "DeBERTa no-Gretel=.local/bench-tc-cache-blind-ner-deberta-nogretel-model-0.3.json" "DeBERTa r2=.local/bench-tc-cache-blind-ner-deberta-full2-model-0.3.json" | tee reports/tc-roles.txt
