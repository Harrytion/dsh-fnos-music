import { fail } from '../errors.js';
import { normalizeAlbum, normalizeArtist, normalizePlaylist, normalizeTrack, numberOf, text, } from './normalize.js';
function recordOf(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
function listOf(data) {
    const record = recordOf(data);
    if (Array.isArray(record.list))
        return record.list;
    if (Array.isArray(record.tracks))
        return record.tracks;
    if (Array.isArray(record.trackList))
        return record.trackList;
    if (Array.isArray(data))
        return data;
    return [];
}
function totalOf(data, fallback) {
    const total = numberOf(recordOf(data).total);
    return total > 0 ? total : fallback;
}
export class FnosApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    get base() {
        return this.transport.base;
    }
    async me() {
        const result = await this.transport.request('/user/me');
        if (result.ok !== true)
            return result;
        return { ok: true, data: recordOf(result.data) };
    }
    async login(username, password) {
        return this.transport.login(username, password);
    }
    async page(path, page, size, normalize) {
        const result = await this.transport.request(path, {
            query: { page, size },
        });
        if (result.ok !== true)
            return result;
        const items = listOf(result.data)
            .map(normalize)
            .filter((item) => {
            if (item === null || typeof item !== 'object')
                return false;
            const id = item.id;
            return typeof id === 'string' && id !== '';
        });
        return {
            ok: true,
            data: { total: totalOf(result.data, items.length), items },
        };
    }
    listTracks(page, size) {
        return this.page('/track/list', page, size, normalizeTrack);
    }
    listAlbums(page, size) {
        return this.page('/album/list', page, size, normalizeAlbum);
    }
    listArtists(page, size) {
        return this.page('/artist/list', page, size, normalizeArtist);
    }
    listPlaylists(page, size) {
        return this.page('/playlist/list', page, size, normalizePlaylist);
    }
    async search(kind, query, page, size) {
        const path = `/search/${kind}`;
        const result = await this.transport.request(path, {
            query: { q: query, page, size },
        });
        if (result.ok !== true)
            return result;
        const rawItems = listOf(result.data);
        const total = totalOf(result.data, rawItems.length);
        if (kind === 'track') {
            return { ok: true, data: { kind, total, items: rawItems.map(normalizeTrack).filter((item) => item.id !== '') } };
        }
        if (kind === 'album') {
            return { ok: true, data: { kind, total, items: rawItems.map(normalizeAlbum).filter((item) => item.id !== '') } };
        }
        if (kind === 'artist') {
            return { ok: true, data: { kind, total, items: rawItems.map(normalizeArtist).filter((item) => item.id !== '') } };
        }
        return { ok: true, data: { kind, total, items: rawItems.map(normalizePlaylist).filter((item) => item.id !== '') } };
    }
    /** Tracks of one playlist. New firmware uses /track/playlist-detail/list. */
    playlistTracks(id, page = 1, size = 300) {
        return this.transport.request('/track/playlist-detail/list', {
            query: { playlistGUID: id, page, size },
        }).then((result) => {
            if (result.ok !== true)
                return result;
            const items = listOf(result.data).map(normalizeTrack).filter((item) => item.id !== '');
            return {
                ok: true,
                data: { total: totalOf(result.data, items.length), items },
            };
        });
    }
    async playlistDetail(id) {
        const result = await this.transport.request('/track/playlist-detail/list', {
            query: { playlistGUID: id, page: 1, size: 300 },
        });
        if (result.ok === true) {
            const data = recordOf(result.data);
            const items = listOf(data).map(normalizeTrack).filter((item) => item.id !== '');
            return {
                ok: true,
                data: { total: totalOf(data, items.length), items },
            };
        }
        // Older firmware: the metadata endpoint also returned tracks.
        if (!['not_found', 'unsupported', 'business', 'protocol'].includes(result.error.code))
            return result;
        const legacy = await this.transport.request('/playlist/detail', {
            query: { guid: id },
        });
        if (legacy.ok !== true)
            return legacy;
        const data = recordOf(legacy.data);
        const items = listOf(data).map(normalizeTrack).filter((item) => item.id !== '');
        return {
            ok: true,
            data: {
                ...(text(recordOf(data.playlist).guid) !== '' || text(recordOf(data).guid) !== '' ? { playlist: normalizePlaylist(data.playlist ?? data) } : {}),
                total: totalOf(data, items.length),
                items,
            },
        };
    }
    /** Read every page of a playlist for export, bounded by `max`. */
    async playlistTracksAll(id, max = 2000) {
        const items = [];
        let total = 0;
        for (let page = 1; page <= 20; page += 1) {
            const result = await this.playlistTracks(id, page, 300);
            if (result.ok !== true) {
                if (items.length > 0)
                    break;
                return result;
            }
            total = result.data.total || total;
            items.push(...result.data.items);
            if (items.length >= max || result.data.items.length < 300 || (total > 0 && items.length >= total))
                break;
        }
        const sliced = items.slice(0, max);
        return {
            ok: true,
            data: { items: sliced, total: Math.max(total, items.length), truncated: items.length >= max && total > max },
        };
    }
    async createPlaylist(name) {
        const result = await this.transport.request('/playlist/create', {
            method: 'POST',
            body: { name },
        });
        if (result.ok !== true)
            return result;
        const playlist = normalizePlaylist(result.data);
        if (playlist.id === '')
            return apiFailure('Created playlist has no guid');
        return { ok: true, data: playlist };
    }
    async editPlaylist(id, name) {
        const result = await this.transport.request('/playlist/edit', {
            method: 'POST',
            body: { guid: id, name },
        });
        return result.ok === true ? { ok: true, data: null } : result;
    }
    async deletePlaylist(id) {
        const result = await this.transport.request('/playlist/delete', {
            method: 'POST',
            body: { guid: id },
        });
        return result.ok === true ? { ok: true, data: null } : result;
    }
    async addPlaylistTracks(id, trackGUIDs) {
        const result = await this.transport.request('/playlist/add-track', {
            method: 'POST',
            body: { guid: id, trackGUIDs },
        });
        return result.ok === true ? { ok: true, data: null } : result;
    }
    async removePlaylistTracks(id, trackGUIDs) {
        const result = await this.transport.request('/playlist/remove-track', {
            method: 'POST',
            body: { guid: id, trackGUIDs },
        });
        return result.ok === true ? { ok: true, data: null } : result;
    }
    async albumDetail(id) {
        const result = await this.transport.request('/album/detail', {
            query: { guid: id },
        });
        if (result.ok !== true)
            return result;
        const data = recordOf(result.data);
        const rawTracks = listOf(data);
        return {
            ok: true,
            data: {
                album: normalizeAlbum(data),
                tracks: rawTracks.map(normalizeTrack).filter((item) => item.id !== ''),
            },
        };
    }
    async favorites(page, size) {
        const result = await this.transport.request('/favorite-track/list', {
            query: { page, size },
        });
        if (result.ok !== true)
            return result;
        const items = listOf(result.data).map(normalizeTrack).filter((item) => item.id !== '');
        return {
            ok: true,
            data: {
                total: totalOf(result.data, items.length),
                items: items.map((item) => ({ ...item, favorite: true })),
            },
        };
    }
    async favorite(trackId, on) {
        const result = await this.transport.request(on ? '/favorite-track/create' : '/favorite-track/delete', { method: 'POST', body: { trackGUID: trackId } });
        if (result.ok !== true)
            return result;
        return { ok: true, data: null };
    }
    async lyrics(trackId) {
        const result = await this.transport.request('/lyric/list', {
            query: { trackGUID: trackId },
        });
        if (result.ok !== true)
            return result;
        const data = recordOf(result.data);
        const rawList = Array.isArray(data.list) ? data.list : [];
        // fnOS `preferred` is a lyric GUID, not the object itself.
        const preferred = text(data.preferred);
        const entries = rawList.map((entry) => {
            if (typeof entry === 'string')
                return { guid: '', text: entry, offsetMs: 0, isLRC: true };
            const record = recordOf(entry);
            const textValue = text(record.lyric)
                || text(record.lyrics)
                || text(record.content)
                || text(record.lrc)
                || text(record.text);
            return {
                guid: text(record.guid) || text(record.id),
                text: textValue,
                offsetMs: numberOf(record.offset),
                isLRC: record.isLRC !== false,
            };
        }).filter((entry) => entry.text !== '');
        const chosen = entries.find((entry) => entry.guid === preferred && preferred !== '') ?? entries[0];
        if (chosen === undefined) {
            const direct = text(data.lyric) || text(data.lrc) || text(data.content);
            return {
                ok: true,
                data: { lrc: direct, offsetMs: numberOf(data.offset), isLRC: data.isLRC !== false, preferredGuid: preferred },
            };
        }
        return {
            ok: true,
            data: { lrc: chosen.text, offsetMs: chosen.offsetMs, isLRC: chosen.isLRC, preferredGuid: preferred },
        };
    }
    async logout() {
        await this.transport.request('/user/logout', { method: 'POST', body: {} });
    }
}
export function apiFailure(message, code = 'protocol') {
    return fail(code, message);
}
