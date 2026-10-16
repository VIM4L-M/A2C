"""Shared helpers for the A2C mapping-specialist experiment.

The prompt format MUST match packages/shared/src/ai/specialist.ts
(buildSpecialistPrompt / parseSpecialistOutput). tests/specialist.test.ts in the
main repo checks both sides against data/eval.jsonl.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
RUNS_DIR = HERE / "runs"
RESULTS_DIR = HERE / "results"

_LABELS = json.loads((HERE / "labels.json").read_text(encoding="utf-8"))
KEYS: list[str] = _LABELS["keys"]
EXTRA: list[str] = _LABELS["extra"]
ALL_LABELS: list[str] = KEYS + EXTRA

_WS = re.compile(r"\s+")


def sanitize(text: str, max_len: int) -> str:
    """Same behaviour as sanitizeLabel() for plain ASCII labels."""
    cleaned = _WS.sub(" ", "".join(" " if ord(c) < 32 or 127 <= ord(c) <= 159 else c for c in text)).strip()
    return cleaned if len(cleaned) <= max_len else cleaned[: max_len - 1] + "…"


def build_prompt(label: str, field_type: str, options: list[str] | None = None) -> str:
    opts = [sanitize(o, 40) for o in (options or [])[:12]]
    lines = [
        "Map the web form field to one memory key.",
        f"Keys: {', '.join(ALL_LABELS)}",
        f"Field label: {sanitize(label, 160)}",
        f"Field type: {field_type}",
    ]
    if opts:
        lines.append(f"Options: {' | '.join(opts)}")
    lines.append("Key:")
    return "\n".join(lines)


def completion_for(target: str) -> str:
    return f" {target}\n"


def parse_output(text: str, allowed: set[str] | None = None) -> str:
    """First recognised label among the first few words; anything else -> ask_user."""
    allowed = set(KEYS) if allowed is None else allowed
    for token in re.findall(r"[a-z_]+", text.lower())[:5]:
        if token in EXTRA or token in allowed:
            return token
    return "ask_user"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def metrics(targets: list[str], predictions: list[str]) -> dict:
    """Accuracy plus the two safety numbers that matter for A2C."""
    assert len(targets) == len(predictions)
    n = len(targets)
    correct = sum(t == p for t, p in zip(targets, predictions))
    skip_total = sum(t == "skip" for t in targets)
    skip_caught = sum(t == "skip" and p == "skip" for t, p in zip(targets, predictions))
    # A credential field mapped to a memory key would be the dangerous error.
    unsafe = sum(t == "skip" and p in KEYS for t, p in zip(targets, predictions))
    key_total = sum(t in KEYS for t in targets)
    key_correct = sum(t in KEYS and t == p for t, p in zip(targets, predictions))
    per_label: dict[str, dict[str, int]] = {}
    for t, p in zip(targets, predictions):
        row = per_label.setdefault(t, {"total": 0, "correct": 0})
        row["total"] += 1
        row["correct"] += int(t == p)
    return {
        "n": n,
        "accuracy": round(correct / n, 4) if n else 0.0,
        "key_accuracy": round(key_correct / key_total, 4) if key_total else 0.0,
        "credential_skip_recall": round(skip_caught / skip_total, 4) if skip_total else 0.0,
        "unsafe_credential_mappings": unsafe,
        "per_label": per_label,
    }
