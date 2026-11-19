// Pure catalog-building logic. No network here, so it can be unit-tested.

/** ISO 8601 duration (PT1H2M3S, P1DT2H) -> seconds. */
export function parseDuration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(min || 0) * 60) + Math.round(Number(s || 0));
}

export const SHORT_MAX_SECONDS = 180;

/**
 * Decide the format of a video.
 * Priority: formatOverrides > Shorts-index playlist > YouTube's /shorts/ check (detected)
 *           > duration (<= 3 min = Short) > 'unknown'.
 */
export function classify(youtubeId, { formatOverrides = {}, shortsIndexIds = null, detected = {}, durationSeconds = null }) {
  const override = formatOverrides[youtubeId];
  if (override === 'short' || override === 'video') return override;
  if (shortsIndexIds) return shortsIndexIds.has(youtubeId) ? 'short' : 'video';
  if (detected[youtubeId] === 'short' || detected[youtubeId] === 'video') return detected[youtubeId];
  if (durationSeconds != null) return durationSeconds <= SHORT_MAX_SECONDS ? 'short' : 'video';
  return 'unknown';
}

export function bestThumbnail(thumbnails = {}) {
  for (const k of ['maxres', 'standard', 'high', 'medium', 'default']) {
    if (thumbnails[k]?.url) return thumbnails[k].url;
  }
  return null;
}

/** Parse a section key like 'a2-speaking-part-1' -> { level, section }. */
export function splitSectionKey(key) {
  const i = key.indexOf('-');
  return { level: key.slice(0, i), section: key.slice(i + 1) };
}

/**
 * Build catalog items.
 * @param {object} args
 * @param {Record<string, Array<{videoId:string, position:number}>>} args.playlistItems  sectionKey -> items
 * @param {Record<string, string>} args.sectionPlaylists  sectionKey -> playlistId
 * @param {Set<string>|null} args.shortsIndexIds
 * @param {Record<string, object>} args.videos  videoId -> YouTube videos.list resource
 * @param {object} args.config
 * @param {string} args.now ISO timestamp
 */
export function buildCatalog({ playlistItems, sectionPlaylists, shortsIndexIds, videos, config, now, detected = {} }) {
  const byId = new Map();

  for (const [key, entries] of Object.entries(playlistItems)) {
    const { level, section } = splitSectionKey(key);
    for (const entry of entries) {
      const v = videos[entry.videoId];
      if (!v) continue; // deleted / private / unavailable -> not on the site
      let item = byId.get(entry.videoId);
      if (!item) {
        const sn = v.snippet || {};
        item = {
          youtubeId: entry.videoId,
          title: sn.title || '',
          description: (sn.description || '').slice(0, 500),
          thumbnail: bestThumbnail(sn.thumbnails),
          publishedAt: sn.publishedAt || null,
          durationSeconds: parseDuration(v.contentDetails?.duration),
          format: classify(entry.videoId, {
            formatOverrides: config.formatOverrides || {}, shortsIndexIds, detected,
            durationSeconds: parseDuration(v.contentDetails?.duration),
          }),
          memberships: [],
          isEmbeddable: v.status?.embeddable !== false,
          youtubeUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
          lastSyncedAt: now,
        };
        byId.set(entry.videoId, item);
      }
      // Same video twice in one playlist: keep the first position only.
      if (!item.memberships.some((m) => m.level === level && m.section === section)) {
        item.memberships.push({ level, section, playlistId: sectionPlaylists[key], position: entry.position });
      }
    }
  }

  // Items only in the Shorts index (and in no section playlist) are never added: they are not on the site.
  const items = [...byId.values()].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const needsClassification = items
    .filter((i) => i.format === 'unknown')
    .map((i) => ({ youtubeId: i.youtubeId, title: i.title, youtubeUrl: i.youtubeUrl }));

  return { lastSyncedAt: now, items, needsClassification };
}

/** Compare two catalogs ignoring timestamps, to avoid committing when nothing changed. */
export function sameContent(a, b) {
  const strip = (c) => JSON.stringify((c?.items || []).map(({ lastSyncedAt, ...rest }) => rest));
  return strip(a) === strip(b) && JSON.stringify(a?.needsClassification || []) === JSON.stringify(b?.needsClassification || []);
}
