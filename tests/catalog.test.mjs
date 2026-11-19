import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, classify, buildCatalog, sameContent } from '../scripts/lib/catalog.mjs';

const v = (id, publishedAt, duration = 'PT30S', embeddable = true) => ({
  id,
  snippet: { title: `Title ${id}`, description: '', publishedAt, thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
  contentDetails: { duration },
  status: { embeddable, privacyStatus: 'public' },
});

test('parseDuration', () => {
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT45S'), 45);
  assert.equal(parseDuration('PT3M'), 180);
  assert.equal(parseDuration('P1DT1S'), 86401);
  assert.equal(parseDuration('bad'), null);
});

test('classify priority: override > index > video; no index -> unknown', () => {
  const idx = new Set(['s1']);
  assert.equal(classify('s1', { shortsIndexIds: idx }), 'short');
  assert.equal(classify('v1', { shortsIndexIds: idx }), 'video');
  assert.equal(classify('s1', { shortsIndexIds: idx, formatOverrides: { s1: 'video' } }), 'video');
  assert.equal(classify('x', { shortsIndexIds: null }), 'unknown');
  assert.equal(classify('x', { shortsIndexIds: null, formatOverrides: { x: 'short' } }), 'short');
});

test('buildCatalog: memberships, dedupe, index-only excluded, sort by publishedAt', () => {
  const cat = buildCatalog({
    playlistItems: {
      'a2-speaking-part-1': [{ videoId: 's1', position: 0 }, { videoId: 'long1', position: 1 }],
      'b1-writing': [{ videoId: 's1', position: 0 }, { videoId: 'gone', position: 1 }],
    },
    sectionPlaylists: { 'a2-speaking-part-1': 'PLA', 'b1-writing': 'PLB' },
    shortsIndexIds: new Set(['s1', 'indexOnly']),
    videos: { s1: v('s1', '2026-01-02T00:00:00Z'), long1: v('long1', '2026-01-03T00:00:00Z', 'PT12M'), indexOnly: v('indexOnly', '2026-01-04T00:00:00Z') },
    config: {},
    now: '2026-01-05T00:00:00Z',
  });
  assert.deepEqual(cat.items.map((i) => i.youtubeId), ['long1', 's1']); // newest first; 'gone' and 'indexOnly' absent
  const s1 = cat.items.find((i) => i.youtubeId === 's1');
  assert.equal(s1.format, 'short');
  assert.deepEqual(s1.memberships.map((m) => `${m.level}/${m.section}`), ['a2/speaking-part-1', 'b1/writing']);
  assert.equal(cat.items.find((i) => i.youtubeId === 'long1').format, 'video');
  assert.equal(cat.items.find((i) => i.youtubeId === 'long1').durationSeconds, 720);
  assert.equal(cat.needsClassification.length, 0);
});

test('buildCatalog without index: unknown goes to needsClassification', () => {
  const cat = buildCatalog({
    playlistItems: { 'a2-writing': [{ videoId: 'a', position: 0 }, { videoId: 'b', position: 1 }] },
    sectionPlaylists: { 'a2-writing': 'PL' },
    shortsIndexIds: null,
    videos: { a: v('a', '2026-01-01T00:00:00Z'), b: v('b', '2026-01-02T00:00:00Z') },
    config: { formatOverrides: { a: 'short' } },
    now: 'x',
  });
  assert.equal(cat.items.find((i) => i.youtubeId === 'a').format, 'short');
  assert.equal(cat.items.find((i) => i.youtubeId === 'b').format, 'unknown');
  assert.deepEqual(cat.needsClassification.map((n) => n.youtubeId), ['b']);
});

test('sameContent ignores timestamps', () => {
  const a = { lastSyncedAt: '1', items: [{ youtubeId: 'x', lastSyncedAt: '1' }], needsClassification: [] };
  const b = { lastSyncedAt: '2', items: [{ youtubeId: 'x', lastSyncedAt: '2' }], needsClassification: [] };
  assert.ok(sameContent(a, b));
});
