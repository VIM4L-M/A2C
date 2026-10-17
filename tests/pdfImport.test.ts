import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readProfileText, parseContext } from '../apps/extension/src/memory/import';

function file(bytes: Uint8Array): File {
  return { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } as File;
}
describe('local PDF resume import', () => {
  it('extracts real PDF text into reviewed fact candidates', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage();
    page.drawText('Full name: Alex Example', { x: 40, y: 700, font });
    page.drawText('College: Example University', { x: 40, y: 670, font });
    page.drawText('Skills: Python, React', { x: 40, y: 640, font });
    const text = await readProfileText(file(await pdf.save()));
    expect(parseContext(text, 'document').candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'full_name', value: 'Alex Example', source: 'document_approved' }),
      expect.objectContaining({ key: 'skills', value: 'Python, React' }),
    ]));
  });
  it('reports image-only or empty PDFs as needing a text version', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    await expect(readProfileText(file(await pdf.save()))).rejects.toThrow('No selectable text');
  });
  it('rejects malformed PDFs instead of treating them as profile text', async () => {
    await expect(readProfileText(file(new TextEncoder().encode('%PDF-1.7\nFull name: Fake\n%%EOF')))).rejects.toThrow('invalid or damaged');
  });
  it('caps PDF pages and file size', async () => {
    const pdf = await PDFDocument.create(); for (let i = 0; i < 21; i++) pdf.addPage();
    await expect(readProfileText(file(await pdf.save()))).rejects.toThrow('at most 20 pages');
    await expect(readProfileText({ size: 5_000_001 } as File)).rejects.toThrow('smaller than 5 MB');
  });
});
