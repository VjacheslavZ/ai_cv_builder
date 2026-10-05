import { cvBulletSchema, cvEducationSchema, cvExperienceSchema, cvSkillSchema } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { newBullet, newEducation, newExperience, newSkill, restoreIndex } from './list-items';

describe('new list items (AC-10.2)', () => {
  it('are valid items with fresh ids', () => {
    expect(cvExperienceSchema.safeParse(newExperience()).success).toBe(true);
    expect(cvEducationSchema.safeParse(newEducation()).success).toBe(true);
    expect(cvBulletSchema.safeParse(newBullet()).success).toBe(true);
    expect(cvSkillSchema.parse(newSkill('  Go '))).toMatchObject({ name: 'Go' });
    expect(newBullet().id).not.toBe(newBullet().id);
  });

  it('restores a removed item at its place, or at the end of a shorter list', () => {
    expect(restoreIndex(1, 3)).toBe(1);
    expect(restoreIndex(4, 2)).toBe(2);
  });
});
