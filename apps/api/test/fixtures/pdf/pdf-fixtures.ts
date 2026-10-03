// Synthetic PDF fixtures built in memory (testing.md, "Fixtures"): no binaries in the repo and
// no real personal data. Each builder returns the bytes of a small, standards-shaped PDF.

const SAMPLE_LINES = [
  'Jane Example - Software Engineer',
  'jane.example@example.com, Springfield',
  'Example Corp, Backend Engineer, 2019 - present',
  'Built a billing service in TypeScript and PostgreSQL that handles 2 million invoices a month.',
  'Cut p95 API latency from 800 ms to 200 ms by adding Redis caching and query batching.',
  'Mentored four engineers and led the migration from a monolith to six services.',
  'Example University, BSc Computer Science, 2015 - 2019',
  'Skills: TypeScript, Node.js, PostgreSQL, Redis, Docker, Kubernetes',
];

function escapeText(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

function textStream(lines: string[]): string {
  const ops = lines.map(
    (line, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${escapeText(line)}) Tj ET`,
  );
  return ops.join('\n');
}

/** Assembles objects into a PDF with a correct xref table. `objects[i]` is object `i + 1`. */
function assemble(objects: string[], trailerExtra = ''): Buffer {
  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** One page per entry of `pages`; each entry is the content stream of that page. */
function buildPdf(pages: string[], trailerExtra = '', extraObjects: string[] = []): Buffer {
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs, then extras.
  const pageObjectIds = pages.map((_, i) => 4 + i * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((content, i) => {
    const contentId = pageObjectIds[i]! + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
  });
  objects.push(...extraObjects);
  return assemble(objects, trailerExtra);
}

/** A text CV on `pages` pages (1 by default). */
export function validPdf(pages = 1, lines: string[] = SAMPLE_LINES): Buffer {
  return buildPdf(Array.from({ length: pages }, (_, i) => textStream([...lines, `Page ${i + 1}`])));
}

/** A "scan": pages with drawings and no text layer (AC-4.3). */
export function scanPdf(): Buffer {
  return buildPdf(['0.5 g 50 400 495 380 re f\n0 g 60 410 200 20 re f']);
}

/**
 * Password-protected (AC-4.4): a standard security handler whose user password is not empty,
 * so pdf.js cannot open it without one.
 */
export function encryptedPdf(): Buffer {
  const hex = (n: number) => '<' + 'ab'.repeat(n) + '>';
  const objects = 3 + 2; // catalog, pages, font, page, content → encrypt dict is next
  return buildPdf(
    [textStream(SAMPLE_LINES)],
    `/Encrypt ${objects + 1} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] `,
    [`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 /O ${hex(32)} /U ${hex(32)} >>`],
  );
}

/** Starts like a PDF, then garbage: no objects, no xref (AC-4.4). */
export function corruptedPdf(): Buffer {
  const junk = Buffer.alloc(4096);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 7919) % 251;
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), junk]);
}

/** Plain text with a `.pdf` name: no `%PDF-` signature (AC-4.2). */
export function fakePdf(): Buffer {
  return Buffer.from('This is not really a PDF, just text with a .pdf extension.\n');
}

/** Free text long enough to generate from on its own. */
export const SAMPLE_TEXT = SAMPLE_LINES.join('\n');
