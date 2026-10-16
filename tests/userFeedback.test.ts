// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://forms.example.test/survey"}
import { adaptToField, buildMappingRequest, buildProposals, deterministicMap, matchOption } from '@a2c/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { fillApprovedFields, locateField, undoLastFill } from '../apps/extension/src/content/filler';
import { scanDocument } from '../apps/extension/src/content/scanner';
import { DEMO_FACTS, fact } from './helpers';

/**
 * Regression tests for problems real users report with autofill tools:
 * custom ARIA choice widgets (Google Forms), dropdown wording mismatches,
 * phone/date formats, undoing a bad fill and finding a field on the page.
 */

const ORIGIN = 'https://forms.example.test';
afterEach(() => {
  document.body.innerHTML = '';
});

function googleStyleForm() {
  document.body.innerHTML = `
    <div role="list">
      <div role="listitem"><div role="heading" id="q1">Your name</div><input type="text" aria-labelledby="q1"></div>
      <div role="listitem"><div role="heading" id="q2">Degree</div>
        <div role="radiogroup" aria-labelledby="q2">
          <div role="radio" aria-checked="false" data-value="Bachelor of Technology" aria-label="Bachelor of Technology"></div>
          <div role="radio" aria-checked="false" data-value="Bachelor of Science" aria-label="Bachelor of Science"></div>
        </div></div>
      <div role="listitem"><div role="heading" id="q3">Skills</div>
        <div role="list" aria-labelledby="q3">
          <div role="checkbox" aria-checked="false" data-answer-value="Python" aria-label="Python"></div>
          <div role="checkbox" aria-checked="false" data-answer-value="Java" aria-label="Java"></div>
          <div role="checkbox" aria-checked="false" data-answer-value="TypeScript" aria-label="TypeScript"></div>
        </div></div>
      <div role="listitem"><div role="heading" id="q5">Mobile number</div><input type="tel" maxlength="10" aria-labelledby="q5"></div>
      <div role="listitem"><div role="heading" id="q6">Date of birth</div><input type="text" placeholder="DD/MM/YYYY" aria-labelledby="q6"></div>
    </div>`;
  document.querySelectorAll<HTMLElement>('[role="radio"]').forEach((el) =>
    el.addEventListener('click', () => {
      el.parentElement!.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', 'false'));
      el.setAttribute('aria-checked', 'true');
    }),
  );
  document.querySelectorAll<HTMLElement>('[role="checkbox"]').forEach((el) =>
    el.addEventListener('click', () => el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true')),
  );
}

describe('custom ARIA choice widgets (Google-Forms style)', () => {
  it('detects div-based radios and checkboxes with their question labels', () => {
    googleStyleForm();
    const { result } = scanDocument(document);
    const degree = result.fields.find((f) => f.label === 'Degree')!;
    const skills = result.fields.find((f) => f.label === 'Skills')!;
    expect(degree).toMatchObject({ kind: 'radio', options: [{ value: 'Bachelor of Technology' }, { value: 'Bachelor of Science' }] });
    expect(skills).toMatchObject({ kind: 'checkbox', multiple: true });
    expect(skills.options.map((o) => o.value)).toEqual(['Python', 'Java', 'TypeScript']);
  });

  it('maps memory through the alias table and fills by clicking the option', () => {
    googleStyleForm();
    const { result, state } = scanDocument(document);
    const facts = [...DEMO_FACTS, fact('phone', '+91 98765 43210', { sensitivity: 'private', permission: 'auto' }), fact('date_of_birth', '2004-05-17', { permission: 'auto', sensitivity: 'standard' })];
    const req = buildMappingRequest(result, facts)!;
    const { proposals } = buildProposals(deterministicMap(req), {
      scan: result,
      facts: new Map(facts.map((f) => [f.key, f])),
      offeredKeys: new Set(req.availableMemoryKeys.map((k) => k.key)),
      domain: 'forms.example.test',
      source: 'mock',
    });
    const by = (label: string) => proposals.find((p) => p.field.label === label)!;
    expect(by('Degree').value).toBe('Bachelor of Technology'); // memory says "B.Tech"
    expect(by('Skills').value).toEqual(['Python', 'TypeScript']);
    expect(by('Mobile number').value).toBe('9876543210');
    expect(by('Date of birth').value).toBe('17/05/2004');

    const fills = proposals
      .filter((p) => ['Degree', 'Skills', 'Mobile number', 'Date of birth'].includes(p.field.label))
      .map((p) => ({ fieldId: p.fieldId, value: p.value, allowOverwrite: false }));
    const res = fillApprovedFields(state, result.scanId, ORIGIN, fills, ORIGIN);
    expect(res.map((r) => r.status)).toEqual(['filled', 'filled', 'filled', 'filled']);
    expect(document.querySelector('[data-value="Bachelor of Technology"]')!.getAttribute('aria-checked')).toBe('true');
    expect([...document.querySelectorAll('[role="checkbox"][aria-checked="true"]')].map((e) => e.getAttribute('aria-label'))).toEqual(['Python', 'TypeScript']);
  });
});

describe('dropdown wording and format mismatches', () => {
  it('matches equivalent option spellings', () => {
    expect(matchOption('B.Tech', [{ value: 'x', label: 'Bachelor of Technology' }])?.value).toBe('x');
    expect(matchOption('India', [{ value: 'in', label: 'IN' }, { value: 'us', label: 'US' }])?.value).toBe('in');
    expect(matchOption('USA', [{ value: '1', label: 'United States' }])?.value).toBe('1');
    expect(matchOption('M.Sc', [{ value: 'a', label: 'Master of Science (MSc)' }])?.value).toBe('a');
    expect(matchOption('B.Tech', [{ value: 'be', label: 'Bachelor of Engineering' }])).toBeUndefined();
  });

  it('adapts phone and date values to the field', () => {
    expect(adaptToField({ kind: 'tel', maxLength: 10, placeholder: '' }, '+91 98765 43210', 'phone').value).toBe('9876543210');
    expect(adaptToField({ kind: 'text', maxLength: undefined, placeholder: 'MM/DD/YYYY' }, '2004-05-17', 'date_of_birth').value).toBe('05/17/2004');
    expect(adaptToField({ kind: 'date', maxLength: undefined, placeholder: '' }, '2004-05-17', 'date_of_birth').value).toBe('2004-05-17');
    expect(adaptToField({ kind: 'text', maxLength: undefined, placeholder: 'Your name' }, 'Alex', 'full_name').value).toBe('Alex');
  });
});

describe('tabs whose address Chrome hides', () => {
  it('treats a hidden URL as scannable (Google Forms) and only real browser pages as blocked', async () => {
    const { isRestrictedUrl, parseTabUrl } = await import('../apps/extension/src/services/tabs');
    expect(isRestrictedUrl(undefined)).toBe(false); // hidden address: try to scan, ask for access if needed
    expect(isRestrictedUrl('https://docs.google.com/forms/d/e/abc/viewform')).toBe(false);
    expect(parseTabUrl('https://docs.google.com/forms/d/e/abc/viewform')?.domain).toBe('docs.google.com');
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
    expect(isRestrictedUrl('chrome-extension://abc/sidepanel.html')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
  });
});

describe('undo and locate', () => {
  it('restores the previous values after a fill', () => {
    document.body.innerHTML = `<label for="n">Full Name</label><input id="n" value="">
      <label for="s">Degree</label><select id="s"><option value="">-</option><option value="bt">B.Tech</option></select>
      <label><input type="radio" name="m" value="a">A</label><label><input type="radio" name="m" value="b">B</label>`;
    const { result, state } = scanDocument(document);
    const fills = result.fields.map((f) => ({ fieldId: f.id, value: f.kind === 'select' ? 'bt' : f.kind === 'radio' ? 'b' : 'Alex', allowOverwrite: false }));
    expect(fillApprovedFields(state, result.scanId, ORIGIN, fills, ORIGIN).every((r) => r.status === 'filled')).toBe(true);
    const out = undoLastFill(state, result.scanId);
    expect(out.restored).toBe(3);
    expect((document.getElementById('n') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('s') as HTMLSelectElement).value).toBe('');
    expect((document.querySelector('input[value="b"]') as HTMLInputElement).checked).toBe(false);
    expect(undoLastFill(state, result.scanId).restored).toBe(0);
  });

  it('locates a scanned field on the page, including blocked ones', () => {
    document.body.innerHTML = `<label for="p">Password</label><input id="p" type="password">`;
    const { result, state } = scanDocument(document);
    expect(locateField(state, result.scanId, result.fields[0]!.id)).toBe(true);
    expect((document.getElementById('p') as HTMLElement).style.outline).toContain('solid');
    expect(locateField(state, 's_otherscan1', result.fields[0]!.id)).toBe(false);
  });
});
