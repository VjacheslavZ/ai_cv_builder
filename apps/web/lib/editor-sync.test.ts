import { emptyCvDocument, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { overlayUnsaved, sectionOf, takeScope } from './editor-sync';

const A = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const B = '1c7d2a6f-5d2b-4e3c-8b88-2a3f4e5d6c7b';
const X = '7d9e8f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

function doc(acme: string, initech: string, summary: string): CvDocument {
  return {
    ...emptyCvDocument(),
    summary,
    experience: [
      { id: A, company: 'Acme', title: 'Engineer', dates: null, bullets: [{ id: X, text: acme }] },
      {
        id: B,
        company: 'Initech',
        title: 'Intern',
        dates: null,
        bullets: [{ id: X, text: initech }],
      },
    ],
  };
}

describe('editor sync (AC-10.4)', () => {
  it('takes only the rewritten entry from the server', () => {
    const local = doc('local acme', 'local initech', 'typing…');
    const server = doc('AI acme', 'server initech', 'server summary');
    const next = takeScope(local, server, `experience.${A}`);
    expect(next.experience[0]!.bullets[0]!.text).toBe('AI acme');
    expect(next.experience[1]!.bullets[0]!.text).toBe('local initech');
    expect(next.summary).toBe('typing…');
  });

  it('takes a single field, or a whole section', () => {
    const local = doc('a', 'b', 'local');
    const server = {
      ...doc('a', 'b', 'server'),
      contact: { ...emptyCvDocument().contact, phone: '+1 555' },
    };
    expect(takeScope(local, server, 'contact.phone').contact.phone).toBe('+1 555');
    expect(takeScope(local, server, 'summary').summary).toBe('server');
    expect(takeScope(local, server, 'experience').experience).toEqual(server.experience);
  });

  it('keeps unsaved local values on top of the server state', () => {
    const local = doc('my unsaved text', 'b', 'local');
    const server = doc('server text', 'b', 'server');
    const next = overlayUnsaved(server, local, [`experience.${A}.bullets.${X}`]);
    expect(next.experience[0]!.bullets[0]!.text).toBe('my unsaved text');
    expect(next.summary).toBe('server');
  });

  it('knows the section of a path', () => {
    expect(sectionOf(`experience.${A}.title`)).toBe('experience');
    expect(sectionOf('nope')).toBeNull();
  });
});
