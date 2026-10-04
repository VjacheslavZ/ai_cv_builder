import type { CvDateRange, CvDocument, CvLink } from '@cv/shared';

// Pure helpers for the PDF template: what is printed and what is left out (AC-11.5, AC-8.3).
// Every value is trimmed, and an empty one produces no line, separator, or heading.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2020-01` → `Jan 2020`, `2020` → `2020`. */
export function formatCvDate(date: string): string {
  const [year, month] = date.split('-');
  return month ? `${MONTHS[Number(month) - 1]} ${year}` : year!;
}

/** `Jan 2020 – Present`; `null` dates print nothing. */
export function formatDateRange(dates: CvDateRange | null): string {
  if (!dates) return '';
  const start = formatCvDate(dates.start);
  const end = dates.end === 'present' ? 'Present' : formatCvDate(dates.end);
  return start === end ? start : `${start} – ${end}`;
}

/** Only `http(s):` and `mailto:` links become clickable (NFR-S7); the schema already says so. */
export function isSafeLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** What a link shows: its label, or the address without `mailto:` / `https://`. */
export function linkText(link: CvLink): string {
  return link.label.trim() || link.url.trim().replace(/^(mailto:|https?:\/\/)/i, '');
}

export type ContactPart = { text: string; url?: string };

/** Email · phone · city · links, empty ones left out. */
export function contactParts(contact: CvDocument['contact']): ContactPart[] {
  const parts: ContactPart[] = [];
  const email = contact.email.trim();
  if (email) {
    const mailto = `mailto:${email}`;
    parts.push({ text: email, url: isSafeLink(mailto) ? mailto : undefined });
  }
  for (const value of [contact.phone, contact.city]) {
    if (value.trim()) parts.push({ text: value.trim() });
  }
  for (const link of contact.links) {
    const text = linkText(link);
    if (text) parts.push({ text, url: isSafeLink(link.url) ? link.url.trim() : undefined });
  }
  return parts;
}

/** `Title, Company` (or whichever of the two exists). */
export function joinNonEmpty(values: string[], separator: string): string {
  return values
    .map((v) => v.trim())
    .filter(Boolean)
    .join(separator);
}

const FALLBACK_FILE_NAME = 'CV.pdf';

/** `José Müller` → `José_Müller_CV.pdf` (AC-11.1); `CV.pdf` when the name has nothing usable. */
export function pdfFileName(fullName: string): string {
  const stem = fullName
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_')
    .slice(0, 100);
  return stem ? `${stem}_CV.pdf` : FALLBACK_FILE_NAME;
}

/**
 * `attachment` with an ASCII `filename` for old clients and an RFC 5987 `filename*` for the
 * real (possibly accented) name (AC-11.6).
 */
export function contentDisposition(fileName: string): string {
  const ascii =
    fileName
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_') || FALLBACK_FILE_NAME;
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
