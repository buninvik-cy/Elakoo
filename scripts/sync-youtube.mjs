#!/usr/bin/env node
// Sync the 8 section playlists (+ optional Shorts index) from the YouTube Data API
// into data/catalog.json. On any error the previous catalog is kept untouched.
//
// Usage:  YOUTUBE_API_KEY=... node scripts/sync-youtube.mjs [--force]
//   --force  write the result even if it is empty while the previous catalog was not.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCatalog, sameContent } from './lib/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = process.env.ELAKOO_CONFIG_PATH || path.join(ROOT, 'config/elakoo.config.json');
const CATALOG_PATH = process.env.ELAKOO_CATALOG_PATH || path.join(ROOT, 'data/catalog.json');
const API = 'https://www.googleapis.com/youtube/v3';
const FORCE = process.argv.includes('--force');

const log = (...a) => console.log('[sync]', ...a);

function isRealId(id) {
  return typeof id === 'string' && id.length > 0 && !id.startsWith('REPLACE');
}

async function api(endpoint, params, key) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const safeUrl = url.toString().replace(/key=[^&]+/, 'key=***');
    throw new Error(`YouTube API ${res.status} for ${safeUrl}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** All items of a playlist, following nextPageToken. */
async function fetchPlaylist(playlistId, key) {
  const out = [];
  let pageToken;
  do {
    const data = await api('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    }, key);
    for (const it of data.items || []) {
      const videoId = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
      if (videoId) out.push({ videoId, position: it.snippet?.position ?? out.length });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Is this a Short? youtube.com/shorts/ID answers 200 for a Short and redirects to /watch for a normal video.
 * Anything else (consent page, network error) -> null, and the duration rule decides.
 */
async function detectShort(id) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${encodeURIComponent(id)}`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { Cookie: 'CONSENT=YES+1; SOCS=CAI', 'User-Agent': 'Mozilla/5.0 (elakoo-sync)' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 200) return 'short';
    const loc = res.headers.get('location') || '';
    if (res.status >= 300 && res.status < 400 && loc.includes('/watch')) return 'video';
  } catch { /* fall through */ }
  return null;
}

/** videos.list in batches of 50. */
async function fetchVideos(ids, key) {
  const out = {};
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const data = await api('videos', { part: 'snippet,contentDetails,status', id: batch.join(','), maxResults: '50' }, key);
    for (const v of data.items || []) {
      if (v.status?.privacyStatus === 'private') continue;
      out[v.id] = v;
    }
  }
  return out;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const previous = JSON.parse(await readFile(CATALOG_PATH, 'utf8').catch(() => '{"items":[]}'));

  // sectionKey ('a2-speaking-part-1') -> playlistId, from config.levels[].playlists[]
  // (old flat "sectionPlaylists" format is still accepted).
  const fromLevels = (config.levels || []).flatMap((l) => (l.playlists || []).map((p) => [`${l.slug}-${p.slug}`, p.playlistId]));
  const sectionPlaylists = Object.fromEntries(
    [...Object.entries(config.sectionPlaylists || {}), ...fromLevels].filter(([, id]) => isRealId(id)),
  );
  if (Object.keys(sectionPlaylists).length === 0) {
    log('No playlist IDs configured in config/elakoo.config.json yet. Nothing to sync; catalog unchanged.');
    return;
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set.');

  const playlistItems = {};
  for (const [sectionKey, playlistId] of Object.entries(sectionPlaylists)) {
    playlistItems[sectionKey] = await fetchPlaylist(playlistId, key);
    log(`${sectionKey}: ${playlistItems[sectionKey].length} items`);
  }

  let shortsIndexIds = null;
  if (isRealId(config.shortsIndexPlaylistId)) {
    const idx = await fetchPlaylist(config.shortsIndexPlaylistId, key);
    shortsIndexIds = new Set(idx.map((i) => i.videoId));
    log(`Shorts index: ${shortsIndexIds.size} items`);
  } else {
    log('No Shorts index playlist: detecting Shorts via youtube.com/shorts/ (fallback: duration <= 3 min).');
  }

  const allIds = Object.values(playlistItems).flat().map((i) => i.videoId);
  const videos = await fetchVideos(allIds, key);

  // Without an index, ask YouTube per video. Earlier answers are reused from the previous catalog.
  const detected = {};
  if (!shortsIndexIds) {
    const known = new Map((previous.items || []).filter((i) => i.formatSource === 'detected').map((i) => [i.youtubeId, i.format]));
    for (const id of Object.keys(videos)) {
      if (config.formatOverrides?.[id]) continue;
      detected[id] = known.get(id) || await detectShort(id);
    }
  }

  const catalog = buildCatalog({
    playlistItems, sectionPlaylists, shortsIndexIds, videos, config, detected, now: new Date().toISOString(),
  });
  for (const item of catalog.items) {
    if (detected[item.youtubeId] === item.format) item.formatSource = 'detected';
  }

  if (catalog.items.length === 0 && (previous.items || []).length > 0 && !FORCE) {
    throw new Error('Sync returned 0 videos but the previous catalog had some. Keeping the previous catalog. Run with --force if this is intended.');
  }

  const counts = catalog.items.reduce((acc, i) => ((acc[i.format] = (acc[i.format] || 0) + 1), acc), {});
  log(`Result: ${catalog.items.length} videos`, counts);
  if (catalog.needsClassification.length) {
    log('NEEDS CLASSIFICATION (hidden on the site until labelled in formatOverrides):');
    for (const n of catalog.needsClassification) log(`  "${n.youtubeId}": "short" | "video"   # ${n.title}`);
  }

  if (sameContent(previous, catalog)) {
    log('No changes. Catalog not rewritten.');
    return;
  }
  await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
  log(`${CATALOG_PATH} updated.`);
}

main().catch((err) => {
  console.error('[sync] FAILED - previous catalog kept.', err.message);
  process.exit(1);
});
