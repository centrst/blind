"""
Builds smaller variants of gliner_multi-v2.1 from the fp32 export.
  python -I ner/scripts/convert-model.py <variant> <in fp32 model.onnx> <out.onnx>
(needs onnx 1.23 and onnxruntime 1.31 for the quantization tools; see docs/BROWSER-NER.md)
Variants:
  fp16             onnxconverter-common float16, fp32 inputs/outputs kept (keep_io_types). Fails to load in ORT 1.30 (Cast type mismatch)
  fp16-ort         onnxruntime.transformers.float16 (ORT's fork of the same converter), keep_io_types
  dq-matmul-s8     dynamic quantization, MatMul only, int8 weights, per-tensor (embeddings stay fp32)
  dq-matmul-s8-pc  same, per-channel
  dq-gather-u8     dynamic quantization of the embedding Gather only (uint8 table + DequantizeLinear)
  dq-all-s8-pc     MatMul + Gather, int8 weights, per-channel
  wo8              weight-only 8-bit (MatMulNBits / GatherBlockQuantized, block 32, symmetric), fp32 activations
  wo4              weight-only 4-bit, same layout
  wo8m-gu8         weight-only 8-bit on MatMul only, then the embedding Gather dynamic-quantized to uint8
  wo4m-gu8         weight-only 4-bit on MatMul only, then the embedding Gather dynamic-quantized to uint8
"""
import sys, onnx
variant, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
if variant == 'fp16':
    from onnxconverter_common import float16
    m = onnx.load(src)
    m16 = float16.convert_float_to_float16(m, keep_io_types=True, disable_shape_infer=False)
    onnx.save(m16, dst)
elif variant == 'fp16-ort':
    from onnxruntime.transformers import float16
    m = onnx.load(src)
    m16 = float16.convert_float_to_float16(m, keep_io_types=True)
    onnx.save(m16, dst)
elif variant.startswith('dq-'):
    from onnxruntime.quantization import quantize_dynamic, QuantType
    ops = {'dq-matmul-s8': ['MatMul'], 'dq-matmul-s8-pc': ['MatMul'], 'dq-gather-u8': ['Gather'], 'dq-all-s8-pc': ['MatMul', 'Gather']}[variant]
    wt = QuantType.QUInt8 if variant.endswith('u8') else QuantType.QInt8
    quantize_dynamic(src, dst, op_types_to_quantize=ops, per_channel=variant.endswith('-pc'), weight_type=wt)
elif variant in ('wo8', 'wo4'):
    from onnxruntime.quantization import matmul_nbits_quantizer as q
    bits = 8 if variant == 'wo8' else 4
    cfg = q.DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=bits, op_types_to_quantize=('MatMul', 'Gather'), quant_axes=(('MatMul', 0), ('Gather', 1)))
    qz = q.MatMulNBitsQuantizer(onnx.load(src), bits=bits, block_size=32, is_symmetric=True, op_types_to_quantize=('MatMul', 'Gather'), quant_axes=(('MatMul', 0), ('Gather', 1)), algo_config=cfg)
    qz.process()
    out = qz.model.model if hasattr(qz.model, 'model') else qz.model
    # The quantizer raises the default opset to 21, where ReduceMean's `axes` attribute is invalid.
    # INT4 tensors need IR 10, not opset 21, so the default domain goes back to 14.
    for o in out.opset_import:
        if o.domain in ('', 'ai.onnx'): o.version = 14
    onnx.save(out, dst)
elif variant in ('wo8m-gu8', 'wo4m-gu8'):
    import os, tempfile
    from onnxruntime.quantization import matmul_nbits_quantizer as q, quantize_dynamic, QuantType
    bits = 8 if variant.startswith('wo8') else 4
    cfg = q.DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=bits, op_types_to_quantize=('MatMul',), quant_axes=(('MatMul', 0),))
    qz = q.MatMulNBitsQuantizer(onnx.load(src), bits=bits, block_size=32, is_symmetric=True, op_types_to_quantize=('MatMul',), quant_axes=(('MatMul', 0),), algo_config=cfg)
    qz.process()
    out = qz.model.model if hasattr(qz.model, 'model') else qz.model
    for o in out.opset_import:
        if o.domain in ('', 'ai.onnx'): o.version = 14
    tmp = dst + '.tmp.onnx'
    onnx.save(out, tmp)
    quantize_dynamic(tmp, dst, op_types_to_quantize=['Gather'], weight_type=QuantType.QUInt8)
    os.remove(tmp)
else:
    raise SystemExit(f'unknown variant {variant}')
print('wrote', dst)
