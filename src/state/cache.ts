/**
 * Disk cache for covers and LRC lyrics under the DSH cache directory.
 *
 * Only hashed names are used (no user path is ever spliced into a file name),
 * images are restricted to safe raster types, and eviction keeps the cache
 * below the configured ceiling. A missing or unwritable cache never blocks
 * playback: the fetched bytes are returned directly.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CacheSummary, Result } from '../types.js';
import { fail } from '../errors.js';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const EXT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const MAX_LYRIC_BYTES = 256 * 1024;
const SUMMARY_TTL_MS = 5000;

export interface CoverPayload {
  buffer: Buffer;
  contentType: string;
}

export interface LyricCachePayload {
  lrc: string;
  offsetMs: number;
  isLRC: boolean;
}

interface CacheScan {
  covers: number;
  lyrics: number;
  bytes: number;
  at: number;
}

function hashKey(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class MediaCache {
  private limitBytes: number;
  private readonly pending = new Map<string, Promise<Result<CoverPayload>>>();
  private readonly pendingLyrics = new Map<string, Promise<Result<LyricCachePayload>>>();
  private scan: CacheScan | undefined;
  private disposed = false;

  constructor(
    private readonly root: string,
    limitMb: number,
  ) {
    this.limitBytes = Math.max(0, limitMb) * 1024 * 1024;
  }

  private get coversDir(): string {
    return path.join(this.root, 'covers');
  }

  private get lyricsDir(): string {
    return path.join(this.root, 'lyrics');
  }

  setLimit(limitMb: number): void {
    this.limitBytes = Math.max(0, limitMb) * 1024 * 1024;
  }

  private async ensureDir(dir: string): Promise<boolean> {
    try {
      await fs.mkdir(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  async cover(
    deviceKey: string,
    coverId: string,
    size: string,
    fetcher: () => Promise<Result<CoverPayload>>,
  ): Promise<Result<CoverPayload>> {
    const key = hashKey(`${deviceKey}\0${coverId}\0${size}`);
    const running = this.pending.get(key);
    if (running !== undefined) return running;
    const promise = this.loadCover(key, fetcher);
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  private async loadCover(key: string, fetcher: () => Promise<Result<CoverPayload>>): Promise<Result<CoverPayload>> {
    if (this.limitBytes > 0) {
      const cached = await this.readCover(key);
      if (cached !== undefined) return cached;
    }
    const fetched = await fetcher();
    if (fetched.ok !== true) return fetched;
    if (fetched.data.buffer.length > MAX_COVER_BYTES) {
      return fail('unsupported', 'Cover image is too large');
    }
    const contentType = fetched.data.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    const extension = IMAGE_TYPES[contentType];
    if (extension === undefined) {
      return fail('unsupported', 'Cover response is not a supported raster image');
    }
    if (this.limitBytes > 0 && !this.disposed) {
      const dir = this.coversDir;
      if (await this.ensureDir(dir)) {
        try {
          await fs.writeFile(path.join(dir, `${key}${extension}`), fetched.data.buffer);
          this.invalidateScan();
          void this.evictIfNeeded();
        } catch {
          // Read-through is still valid; the next request fetches again.
        }
      }
    }
    return { ok: true, data: { buffer: fetched.data.buffer, contentType } };
  }

  private async readCover(key: string): Promise<Result<CoverPayload> | undefined> {
    for (const [extension, contentType] of Object.entries(EXT_TYPES)) {
      try {
        const buffer = await fs.readFile(path.join(this.coversDir, `${key}${extension}`));
        return { ok: true, data: { buffer, contentType } };
      } catch {
        // Try the next known extension.
      }
    }
    return undefined;
  }

  async lyrics(
    deviceKey: string,
    trackId: string,
    fetcher: () => Promise<Result<LyricCachePayload>>,
  ): Promise<Result<LyricCachePayload>> {
    const key = hashKey(`${deviceKey}\0${trackId}\0lrc`);
    const running = this.pendingLyrics.get(key);
    if (running !== undefined) return running;
    const promise = this.loadLyrics(key, fetcher);
    this.pendingLyrics.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingLyrics.delete(key);
    }
  }

  private async loadLyrics(key: string, fetcher: () => Promise<Result<LyricCachePayload>>): Promise<Result<LyricCachePayload>> {
    if (this.limitBytes > 0) {
      try {
        const cached = await fs.readFile(path.join(this.lyricsDir, `${key}.lrc.json`), 'utf8');
        const parsed = JSON.parse(cached) as Partial<LyricCachePayload>;
        if (typeof parsed.lrc === 'string') {
          return {
            ok: true,
            data: {
              lrc: parsed.lrc,
              offsetMs: Number(parsed.offsetMs) || 0,
              isLRC: parsed.isLRC !== false,
            },
          };
        }
      } catch {
        // Fall back to the V1 plain-text file below.
      }
      try {
        const cached = await fs.readFile(path.join(this.lyricsDir, `${key}.lrc`), 'utf8');
        return { ok: true, data: { lrc: cached, offsetMs: 0, isLRC: true } };
      } catch {
        // Not cached.
      }
    }
    const fetched = await fetcher();
    if (fetched.ok !== true) return fetched;
    if (Buffer.byteLength(JSON.stringify(fetched.data), 'utf8') > MAX_LYRIC_BYTES) {
      return fail('unsupported', 'Lyrics are too large');
    }
    if (this.limitBytes > 0 && !this.disposed) {
      const dir = this.lyricsDir;
      if (await this.ensureDir(dir)) {
        try {
          await fs.writeFile(path.join(dir, `${key}.lrc.json`), JSON.stringify(fetched.data), 'utf8');
          // Remove a stale V1 plain-text cache entry with the same key.
          await fs.unlink(path.join(dir, `${key}.lrc`)).catch(() => {});
          this.invalidateScan();
          void this.evictIfNeeded();
        } catch {
          // Return the fetched record anyway.
        }
      }
    }
    return fetched;
  }

  private invalidateScan(): void {
    this.scan = undefined;
  }

  async summary(): Promise<CacheSummary> {
    const now = Date.now();
    if (this.scan !== undefined && now - this.scan.at < SUMMARY_TTL_MS) {
      return {
        covers: this.scan.covers,
        lyrics: this.scan.lyrics,
        bytes: this.scan.bytes,
        limitMb: Math.round(this.limitBytes / (1024 * 1024)),
      };
    }
    let covers = 0;
    let lyrics = 0;
    let bytes = 0;
    for (const dir of [this.coversDir, this.lyricsDir]) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() !== true) continue;
          const file = path.join(dir, entry.name);
          const stat = await fs.stat(file).catch(() => undefined);
          if (stat === undefined) continue;
          bytes += stat.size;
          if (dir === this.coversDir) covers += 1;
          else lyrics += 1;
        }
      } catch {
        // Missing directory = empty cache.
      }
    }
    this.scan = { covers, lyrics, bytes, at: now };
    return { covers, lyrics, bytes, limitMb: Math.round(this.limitBytes / (1024 * 1024)) };
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.limitBytes <= 0 || this.disposed) return;
    const summary = await this.summary();
    if (summary.bytes <= this.limitBytes) return;
    const target = Math.floor(this.limitBytes * 0.9);
    const files: Array<{ file: string; size: number; mtime: number }> = [];
    for (const dir of [this.coversDir, this.lyricsDir]) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() !== true) continue;
          const file = path.join(dir, entry.name);
          const stat = await fs.stat(file).catch(() => undefined);
          if (stat !== undefined) files.push({ file, size: stat.size, mtime: stat.mtimeMs });
        }
      } catch {
        // Ignore.
      }
    }
    files.sort((left, right) => left.mtime - right.mtime);
    let bytes = summary.bytes;
    for (const file of files) {
      if (bytes <= target) break;
      try {
        await fs.unlink(file.file);
        bytes -= file.size;
      } catch {
        // Another request may have removed it.
      }
    }
    this.invalidateScan();
  }

  async clear(): Promise<void> {
    this.scan = undefined;
    try {
      await fs.rm(this.root, { recursive: true, force: true });
    } catch {
      // A missing cache directory is already clear.
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.clear();
  }
}
