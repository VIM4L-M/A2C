import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { DocFieldRaw } from './common';

/**
 * DOCX support: explicit {{placeholder}} tags only (docxtemplater handles tags
 * split across Word runs). Arbitrary blank lines in Word documents are NOT
 * detected. Unfilled placeholders are left visible in the output.
 */

const OPTIONS = { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' } } as const;
const TAG_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,47})\s*\}\}/g;

export class DocxError extends Error {}

function load(buf: ArrayBuffer): Docxtemplater {
  try {
    return new Docxtemplater(new PizZip(buf), OPTIONS);
  } catch {
    throw new DocxError('This DOCX could not be read as a template (unclosed or malformed {{placeholders}}, or not a .docx file).');
  }
}

export function readDocxFields(buf: ArrayBuffer): DocFieldRaw[] {
  const text = load(buf).getFullText();
  const names = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) names.add(m[1]!);
  return [...names].map((name) => ({ name, kind: 'text' as const, options: [], hasExistingValue: false }));
}

export function fillDocx(buf: ArrayBuffer, values: Map<string, string>): Blob {
  const doc = new Docxtemplater(new PizZip(buf), {
    ...OPTIONS,
    // Keep placeholders that the user did not approve, instead of blanking them.
    nullGetter: (part: { module?: string; value?: string }) => (part.module ? '' : `{{${part.value ?? ''}}}`),
    parser: (tag: string) => ({
      get: (scope: Record<string, unknown>) => {
        const key = tag.trim();
        return Object.prototype.hasOwnProperty.call(scope, key) ? scope[key] : undefined;
      },
    }),
  });
  doc.render(Object.fromEntries(values));
  return doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) as Blob;
}
