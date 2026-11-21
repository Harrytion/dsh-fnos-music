import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { apply } from '../lib/index.js';
import { startMockNas, mockTarget, TOKEN } from './mock-nas.mjs';
import { resetFfmpegCache } from '../lib/media/remux.js';

function call(base, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(`${base}${pathname}`, {
      method,
      headers: payload === undefined
        ? { ...headers }
        : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const type = String(response.headers['content-type'] ?? '');
        let parsed;
        if (type.includes('application/json')) {
          try {
            parsed = JSON.parse(buffer.toString('utf8'));
          } catch {
            parsed = undefined;
          }
        }
        resolve({ status: response.statusCode, headers: response.headers, body: parsed, buffer });
      });
    });
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

function memoryCredentials() {
  const records = new Map();
  return {
    records,
    async readRecord(key) {
      return records.get(key);
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key));
      if (next !== undefined) records.set(key, next);
      return next;
    },
    async deleteRecord(key) {
      records.delete(key);
    },
  };
}

function fakeContext(credentials) {
  const routes = new Map();
  const tools = new Map();
  const disposers = [];
  const effect = (callback) => {
    const disposer = callback();
    const wrapped = () => {
      if (typeof disposer === 'function') disposer();
    };
    disposers.push(wrapped);
    return wrapped;
  };
  const services = { credentials };
  return {
    routes,
    tools,
    disposers,
    get(name) {
      return services[name];
    },
    effect,
    inject(names, callback) {
      const scope = { effect, ...services };
      if (names.includes('tools')) {
        scope.tools = {
          register(definition) {
            tools.set(definition.name, definition);
            return () => tools.delete(definition.name);
          },
        };
      }
      if (names.includes('webServer')) {
        scope.webServer = {
          register(route) {
            if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`);
            routes.set(route.path, route.handler);
            return () => routes.delete(route.path);
          },
        };
        scope.connection = {
          requestRejection() {
            return undefined;
          },
        };
      }
      callback(scope);
    },
    disposeAll() {
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch {
          // Continue disposing the rest.
        }
      }
    },
  };
}

test('Host routes and Agent tools work end-to-end against a mock fnOS NAS', async () => {
  const mock = await startMockNas();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fnos-home-'));
  const previousHome = process.env.DSH_HOME;
  const previousProfile = process.env.DSH_PROFILE;
  process.env.DSH_HOME = home;
  process.env.DSH_PROFILE = 'test-host';
  const credentials = memoryCredentials();
  const ctx = fakeContext(credentials);
  let dsh;
  try {
    apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 60));

    dsh = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const handler = ctx.routes.get(pathname);
      if (handler === undefined) {
        response.writeHead(404);
        response.end();
        return;
      }
      Promise.resolve(handler(request, response)).catch(() => {
        if (!response.writableEnded) {
          response.writeHead(500);
          response.end();
        }
      });
    });
    await new Promise((resolve) => dsh.listen(0, '127.0.0.1', resolve));
    const dshBase = `http://127.0.0.1:${dsh.address().port}`;

    assert.equal(ctx.routes.size > 15, true, 'routes registered');
    assert.equal(ctx.tools.size, 16, 'sixteen tools registered');

    const add = await call(dshBase, 'POST', '/fnos-music/devices', {
      id: 'mock-device',
      name: 'Mock NAS',
      mode: 'direct',
      address: mock.base,
      token: TOKEN,
    });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    assert.equal(add.body.ok, true, JSON.stringify(add.body));
    assert.equal(add.body.active, true);

    const state = await call(dshBase, 'GET', '/fnos-music/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.version, 1);
    assert.equal(state.body.devices.length, 1);
    assert.equal(state.body.activeDeviceId, 'mock-device');
    assert.equal(state.body.connection.phase, 'online', JSON.stringify(state.body.connection));
    assert.ok(state.body.compat);
    assert.ok(state.body.compat.backend === 'ffmpeg' || state.body.compat.backend === 'mse');
    assert.equal(state.body.compat.ffmpeg, state.body.compat.backend === 'ffmpeg');
    assert.equal(state.body.devices[0].tokenSet, true);
    assert.equal(Object.hasOwn(state.body.devices[0], 'token'), false);


    assert.equal(state.body.listener.id, 'default');
    const homeData = await call(dshBase, 'GET', '/fnos-music/home');
    assert.equal(homeData.status, 200, JSON.stringify(homeData.body));
    assert.equal(homeData.body.ok, true);
    assert.equal(homeData.body.counts.tracks, 3);
    assert.equal(homeData.body.counts.albums, 2);
    assert.equal(homeData.body.latestAlbums.length, 2);
    assert.equal(homeData.body.listener.id, 'default');

    const albumDetail = await call(dshBase, 'GET', '/fnos-music/album?id=album-1');
    assert.equal(albumDetail.status, 200, JSON.stringify(albumDetail.body));
    assert.equal(albumDetail.body.ok, true);
    assert.equal(albumDetail.body.tracks.length, 2);
    assert.equal(albumDetail.body.album.title, '叶惠美');

    const trackMeta = await call(dshBase, 'GET', '/fnos-music/track-meta?guid=track-1');
    assert.equal(trackMeta.status, 200, JSON.stringify(trackMeta.body));
    assert.equal(trackMeta.body.ok, true);
    assert.equal(trackMeta.body.track.codec, 'flac');
    assert.equal(trackMeta.body.track.channels, 2);

    const artistDetail = await call(dshBase, 'GET', `/fnos-music/artist?name=${encodeURIComponent('周杰伦')}`);
    assert.equal(artistDetail.status, 200, JSON.stringify(artistDetail.body));
    assert.equal(artistDetail.body.ok, true);
    assert.equal(artistDetail.body.tracks.length, 2);

    const listeners = await call(dshBase, 'GET', '/fnos-music/listeners');
    assert.equal(listeners.status, 200);
    assert.equal(listeners.body.listeners.length, 1);
    const createListener = await call(dshBase, 'POST', '/fnos-music/listeners', { action: 'create', name: 'Kid' });
    assert.equal(createListener.status, 200, JSON.stringify(createListener.body));
    assert.equal(createListener.body.ok, true);
    assert.equal(createListener.body.listeners.length, 2);
    const switchListener = await call(dshBase, 'POST', '/fnos-music/listeners', { action: 'switch', listenerId: 'default' });
    assert.equal(switchListener.body.activeListenerId, 'default');

    const play = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', trackId: 'track-1' });
    assert.equal(play.status, 200, JSON.stringify(play.body));
    assert.equal(play.body.ok, true);
    const history = await call(dshBase, 'GET', '/fnos-music/history?range=30d');
    assert.equal(history.status, 200);
    assert.equal(history.body.ok, true);
    assert.equal(history.body.total, 1);
    assert.equal(history.body.items[0].trackId, 'track-1');

    const playSecond = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', trackId: 'track-2' });
    assert.equal(playSecond.body.ok, true);
    const playAgain = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', trackId: 'track-1' });
    assert.equal(playAgain.body.ok, true);
    const rawHistory = await call(dshBase, 'GET', '/fnos-music/history?range=30d');
    assert.equal(rawHistory.body.total, 3);
    const recentHistory = await call(dshBase, 'GET', '/fnos-music/history?range=30d&unique=1');
    assert.equal(recentHistory.body.unique, true);
    assert.equal(recentHistory.body.total, 2);
    assert.deepEqual(recentHistory.body.items.map((entry) => entry.trackId), ['track-1', 'track-2']);

    // Simulate a page reload: switching the device clears the library cache
    // and the player queue. Playing a historical trackId must still resolve
    // from the Host-owned history snapshot.
    const switchSame = await call(dshBase, 'POST', '/fnos-music/devices/switch', { id: 'mock-device' });
    assert.equal(switchSame.body.ok, true, JSON.stringify(switchSame.body));
    const emptyState = await call(dshBase, 'GET', '/fnos-music/state');
    assert.equal(emptyState.body.player.queueTotal, 0);
    const replayHistory = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', trackId: 'track-1' });
    assert.equal(replayHistory.body.ok, true, JSON.stringify(replayHistory.body));
    assert.equal(replayHistory.body.player.track.id, 'track-1');

    const stats = await call(dshBase, 'GET', '/fnos-music/stats?range=30d');
    assert.equal(stats.status, 200);
    assert.equal(stats.body.ok, true);
    assert.equal(Array.isArray(stats.body.hourly), true);
    assert.equal(stats.body.hourly.length, 24);

    const sceneStatus = await call(dshBase, 'GET', '/fnos-music/scene');
    assert.equal(sceneStatus.body.ok, true);
    assert.equal(sceneStatus.body.scene.active, false);
    const voice = await call(dshBase, 'POST', '/fnos-music/voice', { text: '打开歌词' });
    assert.equal(voice.body.matched, true);
    assert.equal(voice.body.clientAction, 'openLyrics');
    const djStatus = await call(dshBase, 'GET', '/fnos-music/dj');
    assert.equal(djStatus.body.ok, true);
    assert.equal(djStatus.body.enabled, false);

    const audit = await call(dshBase, 'GET', '/fnos-music/audit');
    assert.equal(audit.status, 200);
    assert.equal(audit.body.ok, true);

    const agentTool = ctx.tools.get('fnos_music_playlist');
    assert.equal(typeof agentTool.execute, 'function');
    await call(dshBase, 'POST', '/fnos-music/settings', { agentWrites: false });
    const blocked = await agentTool.execute({ action: 'create', name: 'Blocked' }, { signal: new AbortController().signal });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, 'forbidden');
    await call(dshBase, 'POST', '/fnos-music/settings', { agentWrites: true });
    const allowed = await agentTool.execute({ action: 'create', name: 'Allowed' }, { signal: new AbortController().signal });
    assert.equal(allowed.ok, true);
    const auditAfter = await call(dshBase, 'GET', '/fnos-music/audit?limit=20');
    assert.equal(auditAfter.body.entries.length >= 2, true);
    assert.equal(auditAfter.body.entries.some((entry) => entry.code === 'forbidden'), true);

    const traffic = await call(dshBase, 'GET', '/fnos-music/traffic');
    assert.equal(traffic.status, 200);
    assert.equal(traffic.body.ok, true);
    assert.equal(traffic.body.traffic.total.requests > 5, true);
    assert.equal(traffic.body.traffic.byVia.some((bucket) => bucket.key === 'direct'), true);

    const search = await call(dshBase, 'GET', `/fnos-music/search?q=${encodeURIComponent('晴天')}&kind=track`);
    assert.equal(search.status, 200, JSON.stringify(search.body));
    assert.equal(search.body.ok, true);
    assert.equal(search.body.items.length, 1);
    assert.equal(search.body.items[0].id, 'track-1');
    assert.equal(search.body.items[0].quality, 'hires');

    const searchTool = ctx.tools.get('fnos_music_search');
    const searchResult = await searchTool.execute({ query: '晴天' }, { signal: new AbortController().signal });
    assert.equal(searchResult.ok, true);
    assert.equal(searchResult.items[0].id, 'track-1');

    const playTool = ctx.tools.get('fnos_music_play');
    const played = await playTool.execute({ trackId: 'track-1' }, { signal: new AbortController().signal });
    assert.equal(played.ok, true, JSON.stringify(played));
    assert.equal(played.player.track.id, 'track-1');
    assert.equal(played.player.status, 'playing');

    const statusTool = ctx.tools.get('fnos_music_status');
    const status = await statusTool.execute({ includeQueue: true }, { signal: new AbortController().signal });
    assert.equal(status.ok, true);
    assert.equal(status.activeDevice.id, 'mock-device');
    assert.equal(status.player.queueTotal, 1);

    const pause = await call(dshBase, 'POST', '/fnos-music/player', { action: 'pause', clientId: 'test-client' });
    assert.equal(pause.status, 200, JSON.stringify(pause.body));
    assert.equal(pause.body.ok, true);

    const queue = await call(dshBase, 'POST', '/fnos-music/queue', { action: 'get', offset: 0, limit: 50 });
    assert.equal(queue.status, 200);
    assert.equal(queue.body.queue.length, 1);
    assert.equal(queue.body.queue[0].id, 'track-1');

    const searchTwo = await call(dshBase, 'GET', `/fnos-music/search?q=${encodeURIComponent('夜曲')}&kind=track`);
    assert.equal(searchTwo.body.items[0].id, 'track-2');
    const addQueue = await call(dshBase, 'POST', '/fnos-music/queue', { action: 'add', trackIds: ['track-2'] });
    assert.equal(addQueue.body.ok, true);
    assert.equal(addQueue.body.queueTotal, 2);
    const playQueued = await call(dshBase, 'POST', '/fnos-music/player', { action: 'playTrack', trackId: 'track-2' });
    assert.equal(playQueued.body.ok, true, JSON.stringify(playQueued.body));
    assert.equal(playQueued.body.player.queueTotal, 2);
    assert.equal(playQueued.body.player.track.id, 'track-2');
    await call(dshBase, 'POST', '/fnos-music/player', { action: 'playTrack', trackId: 'track-1' });

    const lyrics = await call(dshBase, 'GET', '/fnos-music/lyrics?trackId=track-1');
    assert.equal(lyrics.status, 200, JSON.stringify(lyrics.body));
    assert.equal(lyrics.body.ok, true);
    assert.match(lyrics.body.lrc, /Story/);
    assert.equal(lyrics.body.offsetMs, 250);
    assert.equal(lyrics.body.timed, true);
    assert.equal(lyrics.body.lines[0].translation, '故事');
    assert.equal(lyrics.body.lines[1].words[0].text, 'From');
    const lyricsAgain = await call(dshBase, 'GET', '/fnos-music/lyrics?trackId=track-1');
    assert.equal(lyricsAgain.body.offsetMs, 250);
    assert.equal(lyricsAgain.body.lines[0].translation, '故事');

    const cover = await call(dshBase, 'GET', '/fnos-music/cover?coverId=cover-1');
    assert.equal(cover.status, 200);
    assert.equal(cover.headers['content-type'], 'image/png');
    assert.equal(cover.buffer.length > 0, true);

    const stream = await call(dshBase, 'GET', '/fnos-music/stream?guid=track-1', undefined, { range: 'bytes=0-9' });
    assert.equal(stream.status, 206);
    assert.equal(stream.headers['content-range'], 'bytes 0-9/1644');
    assert.equal(stream.buffer.length, 10);

    const favorite = await call(dshBase, 'POST', '/fnos-music/favorite', { action: 'add', trackId: 'track-1' });
    assert.equal(favorite.body.ok, true, JSON.stringify(favorite.body));
    assert.equal(favorite.body.changed, 1);

    const favorites = await call(dshBase, 'GET', '/fnos-music/favorites?limit=20');
    assert.equal(favorites.body.ok, true);
    assert.equal(favorites.body.items[0].id, 'track-2');

    const playlist = await call(dshBase, 'GET', '/fnos-music/playlist?id=pl-1');
    assert.equal(playlist.body.ok, true);
    assert.equal(playlist.body.items.length, 2);

    const playlistList = await call(dshBase, 'GET', '/fnos-music/library/playlists?limit=20');
    assert.equal(playlistList.body.ok, true);
    assert.equal(playlistList.body.items[0].id, 'pl-1');

    const createdPlaylist = await call(dshBase, 'POST', '/fnos-music/playlist/create', { name: 'V2 Test' });
    assert.equal(createdPlaylist.body.ok, true, JSON.stringify(createdPlaylist.body));
    const newPlaylistId = createdPlaylist.body.playlist.id;
    assert.equal(typeof newPlaylistId, 'string');

    const addedTrack = await call(dshBase, 'POST', '/fnos-music/playlist/add', {
      playlistId: newPlaylistId,
      trackIds: ['track-1', 'track-3'],
    });
    assert.equal(addedTrack.body.ok, true, JSON.stringify(addedTrack.body));
    assert.equal(addedTrack.body.added, 2);

    const renamed = await call(dshBase, 'POST', '/fnos-music/playlist/edit', { playlistId: newPlaylistId, name: 'V2 Renamed' });
    assert.equal(renamed.body.ok, true, JSON.stringify(renamed.body));
    assert.equal(renamed.body.name, 'V2 Renamed');

    const newDetail = await call(dshBase, 'GET', `/fnos-music/playlist?id=${newPlaylistId}`);
    assert.equal(newDetail.body.ok, true);
    assert.equal(newDetail.body.items.length, 2);

    const exported = await call(dshBase, 'GET', `/fnos-music/playlist/export?id=${newPlaylistId}&format=json`);
    assert.equal(exported.status, 200, JSON.stringify(exported.body));
    assert.match(exported.headers['content-disposition'], /V2 Renamed\.json/);
    const exportedJson = JSON.parse(exported.buffer.toString('utf8'));
    assert.equal(exportedJson.tracks.length, 2);

    const imported = await call(dshBase, 'POST', '/fnos-music/playlist/import', {
      filename: 'V2 Renamed.json',
      text: JSON.stringify(exportedJson),
    });
    assert.equal(imported.body.ok, true, JSON.stringify(imported.body));
    assert.equal(imported.body.added, 2);

    const smart = await ctx.tools.get('fnos_music_smart_playlist').execute({
      name: 'Instrumental',
      filters: { hasLyric: false },
      limit: 10,
    }, { signal: new AbortController().signal });
    assert.equal(smart.ok, true, JSON.stringify(smart));
    assert.equal(smart.added, 1);

    await ctx.tools.get('fnos_music_play').execute({ trackId: 'track-1' }, { signal: new AbortController().signal });
    const recommend = await ctx.tools.get('fnos_music_recommend').execute({
      seedTrackId: 'track-1',
      limit: 5,
    }, { signal: new AbortController().signal });
    assert.equal(recommend.ok, true, JSON.stringify(recommend));
    assert.equal(recommend.items.some((track) => track.id === 'track-2'), true);

    const removeManyFirst = await call(dshBase, 'POST', '/fnos-music/playlist/remove', {
      playlistId: newPlaylistId,
      trackIds: ['track-1', 'track-3'],
    });
    assert.equal(removeManyFirst.body.ok, false);
    assert.equal(removeManyFirst.body.error.code, 'confirmation_required');
    const removeManySecond = await call(dshBase, 'POST', '/fnos-music/playlist/remove', {
      playlistId: newPlaylistId,
      trackIds: ['track-1', 'track-3'],
      confirmToken: removeManyFirst.body.error.confirmToken,
    });
    assert.equal(removeManySecond.body.ok, true, JSON.stringify(removeManySecond.body));
    assert.equal(removeManySecond.body.removed, 2);

    const wrongArtist = await call(dshBase, 'POST', '/fnos-music/playlist/import', {
      filename: 'wrong.json',
      text: JSON.stringify({ format: 'dsh-fnos-music-playlist', version: 1, name: 'Wrong', tracks: [{ title: '晴天', artist: '五月天' }] }),
    });
    assert.equal(wrongArtist.body.ok, false);
    assert.equal(wrongArtist.body.error.code, 'not_found');

    const importedM3u = await call(dshBase, 'POST', '/fnos-music/playlist/import', {
      filename: 'road.m3u8',
      text: '#EXTM3U\n#PLAYLIST:Road\n#EXTINF:269,周杰伦 - 晴天\nMusic/周杰伦/叶惠美/01-晴天.flac\n',
    });
    assert.equal(importedM3u.body.ok, true, JSON.stringify(importedM3u.body));
    assert.equal(importedM3u.body.added, 1);

    const deleteFirst = await call(dshBase, 'POST', '/fnos-music/playlist/delete', { playlistId: newPlaylistId });
    assert.equal(deleteFirst.body.ok, false);
    assert.equal(deleteFirst.body.error.code, 'confirmation_required');
    assert.equal(typeof deleteFirst.body.error.confirmToken, 'string');
    const deleteSecond = await call(dshBase, 'POST', '/fnos-music/playlist/delete', {
      playlistId: newPlaylistId,
      confirmToken: deleteFirst.body.error.confirmToken,
    });
    assert.equal(deleteSecond.body.ok, true, JSON.stringify(deleteSecond.body));

    const djEnable = await ctx.tools.get('fnos_music_dj').execute({ action: 'enable' }, { signal: new AbortController().signal });
    assert.equal(djEnable.ok, true);
    assert.equal(djEnable.enabled, true);
    await ctx.tools.get('fnos_music_play').execute({ trackId: 'track-1' }, { signal: new AbortController().signal });
    const ended = await call(dshBase, 'POST', '/fnos-music/player', { action: 'ended', clientId: 'auto-dj-client' });
    assert.equal(ended.body.ok, true, JSON.stringify(ended.body));
    assert.equal(ended.body.player.track.id, 'track-2');

    const probe = await call(dshBase, 'POST', '/fnos-music/devices/probe', { id: 'mock-device' });
    assert.equal(probe.body.ok, true);
    assert.equal(probe.body.layers.gateway.ok, true);

    const auto = await call(dshBase, 'POST', '/fnos-music/devices', {
      id: 'auto-device',
      name: 'Auto NAS',
      mode: 'auto',
      fnid: 'mock-nas',
      address: mock.base,
      token: TOKEN,
    });
    assert.equal(auto.body.ok, true, JSON.stringify(auto.body));
    assert.equal(auto.body.device.mode, 'auto');
    assert.equal(auto.body.device.transport, 'auto');
    const switched = await call(dshBase, 'POST', '/fnos-music/devices/switch', { device: 'auto-device' });
    assert.equal(switched.body.ok, true, JSON.stringify(switched.body));
    assert.equal(switched.body.connection.phase, 'online');
    assert.equal(switched.body.connection.via, 'direct');
    await call(dshBase, 'POST', '/fnos-music/devices/switch', { device: 'mock-device' });

    const favoriteTool = ctx.tools.get('fnos_music_favorite');
    const first = await favoriteTool.execute({ action: 'remove_many', trackIds: ['track-1', 'track-2'] }, { signal: new AbortController().signal });
    assert.equal(first.ok, false);
    assert.equal(first.error.code, 'confirmation_required');
    assert.equal(typeof first.error.confirmToken, 'string');
    const second = await favoriteTool.execute({
      action: 'remove_many',
      trackIds: ['track-1', 'track-2'],
      confirmToken: first.error.confirmToken,
    }, { signal: new AbortController().signal });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.changed, 2);

    const legacyAlbumPlay = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', album: 'album-1' });
    assert.equal(legacyAlbumPlay.status, 200, JSON.stringify(legacyAlbumPlay.body));
    assert.equal(legacyAlbumPlay.body.ok, true);
    assert.equal(legacyAlbumPlay.body.added, 2);
    assert.equal(legacyAlbumPlay.body.player.queueTotal, 2);

    const canonicalAlbumPlay = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', albumId: 'album-1' });
    assert.equal(canonicalAlbumPlay.body.ok, true);
    assert.equal(canonicalAlbumPlay.body.added, 2);

    const legacyPlaylistPlay = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', playlist: 'pl-1' });
    assert.equal(legacyPlaylistPlay.body.ok, true);
    assert.equal(legacyPlaylistPlay.body.added, 2);

    const canonicalPlaylistPlay = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', playlistId: 'pl-1' });
    assert.equal(canonicalPlaylistPlay.body.ok, true);
    assert.equal(canonicalPlaylistPlay.body.added, 2);

    const missingAlbumPlay = await call(dshBase, 'POST', '/fnos-music/player', { action: 'play', album: '' });
    assert.equal(missingAlbumPlay.status, 400);
    assert.equal(missingAlbumPlay.body.error.code, 'bad_request');

    process.env.DSH_FNOS_COMPAT_FORCE_MSE = '1';
    resetFfmpegCache();
    try {
      const mseCompat = await call(dshBase, 'GET', '/fnos-music/compat?guid=track-1');
      assert.equal(mseCompat.status, 200, JSON.stringify(mseCompat.body));
      assert.match(String(mseCompat.headers['content-type']), /audio\/mp4/);
      assert.equal(mseCompat.buffer.toString(), 'fmp4');
    } finally {
      delete process.env.DSH_FNOS_COMPAT_FORCE_MSE;
      resetFfmpegCache();
    }

    const sse = await new Promise((resolve, reject) => {
      const request = http.get(`${dshBase}/fnos-music/events`, (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk.toString('utf8');
          if (data.includes('"type":"snapshot"')) {
            resolve({ request, response, data });
          }
        });
        response.on('error', reject);
      });
      request.on('error', reject);
      setTimeout(() => reject(new Error('SSE timed out')), 3000);
    });
    assert.match(sse.data, /"version":1/);
    sse.request.destroy();

    ctx.disposeAll();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(ctx.routes.size, 0);
    assert.equal(ctx.tools.size, 0);
    const cacheRoot = path.join(home, 'cache', 'dsh-fnos-music', 'test-host');
    await assert.rejects(fs.stat(cacheRoot));

    const after = await call(dshBase, 'GET', '/fnos-music/state');
    assert.equal(after.status, 404);
  } finally {
    if (dsh !== undefined) await new Promise((resolve) => dsh.close(resolve));
    await mock.close();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousProfile === undefined) delete process.env.DSH_PROFILE;
    else process.env.DSH_PROFILE = previousProfile;
    await fs.rm(home, { recursive: true, force: true });
  }
});
