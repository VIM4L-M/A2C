import { buildSpecialistPrompt, parseSpecialistOutput, SPECIALIST_KEYS } from '@a2c/shared';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(import.meta.dirname, '../training/tinker');

describe('Tinker specialist contract', () => {
  it('labels.json matches the memory catalog order', () => {
    const labels = JSON.parse(readFileSync(resolve(dir, 'labels.json'), 'utf8'));
    expect(labels.keys).toEqual(SPECIALIST_KEYS);
    expect(labels.extra).toEqual(['ask_user', 'skip']);
  });

  it('the Python dataset uses exactly the prompt the server sends', () => {
    if (!existsSync(resolve(dir, 'data/eval.jsonl'))) execFileSync('python', [resolve(dir, 'generate_dataset.py')], { cwd: dir });
    const rows = readFileSync(resolve(dir, 'data/eval.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(rows.length).toBeGreaterThan(40);
    for (const r of rows) expect(r.prompt).toBe(buildSpecialistPrompt({ label: r.label, type: r.type, options: r.options }));
  });

  it('parses model output defensively', () => {
    const keys = new Set(SPECIALIST_KEYS);
    expect(parseSpecialistOutput(' college\n', keys)).toBe('college');
    expect(parseSpecialistOutput('**github_url**', keys)).toBe('github_url');
    expect(parseSpecialistOutput('Key: skip', keys)).toBe('skip');
    expect(parseSpecialistOutput('ssn', keys)).toBe('ask_user');
    expect(parseSpecialistOutput('github_url', new Set(['college']))).toBe('ask_user');
  });
});
