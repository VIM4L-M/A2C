import { classifyField, sanitizeLabel, type Classification } from '@a2c/shared';
import { isInput } from './dom';

/**
 * ARIA widgets: div-based radio buttons and checkboxes (role="radio" /
 * role="checkbox"), as used by Google Forms and many component libraries.
 * Users report that most autofill tools ignore these. A2C treats them like
 * native groups: label + options only, filled by clicking the chosen option.
 */

const SELECTOR = '[role="radio"], [role="checkbox"], [role="option"]';
const CONTAINER = '[role="listbox"], [role="radiogroup"], [role="group"], [role="list"], [role="listitem"], fieldset';

function containerFor(el: HTMLElement): Element | null {
  const nearest = el.closest(CONTAINER);
  // Google Forms nests each option in a listitem inside the labelled answer list.
  // Keep the question boundary; never combine unrelated questions in the outer list.
  if (nearest?.getAttribute('role') === 'listitem' && !nearest.querySelector('[role="heading"]')) {
    const list = nearest.parentElement?.closest('[role="list"], [role="group"], [role="radiogroup"]');
    if (list && (list.hasAttribute('aria-labelledby') || list.hasAttribute('aria-label'))) return list;
  }
  return nearest;
}

export interface AriaDescribed {
  kind: 'radio' | 'checkbox' | 'select';
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
  return el.getAttribute(el.getAttribute('role') === 'option' ? 'aria-selected' : 'aria-checked') === 'true';
}

export function ariaOptionValue(el: HTMLElement): string {
  return sanitizeLabel(el.getAttribute('data-value') ?? el.getAttribute('data-answer-value') ?? el.getAttribute('aria-label') ?? el.textContent ?? '', 200);
}

function ariaOptionLabel(el: HTMLElement): string {
  return sanitizeLabel(el.getAttribute('aria-label') || byId(el, el.getAttribute('aria-labelledby')) || el.textContent || '', 200);
}

export function ariaUsable(el: HTMLElement): boolean {
  if (isInput(el)) return false;
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
    if (el.getAttribute('role') === 'option') {
      const list = el.closest('[role="listbox"]');
      if (!list || list.getAttribute('aria-multiselectable') === 'true') return;
    }
    const container = containerFor(el) ?? el.parentElement ?? el;
    const list = out.get(container);
    if (list) list.push(el);
    else out.set(container, [el]);
  });
  if (depth < 6) root.querySelectorAll('*').forEach((host) => host.shadowRoot && collectAriaGroups(host.shadowRoot, depth + 1, out));
  return out;
}

export function describeAria(elements: HTMLElement[]): AriaDescribed {
  const first = elements[0]!;
  const role = first.getAttribute('role');
  const kind = role === 'radio' ? 'radio' : role === 'option' ? 'select' : 'checkbox';
  const container = containerFor(first);
  const label = groupLabel(container, first);
  const options = elements.map((el) => ({ value: ariaOptionValue(el), label: ariaOptionLabel(el) }));
  const classification = classifyField({ kind, label, optionLabels: options.map((o) => o.label) });
  const fingerprint = ['aria', kind, label, options.map((o) => o.value).join('|')].join('#');
  return { kind, elements, label, classification, options, fingerprint };
}
