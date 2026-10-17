import { classifyField, sanitizeLabel, type Classification, type FieldKind, type ScannedField, type ScanResult } from '@a2c/shared';
import {
  collectControls,
  hasValue,
  hintFor,
  isEditable,
  isIgnored,
  isVisible,
  kindOf,
  labelFor,
  optionLabelFor,
  sectionFor,
  signalsFor,
  type Control,
  isInput, isTextarea, isSelect,
} from './dom';
import { ariaChecked, collectAriaGroups, describeAria } from './aria';

/**
 * Scans the page for fillable fields. Each field gets an ephemeral opaque id;
 * the element references stay here in the content script. Only sanitized
 * metadata is returned to the side panel.
 */

export interface RegistryEntry {
  id: string;
  kind: FieldKind;
  /** Native controls, or ARIA widgets (div role=radio/checkbox) when aria is true. */
  elements: Control[];
  fingerprint: string;
  risk: Classification['risk'];
  aria?: boolean;
}

export interface ScanState {
  scanId: string;
  origin: string;
  registry: Map<string, RegistryEntry>;
  /** Snapshot of what the last fill changed (for Undo). */
  undo?: import('./filler').UndoRecord[];
}

const MAX_FIELDS = 300;

function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}

interface Described {
  kind: FieldKind | 'unsupported';
  elements: Control[];
  label: string;
  classification: Classification;
  options: Array<{ value: string; label: string }>;
  fingerprint: string;
}

function groupLabel(members: HTMLInputElement[]): string {
  const first = members[0]!;
  const group = first.closest('[role="radiogroup"], [role="group"]');
  if (group) {
    const aria = group.getAttribute('aria-label');
    if (aria) return sanitizeLabel(aria);
    const by = group.getAttribute('aria-labelledby');
    if (by) {
      const n = (first.getRootNode() as Document).getElementById?.(by);
      if (n?.textContent) return sanitizeLabel(n.textContent);
    }
  }
  const fieldset = first.closest('fieldset');
  if (fieldset && members.every((m) => fieldset.contains(m))) {
    const legend = fieldset.querySelector(':scope > legend');
    if (legend?.textContent) return sanitizeLabel(legend.textContent);
  }
  // Text before the first option, outside the option labels.
  let node: Element | null = first.closest('label') ?? first;
  for (let i = 0; node && i < 4; i += 1) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (!sib.querySelector('input') && sib.textContent?.trim()) return sanitizeLabel(sib.textContent);
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

/** Describe a single control or a radio/checkbox group. Pure w.r.t. values. */
export function describe(elements: Control[]): Described {
  const first = elements[0]!;
  const kind = kindOf(first);
  let label: string;
  let options: Array<{ value: string; label: string }> = [];

  if (kind === 'radio' || (kind === 'checkbox' && elements.length > 1)) {
    const inputs = elements as HTMLInputElement[];
    label = groupLabel(inputs);
    options = inputs.map((m) => ({ value: m.value, label: optionLabelFor(m) }));
  } else {
    label = labelFor(first);
    if (isSelect(first)) {
      options = Array.from(first.options)
        .filter((o) => o.value !== '' && !o.disabled)
        .slice(0, 100)
        .map((o) => ({ value: o.value.slice(0, 200), label: sanitizeLabel(o.textContent ?? o.value, 200) }));
    } else if (kind === 'checkbox') {
      options = [{ value: (first as HTMLInputElement).value, label }];
    }
  }

  const signals = signalsFor(first, kind, label, options.map((o) => o.label));
  const classification = classifyField(signals);
  const fingerprint = [kind, first.getAttribute('type') ?? '', first.getAttribute('name') ?? '', first.id, label, options.map((o) => o.value).join('|')].join('#');
  return { kind, elements, label, classification, options, fingerprint };
}

function groupControls(controls: Control[]): { groups: Control[][]; ignored: number } {
  const groups: Control[][] = [];
  const radioGroups = new Map<string, HTMLInputElement[]>();
  const checkboxGroups = new Map<string, HTMLInputElement[]>();
  let ignored = 0;

  for (const el of controls) {
    if (isIgnored(el)) continue;
    if (!isVisible(el) || !isEditable(el)) {
      ignored += 1;
      continue;
    }
    if (isInput(el) && (el.type === 'radio' || el.type === 'checkbox')) {
      const scope = el.form?.id || (el.form ? 'form' : 'doc');
      if (!el.name) {
        groups.push([el]);
        continue;
      }
      const map = el.type === 'radio' ? radioGroups : checkboxGroups;
      const key = `${scope}::${el.name}`;
      const list = map.get(key);
      if (list) list.push(el);
      else {
        const fresh = [el];
        map.set(key, fresh);
        groups.push(fresh);
      }
      continue;
    }
    groups.push([el]);
  }
  return { groups, ignored };
}

export function scanDocument(root: Document = document, depth = 0): { result: ScanResult; state: ScanState } {
  const scanId = randomId('s');
  const origin = root.location?.origin ?? 'null';
  const registry = new Map<string, RegistryEntry>();
  const { groups, ignored } = groupControls(collectControls(root));
  const fields: ScannedField[] = [];
  let unsupported = 0;

  for (const group of groups) {
    if (fields.length >= MAX_FIELDS) break;
    const d = describe(group);
    // Unnamed radios cannot be grouped safely.
    const unnamedRadio = d.kind === 'radio' && !(group[0] as HTMLInputElement).name;
    if (d.kind === 'unsupported' || unnamedRadio) {
      // Still report red unsupported fields (e.g. password) so the user sees they were blocked.
      if (d.classification.risk !== 'red') {
        unsupported += 1;
        continue;
      }
    }
    const id = randomId('f');
    const kind: FieldKind = d.kind === 'unsupported' || unnamedRadio ? 'text' : d.kind;
    const red = d.classification.risk === 'red';
    const first = group[0]!;
    registry.set(id, { id, kind, elements: group, fingerprint: d.fingerprint, risk: d.classification.risk });
    fields.push({
      id,
      kind,
      label: d.label || sanitizeLabel(first.getAttribute('placeholder') ?? '') || '(unlabelled field)',
      // Blocked fields expose nothing beyond a label and the reason.
      hint: red ? '' : hintFor(first),
      section: red ? '' : sectionFor(first),
      placeholder: red ? '' : sanitizeLabel(first.getAttribute('placeholder') ?? '', 80),
      autocomplete: red ? '' : (first.getAttribute('autocomplete') ?? '').slice(0, 60),
      required: group.some((g) => g.required),
      multiple: d.kind === 'checkbox' && group.length > 1,
      maxLength: !red && !(isSelect(first)) && first.maxLength > 0 ? first.maxLength : undefined,
      options: red ? [] : d.options,
      // Never read values of blocked fields.
      hasExistingValue: red ? false : group.some(hasValue),
      risk: d.classification.risk,
      riskReason: d.classification.reason,
      rule: d.classification.rule,
    });
  }

  // ARIA widgets (Google Forms and similar): div-based radios and checkboxes.
  for (const els of collectAriaGroups(root).values()) {
    if (fields.length >= MAX_FIELDS) break;
    const d = describeAria(els);
    const id = randomId('f');
    const red = d.classification.risk === 'red';
    registry.set(id, { id, kind: d.kind, elements: els as unknown as Control[], fingerprint: d.fingerprint, risk: d.classification.risk, aria: true });
    fields.push({
      id,
      kind: d.kind,
      label: d.label || '(unlabelled choice)',
      hint: '',
      section: '',
      placeholder: '',
      autocomplete: '',
      required: els.some((e) => e.closest('[aria-required="true"]') !== null),
      multiple: d.kind === 'checkbox' && els.length > 1,
      options: red ? [] : d.options,
      hasExistingValue: red ? false : els.some(ariaChecked),
      risk: d.classification.risk,
      riskReason: d.classification.reason,
      rule: d.classification.rule,
    });
  }

  // Only visible same-origin, unsandboxed frames inherit this site's permission.
  // Keep groups scoped to their document so identical radio names never merge.
  if (depth < 6) for (const frame of root.querySelectorAll('iframe')) {
    if (fields.length >= MAX_FIELDS) break;
    if (frame.hasAttribute('sandbox') || !isVisible(frame as unknown as Control)) continue;
    try {
      const child = frame.contentDocument;
      if (!child || (child.location.origin !== origin && !['about:blank', 'about:srcdoc'].includes(child.URL))) continue;
      const nested = scanDocument(child, depth + 1);
      for (const field of nested.result.fields) {
        if (fields.length >= MAX_FIELDS) break;
        fields.push(field);
        registry.set(field.id, nested.state.registry.get(field.id)!);
      }
      unsupported += nested.result.stats.unsupported;
    } catch { /* Cross-origin frames require separate access and are omitted. */ }
  }

  return {
    result: { scanId, origin, fields, stats: { ignoredHiddenOrDisabled: ignored, unsupported, truncated: groups.length > MAX_FIELDS } },
    state: { scanId, origin, registry },
  };
}
