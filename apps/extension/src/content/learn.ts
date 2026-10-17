import { detectSecretValue } from '@a2c/shared';
import { isInput, isTextarea, isSelect } from './dom';
import { verifyEntry } from './filler';
import type { ScanState } from './scanner';

/** Only called after the user explicitly selects one answer to review for saving. */
export function readSelectedAnswer(state: ScanState | null, scanId: string, origin: string, fieldId: string, currentOrigin: string): string | null {
  if (!state || state.scanId !== scanId || state.origin !== origin || origin !== currentOrigin) return null;
  const entry = state.registry.get(fieldId);
  if (!entry || entry.risk === 'red' || entry.risk === 'gray' || entry.aria || verifyEntry(entry)) return null;
  let value: string;
  if (entry.kind === 'checkbox' || entry.kind === 'radio') {
    value = entry.elements.filter((e) => isInput(e) && e.checked)
      .map((e) => (e as HTMLInputElement).value).join(', ');
  } else {
    const element = entry.elements[0];
    if (!(isInput(element) || isTextarea(element) || isSelect(element))) return null;
    value = isSelect(element) ? element.selectedOptions[0]?.textContent ?? '' : element.value;
  }
  if (!value.trim() || value.length > 2000 || detectSecretValue(value).secret) return null;
  return value.trim();
}
