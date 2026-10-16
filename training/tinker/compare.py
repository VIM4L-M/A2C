"""Build results/COMPARISON.md from whichever predictors actually ran."""

from __future__ import annotations

import json

from common import RESULTS_DIR

ORDER = ["baseline", "gemma", "tinker"]
NAMES = {"baseline": "Deterministic rules (A2C baseline)", "gemma": "Gemma 4 (zero-shot)", "tinker": "Tinker fine-tuned specialist"}


def main() -> None:
    lines = [
        "# Field-mapping comparison",
        "",
        "Held-out synthetic eval set (unseen phrasings). Only predictors that were actually run are listed.",
        "",
        "| Predictor | Model | N | Accuracy | Key accuracy | Credential skip recall | Unsafe credential mappings | Time (s) | Evaluated |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    found = 0
    for name in ORDER:
        path = RESULTS_DIR / f"{name}.json"
        if not path.exists():
            lines.append(f"| {NAMES[name]} | - | not run | | | | | | |")
            continue
        r = json.loads(path.read_text(encoding="utf-8"))
        found += 1
        lines.append(
            f"| {NAMES[name]} | {r.get('model') or '-'} | {r['n']} | {r['accuracy']:.1%} | {r['key_accuracy']:.1%} | "
            f"{r['credential_skip_recall']:.1%} | {r['unsafe_credential_mappings']} | {r['seconds']} | {r['evaluated_at']} |"
        )
    lines += ["", "Deterministic security rules run before any model in A2C, so a model's skip recall is defence in depth, not the only protection."]
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "COMPARISON.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n{found} predictor result(s) found.")


if __name__ == "__main__":
    main()
