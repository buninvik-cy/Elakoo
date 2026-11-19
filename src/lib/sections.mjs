// Levels, groups and playlists all come from config/elakoo.config.json.
// To add a level or a playlist, edit the config - no code changes needed.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ELAKOO_CONFIG_PATH lets tests/previews use another config.
const config = JSON.parse(readFileSync(process.env.ELAKOO_CONFIG_PATH || path.resolve('config/elakoo.config.json'), 'utf8'));
export { config };

const isReal = (id) => typeof id === 'string' && id.length > 0 && !id.startsWith('REPLACE');

export const GROUPS = config.groups || [];

/** Levels in config order: { slug, label } */
const HEX = /^#[0-9a-f]{6}$/i;
// Optional level colour (e.g. from the textbook covers); falls back to the brand blue.
export const LEVELS = (config.levels || []).map(({ slug, label, color }) => ({ slug, label, color: HEX.test(color || '') ? color : null }));
export const levelColor = (slug) => LEVELS.find((l) => l.slug === slug)?.color || null;

/** Every configured playlist ("section"), with or without an ID. */
export const ALL_SECTIONS = (config.levels || []).flatMap((level) =>
  (level.playlists || []).map((p) => ({
    key: `${level.slug}-${p.slug}`,
    level: level.slug,
    levelLabel: level.label,
    section: p.slug,
    sectionLabel: p.title,
    group: p.group || 'exam',
    description: p.description || `Greek ${level.label} · ${p.title}: video practice for the Greek exam.`,
    playlistId: isReal(p.playlistId) ? p.playlistId : null,
    path: `/${level.slug}/${p.slug}/`,
  })),
);

/** Sections that are live (have a real YouTube playlist ID). Only these get pages. */
export const SECTIONS = ALL_SECTIONS.filter((s) => s.playlistId);

/** Unique section types across levels, for catalog filters: { slug, label } */
export const SECTION_TYPES = [...new Map(ALL_SECTIONS.map((s) => [s.section, { slug: s.section, label: s.sectionLabel }])).values()];

export function findSection(level, section) {
  return ALL_SECTIONS.find((s) => s.level === level && s.section === section);
}
