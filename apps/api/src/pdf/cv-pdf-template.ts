import { createElement as h, type ReactElement, type ReactNode } from 'react';
import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  type DocumentProps,
} from '@react-pdf/renderer';
import type { CvDocument, CvExperience } from '@cv/shared';
import { contactParts, formatDateRange, joinNonEmpty, type ContactPart } from './cv-pdf-format.js';

// The CV as an A4 PDF (FR-11). `React.createElement` instead of JSX, so the Nest build needs no
// JSX step. Text only (NFR-S7): every value is a plain string child of <Text>, never markup.
// Pages flow automatically (AC-11.4); an empty field or section prints nothing (AC-11.5).

export const PDF_FONT_FAMILY = 'Noto Sans';

/** A4 in points, and a margin ≥ 15 mm (≈ 42.5 pt). */
export const A4_POINTS = { width: 595.28, height: 841.89 } as const;
const MARGIN = 48;

const INK = '#111111';
const MUTED = '#555555';
const RULE = '#BBBBBB';

const styles = StyleSheet.create({
  page: {
    padding: MARGIN,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
    lineHeight: 1.4,
    color: INK,
  },
  name: { fontSize: 20, fontWeight: 'bold', lineHeight: 1.2 },
  contact: { marginTop: 4, color: MUTED, flexDirection: 'row', flexWrap: 'wrap' },
  link: { color: MUTED, textDecoration: 'none' },
  section: { marginTop: 14 },
  heading: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingBottom: 2,
    marginBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: RULE,
  },
  entry: { marginBottom: 8 },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  entryTitle: { fontWeight: 'bold', flexShrink: 1, paddingRight: 8 },
  entryDates: { color: MUTED, flexShrink: 0 },
  bullet: { flexDirection: 'row', marginTop: 2 },
  bulletMark: { width: 10 },
  bulletText: { flex: 1 },
});

const SEPARATOR = '  ·  ';

function contactLine(parts: ContactPart[]): ReactNode {
  if (parts.length === 0) return null;
  return h(
    Text,
    { style: styles.contact },
    parts.flatMap((part, i) => [
      i > 0 ? SEPARATOR : null,
      part.url ? h(Link, { key: i, src: part.url, style: styles.link }, part.text) : part.text,
    ]),
  );
}

/** A heading and its content; nothing at all when the content is empty. */
function section(title: string, children: ReactNode[]): ReactNode {
  if (children.length === 0) return null;
  return h(
    View,
    { style: styles.section, key: title },
    // Keeps the heading off the bottom of a page with nothing under it.
    h(Text, { style: styles.heading, minPresenceAhead: 40 }, title),
    ...children,
  );
}

function entry(key: string, title: string, dates: string, body: ReactNode[]): ReactNode {
  return h(
    View,
    { key, style: styles.entry },
    (title || dates) &&
      h(
        View,
        { style: styles.entryHeader, minPresenceAhead: 20 },
        h(Text, { style: styles.entryTitle }, title),
        dates ? h(Text, { style: styles.entryDates }, dates) : null,
      ),
    ...body,
  );
}

function experienceEntry(item: CvExperience): ReactNode {
  const bullets = item.bullets.filter((b) => b.text.trim());
  const title = joinNonEmpty([item.title, item.company], ', ');
  const dates = formatDateRange(item.dates);
  if (!title && !dates && bullets.length === 0) return null;
  return entry(
    item.id,
    title,
    dates,
    bullets.map((b) =>
      h(
        View,
        { key: b.id, style: styles.bullet },
        h(Text, { style: styles.bulletMark }, '•'),
        h(Text, { style: styles.bulletText }, b.text.trim()),
      ),
    ),
  );
}

function nonNull(nodes: ReactNode[]): ReactNode[] {
  return nodes.filter((n) => n !== null && n !== false && n !== undefined);
}

export function cvPdfDocument(doc: CvDocument): ReactElement<DocumentProps> {
  const name = doc.contact.name.trim();
  const summary = doc.summary.trim();
  const skills = joinNonEmpty(
    doc.skills.map((s) => s.name),
    SEPARATOR,
  );

  return h(
    Document,
    { title: name ? `${name} CV` : 'CV', author: name || undefined, creator: 'AI CV Builder' },
    h(
      Page,
      { size: 'A4', style: styles.page },
      name ? h(Text, { style: styles.name }, name) : null,
      contactLine(contactParts(doc.contact)),
      section('Summary', summary ? [h(Text, { key: 'summary' }, summary)] : []),
      section('Experience', nonNull(doc.experience.map(experienceEntry))),
      section(
        'Education',
        nonNull(
          doc.education.map((item) => {
            const title = joinNonEmpty([item.degree, item.institution], ', ');
            const dates = formatDateRange(item.dates);
            return title || dates ? entry(item.id, title, dates, []) : null;
          }),
        ),
      ),
      section('Skills', skills ? [h(Text, { key: 'skills' }, skills)] : []),
    ),
  );
}
