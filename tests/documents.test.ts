import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PizZip from 'pizzip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { toDocScan } from '../apps/extension/src/documents/common';
import { fillDocx, readDocxFields } from '../apps/extension/src/documents/docx';
import { fillPdf, readPdfFields } from '../apps/extension/src/documents/pdf';

const demo = (name: string) => {
  const b = readFileSync(resolve(import.meta.dirname, '../demo', name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('DOCX placeholders', () => {
  it('detects placeholders including ones split across runs', () => {
    const names = readDocxFields(demo('example-template.docx')).map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['full_name', 'college', 'graduation_year', 'password', 'signature']));
  });

  it('classifies placeholders with the same policy', () => {
    const { scan } = toDocScan(readDocxFields(demo('example-template.docx')));
    const risk = (label: string) => scan.fields.find((f) => f.label === label)?.risk;
    expect(risk('Password')).toBe('red');
    expect(risk('Signature')).toBe('gray');
    expect(risk('Full name')).toBe('green');
  });

  it('fills approved values and keeps the rest visible', async () => {
    const blob = fillDocx(demo('example-template.docx'), new Map([['full_name', 'Alex Example']]));
    const zip = new PizZip(await blob.arrayBuffer());
    const xml = zip.file('word/document.xml')!.asText();
    expect(xml).toContain('Alex Example');
    expect(xml).toContain('{{college}}');
  });
});

describe('fillable PDF', () => {
  it('reads AcroForm fields and fills a local copy', async () => {
    const raw = await readPdfFields(demo('example-fillable.pdf'));
    expect(raw.map((f) => f.name)).toEqual(expect.arrayContaining(['applicant_name', 'university', 'degree', 'card_number', 'signature']));
    const { scan } = toDocScan(raw);
    expect(scan.fields.find((f) => f.label === 'Card number')?.risk).toBe('red');

    const { blob, filled } = await fillPdf(demo('example-fillable.pdf'), new Map([['applicant_name', 'Alex Example'], ['degree', 'B.Tech']]));
    expect(filled).toBe(2);
    const out = await PDFDocument.load(await blob.arrayBuffer());
    expect(out.getForm().getTextField('applicant_name').getText()).toBe('Alex Example');
    expect(out.getForm().getDropdown('degree').getSelected()).toEqual(['B.Tech']);
  });

  it('reports PDFs without form fields as unsupported (empty)', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    expect(await readPdfFields(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)).toEqual([]);
  });
});
