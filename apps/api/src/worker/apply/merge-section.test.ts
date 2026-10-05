import { emptyCvDocument, type CvBullet, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { mergeSection } from './merge-section.js';

const ACME = '0b6c1f5e-4c1a-4d2b-9a77-1f2e3d4c5b6a';
const INITECH = '1c7d2a6f-5d2b-4e3c-8b88-2a3f4e5d6c7b';
const b = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const bullet = (n: number, text = `Bullet ${n}`): CvBullet => ({ id: b(n), text });

function current(editedPaths: string[] = []): CvDocument {
  return {
    ...emptyCvDocument(),
    summary: 'Engineer.',
    experience: [
      {
        id: ACME,
        company: 'Acme',
        title: 'Engineer',
        dates: { start: '2020', end: 'present' },
        bullets: [bullet(1), bullet(2, 'Led a team of 5 engineers'), bullet(3)],
      },
      { id: INITECH, company: 'Initech', title: 'Intern', dates: null, bullets: [] },
    ],
    editedPaths,
  };
}

/** A rewrite of the Acme entry with these bullets. */
function rewrite(bullets: CvBullet[], extra: Partial<CvDocument['experience'][number]> = {}) {
  return {
    ...emptyCvDocument(),
    experience: [{ id: ACME, company: 'Acme', title: 'Engineer', dates: null, bullets, ...extra }],
  };
}

const merge = (cur: CvDocument, rewritten: CvDocument, returned: string[]) =>
  mergeSection({
    current: cur,
    scope: `experience.${ACME}`,
    rewritten,
    returnedIds: new Set(returned),
  });

describe('mergeSection (AC-9.3, NFR-R6)', () => {
  const editedBullet = `experience.${ACME}.bullets.${b(2)}`;

  it('takes the rewrite by id and gives new items fresh places', () => {
    const result = merge(
      current(),
      rewrite([
        bullet(1, 'Cut latency from 800 ms to 200 ms'),
        bullet(3),
        { id: NEW, text: 'New' },
      ]),
      [b(1), b(3)],
    );
    expect(result.experience[0]!.bullets.map((x) => x.text)).toEqual([
      'Cut latency from 800 ms to 200 ms',
      'Bullet 3',
      'New',
    ]);
    // Everything outside the scope is untouched.
    expect(result.experience[1]).toEqual(current().experience[1]);
    expect(result.summary).toBe('Engineer.');
  });

  it('restores a manually edited bullet the model dropped, in its original place', () => {
    const result = merge(current([editedBullet]), rewrite([bullet(1), bullet(3)]), [b(1), b(3)]);
    expect(result.experience[0]!.bullets.map((x) => x.id)).toEqual([b(1), b(2), b(3)]);
    expect(result.experience[0]!.bullets[1]!.text).toBe('Led a team of 5 engineers');
  });

  it('moves a manually edited bullet back and keeps its text byte for byte', () => {
    const result = merge(
      current([editedBullet]),
      rewrite([bullet(2, 'Managed five engineers'), bullet(1), bullet(3)]),
      [b(1), b(2), b(3)],
    );
    expect(result.experience[0]!.bullets.map((x) => x.id)).toEqual([b(1), b(2), b(3)]);
    expect(result.experience[0]!.bullets[1]!.text).toBe('Led a team of 5 engineers');
  });

  it('keeps the current version of an item grounding removed from the rewrite', () => {
    // The model returned bullet 3 (reworded with a fabricated number): grounding dropped it.
    const result = merge(current(), rewrite([bullet(1)]), [b(1), b(3)]);
    expect(result.experience[0]!.bullets.map((x) => x.text)).toEqual(['Bullet 1', 'Bullet 3']);
  });

  it('lets the model drop an item nobody edited', () => {
    const result = merge(current(), rewrite([bullet(1), bullet(2)]), [b(1), b(2)]);
    expect(result.experience[0]!.bullets.map((x) => x.id)).toEqual([b(1), b(2)]);
  });

  it('never clears a field the rewrite left empty, and restores edited scalars', () => {
    const result = merge(
      current([`experience.${ACME}.title`]),
      rewrite([bullet(1)], { company: '', title: 'Senior Engineer' }),
      [b(1)],
    );
    expect(result.experience[0]).toMatchObject({
      company: 'Acme',
      title: 'Engineer',
      dates: { start: '2020', end: 'present' },
    });
  });

  it('restores a field edited while the job ran, even outside the scope', () => {
    const cur = current(['summary']);
    cur.summary = 'Typed while the AI worked.';
    const rewritten = rewrite([bullet(1)]);
    rewritten.summary = 'Something else';
    const result = merge(cur, rewritten, [b(1)]);
    expect(result.summary).toBe('Typed while the AI worked.');
    expect(result.editedPaths).toEqual(['summary']);
  });

  it('accepts the single rewritten entry when the model omitted its id', () => {
    const rewritten = rewrite([bullet(1, 'Shipped billing')]);
    rewritten.experience[0]!.id = NEW;
    const result = merge(current(), rewritten, [b(1)]);
    expect(result.experience[0]!.id).toBe(ACME);
    expect(result.experience[0]!.bullets[0]!.text).toBe('Shipped billing');
  });

  it('restores a manually edited entry the model dropped from a whole-section rewrite', () => {
    const cur = current([`experience.${INITECH}.title`]);
    const rewritten = { ...emptyCvDocument(), experience: [cur.experience[0]!] };
    const result = mergeSection({
      current: cur,
      scope: 'experience',
      rewritten,
      returnedIds: new Set([ACME]),
    });
    expect(result.experience.map((e) => e.id)).toEqual([ACME, INITECH]);
  });

  it('never adds back an item the user removed (AC-10.2)', () => {
    const cur = current();
    cur.removed = [
      { list: `experience.${ACME}.bullets`, key: 'mentored 3 juniors' },
      { list: 'experience', key: 'globex intern' },
    ];
    const bullets = merge(
      cur,
      rewrite([bullet(1), { id: NEW, text: 'Mentored 3 juniors.' }, bullet(3)]),
      [b(1), b(3)],
    ).experience[0]!.bullets;
    expect(bullets.map((x) => x.id)).not.toContain(NEW);

    const globex = { id: NEW, company: 'Globex', title: 'Intern', dates: null, bullets: [] };
    const section = mergeSection({
      current: cur,
      scope: 'experience',
      rewritten: { ...emptyCvDocument(), experience: [...cur.experience, globex] },
      returnedIds: new Set([ACME, INITECH]),
    });
    expect(section.experience.map((e) => e.id)).toEqual([ACME, INITECH]);
    expect(section.removed).toEqual(cur.removed);
  });

  it('keeps a removed-looking item that already exists (only new items are filtered)', () => {
    const cur = current();
    cur.removed = [{ list: `experience.${ACME}.bullets`, key: 'bullet 1' }];
    const result = merge(cur, rewrite([bullet(1), bullet(3)]), [b(1), b(3)]);
    expect(result.experience[0]!.bullets.map((x) => x.id)).toContain(b(1));
  });
});
