/** Small local audit log for Agent mutations; never records tokens or full args. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AuditEntry } from '../types.js';

const MAX_ENTRIES = 1000;

export class AuditService {
  private entries: AuditEntry[] = [];
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly dataDir: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(this.dataDir, 'audit.json'), 'utf8')) as { entries?: unknown };
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries.filter((entry): entry is AuditEntry => {
          return entry !== null && typeof entry === 'object'
            && typeof (entry as AuditEntry).tool === 'string'
            && typeof (entry as AuditEntry).at === 'number';
        }).slice(-MAX_ENTRIES);
      }
    } catch {
      this.entries = [];
    }
  }

  record(entry: Omit<AuditEntry, 'at'> & { at?: number }): void {
    this.entries.push({ ...entry, at: entry.at ?? Date.now() });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.save();
    }, 1000);
    this.timer.unref?.();
  }

  private async save(): Promise<void> {
    if (this.disposed) return;
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const file = path.join(this.dataDir, 'audit.json');
      await fs.writeFile(`${file}.tmp`, JSON.stringify({ entries: this.entries }), 'utf8');
      await fs.rename(`${file}.tmp`, file);
    } catch {
      // Audit is best-effort.
    }
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(500, limit))).reverse().map((entry) => ({ ...entry }));
  }

  async clear(): Promise<void> {
    this.entries = [];
    await fs.rm(path.join(this.dataDir, 'audit.json'), { force: true }).catch(() => {});
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.save();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
