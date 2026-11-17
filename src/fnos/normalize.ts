/** Normalize fnOS track/album/artist/playlist objects into the plugin model. */
import type { AlbumRef, ArtistRef, PlaylistRef, Quality, TrackRef } from '../types.js';

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function numberOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function artistNames(value: unknown): string[] {
  return arrayOf(value)
    .map((entry) => (typeof entry === 'string' ? entry : text(objectOf(entry).name)))
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

export function qualityOf(spec: Record<string, unknown>): Quality {
  const format = text(spec.format).toLowerCase() || text(spec.codec).toLowerCase();
  const bitDepth = numberOf(spec.bitDepth);
  const sampleRate = numberOf(spec.sampleRate);
  const lossless = ['flac', 'alac', 'wav', 'aiff', 'aif', 'ape', 'dsf', 'dff', 'tta', 'wv'].includes(format)
    || bitDepth > 16;
  if (!lossless) return 'standard';
  if (bitDepth >= 24 || sampleRate >= 96000) return 'hires';
  return 'lossless';
}

export function folderOf(pathValue: unknown): { folder: string; fileName: string } {
  const normalized = text(pathValue).replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized === '') return { folder: '', fileName: '' };
  const index = normalized.lastIndexOf('/');
  if (index < 0) return { folder: '', fileName: normalized };
  return {
    folder: normalized.slice(0, index),
    fileName: normalized.slice(index + 1),
  };
}

function genreOf(raw: Record<string, unknown>, album: Record<string, unknown>): string {
  const candidates = [raw.genre, raw.genres, album.genre, album.genres];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
    if (Array.isArray(candidate)) {
      const names = candidate
        .map((entry) => (typeof entry === 'string' ? entry : text(objectOf(entry).name)))
        .filter((name) => name !== '');
      if (names.length > 0) return names.join(' / ');
    }
  }
  return '';
}

export function normalizeTrack(rawValue: unknown): TrackRef {
  const raw = objectOf(rawValue);
  const album = objectOf(raw.album);
  const spec = objectOf(raw.audioSpec);
  const yearFromDate = Number(String(album.originalReleaseDate ?? '').slice(0, 4)) || 0;
  const pathInfo = folderOf(spec.path);
  return {
    id: text(raw.guid),
    title: text(raw.title) || '未知曲目',
    artist: artistNames(raw.artists).join(' / ') || '未知歌手',
    album: text(album.name),
    albumId: text(album.guid),
    year: numberOf(album.originalReleaseYear) || yearFromDate,
    durationSec: Math.max(1, Math.round(numberOf(raw.duration) / 1000)),
    coverId: text(raw.coverId) || text(album.coverId),
    quality: qualityOf(spec),
    bitrateKbps: Math.round(numberOf(spec.bitrate) / 1000),
    format: text(spec.format) || text(spec.codec),
    bitDepth: numberOf(spec.bitDepth),
    sampleRate: numberOf(spec.sampleRate),
    favorite: raw.isFavorite === true,
    folder: pathInfo.folder,
    fileName: pathInfo.fileName,
    genre: genreOf(raw, album),
    hasLyric: raw.hasLyric === true,
  };
}

export function normalizeAlbum(rawValue: unknown): AlbumRef {
  const raw = objectOf(rawValue);
  const yearFromDate = Number(String(raw.originalReleaseDate ?? '').slice(0, 4)) || 0;
  return {
    id: text(raw.guid),
    title: text(raw.name) || '未知专辑',
    artist: artistNames(raw.artists).join(' / ') || '未知歌手',
    year: numberOf(raw.originalReleaseYear) || yearFromDate,
    coverId: text(raw.coverId),
    trackCount: numberOf(raw.trackCount),
  };
}

export function normalizeArtist(rawValue: unknown): ArtistRef {
  const raw = objectOf(rawValue);
  return {
    id: text(raw.guid),
    name: text(raw.name) || '未知歌手',
    coverId: text(raw.coverId),
    albumCount: numberOf(raw.albumCount),
    trackCount: numberOf(raw.trackCount),
  };
}

export function normalizePlaylist(rawValue: unknown): PlaylistRef {
  const raw = objectOf(rawValue);
  return {
    id: text(raw.guid),
    title: text(raw.name) || '未知歌单',
    coverId: text(raw.coverId),
    trackCount: numberOf(raw.trackCount) || numberOf(raw.songCount),
  };
}

/** Apply a favorite change to a cached track without mutating the original. */
export function withFavorite(track: TrackRef, favorite: boolean): TrackRef {
  return track.favorite === favorite ? track : { ...track, favorite };
}
