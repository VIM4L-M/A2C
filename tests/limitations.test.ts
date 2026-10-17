// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://forms.example.test"}
import { afterEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../apps/extension/src/content/scanner';
import { fillApprovedFields } from '../apps/extension/src/content/filler';
import { parseContext } from '../apps/extension/src/memory/import';

afterEach(() => { document.body.innerHTML = ''; });

describe('documented support boundaries', () => {
  it('scans open shadow roots but does not claim closed-root coverage', () => {
    const open = document.createElement('div');
    const closed = document.createElement('div');
    document.body.append(open, closed);
    open.attachShadow({ mode: 'open' }).innerHTML = '<input aria-label="Full name">';
    closed.attachShadow({ mode: 'closed' }).innerHTML = '<input aria-label="College">';
    expect(scanDocument(document).result.fields.map((f) => f.label)).toEqual(['Full name']);
  });
  it('fills visible same-origin iframe inputs and refuses removed frames', () => {
    document.body.innerHTML = '<iframe></iframe>';
    const child = document.querySelector('iframe')!.contentDocument!;
    child.body.innerHTML = '<input aria-label="Full name"><textarea aria-label="College"></textarea><select aria-label="Degree"><option value="">Choose</option><option>B.Tech</option></select><input type="password" aria-label="Password">';
    const { result, state } = scanDocument(document);
    expect(result.fields).toHaveLength(4);
    expect(result.fields.find(f => f.label === 'Password')?.risk).toBe('red');
    const values = ['Alex Example', 'Example University', 'B.Tech'];
    const fills = result.fields.filter(f => f.risk !== 'red').map((f, i) => ({ fieldId: f.id, value: values[i]!, allowOverwrite: false }));
    expect(fillApprovedFields(state, result.scanId, result.origin, fills, result.origin).every(r => r.status === 'filled')).toBe(true);
    expect(child.querySelector('textarea')!.value).toBe('Example University');
    document.querySelector('iframe')!.remove();
    expect(fillApprovedFields(state, result.scanId, result.origin, fills, result.origin).every(r => r.status === 'failed')).toBe(true);
  });
  it('does not scan sandboxed or hidden frames', () => {
    document.body.innerHTML = '<iframe sandbox="allow-same-origin"></iframe><iframe hidden></iframe>';
    for (const frame of document.querySelectorAll('iframe')) frame.contentDocument!.body.innerHTML = '<input aria-label="College">';
    expect(scanDocument(document).result.fields).toHaveLength(0);
  });
  it('fills an exposed single-select ARIA listbox using its selection event', () => {
    document.body.innerHTML = '<div role="listbox" aria-label="Degree"><div role="option" aria-selected="false">B.Tech</div><div role="option" aria-selected="false">M.Tech</div></div>';
    const option = document.querySelector('[role="option"]')!;
    option.addEventListener('click', () => option.setAttribute('aria-selected', 'true'));
    const { result, state } = scanDocument(document);
    expect(result.fields[0]?.kind).toBe('select');
    expect(fillApprovedFields(state, result.scanId, result.origin, [{ fieldId: result.fields[0]!.id, value: 'B.Tech', allowOverwrite: false }], result.origin)[0]?.status).toBe('filled');
  });
  it('leaves multi-select ARIA listboxes manual', () => {
    document.body.innerHTML = '<div role="listbox" aria-multiselectable="true" aria-label="Degree"><div role="option">B.Tech</div></div>';
    expect(scanDocument(document).result.fields).toHaveLength(0);
  });
  it('omits unsupported prose instead of fabricating profile facts', () => {
    expect(parseContext('After several years exploring different fields, I became passionate about engineering.', 'notes').candidates).toEqual([]);
  });
});
