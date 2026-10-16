# Field-mapping comparison

Held-out synthetic eval set (unseen phrasings). Only predictors that were actually run are listed.

| Predictor | Model | N | Accuracy | Key accuracy | Credential skip recall | Unsafe credential mappings | Time (s) | Evaluated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Deterministic rules (A2C baseline) | - | 63 | 84.1% | 81.1% | 100.0% | 0 | 2.5 | 2026-10-16T14:10:48 |
| Gemma 4 (zero-shot) | hf.co/google/gemma-4-E4B-it-qat-q4_0-gguf | 63 | 82.5% | 90.6% | 0.0% | 0 | 165.5 | 2026-10-16T14:22:58 |
| Tinker fine-tuned specialist | - | not run | | | | | | |

Deterministic security rules run before any model in A2C, so a model's skip recall is defence in depth, not the only protection.
