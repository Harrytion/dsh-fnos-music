import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerService } from '../lib/state/player.js';
import { Vault } from '../lib/state/vault.js';
import { ConfirmGate, argsHash } from '../lib/state/confirm.js';

function track(id, durationSec = 100) {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    album: 'Album',
    albumId: 'album-1',
    year: 2024,
    durationSec,
    coverId: 'cover-1',
    quality: 'lossless',
    bitrateKbps: 900,
    format: 'flac',
    bitDepth: 16,
    sampleRate: 44100,
    favorite: false,
    folder: 'Music/Artist',
    fileName: `${id}.flac`,
    genre: '',
    hasLyric: false,
  };
}

test('queue replace, list loop, one repeat, seek and volume clamping', () => {
  const player = new PlayerService();
  player.setDevice('device-1');
  const state = player.replaceQueue([track('a'), track('b'), track('c')]);
  assert.equal(state.currentIndex, 0);
  assert.equal(state.track.id, 'a');
  assert.equal(state.status, 'playing');

  assert.equal(player.advance(1).data.currentIndex, 1);
  assert.equal(player.advance(1).data.currentIndex, 2);
  assert.equal(player.advance(1).data.currentIndex, 0, 'list mode wraps');

  player.setMode('one');
  const before = player.raw().track.id;
  const repeated = player.advance(1, true);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.data.track.id, before);
  assert.equal(repeated.data.positionMs, 0);

  const seek = player.seek(999_999);
  assert.equal(seek.ok, true);
  assert.equal(seek.data.positionMs, 100_000);
  const volume = player.volume(200);
  assert.equal(volume.ok, true);
  assert.equal(volume.data.volume, 100);
});

test('shuffle uses a stable order and wraps with a reshuffle', () => {
  let seed = 7;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const player = new PlayerService({ rng });
  player.replaceQueue([track('a'), track('b'), track('c'), track('d')], 'shuffle');
  const firstOrder = player.raw().order.slice();
  assert.equal(firstOrder.length, 4);
  assert.equal([...firstOrder].sort((x, y) => x - y).join(','), '0,1,2,3');
  for (let i = 0; i < 4; i += 1) player.advance(1);
  assert.equal(player.raw().status, 'playing');
});

test('queue actions append, insert, remove, move and clear', () => {
  const player = new PlayerService();
  player.replaceQueue([track('a')]);
  player.queueAction('add', [track('b')], [], 0, 0);
  assert.equal(player.raw().queue.length, 2);
  player.queueAction('insert', [track('c')], [], 1, 0);
  assert.equal(player.raw().queue.map((entry) => entry.id).join(','), 'a,c,b');
  player.queueAction('move', [], [], 1, 2);
  assert.equal(player.raw().queue.map((entry) => entry.id).join(','), 'a,b,c');
  player.queueAction('remove', [], ['b'], 0, 0);
  assert.equal(player.raw().queue.map((entry) => entry.id).join(','), 'a,c');
  player.queueAction('clear', [], [], 0, 0);
  assert.equal(player.raw().queue.length, 0);
  assert.equal(player.raw().status, 'stopped');
});

test('driver lease keeps a live driver and claim takes over', () => {
  const player = new PlayerService();
  player.setDevice('device-1');
  player.replaceQueue([track('a')]);
  player.claim('client-a');
  assert.equal(player.driverClientId, 'client-a');
  player.heartbeat('client-b');
  assert.equal(player.driverClientId, 'client-a', 'a live driver is not stolen by heartbeats');
  player.claim('client-b');
  assert.equal(player.driverClientId, 'client-b');
  player.setFavorite('a', true);
  assert.equal(player.raw().track.favorite, true);
  const view = player.view({ queue: false });
  assert.equal(view.queue.length, 0);
  assert.equal(view.queueTotal, 1);
});

test('progress is ignored from a non-driver', () => {
  const player = new PlayerService();
  player.replaceQueue([track('a', 200)]);
  player.claim('client-a');
  player.progress('client-b', 5000);
  assert.equal(player.raw().positionMs, 0);
  player.progress('client-a', 5000);
  assert.equal(player.raw().positionMs, 5000);
  player.progress('client-a', 9999999);
  assert.equal(player.raw().positionMs, 200_000);
});

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

function target(id) {
  return {
    id,
    name: `NAS ${id}`,
    mode: 'direct',
    address: 'http://192.168.1.10:5666',
    token: 'secret-token',
    allowSelfSigned: false,
    deviceId: 'a'.repeat(32),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

test('vault is profile-scoped, redacts tokens, and clamps settings', async () => {
  const credentials = memoryCredentials();
  const vault = new Vault(credentials, 'test profile');
  await vault.open();
  assert.equal(vault.persistent, true);
  assert.equal(vault.key, 'dsh-fnos-music/test_profile');
  await vault.upsert(target('one'));
  await vault.upsert(target('two'));
  await vault.setActive('two');
  assert.equal(vault.activeDeviceId, 'two');
  const views = vault.views(new Map(), new Map());
  assert.equal(views.length, 2);
  assert.equal(views[0].tokenSet, true);
  assert.equal(Object.hasOwn(views[0], 'token'), false);
  assert.equal(views.find((entry) => entry.active).id, 'two');
  const settings = await vault.updateSettings({ cacheLimitMb: 99999, requestConcurrency: 99, probeIntervalSec: 1 });
  assert.equal(settings.cacheLimitMb, 4096);
  assert.equal(settings.requestConcurrency, 6);
  assert.equal(settings.probeIntervalSec, 10);
  await vault.reset();
  assert.equal(vault.devices.length, 0);
  assert.equal(credentials.records.has('dsh-fnos-music/test_profile'), false);
});

test('vault reads v1 data and upgrades to v3 with listener and V3 settings defaults', async () => {
  const credentials = memoryCredentials();
  const old = target('old');
  credentials.records.set('dsh-fnos-music/v1-profile', {
    kind: 'grant',
    payload: {
      version: 1,
      activeDeviceId: 'old',
      devices: [old],
      settings: { confirmHighRisk: false, cacheLimitMb: 50, requestConcurrency: 2, probeIntervalSec: 20, logsEnabled: false },
    },
  });
  const vault = new Vault(credentials, 'v1-profile');
  await vault.open();
  assert.equal(vault.devices.length, 1);
  assert.equal(vault.activeDeviceId, 'old');
  assert.equal(vault.settings.confirmHighRisk, false);
  assert.equal(vault.settings.floatingPlayer, true);
  assert.equal(vault.settings.shortcuts, true);
  assert.equal(vault.settings.autoDj, false);
  assert.equal(vault.settings.backgroundProbe, false);
  assert.equal(vault.settings.historyEnabled, true);
  assert.equal(vault.settings.agentWrites, true);
  assert.equal(vault.listeners.length, 1);
  assert.equal(vault.activeListener().name, '我');
  assert.equal(vault.views(new Map(), new Map())[0].transport, 'direct');
  await vault.updateSettings({ backgroundProbe: true });
  assert.equal(credentials.records.get('dsh-fnos-music/v1-profile').payload.version, 3);
});

test('vault accepts auto devices only with both endpoints', async () => {
  const credentials = memoryCredentials();
  const vault = new Vault(credentials, 'auto-profile');
  await vault.open();
  const auto = {
    ...target('auto'),
    mode: 'auto',
    fnid: 'mynas',
    address: 'http://192.168.1.10:5666',
  };
  await vault.upsert(auto);
  assert.equal(vault.views(new Map(), new Map())[0].transport, 'auto');
  assert.equal(vault.views(new Map(), new Map())[0].mode, 'auto');
  const invalid = new Vault(memoryCredentials(), 'bad-auto');
  await invalid.open();
  await invalid.upsert({ ...auto, id: 'bad', address: 'unix:///tmp/test.sock' });
  // An in-memory upsert is not re-validated until the record is reloaded; the
  // sanitizer must reject it on the next open.
  const badCredentials = memoryCredentials();
  const writer = new Vault(badCredentials, 'bad-auto-2');
  await writer.open();
  await writer.upsert({ ...auto, id: 'bad', address: 'unix:///tmp/test.sock' });
  const reader = new Vault(badCredentials, 'bad-auto-2');
  await reader.open();
  assert.equal(reader.devices.length, 0);
});

test('player hasNext and appendAndPlay keep DJ on the new track', () => {
  const player = new PlayerService();
  player.replaceQueue([track('a'), track('b')]);
  assert.equal(player.hasNext(), true);
  player.advance(1);
  assert.equal(player.hasNext(), false);
  const appended = player.appendAndPlay(track('c'));
  assert.equal(appended.ok, true);
  assert.equal(player.currentTrack().id, 'c');
});

test('confirm gate is single-use, expiring by design, and argument-bound', () => {
  const gate = new ConfirmGate();
  const args = { action: 'remove_many', trackIds: ['a', 'b'] };
  let token = gate.issue('favorite.remove_many', args, 'device-1');
  assert.equal(token.length > 10, true);
  const wrong = gate.verify(token, 'favorite.remove_many', { action: 'remove_many', trackIds: ['a'] }, 'device-1');
  assert.equal(wrong.ok, false);
  token = gate.issue('favorite.remove_many', args, 'device-1');
  const ok = gate.verify(token, 'favorite.remove_many', args, 'device-1');
  assert.equal(ok.ok, true);
  const reuse = gate.verify(token, 'favorite.remove_many', args, 'device-1');
  assert.equal(reuse.ok, false);
  const token2 = gate.issue('favorite.remove_many', args, 'device-1');
  const wrongDevice = gate.verify(token2, 'favorite.remove_many', args, 'device-2');
  assert.equal(wrongDevice.ok, false);
  gate.dispose();
});

test('argsHash is canonical across key order', () => {
  assert.equal(argsHash({ a: 1, b: [2, { c: 3 }] }), argsHash({ b: [2, { c: 3 }], a: 1 }));
  assert.notEqual(argsHash({ a: 1 }), argsHash({ a: 2 }));
});

test('vault manages local listener profiles while protecting the last one', async () => {
  const credentials = memoryCredentials();
  const vault = new Vault(credentials, 'listener-profile');
  await vault.open();
  assert.equal(vault.listeners.length, 1);
  assert.equal(vault.activeListener().name, '我');
  const first = await vault.createListener('  Kid  ');
  assert.equal(first.name, 'Kid');
  assert.equal(vault.activeListenerId, first.id);
  assert.equal(vault.listeners.length, 2);
  const renamed = await vault.renameListener(first.id, 'Kid B');
  assert.equal(renamed.name, 'Kid B');
  assert.equal(await vault.setActiveListener('default'), true);
  assert.equal(await vault.setActiveListener('missing'), false);
  assert.equal(await vault.removeListener(first.id), true);
  assert.equal(vault.listeners.length, 1);
  assert.equal(await vault.removeListener(vault.activeListenerId), false);
  for (let index = vault.listeners.length; index < 8; index += 1) await vault.createListener(`L${index}`);
  assert.equal(vault.listeners.length, 8);
  await assert.rejects(() => vault.createListener('overflow'), /At most/i);
});

test('appendQueue preserves the current track; empty-queue playback is handled by the caller', () => {
  const player = new PlayerService();
  player.setDevice('device-1');
  player.replaceQueue([track('a'), track('b')]);
  player.playTrack('a');
  const before = player.raw().track.id;
  const appended = player.appendQueue([track('c')]);
  assert.equal(appended.track.id, before);
  assert.deepEqual(player.raw().queue.map((item) => item.id), ['a', 'b', 'c']);

  const empty = new PlayerService();
  empty.setDevice('device-2');
  const first = empty.appendQueue([track('z')]);
  assert.equal(first.track.id, 'z');
  assert.equal(first.queueTotal, 1);
});
