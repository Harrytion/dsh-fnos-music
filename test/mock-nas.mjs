/**
 * Mock fnOS Music server used by the unit and integration tests. It implements
 * just enough of /music/api/v1 to exercise auth, paging, search, favorites,
 * playlists, lyrics, covers, and Range audio.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';

export const API = '/music/api/v1';
export const TOKEN = 'test-token';
export const PASSWORD = 'secret';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const WAV = (() => {
  const samples = 800;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
})();

export const TRACKS = [
  {
    guid: 'track-1',
    title: '晴天',
    artists: [{ name: '周杰伦' }],
    album: { guid: 'album-1', name: '叶惠美', coverId: 'cover-1', originalReleaseYear: 2003 },
    duration: 269000,
    trackNo: 1,
    coverId: 'cover-1',
    isFavorite: false,
    hasLyric: true,
    audioSpec: {
      path: 'Music/周杰伦/叶惠美/01-晴天.flac',
      format: 'flac',
      bitDepth: 24,
      sampleRate: 96000,
      bitrate: 1411200,
      codec: 'flac',
      channel: 2,
    },
  },
  {
    guid: 'track-2',
    title: '夜曲',
    artists: [{ name: '周杰伦' }],
    album: { guid: 'album-1', name: '叶惠美', coverId: 'cover-1', originalReleaseYear: 2003 },
    duration: 226000,
    trackNo: 2,
    coverId: 'cover-1',
    isFavorite: true,
    hasLyric: true,
    audioSpec: {
      path: 'Music/周杰伦/叶惠美/02-夜曲.flac',
      format: 'flac',
      bitDepth: 16,
      sampleRate: 44100,
      bitrate: 900000,
      codec: 'flac',
      channel: 2,
    },
  },
  {
    guid: 'track-3',
    title: 'Focus One',
    artists: [{ name: 'Ambient' }],
    album: { guid: 'album-2', name: 'Focus', coverId: 'cover-2', originalReleaseYear: 2024 },
    duration: 300000,
    trackNo: 1,
    coverId: 'cover-2',
    isFavorite: false,
    hasLyric: false,
    audioSpec: {
      path: 'Music/Ambient/Focus/01-focus.flac',
      format: 'flac',
      bitDepth: 24,
      sampleRate: 48000,
      bitrate: 1200000,
      codec: 'flac',
      channel: 2,
    },
  },
];

export const PLAYLISTS = [
  { guid: 'pl-1', name: '深夜电台', coverId: 'cover-1', trackCount: 2 },
];
const PLAYLIST_TRACKS = new Map([['pl-1', ['track-1', 'track-2']]]);

function envelope(data) {
  return JSON.stringify({ code: 0, msg: '', data });
}

function paged(items, url) {
  const page = Number(url.searchParams.get('page') ?? 1);
  const size = Number(url.searchParams.get('size') ?? 50);
  return envelope({ total: items.length, list: items.slice((page - 1) * size, page * size) });
}

export function startMockNas() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const send = (status, body, headers = {}) => {
      response.writeHead(status, headers);
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    };
    const json = (value) => send(200, typeof value === 'string' ? value : JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
    const authorized = String(request.headers.cookie ?? '').includes(`music-token=${TOKEN}`);
    const readBody = () => new Promise((resolve) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        try {
          resolve(JSON.parse(body === '' ? '{}' : body));
        } catch {
          resolve({});
        }
      });
    });

    if (request.method === 'POST' && path === `${API}/user/password-login`) {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const parsed = JSON.parse(body === '' ? '{}' : body);
        const hash = createHash('sha256').update(PASSWORD).digest('hex');
        if (parsed.username === 'test' && parsed.password === hash && /^[0-9a-f]{32}$/.test(String(parsed.deviceId))) {
          json(envelope({ userToken: TOKEN, user: { nickname: '测试用户' } }));
        } else {
          json({ code: 120001, msg: '账号或密码错误', data: null });
        }
      });
      return;
    }

    if (!authorized) {
      send(401, '');
      return;
    }

    if (path === `${API}/user/me`) {
      json(envelope({ user: { username: 'test', nickname: '测试用户' } }));
      return;
    }
    if (path === `${API}/user/logout`) {
      json(envelope(null));
      return;
    }
    if (path === `${API}/track/list`) {
      json(paged(TRACKS, url));
      return;
    }
    if (path === `${API}/album/list`) {
      json(paged([
        { guid: 'album-1', name: '叶惠美', artists: [{ name: '周杰伦' }], coverId: 'cover-1', trackCount: 2, originalReleaseYear: 2003 },
        { guid: 'album-2', name: 'Focus', artists: [{ name: 'Ambient' }], coverId: 'cover-2', trackCount: 1, originalReleaseYear: 2024 },
      ], url));
      return;
    }
    if (path === `${API}/artist/list`) {
      json(paged([
        { guid: 'artist-1', name: '周杰伦', coverId: 'cover-1', albumCount: 1, trackCount: 2 },
        { guid: 'artist-2', name: 'Ambient', coverId: 'cover-2', albumCount: 1, trackCount: 1 },
      ], url));
      return;
    }
    if (path === `${API}/playlist/list`) {
      json(paged(PLAYLISTS.map((entry) => ({ ...entry, trackCount: (PLAYLIST_TRACKS.get(entry.guid) ?? []).length })), url));
      return;
    }
    if (path === `${API}/track/playlist-detail/list`) {
      const guid = url.searchParams.get('playlistGUID');
      const ids = PLAYLIST_TRACKS.get(guid) ?? [];
      const tracks = ids.map((id) => TRACKS.find((track) => track.guid === id)).filter(Boolean);
      json(paged(tracks, url));
      return;
    }
    if (path === `${API}/playlist/detail`) {
      const guid = url.searchParams.get('guid');
      const playlist = PLAYLISTS.find((entry) => entry.guid === guid);
      const ids = PLAYLIST_TRACKS.get(guid) ?? [];
      const tracks = ids.map((id) => TRACKS.find((track) => track.guid === id)).filter(Boolean);
      json(envelope(playlist ? { ...playlist, trackCount: ids.length, tracks } : { guid, name: '', tracks: [] }));
      return;
    }
    if (path === `${API}/playlist/create` || path === `${API}/playlist/edit` || path === `${API}/playlist/delete` || path === `${API}/playlist/add-track` || path === `${API}/playlist/remove-track`) {
      void readBody().then((body) => {
        const guid = String(body.guid ?? '');
        if (path.endsWith('/create')) {
          const playlist = {
            guid: `pl-${PLAYLISTS.length + 1}`,
            name: String(body.name ?? '未命名歌单'),
            coverId: '',
            trackCount: 0,
          };
          PLAYLISTS.push(playlist);
          PLAYLIST_TRACKS.set(playlist.guid, []);
          json(envelope(playlist));
          return;
        }
        const playlist = PLAYLISTS.find((entry) => entry.guid === guid);
        if (playlist === undefined) {
          json({ code: 404, msg: 'playlist not found', data: null });
          return;
        }
        if (path.endsWith('/delete')) {
          PLAYLISTS.splice(PLAYLISTS.indexOf(playlist), 1);
          PLAYLIST_TRACKS.delete(guid);
          json(envelope(null));
          return;
        }
        if (path.endsWith('/edit')) {
          if (typeof body.name === 'string' && body.name.trim() !== '') playlist.name = body.name;
          json(envelope(null));
          return;
        }
        const ids = Array.isArray(body.trackGUIDs) ? body.trackGUIDs.map(String) : [];
        const current = PLAYLIST_TRACKS.get(guid) ?? [];
        if (path.endsWith('/add-track')) PLAYLIST_TRACKS.set(guid, [...current, ...ids]);
        else PLAYLIST_TRACKS.set(guid, current.filter((id) => !ids.includes(id)));
        playlist.trackCount = (PLAYLIST_TRACKS.get(guid) ?? []).length;
        json(envelope(null));
      });
      return;
    }
    if (path === `${API}/album/detail`) {
      const guid = url.searchParams.get('guid');
      // Like current fnOS firmware: metadata only, no tracks. The plugin must
      // use /track/album-detail/list to populate the album view.
      const album = guid === 'album-2'
        ? { guid: 'album-2', name: 'Focus', artists: [{ name: 'Ambient' }], coverId: 'cover-2', trackCount: 1 }
        : { guid: 'album-1', name: '叶惠美', artists: [{ name: '周杰伦' }], coverId: 'cover-1', trackCount: 2 };
      json(envelope(album));
      return;
    }
    if (path === `${API}/track/album-detail/list`) {
      const guid = url.searchParams.get('albumGUID');
      const tracks = TRACKS.filter((track) => track.album?.guid === guid);
      json(paged(tracks, url));
      return;
    }
    if (path === `${API}/track/artist-detail/list`) {
      const guid = url.searchParams.get('artistGUID');
      const names = { 'artist-1': '周杰伦', 'artist-2': 'Ambient' };
      const name = names[guid] ?? '';
      const tracks = TRACKS.filter((track) => track.artists.some((artist) => artist.name === name));
      json(paged(tracks, url));
      return;
    }
    if (path === `${API}/track/metadata`) {
      const guid = url.searchParams.get('guid');
      const track = TRACKS.find((entry) => entry.guid === guid);
      if (track === undefined) {
        json({ code: 404, msg: 'track not found', data: null });
        return;
      }
      json(envelope({ track, audioSpec: track.audioSpec }));
      return;
    }
    if (path === `${API}/search/track`) {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const hits = TRACKS.filter((track) => track.title.toLowerCase().includes(query) || track.artists.some((artist) => artist.name.toLowerCase().includes(query)));
      json(paged(hits, url));
      return;
    }
    if (path === `${API}/search/album`) {
      json(paged([{ guid: 'album-1', name: '叶惠美', artists: [{ name: '周杰伦' }], coverId: 'cover-1', trackCount: 2, originalReleaseYear: 2003 }], url));
      return;
    }
    if (path === `${API}/search/artist`) {
      json(paged([{ guid: 'artist-1', name: '周杰伦', coverId: 'cover-1', albumCount: 1, trackCount: 2 }], url));
      return;
    }
    if (path === `${API}/search/playlist`) {
      json(paged(PLAYLISTS, url));
      return;
    }
    if (path === `${API}/favorite-track/create` || path === `${API}/favorite-track/delete`) {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => json(envelope(null)));
      return;
    }
    if (path === `${API}/favorite-track/list`) {
      json(paged([TRACKS[1]], url));
      return;
    }
    if (path === `${API}/lyric/list`) {
      json(envelope({
        list: [
          { guid: 'lyric-1', content: '[00:01.00]故事的小黄花\n[00:04.00]从出生那年就飘着', isLRC: true, offset: 0 },
          { guid: 'lyric-2', content: '[00:01.00]Story\n[00:01.00]故事\n[00:04.00]<00:04.00>From <00:04.50>birth', isLRC: true, offset: 250 },
        ],
        preferred: 'lyric-2',
      }));
      return;
    }
    if (path === `${API}/static/cover`) {
      send(200, PNG, { 'content-type': 'image/png', 'content-length': String(PNG.length) });
      return;
    }
    if (path === `${API}/track/stream`) {
      const range = String(request.headers.range ?? '');
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match === null) {
        send(200, WAV, {
          'content-type': 'audio/wav',
          'content-length': String(WAV.length),
          'accept-ranges': 'bytes',
        });
        return;
      }
      const start = Number(match[1]);
      const end = match[2] === '' ? WAV.length - 1 : Math.min(Number(match[2]), WAV.length - 1);
      const slice = WAV.subarray(start, end + 1);
      send(206, slice, {
        'content-type': 'audio/wav',
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${end}/${WAV.length}`,
        'accept-ranges': 'bytes',
      });
      return;
    }

    send(404, '');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        server,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export function mockTarget(base) {
  return {
    id: 'mock-device',
    name: 'Mock NAS',
    mode: 'direct',
    address: base,
    token: TOKEN,
    allowSelfSigned: false,
    deviceId: 'a'.repeat(32),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
