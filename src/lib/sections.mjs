// The 8 public sections of the site. This list is the single source of truth
// for levels/sections. Do not add A1, B2, Reading or Listening here.

export const LEVELS = [
  { slug: 'a2', label: 'A2' },
  { slug: 'b1', label: 'B1' },
];

export const SECTION_TYPES = [
  {
    slug: 'speaking-part-1',
    label: 'Speaking Part 1',
    short: 'Speaking · Part 1',
    description: 'Video practice for Speaking Part 1 of the Greek exam.',
  },
  {
    slug: 'speaking-part-2',
    label: 'Speaking Part 2',
    short: 'Speaking · Part 2',
    description: 'Video practice for Speaking Part 2 of the Greek exam.',
  },
  {
    slug: 'speaking-part-3',
    label: 'Speaking Part 3',
    short: 'Speaking · Part 3',
    description: 'Video practice for Speaking Part 3 of the Greek exam.',
  },
  {
    slug: 'writing',
    label: 'Writing',
    short: 'Writing',
    description: 'Video practice for the Writing part of the Greek exam.',
  },
];

/** All 8 sections: { key: 'a2-speaking-part-1', level, section, ... } */
export const SECTIONS = LEVELS.flatMap((level) =>
  SECTION_TYPES.map((type) => ({
    key: `${level.slug}-${type.slug}`,
    level: level.slug,
    levelLabel: level.label,
    section: type.slug,
    sectionLabel: type.label,
    sectionShort: type.short,
    description: type.description,
    path: `/${level.slug}/${type.slug}/`,
  })),
);

export function findSection(level, section) {
  return SECTIONS.find((s) => s.level === level && s.section === section);
}

export function sectionKey(level, section) {
  return `${level}-${section}`;
}
