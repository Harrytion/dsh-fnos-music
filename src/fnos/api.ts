/**
 * Thin typed facade over the fnOS `/music/api/v1` endpoints used by V1.
 * The endpoint names and envelope are centralized here so a firmware change is
 * a one-file fix.
 */
import type {
  AlbumRef,
  ArtistRef,
  PlaylistRef,
  Result,
  StreamResponse,
  TrackRef,
} from '../types.js';
import { fail } from '../errors.js';
import type { Transport } from '../transport/contract.js';
import {
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
  normalizeTrack,
  numberOf,
  text,
} from './normalize.js';

export interface Page<T> {
  total: number;
  items: T[];
}

export type SearchKind = 'track' | 'album' | 'artist' | 'playlist';

export type SearchPage =
  | { kind: 'track'; total: number; items: TrackRef[] }
  | { kind: 'album'; total: number; items: AlbumRef[] }
  | { kind: 'artist'; total: number; items: ArtistRef[] }
  | { kind: 'playlist'; total: number; items: PlaylistRef[] };

export interface PlaylistDetail {
  playlist?: PlaylistRef;
  total: number;
  items: TrackRef[];
}

export interface AlbumDetail {
  album?: AlbumRef;
  tracks: TrackRef[];
}

export interface LyricSource {
  lrc: string;
  offsetMs: number;
  isLRC: boolean;
  preferredGuid: string;
}

export interface PlaylistTracksPage {
  total: number;
  items: TrackRef[];
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function listOf(data: unknown): unknown[] {
  const record = recordOf(data);
  if (Array.isArray(record.list)) return record.list;
  if (Array.isArray(record.tracks)) return record.tracks;
  if (Array.isArray(record.trackList)) return record.trackList;
  if (Array.isArray(data)) return data;
  return [];
}

function totalOf(data: unknown, fallback: number): number {
  const total = numberOf(recordOf(data).total);
  return total > 0 ? total : fallback;
}

export class FnosApi {
  constructor(private readonly transport: Transport) {}

  get base(): string {
    return this.transport.base;
  }

  async me(): Promise<Result<Record<string, unknown>>> {
    const result = await this.transport.request<unknown>('/user/me');
    if (result.ok !== true) return result;
    return { ok: true, data: recordOf(result.data) };
  }

  async login(username: string, password: string): Promise<Result<{ token: string; user: string }>> {
    return this.transport.login(username, password);
  }

  private async page<T>(
    path: string,
    page: number,
    size: number,
    normalize: (value: unknown) => T,
  ): Promise<Result<Page<T>>> {
    return this.pageWith(path, page, size, normalize);
  }

  /** Paged endpoint with a fixed id query (albumGUID, artistGUID, ...). */
  private async pageWith<T>(
    path: string,
    page: number,
    size: number,
    normalize: (value: unknown) => T,
    query: Record<string, string> = {},
  ): Promise<Result<Page<T>>> {
    const result = await this.transport.request<unknown>(path, {
      query: { ...query, page, size },
    });
    if (result.ok !== true) return result;
    const items = listOf(result.data)
      .map(normalize)
      .filter((item) => {
        if (item === null || typeof item !== 'object') return false;
        const id = (item as { id?: unknown }).id;
        return typeof id === 'string' && id !== '';
      });
    return {
      ok: true,
      data: { total: totalOf(result.data, items.length), items },
    };
  }

  listTracks(page: number, size: number): Promise<Result<Page<TrackRef>>> {
    return this.page('/track/list', page, size, normalizeTrack);
  }

  /** Exact album track list used by firmware whose /album/detail has no tracks. */
  albumTrackList(albumGUID: string, page: number, size: number): Promise<Result<Page<TrackRef>>> {
    return this.pageWith('/track/album-detail/list', page, size, normalizeTrack, { albumGUID });
  }

  /** Exact artist track list used instead of the bounded full-library scan. */
  artistTrackList(artistGUID: string, page: number, size: number): Promise<Result<Page<TrackRef>>> {
    return this.pageWith('/track/artist-detail/list', page, size, normalizeTrack, { artistGUID });
  }

  /** Per-track metadata, used to recover codec/channels for history rows. */
  async trackMetadata(guid: string): Promise<Result<TrackRef>> {
    const result = await this.transport.request<unknown>('/track/metadata', { query: { guid } });
    if (result.ok !== true) return result;
    const data = recordOf(result.data);
    const track = recordOf(data.track);
    const normalized = normalizeTrack(Object.keys(track).length > 0 ? track : data);
    if (normalized.id === '') return fail('not_found', 'Track metadata was empty');
    return { ok: true, data: normalized };
  }

  /** Ask the NAS to transcode one track; returns the server-relative HLS URL. */
  async transcode(guid: string, codec = 'opus', channel = 2): Promise<Result<string>> {
    const result = await this.transport.request<unknown>('/track/transcode', {
      method: 'POST',
      body: { guid, output: { codec, channel } },
    });
    if (result.ok !== true) return result;
    const url = text(recordOf(result.data).url);
    if (url === '') return fail('unsupported', 'Transcode did not return a URL');
    return { ok: true, data: url };
  }

  /** Best-effort release of a server transcode session. */
  async transcodeQuit(guid: string): Promise<Result<null>> {
    const result = await this.transport.request<unknown>('/track/transcode/quit', {
      method: 'POST',
      body: { guid },
    });
    return result.ok === true ? { ok: true, data: null } : result;
  }

  /** Read one HLS file (playlist, init or segment) through the authenticated transport. */
  hls(path: string, signal?: AbortSignal): Promise<Result<StreamResponse>> {
    return this.transport.stream(path, { signal, timeoutMs: 20_000 });
  }

  listAlbums(page: number, size: number): Promise<Result<Page<AlbumRef>>> {
    return this.page('/album/list', page, size, normalizeAlbum);
  }

  listArtists(page: number, size: number): Promise<Result<Page<ArtistRef>>> {
    return this.page('/artist/list', page, size, normalizeArtist);
  }

  listPlaylists(page: number, size: number): Promise<Result<Page<PlaylistRef>>> {
    return this.page('/playlist/list', page, size, normalizePlaylist);
  }

  async search(kind: SearchKind, query: string, page: number, size: number): Promise<Result<SearchPage>> {
    const path = `/search/${kind}`;
    const result = await this.transport.request<unknown>(path, {
      query: { q: query, page, size },
    });
    if (result.ok !== true) return result;
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
  playlistTracks(id: string, page = 1, size = 300): Promise<Result<PlaylistTracksPage>> {
    return this.transport.request<unknown>('/track/playlist-detail/list', {
      query: { playlistGUID: id, page, size },
    }).then((result) => {
      if (result.ok !== true) return result;
      const items = listOf(result.data).map(normalizeTrack).filter((item) => item.id !== '');
      return {
        ok: true as const,
        data: { total: totalOf(result.data, items.length), items },
      };
    });
  }

  async playlistDetail(id: string): Promise<Result<PlaylistDetail>> {
    const result = await this.transport.request<unknown>('/track/playlist-detail/list', {
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
    if (!['not_found', 'unsupported', 'business', 'protocol'].includes(result.error.code)) return result;
    const legacy = await this.transport.request<unknown>('/playlist/detail', {
      query: { guid: id },
    });
    if (legacy.ok !== true) return legacy;
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
  async playlistTracksAll(id: string, max = 2000): Promise<Result<{ items: TrackRef[]; total: number; truncated: boolean }>> {
    const items: TrackRef[] = [];
    let total = 0;
    for (let page = 1; page <= 20; page += 1) {
      const result = await this.playlistTracks(id, page, 300);
      if (result.ok !== true) {
        if (items.length > 0) break;
        return result;
      }
      total = result.data.total || total;
      items.push(...result.data.items);
      if (items.length >= max || result.data.items.length < 300 || (total > 0 && items.length >= total)) break;
    }
    const sliced = items.slice(0, max);
    return {
      ok: true,
      data: { items: sliced, total: Math.max(total, items.length), truncated: items.length >= max && total > max },
    };
  }

  async createPlaylist(name: string): Promise<Result<PlaylistRef>> {
    const result = await this.transport.request<unknown>('/playlist/create', {
      method: 'POST',
      body: { name },
    });
    if (result.ok !== true) return result;
    const playlist = normalizePlaylist(result.data);
    if (playlist.id === '') return apiFailure('Created playlist has no guid') as Result<PlaylistRef>;
    return { ok: true, data: playlist };
  }

  async editPlaylist(id: string, name: string): Promise<Result<null>> {
    const result = await this.transport.request<unknown>('/playlist/edit', {
      method: 'POST',
      body: { guid: id, name },
    });
    return result.ok === true ? { ok: true, data: null } : result;
  }

  async deletePlaylist(id: string): Promise<Result<null>> {
    const result = await this.transport.request<unknown>('/playlist/delete', {
      method: 'POST',
      body: { guid: id },
    });
    return result.ok === true ? { ok: true, data: null } : result;
  }

  async addPlaylistTracks(id: string, trackGUIDs: string[]): Promise<Result<null>> {
    const result = await this.transport.request<unknown>('/playlist/add-track', {
      method: 'POST',
      body: { guid: id, trackGUIDs },
    });
    return result.ok === true ? { ok: true, data: null } : result;
  }

  async removePlaylistTracks(id: string, trackGUIDs: string[]): Promise<Result<null>> {
    const result = await this.transport.request<unknown>('/playlist/remove-track', {
      method: 'POST',
      body: { guid: id, trackGUIDs },
    });
    return result.ok === true ? { ok: true, data: null } : result;
  }

  async albumDetail(id: string): Promise<Result<AlbumDetail>> {
    const result = await this.transport.request<unknown>('/album/detail', {
      query: { guid: id },
    });
    if (result.ok !== true) return result;
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

  async favorites(page: number, size: number): Promise<Result<Page<TrackRef>>> {
    const result = await this.transport.request<unknown>('/favorite-track/list', {
      query: { page, size },
    });
    if (result.ok !== true) return result;
    const items = listOf(result.data).map(normalizeTrack).filter((item) => item.id !== '');
    return {
      ok: true,
      data: {
        total: totalOf(result.data, items.length),
        items: items.map((item) => ({ ...item, favorite: true })),
      },
    };
  }

  async favorite(trackId: string, on: boolean): Promise<Result<null>> {
    const result = await this.transport.request<unknown>(
      on ? '/favorite-track/create' : '/favorite-track/delete',
      { method: 'POST', body: { trackGUID: trackId } },
    );
    if (result.ok !== true) return result;
    return { ok: true, data: null };
  }

  async lyrics(trackId: string): Promise<Result<LyricSource>> {
    const result = await this.transport.request<unknown>('/lyric/list', {
      query: { trackGUID: trackId },
    });
    if (result.ok !== true) return result;
    const data = recordOf(result.data);
    const rawList = Array.isArray(data.list) ? data.list : [];
    // fnOS `preferred` is a lyric GUID, not the object itself.
    const preferred = text(data.preferred);
    const entries = rawList.map((entry) => {
      if (typeof entry === 'string') return { guid: '', text: entry, offsetMs: 0, isLRC: true };
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

  async logout(): Promise<void> {
    await this.transport.request('/user/logout', { method: 'POST', body: {} });
  }
}

export function apiFailure(message: string, code: 'protocol' | 'business' = 'protocol'): Result<never> {
  return fail(code, message);
}
