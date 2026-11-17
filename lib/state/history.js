/**
 * Local, per-listener listening history and derived statistics. Everything is
 * written under the plugin data directory (never the NAS); cache clearing does
 * not remove it. Writes are debounced and atomic, and a corrupt file never
 * blocks playback.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
const MAX_ENTRIES = 5000;
const SAVE_DELAY_MS = 1500;
const MIN_PLAY_MS = 5000;
const FILE_VERSION = 1;
function safeListener(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'default';
}
function localDate(at) {
    const date = new Date(at);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function rangeStart(range, now = Date.now()) {
    if (range === '7d')
        return now - 7 * 24 * 3600_000;
    if (range === '30d')
        return now - 30 * 24 * 3600_000;
    return 0;
}
function sanitizeEntry(value) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const raw = value;
    const trackId = typeof raw.trackId === 'string' ? raw.trackId : '';
    if (trackId === '')
        return undefined;
    const at = Number(raw.at);
    if (!Number.isFinite(at) || at <= 0)
        return undefined;
    const quality = raw.quality === 'hires' || raw.quality === 'lossless' ? raw.quality : 'standard';
    const source = raw.source === 'queue' || raw.source === 'dj' || raw.source === 'scene' ? raw.source : 'play';
    return {
        id: typeof raw.id === 'string' ? raw.id : `${at}-${trackId}`,
        at,
        updatedAt: Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : at,
        trackId,
        title: typeof raw.title === 'string' ? raw.title : '',
        artist: typeof raw.artist === 'string' ? raw.artist : '',
        album: typeof raw.album === 'string' ? raw.album : '',
        albumId: typeof raw.albumId === 'string' ? raw.albumId : '',
        coverId: typeof raw.coverId === 'string' ? raw.coverId : '',
        genre: typeof raw.genre === 'string' ? raw.genre : '',
        quality,
        durationSec: Math.max(0, Number(raw.durationSec) || 0),
        listenedMs: Math.max(0, Number(raw.listenedMs) || 0),
        completed: raw.completed === true,
        deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
        listenerId: typeof raw.listenerId === 'string' ? raw.listenerId : 'default',
        source,
    };
}
export class HistoryService {
    dataDir;
    listenerId = 'default';
    entries = [];
    current = null;
    saveTimer;
    loaded = false;
    disposed = false;
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    get activeListenerId() {
        return this.listenerId;
    }
    get currentEntry() {
        return this.current === null ? null : { ...this.current };
    }
    async start(listenerId) {
        this.listenerId = safeListener(listenerId);
        await this.load();
    }
    async switchListener(listenerId) {
        const next = safeListener(listenerId);
        if (next === this.listenerId)
            return;
        this.finish();
        await this.saveNow();
        this.listenerId = next;
        this.entries = [];
        this.current = null;
        this.loaded = false;
        await this.load();
    }
    path() {
        return path.join(this.dataDir, `history-${safeListener(this.listenerId)}.json`);
    }
    async load() {
        if (this.loaded)
            return;
        this.loaded = true;
        try {
            const raw = JSON.parse(await fs.readFile(this.path(), 'utf8'));
            const list = Array.isArray(raw.entries) ? raw.entries : [];
            this.entries = list.map(sanitizeEntry).filter((entry) => entry !== undefined).slice(-MAX_ENTRIES);
        }
        catch {
            this.entries = [];
        }
    }
    scheduleSave() {
        if (this.disposed)
            return;
        if (this.saveTimer !== undefined)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            void this.saveNow();
        }, SAVE_DELAY_MS);
        this.saveTimer.unref?.();
    }
    async saveNow() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            const file = this.path();
            const temp = `${file}.tmp`;
            await fs.writeFile(temp, JSON.stringify({ version: FILE_VERSION, entries: this.entries.slice(-MAX_ENTRIES) }), 'utf8');
            await fs.rename(temp, file);
        }
        catch {
            // Local statistics are best-effort; never fail playback for them.
        }
    }
    /** Begin a history row for a newly current track. */
    startTrack(track, deviceId, source = 'play') {
        this.finish();
        const now = Date.now();
        const entry = {
            id: `${now.toString(36)}-${track.id}`,
            at: now,
            updatedAt: now,
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            albumId: track.albumId,
            coverId: track.coverId,
            genre: track.genre,
            quality: track.quality,
            durationSec: track.durationSec,
            listenedMs: 0,
            completed: false,
            deviceId,
            listenerId: this.listenerId,
            source,
        };
        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES)
            this.entries.splice(0, this.entries.length - MAX_ENTRIES);
        this.current = entry;
        this.scheduleSave();
    }
    progress(positionMs, status) {
        if (this.current === null)
            return;
        const duration = this.current.durationSec * 1000;
        const position = Math.max(0, Math.min(duration > 0 ? duration : Number.MAX_SAFE_INTEGER, Number(positionMs) || 0));
        if (position > this.current.listenedMs)
            this.current.listenedMs = position;
        if (status === 'playing' || status === 'paused')
            this.current.updatedAt = Date.now();
        if (duration > 0 && position >= duration - 3000) {
            this.current.completed = true;
            this.current.listenedMs = Math.max(this.current.listenedMs, duration);
        }
        this.scheduleSave();
    }
    finish(completed = false) {
        if (this.current === null)
            return;
        if (completed)
            this.current.completed = true;
        this.current.updatedAt = Date.now();
        this.current = null;
        this.scheduleSave();
    }
    async list(range, offset, limit, unique = false) {
        const from = rangeStart(range);
        let filtered = this.entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => entry.at >= from)
            .sort((a, b) => (b.entry.at - a.entry.at) || (b.index - a.index))
            .map(({ entry }) => entry);
        if (unique) {
            const seen = new Set();
            filtered = filtered.filter((entry) => {
                if (seen.has(entry.trackId))
                    return false;
                seen.add(entry.trackId);
                return true;
            });
        }
        const start = Math.max(0, Math.trunc(offset) || 0);
        const size = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
        return { total: filtered.length, items: filtered.slice(start, start + size).map((entry) => ({ ...entry })) };
    }
    /** Latest locally recorded snapshot of a track, usable after the library cache is gone. */
    findTrack(trackId) {
        if (trackId === '')
            return undefined;
        for (let index = this.entries.length - 1; index >= 0; index -= 1) {
            const entry = this.entries[index];
            if (entry === undefined || entry.trackId !== trackId)
                continue;
            return {
                id: entry.trackId,
                title: entry.title,
                artist: entry.artist,
                album: entry.album,
                albumId: entry.albumId,
                year: 0,
                durationSec: entry.durationSec,
                coverId: entry.coverId,
                quality: entry.quality,
                bitrateKbps: 0,
                format: '',
                bitDepth: 0,
                sampleRate: 0,
                favorite: false,
                folder: '',
                fileName: '',
                genre: entry.genre,
                hasLyric: false,
            };
        }
        return undefined;
    }
    stats(range) {
        const now = Date.now();
        const from = rangeStart(range, now);
        const entries = this.entries.filter((entry) => entry.at >= from);
        const plays = entries.filter((entry) => entry.listenedMs >= MIN_PLAY_MS || entry.completed);
        const totalListened = plays.reduce((sum, entry) => sum + entry.listenedMs, 0);
        const days = new Map();
        for (const entry of plays) {
            const date = localDate(entry.at);
            const row = days.get(date) ?? { date, plays: 0, listenedSec: 0 };
            row.plays += 1;
            row.listenedSec += Math.round(entry.listenedMs / 1000);
            days.set(date, row);
        }
        const activeDays = [...days.values()].filter((row) => row.plays > 0).length;
        const fillDays = range === '7d' ? 7 : range === '30d' ? 30 : 0;
        if (fillDays > 0) {
            const today = new Date();
            for (let index = fillDays - 1; index >= 0; index -= 1) {
                const date = new Date(today);
                date.setDate(today.getDate() - index);
                const key = localDate(date.getTime());
                if (!days.has(key))
                    days.set(key, { date: key, plays: 0, listenedSec: 0 });
            }
        }
        const hourly = Array.from({ length: 24 }, () => 0);
        for (const entry of plays)
            hourly[new Date(entry.at).getHours()] += 1;
        const trackMap = new Map();
        const artistMap = new Map();
        const albumMap = new Map();
        const genreMap = new Map();
        const qualityMap = new Map();
        for (const entry of plays) {
            const track = trackMap.get(entry.trackId) ?? { key: entry.trackId, label: entry.title, sub: entry.artist, plays: 0, listenedSec: 0 };
            track.plays += 1;
            track.listenedSec += Math.round(entry.listenedMs / 1000);
            trackMap.set(entry.trackId, track);
            if (entry.artist !== '') {
                const artist = artistMap.get(entry.artist) ?? { key: entry.artist, label: entry.artist, plays: 0, listenedSec: 0 };
                artist.plays += 1;
                artist.listenedSec += Math.round(entry.listenedMs / 1000);
                artistMap.set(entry.artist, artist);
            }
            if (entry.genre !== '') {
                const genre = genreMap.get(entry.genre) ?? { key: entry.genre, label: entry.genre, plays: 0, listenedSec: 0 };
                genre.plays += 1;
                genre.listenedSec += Math.round(entry.listenedMs / 1000);
                genreMap.set(entry.genre, genre);
            }
            if (entry.album !== '') {
                const album = albumMap.get(entry.album) ?? { key: entry.album, label: entry.album, sub: entry.artist, plays: 0, listenedSec: 0 };
                album.plays += 1;
                album.listenedSec += Math.round(entry.listenedMs / 1000);
                albumMap.set(entry.album, album);
            }
            qualityMap.set(entry.quality, (qualityMap.get(entry.quality) ?? 0) + 1);
        }
        const top = (map) => [...map.values()]
            .sort((a, b) => (b.plays - a.plays) || (b.listenedSec - a.listenedSec))
            .slice(0, 10);
        return {
            range,
            from,
            to: now,
            plays: plays.length,
            listenedSec: Math.round(totalListened / 1000),
            uniqueTracks: new Set(plays.map((entry) => entry.trackId)).size,
            activeDays,
            daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
            hourly,
            topTracks: top(trackMap),
            topArtists: top(artistMap),
            topAlbums: top(albumMap),
            topGenres: top(genreMap),
            quality: [...qualityMap.entries()].map(([quality, count]) => ({ quality, plays: count })),
        };
    }
    async clear() {
        this.entries = [];
        this.current = null;
        await fs.rm(this.path(), { force: true }).catch(() => { });
        this.scheduleSave();
    }
    async removeListenerFile(listenerId) {
        await fs.rm(path.join(this.dataDir, `history-${safeListener(listenerId)}.json`), { force: true }).catch(() => { });
    }
    async flush() {
        if (this.saveTimer !== undefined) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
        await this.saveNow();
    }
    dispose() {
        if (this.disposed)
            return;
        this.finish();
        this.disposed = true;
        if (this.saveTimer !== undefined) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
        void this.saveNow();
    }
}
