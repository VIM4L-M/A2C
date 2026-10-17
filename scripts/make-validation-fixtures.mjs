import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('output/validation', { recursive: true });
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage();
['Full name: Alex Example', 'College: Example University', 'Degree: B.Tech', 'Graduation year: 2028', 'Skills: Python, React', 'GitHub: https://github.com/example'].forEach((line,i) => page.drawText(line, { x:40, y:740-i*32, size:14, font }));
writeFileSync('output/validation/fictional-resume.pdf', await pdf.save());
console.log('Created fictional selectable-text resume fixture');
