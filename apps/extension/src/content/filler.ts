import { detectSecretValue, type FillInstruction, type FillResult } from '@contextfill/shared';
import { hasValue, isEditable, isVisible, type Control } from './dom';
import { describe, type RegistryEntry, type ScanState } from './scanner';

/**
 * Writes validated values into the page. Only the side panel's validated
 * fill instructions reach here, never model output directly. Nothing is
 * submitted, clicked (other than radio/checkbox toggles) or navigated.
 */

const HIGHLIGHT_MS = 4000;

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  // Native setter bypasses framework value trackers (React controlled inputs).
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function highlight(elements: Control[]) {
  for (const el of elements) {
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid rgba(47, 133, 90, 0.55)';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, HIGHLIGHT_MS);
  }
}

function fail(fieldId: string, reason: string): FillResult {
  return { fieldId, status: 'failed', reason };
}

/** Re-verify that the element is still the field the user approved. */
export function verifyEntry(entry: RegistryEntry): string | null {
  if (!entry.elements.every((el) => el.isConnected)) return 'Field disappeared from the page; rescan';
  if (!entry.elements.some((el) => isVisible(el) && isEditable(el))) return 'Field is hidden, disabled or read-only now';
  const now = describe(entry.elements);
  if (now.classification.risk === 'red') return 'Field is now classified as sensitive; not filled';
  if (now.classification.risk === 'gray' && entry.risk !== 'gray') return 'Field changed and needs manual input';
  if (now.fingerprint !== entry.fingerprint) return 'Field changed since scan; rescan';
  return null;
}

export function fillField(entry: RegistryEntry, instr: FillInstruction): FillResult {
  const { fieldId, value, allowOverwrite } = instr;
  if (entry.risk === 'red') return fail(fieldId, 'Blocked field');
  const problem = verifyEntry(entry);
  if (problem) return fail(fieldId, problem);

  const values = Array.isArray(value) ? value : [value];
  if (values.some((v) => detectSecretValue(v).secret)) return fail(fieldId, 'Value looks like a secret; refused');

  // Preserve manual input made after the scan unless replacement was approved.
  if (!allowOverwrite && entry.elements.some(hasValue)) return { fieldId, status: 'skipped', reason: 'Already has a value; kept yours' };

  try {
    switch (entry.kind) {
      case 'radio': {
        const target = values[0] ?? '';
        const radio = (entry.elements as HTMLInputElement[]).find((r) => r.value === target);
        if (!radio) return fail(fieldId, 'Option no longer available');
        if (!radio.checked) radio.click();
        if (!radio.checked) return fail(fieldId, 'Page did not accept the selection');
        highlight([radio]);
        return { fieldId, status: 'filled', reason: '' };
      }
      case 'checkbox': {
        const boxes = entry.elements as HTMLInputElement[];
        const wanted = new Set(values);
        const targets = boxes.filter((b) => wanted.has(b.value));
        if (targets.length === 0) return fail(fieldId, 'No matching options');
        for (const b of targets) if (!b.checked) b.click();
        if (!targets.every((b) => b.checked)) return fail(fieldId, 'Page did not accept the selection');
        highlight(targets);
        return { fieldId, status: 'filled', reason: '' };
      }
      case 'select': {
        const select = entry.elements[0] as HTMLSelectElement;
        const target = values[0] ?? '';
        if (!Array.from(select.options).some((o) => o.value === target && !o.disabled)) return fail(fieldId, 'Option no longer available');
        setNativeValue(select, target);
        if (select.value !== target) return fail(fieldId, 'Page did not accept the selection');
        highlight([select]);
        return { fieldId, status: 'filled', reason: '' };
      }
      default: {
        const el = entry.elements[0] as HTMLInputElement | HTMLTextAreaElement;
        const text = values[0] ?? '';
        if (Array.isArray(value)) return fail(fieldId, 'Expected a single value');
        setNativeValue(el, text);
        if (el.value !== text) return fail(fieldId, 'Page rejected or reformatted the value');
        highlight([el]);
        return { fieldId, status: 'filled', reason: '' };
      }
    }
  } catch {
    return fail(fieldId, 'Unexpected error while filling this field');
  }
}

export function fillApprovedFields(state: ScanState | null, scanId: string, origin: string, fills: FillInstruction[], currentOrigin: string): FillResult[] {
  if (!state || state.scanId !== scanId) return fills.map((f) => fail(f.fieldId, 'Scan expired; rescan the page'));
  if (state.origin !== origin || currentOrigin !== origin) return fills.map((f) => fail(f.fieldId, 'Page changed since scan; rescan'));
  return fills.map((instr) => {
    const entry = state.registry.get(instr.fieldId);
    if (!entry) return fail(instr.fieldId, 'Unknown field id');
    return fillField(entry, instr);
  });
}
