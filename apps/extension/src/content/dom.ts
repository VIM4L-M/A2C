import { normalizeText, sanitizeLabel, type FieldKind, type FieldSignals } from '@a2c/shared';

/**
 * DOM helpers for the content script. They read only metadata (labels, names,
 * types, option lists). Field values are never read here except the boolean
 * "is it already filled" check, which the scanner skips for blocked fields.
 */

export type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const TEXTLIKE_INPUT_TYPES: Record<string, FieldKind> = {
  '': 'text',
  text: 'text',
  search: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  date: 'date',
};

export function isIgnored(el: Control): boolean {
  return el instanceof HTMLInputElement && IGNORED_INPUT_TYPES.has(el.type.toLowerCase());
}

/** Map an element to a supported kind, or 'unsupported' (file, color, range, password...). */
export function kindOf(el: Control): FieldKind | 'unsupported' {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return el.multiple ? 'unsupported' : 'select';
  const t = (el.getAttribute('type') ?? '').toLowerCase();
  if (t === 'radio') return 'radio';
  if (t === 'checkbox') return 'checkbox';
  return TEXTLIKE_INPUT_TYPES[t] ?? 'unsupported';
}

/** Collect form controls from the document and any open shadow roots. */
export function collectControls(root: Document | ShadowRoot = document, depth = 0, out: Control[] = []): Control[] {
  root.querySelectorAll<Control>('input, textarea, select').forEach((el) => out.push(el));
  if (depth < 6) {
    root.querySelectorAll('*').forEach((host) => {
      if (host.shadowRoot) collectControls(host.shadowRoot, depth + 1, out);
    });
  }
  return out;
}

function textOf(node: Element | null | undefined, max = 160): string {
  if (!node) return '';
  // Clone so that nested controls / scripts do not contribute text.
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('input, textarea, select, script, style, noscript, svg, [aria-hidden="true"]').forEach((n) => n.remove());
  return sanitizeLabel(clone.textContent ?? '', max);
}

function byIds(el: Element, ids: string | null): string {
  if (!ids) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return ids
    .split(/\s+/)
    .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
    .map((n) => textOf(n))
    .filter(Boolean)
    .join(' ');
}

function labelElementText(el: Control): string {
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) return Array.from(labels).map((l) => textOf(l)).filter(Boolean).join(' ');
  const wrapping = el.closest('label');
  return wrapping ? textOf(wrapping) : '';
}

/** Closest preceding text that plausibly labels the control (bounded). */
function precedingText(el: Element): string {
  let node: Element | null = el;
  for (let hops = 0; node && hops < 3; hops += 1) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (!sib.matches('input, textarea, select, button, script, style')) {
        const t = textOf(sib, 120);
        if (t) return t;
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
    if (node && countControls(node) > 1) break;
  }
  return '';
}

function countControls(container: Element): number {
  return container.querySelectorAll('input:not([type=hidden]), textarea, select').length;
}

export function labelFor(el: Control): string {
  const parts = [byIds(el, el.getAttribute('aria-labelledby')), labelElementText(el), el.getAttribute('aria-label') ?? ''];
  const found = parts.find((p) => p.trim());
  if (found) return sanitizeLabel(found);
  const title = el.getAttribute('title');
  if (title) return sanitizeLabel(title);
  return sanitizeLabel(precedingText(el));
}

export function sectionFor(el: Element): string {
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  return legend ? textOf(legend, 120) : '';
}

/** Short text near the control, used only to make classification stricter. */
export function nearbyTextFor(el: Element): string {
  const parent = el.parentElement;
  if (parent && countControls(parent) <= 1) return textOf(parent, 220);
  return precedingText(el);
}

export function hintFor(el: Control): string {
  return normalizeText([el.getAttribute('name'), el.id].filter(Boolean).join(' ')).slice(0, 120);
}

export function signalsFor(el: Control, kind: FieldKind | 'unsupported', label: string, optionLabels?: string[]): FieldSignals {
  return {
    kind,
    inputType: el instanceof HTMLInputElement ? el.type : el instanceof HTMLTextAreaElement ? 'textarea' : 'select',
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    label,
    placeholder: el.getAttribute('placeholder') ?? undefined,
    ariaDescription: byIds(el, el.getAttribute('aria-describedby')) || undefined,
    nearbyText: nearbyTextFor(el),
    inputMode: el.getAttribute('inputmode') ?? undefined,
    maxLength: el instanceof HTMLSelectElement ? undefined : el.maxLength > 0 ? el.maxLength : undefined,
    optionLabels,
  };
}

/** Visible to the user and not a hidden honeypot. */
export function isVisible(el: Control): boolean {
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const view = el.ownerDocument.defaultView;
  const style = view?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
  const checkable = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
  // Real browsers: use layout. jsdom (tests) has no layout, so these checks are skipped there.
  if (typeof (el as Element & { checkVisibility?: unknown }).checkVisibility === 'function') {
    if (!el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions)) return false;
    if (!checkable) {
      if (style && Number.parseFloat(style.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.right < -50 || r.bottom < -50) return false;
    }
  }
  return true;
}

export function isEditable(el: Control): boolean {
  if (el.disabled || el.closest('fieldset[disabled]')) return false;
  if (!(el instanceof HTMLSelectElement) && el.readOnly) return false;
  return true;
}

export function hasValue(el: Control): boolean {
  if (el instanceof HTMLSelectElement) {
    if (el.selectedIndex < 0 || el.value === '') return false;
    const opt = el.options[el.selectedIndex];
    // An implicit default first option is not a user choice.
    if (el.selectedIndex === 0 && opt && !opt.hasAttribute('selected')) return false;
    return true;
  }
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) return el.checked;
  return el.value.trim() !== '';
}

export function optionLabelFor(el: HTMLInputElement): string {
  return sanitizeLabel(labelElementText(el) || el.getAttribute('aria-label') || el.value, 120);
}
