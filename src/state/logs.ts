/** Small in-memory request/play log. Values are already sanitized by callers. */
import type { LogEntry } from '../types.js';

export class RingLog {
  private entries: LogEntry[] = [];

  constructor(
    private readonly max = 200,
    private enabled = true,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.entries = [];
  }

  add(entry: LogEntry): void {
    if (!this.enabled) return;
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
  }

  list(limit = 50): LogEntry[] {
    const count = Math.max(1, Math.min(200, Math.round(limit)));
    return this.entries.slice(-count).reverse().map((entry) => ({ ...entry }));
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }
}
