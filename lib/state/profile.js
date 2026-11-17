export class ProfileService {
    history;
    library;
    constructor(history, library) {
        this.history = history;
        this.library = library;
    }
    summary() {
        const stats = this.history.stats('30d');
        return { artists: stats.topArtists.slice(0, 5), genres: stats.topGenres.slice(0, 5), plays: stats.plays };
    }
    async recommend(limit = 12, signal) {
        const stats = this.history.stats('30d');
        const candidates = new Map();
        const add = (track, weight) => {
            if (track.id === '')
                return;
            const current = candidates.get(track.id);
            if (current === undefined)
                candidates.set(track.id, { track, weight });
            else
                current.weight += weight;
        };
        const favorites = await this.library.favorites(0, 20, signal);
        if (favorites.ok === true) {
            for (const track of favorites.data.items)
                add(track, 2);
        }
        for (const artist of stats.topArtists.slice(0, 3)) {
            const result = await this.library.search({ kind: 'track', artist: artist.label, limit: 15, signal });
            if (result.ok === true) {
                for (const track of result.data.items)
                    add(track, 2);
            }
        }
        for (const genre of stats.topGenres.slice(0, 2)) {
            const result = await this.library.search({ kind: 'track', genre: genre.label, limit: 15, signal });
            if (result.ok === true) {
                for (const track of result.data.items)
                    add(track, 1);
            }
        }
        if (candidates.size === 0) {
            const lossless = await this.library.search({ kind: 'track', lossless: true, limit: 30, signal });
            if (lossless.ok === true) {
                for (const track of lossless.data.items)
                    add(track, 1);
            }
        }
        if (candidates.size === 0) {
            const page = await this.library.listTracks(0, Math.min(50, limit), signal);
            if (page.ok !== true)
                return page;
            for (const track of page.data.items)
                add(track, 1);
        }
        const items = [...candidates.values()]
            .sort((a, b) => (b.weight - a.weight) || (a.track.title.localeCompare(b.track.title)))
            .slice(0, Math.max(1, Math.min(50, limit)))
            .map((entry) => entry.track);
        return {
            ok: true,
            data: {
                items,
                source: stats.plays > 0 ? 'history' : favorites.ok === true && favorites.data.items.length > 0 ? 'favorites' : 'library',
            },
        };
    }
}
