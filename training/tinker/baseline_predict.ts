// Baseline predictor for evaluate.py: A2C's deterministic classifier + semantic matcher.
// stdin: JSONL {label, type, options}  ->  stdout: JSONL {prediction}
import { buildMemoryKeyDescriptors, classifyField, matchField, type FieldKind } from '@a2c/shared';

const KINDS = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox']);
// Every catalog key is offered (as if the user had all facts).
const keys = buildMemoryKeyDescriptors([]).map((k) => ({ ...k, hasValue: true }));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  for (const line of input.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { label: string; type: string; options: string[] };
    const kind = (KINDS.has(row.type) ? row.type : 'text') as FieldKind;
    const cls = classifyField({ kind, inputType: row.type, label: row.label, optionLabels: row.options });
    let prediction: string;
    if (cls.risk === 'red') prediction = 'skip';
    else {
      const m = matchField({ id: 'f_baseline1', label: row.label, type: kind, hint: '', section: '', required: false, options: row.options }, keys);
      prediction = m.action === 'use_memory' && m.memoryKey ? m.memoryKey : m.action === 'skip' ? 'skip' : 'ask_user';
    }
    process.stdout.write(`${JSON.stringify({ prediction })}\n`);
  }
});
