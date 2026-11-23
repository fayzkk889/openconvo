// Builds a small, valid, text-based PDF (one Helvetica text block per page)
// with a correct xref table, so tests exercise real PDF.js parsing of real bytes.
export function buildSyntheticPdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = add(null);
  const pagesId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];

  for (const lines of pages) {
    const escaped = lines.map((line) => line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'));
    const ops = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td'];
    escaped.forEach((line, index) => {
      ops.push(index === 0 ? `(${line}) Tj` : `T* (${line}) Tj`);
    });
    ops.push('ET');
    const stream = ops.join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    );
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const AURORA_PAGES = [
  [
    'Project Ledger - Synthetic Fixture',
    'Initial planning identifier: MINT-1047.',
    'This page describes the early budget review.',
  ],
  [
    'Infrastructure notes',
    'Staging cluster identifier: OAK-2206.',
    'Load tests are scheduled after the security review.',
  ],
  [
    'Release summary',
    'Production identifier: AURORA-7319.',
    'Lead engineer: Lina Patel.',
    'Target release date: February 14, 2027.',
  ],
];
