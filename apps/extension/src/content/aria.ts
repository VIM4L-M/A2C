import { classifyField, sanitizeLabel, type Classification } from '@a2c/shared';

/**
 * ARIA widgets: div-based radio buttons and checkboxes (role="radio" /
 * role="checkbox"), as used by Google Forms and many component libraries.
 * Users report that most autofill tools ignore these. A2C treats them like
 * native groups: label + options only, filled by clicking the chosen option.
 */

const SELECTOR = '[role="radio"], [role="checkbox"]';
const CONTAINER = '[role="radiogroup"], [role="group"], [role="list"], [role="listitem"], fieldset';

export interface AriaDescribed {
  kind: 'radio' | 'checkbox';
  elements: HTMLElement[];
  label: string;
  classification: Classification;
  options: Array<{ value: string; label: string }>;
  fingerprint: string;
}

function text(el: Element | null | undefined, max = 160): string {
  return sanitizeLabel(el?.textContent ?? '', max);
}

function byId(el: Element, ids: string | null): string {
  if (!ids) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return ids
    .split(/\s+/)
    .map((id) => text(root.getElementById?.(id)))
    .filter(Boolean)
    .join(' ');
}

export function ariaChecked(el: HTMLElement): boolean {
  return el.getAttribute('aria-checked') === 'true';
}

export function ariaOptionValue(el: HTMLElement): string {
  return sanitizeLabel(el.getAttribute('data-value') ?? el.getAttribute('data-answer-value') ?? el.getAttribute('aria-label') ?? el.textContent ?? '', 200);
}

function ariaOptionLabel(el: HTMLElement): string {
  return sanitizeLabel(el.getAttribute('aria-label') || byId(el, el.getAttribute('aria-labelledby')) || el.textContent || '', 200);
}

export function ariaUsable(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return false;
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  if (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true') return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !(style && (style.display === 'none' || style.visibility === 'hidden'));
}

function groupLabel(container: Element | null, first: HTMLElement): string {
  if (container) {
    const own = container.getAttribute('aria-label') || byId(container, container.getAttribute('aria-labelledby'));
    if (own) return sanitizeLabel(own);
    const legend = container.querySelector(':scope > legend');
    if (legend) return text(legend);
    // Google Forms style: question heading inside the list item.
    const heading = container.closest('[role="listitem"]')?.querySelector('[role="heading"]') ?? container.querySelector('[role="heading"]');
    if (heading) return text(heading);
  }
  let node: Element | null = container ?? first;
  for (let i = 0; node && i < 3; i += 1) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (!sib.querySelector(SELECTOR) && sib.textContent?.trim()) return text(sib);
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

/** Collect ARIA radio/checkbox widgets in the document and open shadow roots, grouped by container. */
export function collectAriaGroups(root: Document | ShadowRoot = document, depth = 0, out = new Map<Element, HTMLElement[]>()): Map<Element, HTMLElement[]> {
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    if (!ariaUsable(el)) return;
    const container = el.closest(CONTAINER) ?? el.parentElement ?? el;
    const list = out.get(container);
    if (list) list.push(el);
    else out.set(container, [el]);
  });
  if (depth < 6) root.querySelectorAll('*').forEach((host) => host.shadowRoot && collectAriaGroups(host.shadowRoot, depth + 1, out));
  return out;
}

export function describeAria(elements: HTMLElement[]): AriaDescribed {
  const first = elements[0]!;
  const kind = first.getAttribute('role') === 'radio' ? 'radio' : 'checkbox';
  const container = first.closest(CONTAINER);
  const label = groupLabel(container, first);
  const options = elements.map((el) => ({ value: ariaOptionValue(el), label: ariaOptionLabel(el) }));
  const classification = classifyField({ kind, label, optionLabels: options.map((o) => o.label) });
  const fingerprint = ['aria', kind, label, options.map((o) => o.value).join('|')].join('#');
  return { kind, elements, label, classification, options, fingerprint };
}
