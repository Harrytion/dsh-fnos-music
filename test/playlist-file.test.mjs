import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePlaylistFile,
  playlistFileName,
  sanitizePlaylistName,
  toJsonPlaylist,
  toM3u8Playlist,
} from '../lib/fnos/playlist-file.js';

function track(overrides = {}) {
  return {
    id: 'g1', title: 'Song', artist: 'Artist', album: 'Album', albumId: 'a1',
    year: 2020, durationSec: 180, coverId: '', quality: 'lossless', bitrateKbps: 900,
    format: 'flac', bitDepth: 16, sampleRate: 44100, favorite: false, folder: 'Music',
    fileName: 'Song.flac', genre: 'Rock', hasLyric: true, ...overrides,
  };
}

test('parses plugin JSON playlists', () => {
  const parsed = parsePlaylistFile(JSON.stringify({
    format: 'dsh-fnos-music-playlist', version: 1, name: 'Focus',
    tracks: [{ guid: 'g1', title: 'Song', artist: 'Artist', durationSec: 180 }],
  }), 'fallback');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.name, 'Focus');
  assert.equal(parsed.data.tracks[0].guid, 'g1');
});

test('parses M3U8 with EXTINF metadata and paths', () => {
  const parsed = parsePlaylistFile('#EXTM3U\n#PLAYLIST:Road\n#EXTINF:180,Artist - Song\nMusic/Song.flac\n', 'fallback');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.name, 'Road');
  assert.equal(parsed.data.tracks[0].artist, 'Artist');
  assert.equal(parsed.data.tracks[0].title, 'Song');
  assert.equal(parsed.data.tracks[0].fileName, 'Song.flac');
});

test('rejects bad/oversized/empty playlist files', () => {
  assert.equal(parsePlaylistFile('not a playlist').ok, false);
  assert.equal(parsePlaylistFile('{}').ok, false);
  assert.equal(parsePlaylistFile(JSON.stringify({ tracks: Array.from({ length: 501 }, () => ({ guid: 'x', title: 't', artist: '' })) })).ok, false);
});

test('serializes JSON and M3U8 and sanitizes names', () => {
  const json = toJsonPlaylist('Focus/List', [track()]);
  assert.equal(json.format, 'dsh-fnos-music-playlist');
  assert.equal(json.tracks[0].guid, 'g1');
  const m3u = toM3u8Playlist('Focus', [track()]);
  assert.match(m3u, /#EXTINF:180,Artist - Song/);
  assert.match(m3u, /Music\/Song\.flac/);
  assert.equal(playlistFileName('a/b:c', 'json'), 'a_b_c.json');
  assert.equal(sanitizePlaylistName('  \u0000x  '), 'x');
});
