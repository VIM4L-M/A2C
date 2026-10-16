# A2C mapping specialist: Tinker fine-tuning experiment

Goal: train a small model that maps unfamiliar form-field labels ("Developer Repository", "Educational Institution") to A2C memory keys (`github_url`, `college`), or to `ask_user` / `skip`.

- **Gemma 4 stays the primary engine.** The specialist is an optional, experimental mapper (Settings → "Fine-tuned specialist").
- **Deterministic rules stay the authority** for privacy and security. A model answer can never unblock a field.
- **Tinker is a training platform, not a model.** Its catalog (checked 2026-10-16, [Models & Pricing](https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/)) has no Gemma model, so the specialist uses `Qwen/Qwen3.5-4B` (dense, 4B, listed in the catalog).

## Files

| File | Purpose |
| --- | --- |
| `labels.json` | Label set (memory keys + `ask_user`, `skip`). Must match the extension catalog (checked by `tests/specialist.test.ts`). |
| `common.py` | Prompt format (identical to `packages/shared/src/ai/specialist.ts`), output parser, metrics. |
| `generate_dataset.py` | Synthetic, hand-written labels → `data/train.jsonl` (260) and `data/eval.jsonl` (63). Eval phrasings never appear in training. No user data, no values. |
| `train_sft.py` | LoRA SFT with the official Tinker SDK (`create_lora_training_client`, `forward_backward(..., "cross_entropy")`, `optim_step(AdamParams)`, `save_weights_for_sampler`). Writes `runs/latest.json`. |
| `evaluate.py` | Scores a predictor on the held-out set: `baseline` (A2C rules), `gemma` (Gemma 4 zero-shot via any OpenAI-compatible endpoint), `tinker` (the trained checkpoint). Writes `results/<predictor>.json`. |
| `compare.py` | Builds `results/COMPARISON.md` from the predictors that actually ran. |
| `baseline_predict.ts` | Runs A2C's deterministic classifier + matcher for the baseline. |
| `tests/test_pipeline.py` | Dataset, prompt, parser and metric tests (`npm run test:training`). |

## Run it

```bash
python training/tinker/generate_dataset.py
python training/tinker/evaluate.py --predictor baseline
python training/tinker/evaluate.py --predictor gemma      # needs GEMMA_BASE_URL / GEMMA_MODEL (.env)

# Fine-tuning (needs a Tinker account)
pip install -r training/tinker/requirements.txt
export TINKER_API_KEY=...            # PowerShell: $env:TINKER_API_KEY="..."
python training/tinker/train_sft.py --base-model Qwen/Qwen3.5-4B --epochs 3
python training/tinker/evaluate.py --predictor tinker
python training/tinker/compare.py
```

Metrics: overall accuracy, accuracy on memory-key fields, recall of `skip` on credential fields, and the count of **unsafe credential mappings** (a credential label mapped to a memory key; must be 0).

## Results

See `results/COMPARISON.md` (generated; only lists predictors that actually ran). The main README reports the numbers measured on the dev machine.

**No Tinker training run has been performed in this repository yet** (no `TINKER_API_KEY` was available). `runs/latest.json` does not exist until you run `train_sft.py`; nothing here claims fine-tuned results.

## Using a trained specialist in A2C

Serve the checkpoint behind an OpenAI-compatible `/chat/completions` endpoint and set `SPECIALIST_BASE_URL`, `SPECIALIST_MODEL` (and `SPECIALIST_API_KEY` if needed) on the backend. The backend sends the same prompt (`buildSpecialistPrompt`) and parses one label per field. Tinker documents an OpenAI-compatible API for sampling from checkpoints; follow its current docs for the URL and model path.

## Limitations

- The dataset is small and synthetic; real forms are more varied. Treat results as a sanity check, not a benchmark.
- Only single-label mapping is learned; drafting answers stays with Gemma 4.
