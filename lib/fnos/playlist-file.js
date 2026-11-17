import { fail } from '../errors.js';
export const MAX_IMPORT_TRACKS = 500;
export const MAX_EXPORT_TRACKS = 2000;
export const MAX_PLAYLIST_NAME = 120;
function objectOf(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
function text(value) {
    return typeof value === 'string' ? value : '';
}
function numberOf(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
export function sanitizePlaylistName(value, fallback = '导入歌单') {
    const raw = typeof value === 'string' ? value : '';
    const cleaned = raw
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_PLAYLIST_NAME)
        .trim();
    return cleaned === '' ? fallback : cleaned;
}
export function playlistFileName(value, extension) {
    const base = sanitizePlaylistName(value, 'playlist')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\.+$/g, '')
        .trim();
    return `${base === '' ? 'playlist' : base}.${extension}`;
}
function trackOf(rawValue) {
    const raw = objectOf(rawValue);
    const guid = text(raw.guid) || text(raw.id) || text(raw.trackGUID) || text(raw.trackId);
    const title = text(raw.title) || text(raw.name);
    const artist = text(raw.artist) || text(raw.artists);
    const album = text(raw.album);
    const fileName = text(raw.fileName) || text(raw.file_name);
    const path = text(raw.path);
    if (guid === '' && title === '' && fileName === '' && path === '')
        return undefined;
    return {
        ...(guid !== '' ? { guid } : {}),
        title: title || fileName || path,
        artist,
        ...(album !== '' ? { album } : {}),
        ...(numberOf(raw.durationSec) > 0 ? { durationSec: numberOf(raw.durationSec) } : {}),
        ...(fileName !== '' ? { fileName } : {}),
        ...(path !== '' ? { path } : {}),
    };
}
function parseJson(textValue, fallbackName) {
    let parsed;
    try {
        parsed = JSON.parse(textValue);
    }
    catch {
        return fail('bad_request', '歌单 JSON 无法解析');
    }
    const raw = objectOf(parsed);
    if (!Array.isArray(raw.tracks))
        return fail('bad_request', '歌单 JSON 缺少 tracks 数组');
    if (raw.tracks.length > MAX_IMPORT_TRACKS) {
        return fail('bad_request', `单次最多导入 ${MAX_IMPORT_TRACKS} 首歌曲`);
    }
    const tracks = raw.tracks.map(trackOf).filter((track) => track !== undefined);
    if (tracks.length === 0)
        return fail('bad_request', '歌单 JSON 中没有可用曲目');
    const name = sanitizePlaylistName(raw.name, fallbackName);
    return { ok: true, data: { name, tracks } };
}
function parseM3u(textValue, fallbackName) {
    const lines = textValue.replace(/\r\n?/g, '\n').split('\n');
    const tracks = [];
    let playlistName = fallbackName;
    let pending;
    const push = (pathValue) => {
        const path = pathValue.trim().replace(/\\/g, '/');
        if (path === '')
            return;
        const marker = path.split('/').filter((part) => part !== '').pop() ?? path;
        const fileName = marker.replace(/[?#].*$/, '');
        if (pending !== undefined) {
            tracks.push({
                title: pending.title || fileName,
                artist: pending.artist,
                ...(pending.durationSec > 0 ? { durationSec: pending.durationSec } : {}),
                fileName,
                path,
            });
            pending = undefined;
        }
        else {
            tracks.push({ title: fileName, artist: '', fileName, path });
        }
    };
    for (const line of lines) {
        const value = line.trim();
        if (value === '' || value === '#EXTM3U')
            continue;
        if (value.startsWith('#PLAYLIST:')) {
            playlistName = sanitizePlaylistName(value.slice('#PLAYLIST:'.length), fallbackName);
            continue;
        }
        if (value.startsWith('#EXTINF:')) {
            const body = value.slice('#EXTINF:'.length);
            const comma = body.indexOf(',');
            const duration = numberOf(comma >= 0 ? body.slice(0, comma) : body);
            const label = comma >= 0 ? body.slice(comma + 1).trim() : '';
            const dash = label.indexOf(' - ');
            const artist = dash >= 0 ? label.slice(0, dash).trim() : '';
            const title = dash >= 0 ? label.slice(dash + 3).trim() : label;
            pending = { durationSec: Math.round(duration), artist, title };
            continue;
        }
        if (value.startsWith('#'))
            continue;
        push(value);
        if (tracks.length > MAX_IMPORT_TRACKS) {
            return fail('bad_request', `单次最多导入 ${MAX_IMPORT_TRACKS} 首歌曲`);
        }
    }
    if (tracks.length === 0)
        return fail('bad_request', 'M3U8 中没有可用曲目');
    return { ok: true, data: { name: sanitizePlaylistName(playlistName, fallbackName), tracks } };
}
/** Detect JSON vs M3U8 and parse. The route enforces the raw text size limit. */
export function parsePlaylistFile(textValue, fallbackName = '导入歌单') {
    const trimmed = textValue.trim();
    const name = sanitizePlaylistName(fallbackName);
    if (trimmed.startsWith('{'))
        return parseJson(trimmed, name);
    if (trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXTINF:'))
        return parseM3u(trimmed, name);
    return fail('bad_request', '无法识别的歌单文件（支持插件 JSON 或 M3U8）');
}
function exportTrack(track) {
    return {
        guid: track.id,
        title: track.title,
        artist: track.artist,
        ...(track.album !== '' ? { album: track.album } : {}),
        ...(track.durationSec > 0 ? { durationSec: track.durationSec } : {}),
        ...(track.fileName !== '' ? { fileName: track.fileName } : {}),
    };
}
export function toJsonPlaylist(name, tracks, truncated = false) {
    return {
        format: 'dsh-fnos-music-playlist',
        version: 1,
        name: sanitizePlaylistName(name),
        exportedAt: new Date().toISOString(),
        ...(truncated ? { truncated: true } : {}),
        tracks: tracks.slice(0, MAX_EXPORT_TRACKS).map(exportTrack),
    };
}
export function toM3u8Playlist(name, tracks, truncated = false) {
    const lines = ['#EXTM3U', `#PLAYLIST:${sanitizePlaylistName(name)}`, ...(truncated ? ['# dsh-fnos-music: truncated at 2000 tracks'] : [])];
    for (const track of tracks.slice(0, MAX_EXPORT_TRACKS)) {
        const label = track.artist !== '' ? `${track.artist} - ${track.title}` : track.title;
        lines.push(`#EXTINF:${track.durationSec},${label.replace(/\r?\n/g, ' ')}`);
        lines.push(track.folder !== '' ? `${track.folder}/${track.fileName || track.title}` : (track.fileName || track.title));
    }
    return `${lines.join('\n')}\n`;
}
