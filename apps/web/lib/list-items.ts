import type { CvBullet, CvEducation, CvExperience, CvSkill } from '@cv/shared';

// New, empty items for "Add …" (AC-10.2). The id is made here: the server keeps it, so the
// editor can address the item before the save comes back.

export const newExperience = (): CvExperience => ({
  id: crypto.randomUUID(),
  company: '',
  title: '',
  dates: null,
  bullets: [],
});

export const newEducation = (): CvEducation => ({
  id: crypto.randomUUID(),
  institution: '',
  degree: '',
  dates: null,
});

export const newBullet = (): CvBullet => ({ id: crypto.randomUUID(), text: '' });

/** A skill is never empty, so it is added with its name. */
export const newSkill = (name: string): CvSkill => ({ id: crypto.randomUUID(), name: name.trim() });

/** Where an item lands after "Undo": its old place, or the end if the list got shorter. */
export const restoreIndex = (index: number, length: number) => Math.min(index, length);
