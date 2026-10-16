// Generates demo/example-template.docx and demo/example-fillable.pdf.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PizZip from 'pizzip';

const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), '../demo');

// ---------------------------------------------------------------- DOCX
const p = (inner) => `<w:p>${inner}</w:p>`;
const r = (text, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const body = [
  p(r('Hackathon Participant Declaration Form', true)),
  p(r('Participant name: ') + r('{{full_name}}')),
  p(r('College / University: ') + r('{{college}}')),
  p(r('Degree: ') + r('{{degree}}') + r(' in ') + r('{{major}}')),
  // Placeholder deliberately split across two runs, as Word often does.
  p(r('Graduation year: ') + r('{{gradu') + r('ation_year}}')),
  p(r('Email: ') + r('{{email}}')),
  p(r('GitHub: ') + r('{{github_url}}')),
  p(r('Skills: ') + r('{{skills}}')),
  p(r('Account password (should be blocked): ') + r('{{password}}')),
  p(r('Signature: ') + r('{{signature}}')),
  p(r('This document was completed locally by ContextFill AI. Review every value before signing.')),
].join('');

const zip = new PizZip();
zip.file(
  '[Content_Types].xml',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
zip.file(
  '_rels/.rels',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
zip.file(
  'word/document.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
);
writeFileSync(resolve(demoDir, 'example-template.docx'), zip.generate({ type: 'nodebuffer' }));

// ---------------------------------------------------------------- PDF
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const form = pdf.getForm();
page.drawText('Internship Application (fillable demo)', { x: 50, y: 790, size: 18, font: bold, color: rgb(0.12, 0.11, 0.1) });
page.drawText('Interactive AcroForm fields. Filled locally by ContextFill AI.', { x: 50, y: 770, size: 10, font, color: rgb(0.4, 0.38, 0.36) });

let y = 720;
const text = (name, label) => {
  page.drawText(label, { x: 50, y: y + 6, size: 11, font });
  const f = form.createTextField(name);
  f.addToPage(page, { x: 230, y, width: 300, height: 22 });
  y -= 42;
};
text('applicant_name', 'Applicant name');
text('university', 'University');
text('email', 'Email');
text('github', 'GitHub profile');
text('graduation_year', 'Graduation year');

page.drawText('Degree', { x: 50, y: y + 6, size: 11, font });
const degree = form.createDropdown('degree');
degree.addOptions(['B.Tech', 'B.E.', 'B.Sc', 'M.Tech', 'M.Sc', 'PhD']);
degree.addToPage(page, { x: 230, y, width: 300, height: 22 });
y -= 42;

text('card_number', 'Card number (blocked)');
text('signature', 'Signature');

page.drawText('Values you approve are written into a downloaded copy. The original stays untouched.', { x: 50, y: 80, size: 9, font, color: rgb(0.4, 0.38, 0.36) });
writeFileSync(resolve(demoDir, 'example-fillable.pdf'), await pdf.save());

console.log('Wrote demo/example-template.docx and demo/example-fillable.pdf');
