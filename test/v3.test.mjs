import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { HistoryService } from '../lib/state/history.js';
import { DjService } from '../lib/state/dj.js';
import { SceneService } from '../lib/state/scene.js';
import { ProfileService } from '../lib/state/profile.js';
import { TrafficService } from '../lib/state/traffic.js';
import { AuditService } from '../lib/state/audit.js';
import { parseVoiceIntent } from '../lib/fnos/voice.js';
import { Vault } from '../lib/state/vault.js';


function memoryCredentials() {
  const records = new Map();
  return {
    records,
    async readRecord(key) { return records.get(key); },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key));
      if (next !== undefined) records.set(key, next);
      return next;
    },
    async deleteRecord(key) { records.delete(key); },
  };
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fnos-v3-'));
}

function track(id, overrides = {}) {
  return {
    id,
    title: `Title ${id}`,
    artist: 'Artist',
    album: 'Album',
    albumId: 'album-1',
    genre: 'Pop',
    year: 2024,
    trackNo: 1,
    discNo: 1,
    durationSec: 240,
    quality: 'lossless',
    coverId: '',
    favorite: false,
    ...overrides,
  };
}

test('history records plays, persists, and isolates listeners', async () => {
  const dir = await tempDir();
  const history = new HistoryService(dir);
  await history.start('default');
  history.startTrack(track('a'), 'device-1');
  history.progress(12_000, 'playing');
  history.finish();
  history.startTrack(track('b'), 'device-1');
  history.progress(2_000, 'playing');
  history.finish(true);
  await history.flush();

  const stats = history.stats('30d');
  assert.equal(stats.plays, 2);
  assert.equal(stats.uniqueTracks, 2);
  assert.equal(stats.hourly.reduce((sum, value) => sum + value, 0), 2);
  assert.equal(stats.topTracks[0].plays, 1);

  const list = await history.list('30d', 0, 10);
  assert.equal(list.total, 2);
  assert.equal(list.items[0].trackId, 'b');

  const reopened = new HistoryService(dir);
  await reopened.start('default');
  assert.equal((await reopened.list('all', 0, 10)).total, 2);

  await history.switchListener('kid');
  history.startTrack(track('c'), 'device-1');
  history.progress(10_000, 'playing');
  history.finish();
  await history.flush();
  assert.equal((await history.list('all', 0, 10)).total, 1);

  await history.switchListener('default');
  assert.equal((await history.list('all', 0, 10)).total, 2);

  await history.clear();
  assert.equal((await history.list('all', 0, 10)).total, 0);
  await history.dispose();
  await reopened.dispose();
});

test('DJ pool consumes in order, skips excluded tracks, and replenishes', () => {
  const dj = new DjService();
  const pool = [track('a'), track('b'), track('c')];
  const state = dj.start(pool, 'pool', null);
  assert.equal(state.enabled, true);
  assert.equal(state.poolRemaining, 3);
  assert.equal(dj.takeNext(new Set(['a'])).id, 'b');
  assert.equal(dj.takeNext(new Set()).id, 'c');
  assert.equal(dj.takeNext(new Set()), undefined);
  dj.replenish([track('d')]);
  assert.equal(dj.takeNext(new Set()).id, 'd');
  dj.stop();
  assert.equal(dj.status().enabled, false);
  assert.equal(dj.status().poolRemaining, 0);
});

test('scene resolves local time and falls back through local sources', async () => {
  const calls = [];
  const profile = {
    async recommend() {
      return { ok: true, data: { items: [track('p1')], source: 'history' } };
    },
  };
  const library = {
    async search(params) {
      calls.push(params);
      if (params.hasLyric === false) return { ok: true, data: { items: [track('i1')], total: 1, hasMore: false } };
      return { ok: true, data: { items: [track('l1')], total: 1, hasMore: false } };
    },
    async listTracks() { return { ok: true, data: { items: [track('t1')], total: 1, truncated: false, scanned: 1 } }; },
  };
  const scene = new SceneService(profile, library);
  assert.equal(scene.resolve('auto'), scene.resolve('auto'));
  const morning = await scene.tracks('morning', 2);
  assert.equal(morning.ok, true);
  assert.equal(morning.data.scene, 'morning');
  assert.equal(morning.data.items[0].id, 'p1');
  const instrumental = await scene.tracks('instrumental', 2);
  assert.equal(instrumental.ok, true);
  assert.equal(instrumental.data.items[0].id, 'i1');
  assert.equal(calls.some((call) => call.hasLyric === false), true);
});

test('voice intent is deterministic, local, and supports client actions', () => {
  assert.deepEqual(parseVoiceIntent('暂停'), { matched: true, action: 'pause' });
  assert.deepEqual(parseVoiceIntent('继续播放'), { matched: true, action: 'resume' });
  assert.equal(parseVoiceIntent('音量调到 42').volume, 42);
  assert.equal(parseVoiceIntent('播放 晴天').action, 'play_query');
  assert.equal(parseVoiceIntent('播放 晴天').query, '晴天');
  assert.deepEqual(parseVoiceIntent('打开歌词'), { matched: true, action: 'open_lyrics', clientAction: 'openLyrics' });
  assert.equal(parseVoiceIntent('完全无法识别').matched, false);
  assert.equal(parseVoiceIntent('').matched, false);
});

test('traffic and audit are local, bounded, and clearable', async () => {
  const dir = await tempDir();
  const traffic = new TrafficService(dir);
  await traffic.load();
  traffic.record({ at: Date.now(), kind: 'request', path: '/track/list', status: 200, ms: 12, bytes: 1024, via: 'direct' }, 'dev');
  traffic.record({ at: Date.now(), kind: 'request', path: '/album/detail', status: 500, ms: 30, bytes: 256, via: 'fnid' }, 'dev');
  traffic.record({ at: Date.now(), kind: 'play', path: '/x' }, 'dev');
  const summary = traffic.summary();
  assert.equal(summary.total.requests, 2);
  assert.equal(summary.total.bytes, 1280);
  assert.equal(summary.total.errors, 1);
  assert.equal(summary.byVia.length, 2);
  assert.equal(summary.byDevice[0].key, 'dev');
  await traffic.clear();
  assert.equal(traffic.summary().total.requests, 0);

  const audit = new AuditService(dir);
  await audit.load();
  audit.record({ tool: 'fnos_music_playlist', action: 'create', target: 'p1', ok: true });
  audit.record({ tool: 'fnos_music_playlist', action: 'delete', target: 'p1', ok: false, code: 'forbidden' });
  assert.equal(audit.list().length, 2);
  assert.equal(audit.list()[0].ok, false);
  await audit.clear();
  assert.equal(audit.list().length, 0);
});

test('profile recommendations combine history, favorites, and dedupe tracks', async () => {
  const history = {
    stats() {
      return {
        topArtists: [{ key: 'Artist', label: 'Artist', plays: 4, listenedSec: 400 }],
        topGenres: [{ key: 'Pop', label: 'Pop', plays: 3, listenedSec: 300 }],
        plays: 4,
      };
    },
  };
  const favorite = track('favorite');
  const library = {
    async favorites() { return { ok: true, data: { total: 1, items: [favorite], hasMore: false } }; },
    async search(params) {
      if (params.artist) return { ok: true, data: { items: [track('by-artist'), favorite], total: 2, hasMore: false } };
      if (params.genre) return { ok: true, data: { items: [track('by-genre')], total: 1, hasMore: false } };
      return { ok: true, data: { items: [], total: 0, hasMore: false } };
    },
    async listTracks() { return { ok: true, data: { items: [], total: 0 } }; },
  };
  const profile = new ProfileService(history, library);
  const result = await profile.recommend(10);
  assert.equal(result.ok, true);
  assert.equal(result.data.source, 'history');
  assert.equal(result.data.items.length, 3);
  assert.equal(new Set(result.data.items.map((item) => item.id)).size, 3);
  assert.deepEqual(profile.summary().artists[0].label, 'Artist');
});

test('history retains at most 5000 rows and fills zero days for 7d stats', async () => {
  const dir = await tempDir();
  const history = new HistoryService(dir);
  await history.start('default');
  for (let index = 0; index < 5005; index += 1) {
    history.startTrack(track(`cap-${index}`), 'device');
    history.progress(6000, 'playing');
    history.finish();
  }
  await history.flush();
  const all = await history.list('all', 0, 100);
  assert.equal(all.total, 5000);
  const week = history.stats('7d');
  assert.equal(week.daily.length, 7);
  assert.equal(week.daily.reduce((sum, day) => sum + day.plays, 0), 5000);
  await history.dispose();
});

test('traffic and audit survive a service reload', async () => {
  const dir = await tempDir();
  const traffic = new TrafficService(dir);
  await traffic.load();
  traffic.record({ at: Date.now(), kind: 'request', path: '/x', status: 200, ms: 3, bytes: 10, via: 'fnid' }, 'd');
  await traffic.flush();
  const trafficAgain = new TrafficService(dir);
  await trafficAgain.load();
  assert.equal(trafficAgain.summary().total.requests, 1);

  const audit = new AuditService(dir);
  await audit.load();
  audit.record({ tool: 'fnos_music_favorite', action: 'remove', target: 't', ok: true });
  await audit.flush();
  const auditAgain = new AuditService(dir);
  await auditAgain.load();
  assert.equal(auditAgain.list().length, 1);
  assert.equal(auditAgain.list()[0].tool, 'fnos_music_favorite');
});

test('DJ scene start/stop and voice English commands keep local semantics', () => {
  const dj = new DjService();
  dj.start([track('x')], 'scene', 'focus');
  assert.equal(dj.status().mode, 'scene');
  assert.equal(dj.status().scene, 'focus');
  dj.stop();
  assert.equal(dj.status().scene, null);
  assert.equal(parseVoiceIntent('Pause').action, 'pause');
  assert.equal(parseVoiceIntent('Next track').matched, false);
  assert.equal(parseVoiceIntent('next').action, 'next');
  assert.equal(parseVoiceIntent('volume to 7').volume, 7);
  assert.equal(parseVoiceIntent('打开悬浮').clientAction, 'openFloat');
});

test('history completion and clear persist across reload', async () => {
  const dir = await tempDir();
  const history = new HistoryService(dir);
  await history.start('default');
  history.startTrack(track('done'), 'd');
  history.progress(240_000, 'playing');
  history.finish(true);
  await history.flush();
  assert.equal(history.stats('all').plays, 1);
  assert.equal(history.stats('all').topTracks[0].listenedSec, 240);
  await history.clear();
  const reopened = new HistoryService(dir);
  await reopened.start('default');
  assert.equal((await reopened.list('all', 0, 10)).total, 0);
  await reopened.dispose();
});

test('profile falls back to the local library without history or favorites', async () => {
  const history = { stats: () => ({ topArtists: [], topGenres: [], plays: 0 }) };
  const library = {
    async favorites() { return { ok: true, data: { items: [], total: 0 } }; },
    async search() { return { ok: true, data: { items: [], total: 0 } }; },
    async listTracks() { return { ok: true, data: { items: [track('fallback')], total: 1 } }; },
  };
  const profile = new ProfileService(history, library);
  const result = await profile.recommend(5);
  assert.equal(result.ok, true);
  assert.equal(result.data.source, 'library');
  assert.equal(result.data.items[0].id, 'fallback');
});

test('scene returns not_found when every local source is empty', async () => {
  const profile = { async recommend() { return { ok: true, data: { items: [], source: 'library' } }; } };
  const library = {
    async search() { return { ok: true, data: { items: [], total: 0 } }; },
    async listTracks() { return { ok: true, data: { items: [], total: 0 } }; },
  };
  const scene = new SceneService(profile, library);
  const result = await scene.tracks('morning', 3);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not_found');
  assert.equal(['morning', 'focus', 'evening', 'late', 'instrumental'].includes(scene.resolve('auto')), true);
});

test('DJ setEnabled(false) clears its pool and traffic ignores non-request rows', async () => {
  const dj = new DjService();
  dj.start([track('a'), track('b')], 'pool', null);
  assert.equal(dj.remaining, 2);
  dj.setEnabled(false);
  assert.equal(dj.remaining, 0);
  assert.equal(dj.status().enabled, false);

  const dir = await tempDir();
  const traffic = new TrafficService(dir);
  traffic.record({ at: Date.now(), kind: 'play', path: '/x' }, 'd');
  traffic.record({ at: Date.now(), kind: 'system', path: '/y' }, 'd');
  assert.equal(traffic.summary().total.requests, 0);
  traffic.record({ at: Date.now(), kind: 'request', path: '/z', status: 200, ms: 2, bytes: 4, via: 'direct' }, 'd');
  assert.equal(traffic.summary().total.requests, 1);
  assert.equal(traffic.summary().byVia[0].key, 'direct');
  assert.equal(traffic.summary().byDevice[0].key, 'd');
});

test('audit bounds its in-memory ring and clears', async () => {
  const dir = await tempDir();
  const audit = new AuditService(dir);
  await audit.load();
  for (let index = 0; index < 1005; index += 1) audit.record({ tool: 't', action: 'a', target: 'x', ok: true });
  assert.equal(audit.list(1000).length, 500);
  await audit.clear();
  assert.equal(audit.list(1000).length, 0);
});

test('voice handles volume bounds and rejects empty/unknown text', () => {
  assert.equal(parseVoiceIntent('音量 999').volume, 100);
  assert.equal(parseVoiceIntent('volume 0').volume, 0);
  assert.equal(parseVoiceIntent('   ').matched, false);
  assert.equal(parseVoiceIntent('今天天气不错').matched, false);
  assert.equal(parseVoiceIntent('播放').action, 'play');
  assert.equal(parseVoiceIntent('取消红心').action, 'unfavorite');
  assert.equal(parseVoiceIntent('打开面板').clientAction, 'openPanel');
});

test('history ordering is newest-first even for same-millisecond plays', async () => {
  const dir = await tempDir();
  const history = new HistoryService(dir);
  await history.start('default');
  history.startTrack(track('one'), 'd');
  history.finish();
  history.startTrack(track('two'), 'd');
  history.finish();
  const list = await history.list('all', 0, 10);
  assert.equal(list.items[0].trackId, 'two');
  assert.equal(list.items[1].trackId, 'one');
});

test('vault listener names are sanitized and active listener persists', async () => {
  const credentials = memoryCredentials();
  const vault = new Vault(credentials, 'listener-persist');
  await vault.open();
  const listener = await vault.createListener('  A\n\tB  ');
  assert.equal(listener.name, 'A B');
  const reopened = new Vault(credentials, 'listener-persist');
  await reopened.open();
  assert.equal(reopened.activeListener().name, 'A B');
  assert.equal(reopened.listeners.length, 2);
});

test('traffic summary totals and clears in place', async () => {
  const dir = await tempDir();
  const traffic = new TrafficService(dir);
  await traffic.load();
  traffic.record({ at: Date.now(), kind: 'request', path: '/a', status: 200, ms: 10, bytes: 100, via: 'fnid' }, 'dev');
  traffic.record({ at: Date.now(), kind: 'request', path: '/b', status: 400, ms: 20, bytes: 50, via: 'fnid' }, 'dev');
  const summary = traffic.summary();
  assert.equal(summary.total.requests, 2);
  assert.equal(summary.total.errors, 1);
  assert.equal(summary.total.bytes, 150);
  assert.equal(summary.byVia[0].key, 'fnid');
  await traffic.clear();
  assert.equal(traffic.summary().total.requests, 0);
});

test('scene focus chain prefers profile and reports fallback', async () => {
  const profile = { async recommend() { return { ok: true, data: { items: [track('p')], source: 'history' } }; } };
  const library = { async search() { return { ok: true, data: { items: [track('i')], total: 1 } }; }, async listTracks() { return { ok: true, data: { items: [] } }; } };
  const scene = new SceneService(profile, library);
  const result = await scene.tracks('focus', 3);
  assert.equal(result.ok, true);
  assert.equal(result.data.scene, 'focus');
  assert.equal(result.data.fallback, true);
  assert.equal(result.data.items.length, 2);
});

test('recent history keeps the latest play per track, while raw history and stats stay per play', async () => {
  const dir = await tempDir();
  const history = new HistoryService(dir);
  await history.start('default');
  history.startTrack(track('repeat', { albumId: 'album-r', coverId: 'cover-r' }), 'd');
  history.progress(6000, 'playing');
  history.finish();
  history.startTrack(track('other'), 'd');
  history.progress(6000, 'playing');
  history.finish();
  history.startTrack(track('repeat', { albumId: 'album-r', coverId: 'cover-r' }), 'd');
  history.progress(9000, 'playing');
  history.finish();

  const raw = await history.list('all', 0, 10);
  assert.equal(raw.total, 3);
  assert.equal(raw.items.filter((entry) => entry.trackId === 'repeat').length, 2);
  const recent = await history.list('all', 0, 10, true);
  assert.equal(recent.total, 2);
  assert.deepEqual(recent.items.map((entry) => entry.trackId), ['repeat', 'other']);
  assert.equal(recent.items[0].listenedMs, 9000);
  assert.equal(history.stats('all').plays, 3);

  const snap = history.findTrack('repeat');
  assert.equal(snap.albumId, 'album-r');
  assert.equal(snap.coverId, 'cover-r');
  assert.equal(snap.durationSec, 240);
  assert.equal(snap.quality, 'lossless');
  assert.equal(history.findTrack('missing'), undefined);
  await history.dispose();
});

test('old history rows without albumId still resolve from the latest snapshot', async () => {
  const dir = await tempDir();
  const now = Date.now();
  await fs.writeFile(path.join(dir, 'history-default.json'), JSON.stringify({
    version: 1,
    entries: [
      { at: now - 20_000, trackId: 'legacy', title: 'Legacy', artist: 'A', album: 'B', durationSec: 120, quality: 'standard', listenedMs: 6000, deviceId: 'd', listenerId: 'default', source: 'play' },
      { at: now - 10_000, trackId: 'legacy', title: 'Legacy', artist: 'A', album: 'B', durationSec: 120, quality: 'standard', listenedMs: 8000, deviceId: 'd', listenerId: 'default', source: 'play' },
    ],
  }), 'utf8');
  const history = new HistoryService(dir);
  await history.start('default');
  const unique = await history.list('all', 0, 10, true);
  assert.equal(unique.total, 1);
  assert.equal(unique.items[0].albumId, '');
  const snap = history.findTrack('legacy');
  assert.equal(snap.id, 'legacy');
  assert.equal(snap.albumId, '');
  assert.equal(snap.coverId, '');
  assert.equal(snap.durationSec, 120);
  await history.dispose();
});
