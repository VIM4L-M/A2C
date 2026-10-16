import { detectSecretValue, type FillInstruction, type FillResult } from '@a2c/shared';
import { ariaChecked, ariaOptionValue, ariaUsable, describeAria } from './aria';
import { hasValue, isEditable, isVisible, type Control } from './dom';
import { describe, type RegistryEntry, type ScanState } from './scanner';

/**
 * Writes validated values into the page. Only the side panel's validated
 * fill instructions reach here, never model output directly. Nothing is
 * submitted, clicked (other than radio/checkbox options) or navigated.
 */

const HIGHLIGHT_MS = 4000;

type TextControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** What a field looked like before A2C changed it, so the user can undo. */
export type UndoRecord =
  | { kind: 'value'; el: TextControl; previous: string }
  | { kind: 'checked'; boxes: Array<{ el: HTMLInputElement; previous: boolean }> }
  | { kind: 'aria' };

function setNativeValue(el: TextControl, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  // Native setter bypasses framework value trackers (React controlled inputs).
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setChecked(el: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  if (setter) setter.call(el, checked);
  else el.checked = checked;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function highlight(elements: HTMLElement[], color = 'rgba(47, 91, 211, 0.6)', ms = HIGHLIGHT_MS) {
  for (const el of elements) {
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = `3px solid ${color}`;
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, ms);
  }
}

function fail(fieldId: string, reason: string): FillResult {
  return { fieldId, status: 'failed', reason };
}

/** Re-verify that the element is still the field the user approved. */
export function verifyEntry(entry: RegistryEntry): string | null {
  if (!entry.elements.every((el) => el.isConnected)) return 'Field disappeared from the page; rescan';
  if (entry.aria) {
    const els = entry.elements as unknown as HTMLElement[];
    if (!els.some(ariaUsable)) return 'Field is hidden or disabled now';
    const now = describeAria(els);
    if (now.classification.risk === 'red') return 'Field is now classified as sensitive; not filled';
    if (now.fingerprint !== entry.fingerprint) return 'Field changed since scan; rescan';
    return null;
  }
  if (!entry.elements.some((el) => isVisible(el) && isEditable(el))) return 'Field is hidden, disabled or read-only now';
  const now = describe(entry.elements);
  if (now.classification.risk === 'red') return 'Field is now classified as sensitive; not filled';
  if (now.classification.risk === 'gray' && entry.risk !== 'gray') return 'Field changed and needs manual input';
  if (now.fingerprint !== entry.fingerprint) return 'Field changed since scan; rescan';
  return null;
}

function fillAria(entry: RegistryEntry, fieldId: string, values: string[]): FillResult {
  const els = entry.elements as unknown as HTMLElement[];
  const wanted = new Set(values);
  const targets = els.filter((el) => wanted.has(ariaOptionValue(el)));
  if (targets.length === 0) return fail(fieldId, 'Option no longer available');
  if (entry.kind === 'radio' && targets.length > 1) return fail(fieldId, 'Ambiguous option');
  for (const el of targets) if (!ariaChecked(el)) el.click();
  if (!targets.every(ariaChecked)) return fail(fieldId, 'Page did not accept the selection');
  highlight(targets);
  return { fieldId, status: 'filled', reason: '' };
}

export function fillField(entry: RegistryEntry, instr: FillInstruction, undo?: UndoRecord[]): FillResult {
  const { fieldId, value, allowOverwrite } = instr;
  if (entry.risk === 'red') return fail(fieldId, 'Blocked field');
  const problem = verifyEntry(entry);
  if (problem) return fail(fieldId, problem);

  const values = Array.isArray(value) ? value : [value];
  if (values.some((v) => detectSecretValue(v).secret)) return fail(fieldId, 'Value looks like a secret; refused');

  // Preserve manual input made after the scan unless replacement was approved.
  const filledAlready = entry.aria ? (entry.elements as unknown as HTMLElement[]).some(ariaChecked) : entry.elements.some(hasValue);
  if (!allowOverwrite && filledAlready) return { fieldId, status: 'skipped', reason: 'Already has a value; kept yours' };

  try {
    if (entry.aria) {
      const r = fillAria(entry, fieldId, values);
      if (r.status === 'filled') undo?.push({ kind: 'aria' });
      return r;
    }
    switch (entry.kind) {
      case 'radio': {
        const radios = entry.elements as HTMLInputElement[];
        const before = radios.map((el) => ({ el, previous: el.checked }));
        const radio = radios.find((r) => r.value === (values[0] ?? ''));
        if (!radio) return fail(fieldId, 'Option no longer available');
        if (!radio.checked) radio.click();
        if (!radio.checked) return fail(fieldId, 'Page did not accept the selection');
        undo?.push({ kind: 'checked', boxes: before });
        highlight([radio]);
        return { fieldId, status: 'filled', reason: '' };
      }
      case 'checkbox': {
        const boxes = entry.elements as HTMLInputElement[];
        const before = boxes.map((el) => ({ el, previous: el.checked }));
        const wanted = new Set(values);
        const targets = boxes.filter((b) => wanted.has(b.value));
        if (targets.length === 0) return fail(fieldId, 'No matching options');
        for (const b of targets) if (!b.checked) b.click();
        if (!targets.every((b) => b.checked)) return fail(fieldId, 'Page did not accept the selection');
        undo?.push({ kind: 'checked', boxes: before });
        highlight(targets);
        return { fieldId, status: 'filled', reason: '' };
      }
      case 'select': {
        const select = entry.elements[0] as HTMLSelectElement;
        const target = values[0] ?? '';
        if (!Array.from(select.options).some((o) => o.value === target && !o.disabled)) return fail(fieldId, 'Option no longer available');
        const previous = select.value;
        setNativeValue(select, target);
        if (select.value !== target) return fail(fieldId, 'Page did not accept the selection');
        undo?.push({ kind: 'value', el: select, previous });
        highlight([select]);
        return { fieldId, status: 'filled', reason: '' };
      }
      default: {
        const el = entry.elements[0] as HTMLInputElement | HTMLTextAreaElement;
        const text = values[0] ?? '';
        if (Array.isArray(value)) return fail(fieldId, 'Expected a single value');
        const previous = el.value;
        setNativeValue(el, text);
        if (el.value !== text) return fail(fieldId, 'Page rejected or reformatted the value');
        undo?.push({ kind: 'value', el, previous });
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
  const undo: UndoRecord[] = [];
  const results = fills.map((instr) => {
    const entry = state.registry.get(instr.fieldId);
    if (!entry) return fail(instr.fieldId, 'Unknown field id');
    return fillField(entry, instr, undo);
  });
  state.undo = undo;
  return results;
}

/** Some frameworks publish aria-checked after the click handler returns. Never click twice. */
export async function fillApprovedFieldsSettled(state: ScanState | null, scanId: string, origin: string, fills: FillInstruction[], getOrigin: () => string): Promise<FillResult[]> {
  const results = fillApprovedFields(state, scanId, origin, fills, getOrigin());
  const pending = results.filter((r) => r.status === 'failed' && r.reason === 'Page did not accept the selection');
  if (!pending.length) return results;
  for (let attempt = 0; attempt < 20 && pending.length; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (getOrigin() !== origin) return results;
    for (let i = pending.length - 1; i >= 0; i--) {
      const result = pending[i]!;
      const entry = state?.registry.get(result.fieldId);
      const instruction = fills.find((f) => f.fieldId === result.fieldId);
      if (!entry?.aria || !instruction || verifyEntry(entry)) continue;
      const values = Array.isArray(instruction.value) ? instruction.value : [instruction.value];
      const elements = entry.elements as unknown as HTMLElement[];
      if (values.every((value) => elements.some((el) => ariaOptionValue(el) === value && ariaChecked(el)))) {
        result.status = 'filled'; result.reason = '';
        highlight(elements);
        pending.splice(i, 1);
      }
    }
  }
  return results;
}

/** Restore what the last fill changed. ARIA widgets cannot be reliably reverted and are reported. */
export function undoLastFill(state: ScanState | null, scanId: string): { restored: number; notUndoable: number } {
  if (!state || state.scanId !== scanId || !state.undo) return { restored: 0, notUndoable: 0 };
  let restored = 0;
  let notUndoable = 0;
  for (const rec of state.undo) {
    if (rec.kind === 'aria') {
      notUndoable += 1;
      continue;
    }
    if (rec.kind === 'value') {
      if (!rec.el.isConnected) continue;
      setNativeValue(rec.el, rec.previous);
      restored += 1;
      continue;
    }
    for (const b of rec.boxes) if (b.el.isConnected && b.el.checked !== b.previous) setChecked(b.el, b.previous);
    restored += 1;
  }
  state.undo = [];
  return { restored, notUndoable };
}

/** Scroll a field into view and flash it, so users can match the review list to the page. */
export function locateField(state: ScanState | null, scanId: string, fieldId: string): boolean {
  const entry = state && state.scanId === scanId ? state.registry.get(fieldId) : undefined;
  const first = entry?.elements[0] as HTMLElement | undefined;
  if (!entry || !first?.isConnected) return false;
  first.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  highlight(entry.elements as unknown as HTMLElement[], entry.risk === 'red' ? 'rgba(179, 38, 30, 0.7)' : 'rgba(47, 91, 211, 0.7)', 1800);
  return true;
}
