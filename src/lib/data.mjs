// Site-side access to the synced catalog and config (read at build time only).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config, SECTIONS, ALL_SECTIONS, findSection } from './sections.mjs';

// On the server the catalog lives outside the code folder (ELAKOO_CATALOG_PATH),
// so code updates never overwrite synced data.
const catalogPath = process.env.ELAKOO_CATALOG_PATH || path.resolve('data/catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

const isReal = (id) => typeof id === 'string' && id && !id.startsWith('REPLACE');

export const siteConfig = config;
export const channelUrl = isReal(config.channelUrl) ? config.channelUrl : null;
export const lastSyncedAt = catalog.lastSyncedAt;

/** Only classified items, keeping memberships of sections that are still live in the config. */
const live = new Set(SECTIONS.map((s) => s.key));
export const items = (catalog.items || [])
  .filter((i) => i.format === 'video' || i.format === 'short')
  .map((i) => ({ ...i, memberships: (i.memberships || []).filter((m) => live.has(`${m.level}-${m.section}`)) }))
  .filter((i) => i.memberships.length);

export function playlistIdFor(level, section) {
  return findSection(level, section)?.playlistId || null;
}

export function playlistUrl(level, section) {
  const id = playlistIdFor(level, section);
  return id ? `https://www.youtube.com/playlist?list=${id}` : null;
}

/** Items of one section and format, in original playlist order. */
export function sectionItems(level, section, format) {
  return items
    .filter((i) => i.format === format)
    .map((i) => ({ item: i, m: i.memberships.find((m) => m.level === level && m.section === section) }))
    .filter((x) => x.m)
    .sort((a, b) => a.m.position - b.m.position)
    .map((x) => x.item);
}

/** Newest first, deduplicated (catalog items are already unique by youtubeId). */
export function latest(format, n) {
  return items.filter((i) => i.format === format).slice(0, n);
}

export function allOfFormat(format) {
  return items.filter((i) => i.format === format);
}

/** Where to watch an item on the site: its first section page with ?v= */
export function watchHref(item, preferred) {
  const m = (preferred && item.memberships.find((x) => x.level === preferred.level && (!preferred.section || x.section === preferred.section)))
    || (preferred && item.memberships.find((x) => x.level === preferred.level))
    || item.memberships[0];
  return `/${m.level}/${m.section}/?v=${encodeURIComponent(item.youtubeId)}`;
}

export function labels(item) {
  return item.memberships.map((m) => {
    const s = findSection(m.level, m.section);
    return s ? `${s.levelLabel} · ${s.sectionLabel}` : `${m.level} ${m.section}`;
  });
}

export function formatDuration(sec) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Compilation map: longId -> [short items] (only real, existing shorts). */
export function compilationShorts(longId) {
  const ids = config.compilations?.[longId] || [];
  return ids.map((id) => items.find((i) => i.youtubeId === id && i.format === 'short')).filter(Boolean);
}

/** Items of one level and format, newest first. */
export function levelItems(level, format) {
  return items.filter((i) => i.format === format && i.memberships.some((m) => m.level === level));
}

/** Summary for a playlist card. */
export function sectionSummary(level, section) {
  const videos = sectionItems(level, section, 'video');
  const shorts = sectionItems(level, section, 'short');
  const cover = videos[0]?.thumbnail || shorts[0]?.thumbnail || null;
  return { videos: videos.length, shorts: shorts.length, cover };
}

export { SECTIONS, ALL_SECTIONS };
