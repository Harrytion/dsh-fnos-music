import { fail, makeError } from '../errors.js';
import { withFavorite } from '../fnos/normalize.js';
const TRACK_PAGE_SIZE = 50;
const LIST_PAGE_SIZE = 100;
const CACHE_TTL_MS = 60_000;
const SUMMARY_TTL_MS = 5 * 60_000;
const LYRICS_TTL_MS = 10 * 60_000;
const MAX_SCAN_PAGES = 10;
const MAX_PLAYLIST_TRACKS = 2000;
function clamp(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, value));
}
function older(at, ttl) {
    return Date.now() - at > ttl;
}
function matchesFilters(track, params) {
    const artist = (params.artist ?? '').trim().toLowerCase();
    const album = (params.album ?? '').trim().toLowerCase();
    const folder = (params.folder ?? '').trim().toLowerCase();
    const genre = (params.genre ?? '').trim().toLowerCase();
    if (artist !== '' && !track.artist.toLowerCase().includes(artist))
        return false;
    if (album !== '' && !track.album.toLowerCase().includes(album))
        return false;
    if (folder !== '' && !track.folder.toLowerCase().includes(folder))
        return false;
    if (genre !== '' && !track.genre.toLowerCase().includes(genre))
        return false;
    if (params.year !== undefined && params.year > 0 && track.year !== params.year)
        return false;
    if (params.lossless === true && track.quality === 'standard')
        return false;
    if (params.hasLyric !== undefined && track.hasLyric !== params.hasLyric)
        return false;
    if (params.minDurationSec !== undefined && params.minDurationSec > 0 && track.durationSec < params.minDurationSec)
        return false;
    if (params.maxDurationSec !== undefined && params.maxDurationSec > 0 && track.durationSec > params.maxDurationSec)
        return false;
    return true;
}
function matchesSearchText(track, query) {
    const needle = query.trim().toLowerCase();
    if (needle === '')
        return true;
    return track.title.toLowerCase().includes(needle)
        || track.artist.toLowerCase().includes(needle)
        || track.album.toLowerCase().includes(needle)
        || track.folder.toLowerCase().includes(needle)
        || track.genre.toLowerCase().includes(needle);
}
export class LibraryService {
    deps;
    trackPages = new Map();
    favoritePages = new Map();
    albumPage = new Map();
    artistPage = new Map();
    playlistPage = new Map();
    playlistCache = new Map();
    lyricsCache = new Map();
    tracksById = new Map();
    summaryCache;
    constructor(deps) {
        this.deps = deps;
    }
    api() {
        return this.deps.api();
    }
    async run(task, signal) {
        const api = this.api();
        if (api === null)
            return fail('no_active_device', 'No active device');
        try {
            return await this.deps.limiter.run(() => task(api), signal);
        }
        catch (error) {
            const candidate = error;
            if (candidate.name === 'AbortError')
                return fail('cancelled', 'Request cancelled');
            return {
                ok: false,
                error: makeError('network', candidate.message ?? 'Library request failed'),
            };
        }
    }
    remember(track) {
        const cached = this.tracksById.get(track.id);
        const value = cached === undefined ? track : { ...track, favorite: cached.favorite || track.favorite };
        this.tracksById.set(value.id, value);
        return value;
    }
    async trackPage(page, signal) {
        const cached = this.trackPages.get(page);
        if (cached !== undefined && !older(cached.at, CACHE_TTL_MS))
            return { ok: true, data: cached.value };
        const result = await this.run((api) => api.listTracks(page, TRACK_PAGE_SIZE), signal);
        if (result.ok !== true)
            return result;
        const items = result.data.items.map((track) => this.remember(track));
        const value = { total: result.data.total, items };
        this.trackPages.set(page, { at: Date.now(), value });
        return { ok: true, data: value };
    }
    async listTracks(offsetInput, limitInput, signal) {
        const offset = clamp(offsetInput, 0, 1_000_000);
        const limit = clamp(limitInput, 1, 100);
        const signedOffset = offset % TRACK_PAGE_SIZE;
        const firstPage = Math.floor(offset / TRACK_PAGE_SIZE) + 1;
        const pagesNeeded = signedOffset + limit > TRACK_PAGE_SIZE ? 2 : 1;
        const items = [];
        let total = 0;
        for (let index = 0; index < pagesNeeded; index += 1) {
            const page = await this.trackPage(firstPage + index, signal);
            if (page.ok !== true)
                return page;
            total = page.data.total;
            const start = index === 0 ? signedOffset : 0;
            items.push(...page.data.items.slice(start));
            if (page.data.items.length < TRACK_PAGE_SIZE)
                break;
        }
        const pageItems = items.slice(0, limit);
        return {
            ok: true,
            data: {
                total,
                items: pageItems,
                offset,
                limit,
                hasMore: offset + pageItems.length < total,
            },
        };
    }
    async listPage(cache, page, loader, signal) {
        const cached = cache.get(page);
        if (cached !== undefined && !older(cached.at, CACHE_TTL_MS))
            return { ok: true, data: cached.value };
        const result = await this.run(loader, signal);
        if (result.ok !== true)
            return result;
        cache.set(page, { at: Date.now(), value: result.data });
        return result;
    }
    async listAlbums(offset, limit, signal) {
        const pageNumber = Math.floor(clamp(offset, 0, 100_000) / LIST_PAGE_SIZE) + 1;
        const result = await this.listPage(this.albumPage, pageNumber, (api) => api.listAlbums(pageNumber, LIST_PAGE_SIZE), signal);
        if (result.ok !== true)
            return result;
        const items = result.data.items.slice(0, clamp(limit, 1, 100));
        return { ok: true, data: { total: result.data.total, items, hasMore: items.length < result.data.items.length || result.data.total > offset + items.length } };
    }
    async listArtists(offset, limit, signal) {
        const pageNumber = Math.floor(clamp(offset, 0, 100_000) / LIST_PAGE_SIZE) + 1;
        const result = await this.listPage(this.artistPage, pageNumber, (api) => api.listArtists(pageNumber, LIST_PAGE_SIZE), signal);
        if (result.ok !== true)
            return result;
        const items = result.data.items.slice(0, clamp(limit, 1, 100));
        return { ok: true, data: { total: result.data.total, items, hasMore: items.length < result.data.items.length || result.data.total > offset + items.length } };
    }
    async listPlaylists(offset, limit, signal) {
        const pageNumber = Math.floor(clamp(offset, 0, 100_000) / LIST_PAGE_SIZE) + 1;
        const result = await this.listPage(this.playlistPage, pageNumber, (api) => api.listPlaylists(pageNumber, LIST_PAGE_SIZE), signal);
        if (result.ok !== true)
            return result;
        const items = result.data.items.slice(0, clamp(limit, 1, 100));
        return { ok: true, data: { total: result.data.total, items, hasMore: items.length < result.data.items.length || result.data.total > offset + items.length } };
    }
    async scanTracks(params, offset, limit, signal) {
        const matched = [];
        let scanned = 0;
        let serverTotal = 0;
        let pages = 0;
        const folderNeedle = (params.kind === 'folder' ? params.query ?? '' : params.folder ?? '').trim().toLowerCase();
        for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
            const result = await this.trackPage(page, signal);
            if (result.ok !== true) {
                if (matched.length > 0)
                    break;
                return result;
            }
            serverTotal = result.data.total;
            scanned += result.data.items.length;
            pages = page;
            for (const track of result.data.items) {
                if (folderNeedle !== '' && !track.folder.toLowerCase().includes(folderNeedle))
                    continue;
                if (!matchesFilters(track, params))
                    continue;
                if (params.kind === 'track' && params.query !== undefined && params.query.trim() !== '' && !matchesSearchText(track, params.query))
                    continue;
                matched.push(track);
            }
            if (result.data.items.length < TRACK_PAGE_SIZE)
                break;
            if (matched.length >= offset + limit && serverTotal <= scanned)
                break;
            if (matched.length >= offset + limit + 200)
                break;
        }
        const items = matched.slice(offset, offset + limit);
        const truncated = pages >= MAX_SCAN_PAGES && scanned < serverTotal;
        return {
            ok: true,
            data: {
                kind: params.kind ?? 'track',
                total: matched.length,
                items,
                offset,
                limit,
                hasMore: matched.length > offset + items.length || truncated || scanned < serverTotal,
                scanned,
                truncated,
            },
        };
    }
    async search(params) {
        const kind = params.kind ?? 'track';
        const offset = clamp(params.offset ?? 0, 0, 100_000);
        const limit = clamp(params.limit ?? 20, 1, 50);
        const query = (params.query ?? '').trim();
        const hasFilters = (params.artist ?? '') !== '' || (params.album ?? '') !== '' || (params.folder ?? '') !== ''
            || (params.genre ?? '') !== '' || (params.year ?? 0) > 0 || params.lossless === true
            || params.hasLyric !== undefined || (params.minDurationSec ?? 0) > 0 || (params.maxDurationSec ?? 0) > 0;
        if (kind === 'folder' || hasFilters) {
            return this.scanTracks({ ...params, kind: kind === 'folder' ? 'folder' : 'track' }, offset, limit, params.signal);
        }
        if (query === '' && (kind === 'artist' || kind === 'album' || kind === 'playlist')) {
            if (kind === 'artist') {
                const result = await this.listArtists(offset, limit, params.signal);
                if (result.ok !== true)
                    return result;
                return { ok: true, data: { kind, offset, limit, ...result.data } };
            }
            if (kind === 'album') {
                const result = await this.listAlbums(offset, limit, params.signal);
                if (result.ok !== true)
                    return result;
                return { ok: true, data: { kind, offset, limit, ...result.data } };
            }
            const result = await this.listPlaylists(offset, limit, params.signal);
            if (result.ok !== true)
                return result;
            return { ok: true, data: { kind, offset, limit, ...result.data } };
        }
        if (query === '') {
            const page = Math.floor(offset / TRACK_PAGE_SIZE) + 1;
            const result = await this.trackPage(page, params.signal);
            if (result.ok !== true)
                return result;
            const items = result.data.items.slice(offset % TRACK_PAGE_SIZE, offset % TRACK_PAGE_SIZE + limit);
            return {
                ok: true,
                data: {
                    kind: 'track',
                    total: result.data.total,
                    items,
                    offset,
                    limit,
                    hasMore: offset + items.length < result.data.total,
                },
            };
        }
        if (kind === 'artist' || kind === 'album' || kind === 'playlist') {
            const page = Math.floor(offset / 50) + 1;
            const result = await this.run((api) => api.search(kind, query, page, 50), params.signal);
            if (result.ok !== true)
                return result;
            const searchPage = result.data;
            const items = searchPage.items.slice(offset % 50, offset % 50 + limit);
            return {
                ok: true,
                data: {
                    kind,
                    total: searchPage.total,
                    items,
                    offset,
                    limit,
                    hasMore: offset + items.length < searchPage.total,
                },
            };
        }
        const page = Math.floor(offset / 50) + 1;
        const result = await this.run((api) => api.search('track', query, page, 50), params.signal);
        if (result.ok !== true)
            return result;
        const searchPage = result.data;
        const items = searchPage.items.slice(offset % 50, offset % 50 + limit).map((track) => this.remember(track));
        return {
            ok: true,
            data: {
                kind: 'track',
                total: searchPage.total,
                items,
                offset,
                limit,
                hasMore: offset + items.length < searchPage.total,
            },
        };
    }
    async playlistDetail(id, signal) {
        const cached = this.playlistCache.get(id);
        if (cached !== undefined && !older(cached.at, CACHE_TTL_MS))
            return { ok: true, data: cached.value };
        const result = await this.run((api) => api.playlistDetail(id), signal);
        if (result.ok !== true)
            return result;
        const items = result.data.items.slice(0, MAX_PLAYLIST_TRACKS).map((track) => this.remember(track));
        const value = {
            ...(result.data.playlist !== undefined ? { playlist: result.data.playlist } : {}),
            total: result.data.total,
            items,
            truncated: result.data.total > MAX_PLAYLIST_TRACKS,
        };
        this.playlistCache.set(id, { at: Date.now(), value });
        return { ok: true, data: value };
    }
    async createPlaylist(name, signal) {
        const result = await this.run((api) => api.createPlaylist(name), signal);
        if (result.ok === true)
            this.invalidatePlaylist();
        return result;
    }
    async renamePlaylist(id, name, signal) {
        const result = await this.run((api) => api.editPlaylist(id, name), signal);
        if (result.ok === true)
            this.invalidatePlaylist(id);
        return result;
    }
    async deletePlaylist(id, signal) {
        const result = await this.run((api) => api.deletePlaylist(id), signal);
        if (result.ok === true)
            this.invalidatePlaylist(id);
        return result;
    }
    async addPlaylistTracks(id, trackIds, signal) {
        const result = await this.run((api) => api.addPlaylistTracks(id, trackIds), signal);
        if (result.ok === true)
            this.invalidatePlaylist(id);
        return result;
    }
    async removePlaylistTracks(id, trackIds, signal) {
        const result = await this.run((api) => api.removePlaylistTracks(id, trackIds), signal);
        if (result.ok === true)
            this.invalidatePlaylist(id);
        return result;
    }
    async playlistTracksAll(id, max = 2000, signal) {
        const result = await this.run((api) => api.playlistTracksAll(id, max), signal);
        if (result.ok !== true)
            return result;
        return {
            ok: true,
            data: {
                items: result.data.items.map((track) => this.remember(track)),
                total: result.data.total,
                truncated: result.data.truncated,
            },
        };
    }
    /** Drop all playlist list/detail caches (used after any native mutation). */
    invalidatePlaylist(id) {
        this.playlistPage.clear();
        this.summaryCache = undefined;
        if (id === undefined) {
            this.playlistCache.clear();
            return;
        }
        this.playlistCache.delete(id);
    }
    async albumDetail(id, signal) {
        const result = await this.run((api) => api.albumDetail(id), signal);
        if (result.ok !== true)
            return result;
        let tracks = result.data.tracks;
        // Some fnOS firmware versions return album metadata without tracks. Fall
        // back to the server-side album-title search so the detail view and
        // "play album" still work; this is bounded and never a full-library scan.
        if (tracks.length === 0 && result.data.album !== undefined && result.data.album.title.trim() !== '') {
            const fallback = await this.search({ kind: 'track', album: result.data.album.title, limit: 100 });
            if (fallback.ok === true)
                tracks = fallback.data.items;
        }
        return {
            ok: true,
            data: {
                ...(result.data.album !== undefined ? { album: result.data.album } : {}),
                tracks: tracks.map((track) => this.remember(track)),
            },
        };
    }
    async albumTracks(id, signal) {
        const result = await this.albumDetail(id, signal);
        if (result.ok !== true)
            return result;
        return { ok: true, data: { total: result.data.tracks.length, items: result.data.tracks } };
    }
    async favorites(offset, limit, signal) {
        const start = clamp(offset, 0, 100_000);
        const wanted = clamp(limit, 1, 100);
        const firstPage = Math.floor(start / TRACK_PAGE_SIZE) + 1;
        const pages = Math.ceil((start % TRACK_PAGE_SIZE + wanted) / TRACK_PAGE_SIZE);
        const items = [];
        let total = 0;
        for (let index = 0; index < pages; index += 1) {
            const pageNumber = firstPage + index;
            const cached = this.favoritePages.get(pageNumber);
            let page;
            if (cached !== undefined && !older(cached.at, CACHE_TTL_MS)) {
                page = cached.value;
            }
            else {
                const result = await this.run((api) => api.favorites(pageNumber, TRACK_PAGE_SIZE), signal);
                if (result.ok !== true)
                    return result;
                page = { ...result.data, items: result.data.items.map((track) => this.remember(track)) };
                this.favoritePages.set(pageNumber, { at: Date.now(), value: page });
            }
            total = page.total || total;
            const from = index === 0 ? start % TRACK_PAGE_SIZE : 0;
            items.push(...page.items.slice(from));
            if (page.items.length < TRACK_PAGE_SIZE)
                break;
        }
        const pageItems = items.slice(0, wanted);
        return {
            ok: true,
            data: { total, items: pageItems, hasMore: start + pageItems.length < total },
        };
    }
    async lyrics(trackId, signal) {
        const cached = this.lyricsCache.get(trackId);
        if (cached !== undefined && !older(cached.at, LYRICS_TTL_MS)) {
            return {
                ok: true,
                data: {
                    lrc: cached.value.lrc,
                    lineCount: countLines(cached.value.lrc),
                    offsetMs: cached.value.offsetMs,
                    isLRC: cached.value.isLRC,
                },
            };
        }
        const result = await this.run((api) => api.lyrics(trackId), signal);
        if (result.ok !== true)
            return result;
        const value = { lrc: result.data.lrc, offsetMs: result.data.offsetMs, isLRC: result.data.isLRC };
        this.lyricsCache.set(trackId, { at: Date.now(), value });
        return { ok: true, data: { ...value, lineCount: countLines(value.lrc) } };
    }
    findTrack(id) {
        const found = this.tracksById.get(id);
        return found === undefined ? undefined : { ...found };
    }
    applyFavorite(trackId, favorite) {
        const cached = this.tracksById.get(trackId);
        if (cached !== undefined)
            this.tracksById.set(trackId, withFavorite(cached, favorite));
        for (const entry of this.trackPages.values()) {
            entry.value.items = entry.value.items.map((track) => (track.id === trackId ? withFavorite(track, favorite) : track));
        }
        for (const entry of this.playlistCache.values()) {
            entry.value.items = entry.value.items.map((track) => (track.id === trackId ? withFavorite(track, favorite) : track));
        }
        for (const entry of this.favoritePages.values()) {
            entry.value.items = entry.value.items.map((track) => (track.id === trackId ? withFavorite(track, favorite) : track));
        }
    }
    async summary(signal) {
        if (this.summaryCache !== undefined && !older(this.summaryCache.at, SUMMARY_TTL_MS)) {
            return this.summaryCache.value;
        }
        const api = this.api();
        if (api === null)
            return null;
        const [tracks, albums, artists, playlists] = await Promise.all([
            this.run((service) => service.listTracks(1, 1), signal),
            this.run((service) => service.listAlbums(1, 1), signal),
            this.run((service) => service.listArtists(1, 1), signal),
            this.run((service) => service.listPlaylists(1, 1), signal),
        ]);
        if (tracks.ok !== true && albums.ok !== true && artists.ok !== true && playlists.ok !== true)
            return null;
        const value = {
            tracks: tracks.ok === true ? tracks.data.total : this.tracksById.size,
            albums: albums.ok === true ? albums.data.total : 0,
            artists: artists.ok === true ? artists.data.total : 0,
            playlists: playlists.ok === true ? playlists.data.total : 0,
        };
        this.summaryCache = { at: Date.now(), value };
        return value;
    }
    invalidate() {
        this.trackPages.clear();
        this.favoritePages.clear();
        this.albumPage.clear();
        this.artistPage.clear();
        this.playlistPage.clear();
        this.playlistCache.clear();
        this.lyricsCache.clear();
        this.tracksById.clear();
        this.summaryCache = undefined;
    }
}
function countLines(value) {
    return value === '' ? 0 : value.split('\n').length;
}
