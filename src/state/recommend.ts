/**
 * Local-only recommendation for the V2 smart playlist and basic DJ.
 * Candidates come from bounded library filters (artist/album/genre/year/
 * lossless) and are scored, never from an online service.
 */
import type { FnosError, Result, TrackRef } from '../types.js';
import type { LibraryService } from './library.js';

export type RecommendStrategy = 'similar' | 'shuffle' | 'lossless';

export interface RecommendOptions {
  seed: TrackRef;
  strategy: RecommendStrategy;
  limit: number;
  excludeIds?: Set<string>;
  signal?: AbortSignal;
}

export interface RecommendResult {
  items: TrackRef[];
  scanned: number;
  truncated: boolean;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function score(track: TrackRef, seed: TrackRef): number {
  let value = 0;
  if (seed.artist !== '' && track.artist.toLowerCase().includes(seed.artist.split(' / ')[0]!.toLowerCase())) value += 3;
  if (seed.album !== '' && track.album.toLowerCase() === seed.album.toLowerCase()) value += 2;
  if (seed.genre !== '' && track.genre.toLowerCase() === seed.genre.toLowerCase()) value += 2;
  if (seed.year > 0 && track.year === seed.year) value += 1;
  if (track.quality !== 'standard') value += 1;
  return value;
}

export class RecommendService {
  constructor(private readonly library: LibraryService) {}

  async recommend(options: RecommendOptions): Promise<Result<RecommendResult>> {
    const seed = options.seed;
    const limit = Math.max(1, Math.min(50, Math.trunc(options.limit)));
    const exclude = new Set(options.excludeIds ?? []);
    exclude.add(seed.id);
    const candidates = new Map<string, TrackRef>();
    let truncated = false;
    let firstError: FnosError | undefined;

    const add = (items: TrackRef[]): void => {
      for (const track of items) {
        if (track.id !== '' && !exclude.has(track.id)) candidates.set(track.id, track);
      }
    };

    if (options.strategy === 'shuffle') {
      const first = await this.library.listTracks(0, 1, options.signal);
      if (first.ok !== true) return first;
      const total = first.data.total;
      const offset = total > 50 ? Math.floor(Math.random() * total) : 0;
      const page = await this.library.listTracks(offset, 50, options.signal);
      if (page.ok !== true) return page;
      add(page.data.items);
    } else if (options.strategy === 'lossless') {
      const result = await this.library.search({ kind: 'track', lossless: true, limit: 50, signal: options.signal });
      if (result.ok !== true) return result;
      add(result.data.items as TrackRef[]);
      truncated = truncated || result.data.truncated === true;
    } else {
      const queries: Array<Record<string, string | number | boolean | undefined>> = [
        { artist: seed.artist.split(' / ')[0] ?? '' },
        { album: seed.album },
        { genre: seed.genre },
        ...(seed.quality !== 'standard' ? [{ lossless: true }] : []),
      ];
      for (const filters of queries) {
        if (Object.values(filters).every((value) => value === undefined || value === '')) continue;
        const result = await this.library.search({
          kind: 'track',
          limit: 50,
          ...filters,
          signal: options.signal,
        } as Parameters<LibraryService['search']>[0]);
        if (result.ok !== true) {
          firstError ??= result.error;
          continue;
        }
        add(result.data.items as TrackRef[]);
        truncated = truncated || result.data.truncated === true;
      }
      if (candidates.size === 0 && firstError !== undefined) {
        return { ok: false, error: firstError };
      }
    }

    if (candidates.size < limit) {
      const fallback = await this.library.listTracks(0, 50, options.signal);
      if (fallback.ok === true) add(fallback.data.items);
    }

    const scanned = candidates.size;
    const ranked = [...candidates.values()]
      .map((track) => ({ track, score: score(track, seed), tie: Math.random() }))
      .sort((a, b) => (b.score - a.score) || (a.tie - b.tie))
      .slice(0, limit)
      .map((entry) => entry.track);
    return {
      ok: true,
      data: {
        items: options.strategy === 'shuffle' ? shuffle(ranked) : ranked,
        scanned,
        truncated,
      },
    };
  }
}
