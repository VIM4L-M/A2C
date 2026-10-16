import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFSignature, PDFTextField } from 'pdf-lib';
import type { DocFieldRaw } from './common';

/**
 * Fillable PDF support: real interactive AcroForm fields only. Scanned or
 * flattened PDFs have no fields and are reported as unsupported. Signatures
 * and checkboxes are never filled. Filling happens on a local copy.
 */

export class PdfError extends Error {}

async function load(buf: ArrayBuffer): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(buf, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/encrypt/i.test(msg)) throw new PdfError('This PDF is encrypted / password protected and is not supported.');
    throw new PdfError('This file could not be read as a PDF.');
  }
}

export async function readPdfFields(buf: ArrayBuffer): Promise<DocFieldRaw[]> {
  const pdf = await load(buf);
  const fields = pdf.getForm().getFields();
  return fields.map((f): DocFieldRaw => {
    const name = f.getName();
    if (f instanceof PDFTextField) {
      return { name, kind: f.isMultiline() ? 'textarea' : 'text', options: [], hasExistingValue: Boolean(f.getText()?.trim()), maxLength: f.getMaxLength() };
    }
    if (f instanceof PDFDropdown) return { name, kind: 'select', options: f.getOptions(), hasExistingValue: f.getSelected().length > 0 };
    if (f instanceof PDFRadioGroup) return { name, kind: 'radio', options: f.getOptions(), hasExistingValue: Boolean(f.getSelected()) };
    if (f instanceof PDFCheckBox || f instanceof PDFSignature) return { name, kind: 'unsupported', options: [], hasExistingValue: false };
    return { name, kind: 'unsupported', options: [], hasExistingValue: false };
  });
}

export async function fillPdf(buf: ArrayBuffer, values: Map<string, string>): Promise<{ blob: Blob; filled: number; failed: string[] }> {
  const pdf = await load(buf);
  const form = pdf.getForm();
  let filled = 0;
  const failed: string[] = [];
  for (const [name, value] of values) {
    try {
      const f = form.getField(name);
      if (f instanceof PDFTextField) f.setText(value);
      else if (f instanceof PDFDropdown) f.select(value);
      else if (f instanceof PDFRadioGroup) f.select(value);
      else {
        failed.push(name);
        continue;
      }
      filled += 1;
    } catch {
      failed.push(name);
    }
  }
  const bytes = await pdf.save();
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), filled, failed };
}
