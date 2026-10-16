"""Supervised fine-tuning of the A2C mapping specialist with Tinker (LoRA).

Requires TINKER_API_KEY and `pip install -r training/tinker/requirements.txt`.
Gemma is NOT in Tinker's model catalog, so the specialist uses a supported
small model (default Qwen/Qwen3.5-4B, verified in the catalog on 2026-10-16).

Usage:
  python training/tinker/train_sft.py --base-model Qwen/Qwen3.5-4B --epochs 3

Writes runs/latest.json with the config and the sampler checkpoint path.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time

from common import DATA_DIR, RUNS_DIR, read_jsonl


def build_datum(types, tokenizer, prompt: str, completion: str):
    """Loss only on completion tokens (pattern from the Tinker SDK cheatsheet)."""
    prompt_tokens = tokenizer.encode(prompt)
    completion_tokens = tokenizer.encode(completion, add_special_tokens=False)
    full = prompt_tokens + completion_tokens
    n_prefix = len(prompt_tokens) - 1
    return types.Datum(
        model_input=types.ModelInput.from_ints(tokens=full[:-1]),
        loss_fn_inputs=dict(
            weights=[0.0] * n_prefix + [1.0] * len(completion_tokens),
            target_tokens=full[1:],
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="Qwen/Qwen3.5-4B")
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--name", default="a2c-mapping-specialist")
    args = parser.parse_args()

    if not os.environ.get("TINKER_API_KEY"):
        print("TINKER_API_KEY is not set. No training was run.", file=sys.stderr)
        return 2
    try:
        import tinker
        from tinker import types
    except ImportError:
        print("The tinker SDK is not installed: pip install -r training/tinker/requirements.txt", file=sys.stderr)
        return 2

    rows = read_jsonl(DATA_DIR / "train.jsonl")
    service_client = tinker.ServiceClient()
    training_client = service_client.create_lora_training_client(base_model=args.base_model, rank=args.rank)
    tokenizer = training_client.get_tokenizer()
    data = [build_datum(types, tokenizer, r["prompt"], r["completion"]) for r in rows]

    rng = random.Random(0)
    losses: list[float] = []
    started = time.time()
    for epoch in range(args.epochs):
        rng.shuffle(data)
        for start in range(0, len(data), args.batch_size):
            batch = data[start : start + args.batch_size]
            fwd = training_client.forward_backward(batch, "cross_entropy").result()
            training_client.optim_step(types.AdamParams(learning_rate=args.learning_rate)).result()
            loss = getattr(fwd, "loss", None)
            if loss is not None:
                losses.append(float(loss))
            print(f"epoch {epoch + 1}/{args.epochs} batch {start // args.batch_size + 1}: loss={loss}")

    saved = training_client.save_weights_for_sampler(args.name).result()
    record = {
        "base_model": args.base_model,
        "rank": args.rank,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "train_examples": len(rows),
        "sampler_path": saved.path,
        "final_losses": losses[-5:],
        "seconds": round(time.time() - started, 1),
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    (RUNS_DIR / "latest.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps(record, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
