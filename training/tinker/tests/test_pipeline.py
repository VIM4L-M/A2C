import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import generate_dataset  # noqa: E402
from common import ALL_LABELS, DATA_DIR, KEYS, build_prompt, metrics, parse_output, read_jsonl  # noqa: E402


class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        generate_dataset.main()
        cls.train = read_jsonl(DATA_DIR / "train.jsonl")
        cls.eval = read_jsonl(DATA_DIR / "eval.jsonl")

    def test_labels_are_valid(self):
        for row in self.train + self.eval:
            self.assertIn(row["target"], ALL_LABELS)
            self.assertEqual(row["prompt"], build_prompt(row["label"], row["type"], row["options"]))
            self.assertEqual(row["completion"], f" {row['target']}\n")

    def test_eval_phrasings_unseen(self):
        train_labels = {r["label"].lower() for r in self.train}
        overlap = [r["label"] for r in self.eval if r["label"].lower() in train_labels]
        self.assertEqual(overlap, [])

    def test_every_key_and_safety_label_covered(self):
        targets = {r["target"] for r in self.eval}
        for key in KEYS:
            self.assertIn(key, targets)
        self.assertIn("skip", targets)
        self.assertIn("ask_user", targets)

    def test_credentials_are_skip_and_carry_no_values(self):
        for row in self.train + self.eval:
            if any(w in row["label"].lower() for w in ("password", "otp", "cvv", "api key", "card number")):
                self.assertEqual(row["target"], "skip")
            self.assertEqual(set(row), {"label", "type", "options", "target", "prompt", "completion"})

    def test_deterministic(self):
        before = (DATA_DIR / "train.jsonl").read_text(encoding="utf-8")
        generate_dataset.main()
        self.assertEqual(before, (DATA_DIR / "train.jsonl").read_text(encoding="utf-8"))


class ParsingAndMetricsTests(unittest.TestCase):
    def test_parse_output(self):
        self.assertEqual(parse_output(" college\n"), "college")
        self.assertEqual(parse_output("**github_url**"), "github_url")
        self.assertEqual(parse_output("Key: skip"), "skip")
        self.assertEqual(parse_output("social_security_number"), "ask_user")
        self.assertEqual(parse_output(""), "ask_user")

    def test_prompt_format(self):
        p = build_prompt("Developer   Repository", "url")
        self.assertIn("Field label: Developer Repository\nField type: url\nKey:", p)
        self.assertTrue(p.startswith("Map the web form field to one memory key.\nKeys: full_name,"))

    def test_metrics(self):
        m = metrics(["college", "skip", "skip", "ask_user"], ["college", "skip", "github_url", "college"])
        self.assertEqual(m["accuracy"], 0.5)
        self.assertEqual(m["credential_skip_recall"], 0.5)
        self.assertEqual(m["unsafe_credential_mappings"], 1)
        self.assertEqual(json.loads(json.dumps(m))["n"], 4)


if __name__ == "__main__":
    unittest.main()
