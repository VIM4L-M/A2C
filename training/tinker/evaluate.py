"""Evaluate a field-mapping predictor on the held-out synthetic eval set.

Predictors:
  baseline  A2C deterministic rules (classifier + semantic matcher), via Node.
  gemma     Gemma 4 through any OpenAI-compatible endpoint (GEMMA_BASE_URL, GEMMA_MODEL),
            zero-shot with the same prompt the specialist is trained on.
  tinker    The fine-tuned specialist (runs/latest.json sampler_path), needs TINKER_API_KEY.

Usage: python training/tinker/evaluate.py --predictor baseline [--limit N]
Writes results/<predictor>.json. Nothing is reported for a predictor that did not run.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from common import DATA_DIR, HERE, KEYS, RESULTS_DIR, RUNS_DIR, metrics, parse_output, read_jsonl

REPO = HERE.parent.parent


def load_dotenv() -> None:
    env = REPO / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def predict_baseline(rows: list[dict]) -> list[str]:
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise RuntimeError("npx not found; install Node.js")
    payload = "".join(json.dumps({"label": r["label"], "type": r["type"], "options": r["options"]}) + "\n" for r in rows)
    out = subprocess.run([npx, "tsx", str(HERE / "baseline_predict.ts")], input=payload, capture_output=True, text=True, cwd=REPO, check=True)
    preds = [json.loads(line)["prediction"] for line in out.stdout.splitlines() if line.strip()]
    if len(preds) != len(rows):
        raise RuntimeError(f"baseline returned {len(preds)} predictions for {len(rows)} rows")
    return preds


def predict_gemma(rows: list[dict]) -> list[str]:
    base = os.environ.get("GEMMA_BASE_URL", "").rstrip("/")
    model = os.environ.get("GEMMA_MODEL", "")
    if not base or not model:
        raise RuntimeError("GEMMA_BASE_URL and GEMMA_MODEL must be set (see .env.example)")
    headers = {"Content-Type": "application/json"}
    if os.environ.get("GEMMA_API_KEY"):
        headers["Authorization"] = f"Bearer {os.environ['GEMMA_API_KEY']}"
    preds = []
    for i, r in enumerate(rows):
        body = json.dumps({"model": model, "messages": [{"role": "user", "content": r["prompt"] + "\nAnswer with the key only."}], "temperature": 0, "max_tokens": 16}).encode()
        req = urllib.request.Request(f"{base}/chat/completions", data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=300) as resp:
            text = json.loads(resp.read())["choices"][0]["message"]["content"] or ""
        preds.append(parse_output(text))
        print(f"  gemma {i + 1}/{len(rows)}: {r['label']!r} -> {preds[-1]}", file=sys.stderr)
    return preds


def predict_tinker(rows: list[dict]) -> list[str]:
    run = RUNS_DIR / "latest.json"
    if not run.exists():
        raise RuntimeError("runs/latest.json not found: run train_sft.py first")
    if not os.environ.get("TINKER_API_KEY"):
        raise RuntimeError("TINKER_API_KEY is not set")
    import tinker
    from tinker import types

    path = json.loads(run.read_text(encoding="utf-8"))["sampler_path"]
    client = tinker.ServiceClient().create_sampling_client(model_path=path)
    tokenizer = client.get_tokenizer()
    params = types.SamplingParams(max_tokens=8, temperature=0.0, stop=["\n"])
    preds = []
    for r in rows:
        prompt = types.ModelInput.from_ints(tokenizer.encode(r["prompt"]))
        result = client.sample(prompt=prompt, num_samples=1, sampling_params=params).result()
        preds.append(parse_output(tokenizer.decode(result.sequences[0].tokens)))
    return preds


PREDICTORS = {"baseline": predict_baseline, "gemma": predict_gemma, "tinker": predict_tinker}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictor", choices=sorted(PREDICTORS), required=True)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    load_dotenv()

    rows = read_jsonl(DATA_DIR / "eval.jsonl")
    if args.limit:
        rows = rows[: args.limit]
    started = time.time()
    try:
        preds = PREDICTORS[args.predictor](rows)
    except (RuntimeError, urllib.error.URLError, subprocess.CalledProcessError, ImportError) as err:
        print(f"{args.predictor} did not run: {err}", file=sys.stderr)
        return 2
    report = metrics([r["target"] for r in rows], preds)
    report.update(
        {
            "predictor": args.predictor,
            "model": os.environ.get("GEMMA_MODEL") if args.predictor == "gemma" else None,
            "seconds": round(time.time() - started, 1),
            "evaluated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "errors": [{"label": r["label"], "target": r["target"], "prediction": p} for r, p in zip(rows, preds) if r["target"] != p],
        }
    )
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / f"{args.predictor}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("predictor", "n", "accuracy", "key_accuracy", "credential_skip_recall", "unsafe_credential_mappings")}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
