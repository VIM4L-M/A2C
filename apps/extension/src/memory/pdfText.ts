/// <reference types="vite/client" />
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/** Extract text locally; never render or execute document actions. */
export async function readPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: false,
    disableFontFace: true, stopAtErrors: true, maxImageSize: 0 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const doc = await task.promise;
        if (doc.numPages > 20) throw new Error('Use a resume PDF with at most 20 pages.');
        let text = '';
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          let lastY: number | undefined;
          for (const item of content.items) {
            if (!('str' in item)) continue;
            const y = item.transform[5] as number;
            if (lastY !== undefined && Math.abs(y - lastY) > 2) text += '\n';
            text += item.str + (item.hasEOL ? '\n' : ' ');
            lastY = item.hasEOL ? undefined : y;
            if (text.length > 100_000) throw new Error('Extracted resume text exceeds 100,000 characters.');
          }
          text += '\n';
          page.cleanup();
        }
        if (!text.trim()) throw new Error('No selectable text found. Scanned PDFs need OCR; export a text version instead.');
        return text.trim();
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PDF reading timed out. Try a smaller text-based PDF.')), 30_000); }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('Password-protected PDFs are not supported. Export an unlocked copy.');
    if (error instanceof Error && error.name === 'InvalidPDFException') throw new Error('This PDF is invalid or damaged. Export a new text-based copy.');
    throw error;
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
