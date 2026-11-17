/** Non-secret traffic counters derived from transport request logs. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
const MAX_DAYS = 60;
export class TrafficService {
    dataDir;
    buckets = new Map();
    timer;
    disposed = false;
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    async load() {
        try {
            const parsed = JSON.parse(await fs.readFile(path.join(this.dataDir, 'traffic.json'), 'utf8'));
            if (parsed.buckets !== null && typeof parsed.buckets === 'object') {
                for (const [key, value] of Object.entries(parsed.buckets)) {
                    const bucket = value;
                    if (bucket !== null && typeof bucket === 'object') {
                        this.buckets.set(key, {
                            key,
                            requests: Number(bucket.requests) || 0,
                            errors: Number(bucket.errors) || 0,
                            bytes: Number(bucket.bytes) || 0,
                            ms: Number(bucket.ms) || 0,
                        });
                    }
                }
            }
        }
        catch {
            this.buckets = new Map();
        }
    }
    record(entry, deviceId) {
        if (entry.kind !== 'request')
            return;
        const day = new Date(entry.at).toISOString().slice(0, 10);
        const via = entry.via ?? 'direct';
        const keys = [`day:${day}`, `via:${via}`, `device:${deviceId || 'none'}`];
        for (const key of keys) {
            const bucket = this.buckets.get(key) ?? { key, requests: 0, errors: 0, bytes: 0, ms: 0 };
            bucket.requests += 1;
            if ((entry.status !== undefined && entry.status >= 400) || entry.code !== undefined)
                bucket.errors += 1;
            bucket.bytes += Math.max(0, entry.bytes ?? 0);
            bucket.ms += Math.max(0, entry.ms ?? 0);
            this.buckets.set(key, bucket);
        }
        this.prune();
        this.scheduleSave();
    }
    prune() {
        const cutoff = new Date(Date.now() - MAX_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
        for (const key of [...this.buckets.keys()]) {
            if (key.startsWith('day:') && key.slice(4) < cutoff)
                this.buckets.delete(key);
        }
    }
    summary() {
        const all = [...this.buckets.values()];
        const total = all.filter((bucket) => bucket.key.startsWith('day:')).reduce((sum, bucket) => ({
            requests: sum.requests + bucket.requests,
            errors: sum.errors + bucket.errors,
            bytes: sum.bytes + bucket.bytes,
            ms: sum.ms + bucket.ms,
        }), { requests: 0, errors: 0, bytes: 0, ms: 0 });
        const collect = (prefix) => all
            .filter((bucket) => bucket.key.startsWith(prefix))
            .sort((a, b) => b.requests - a.requests);
        const days = collect('day:');
        return {
            from: days.length > 0 ? Date.parse(`${days[days.length - 1].key.slice(4)}T00:00:00`) : Date.now(),
            to: Date.now(),
            total,
            byDay: days,
            byVia: collect('via:').map((bucket) => ({ ...bucket, key: bucket.key.slice(4) })),
            byDevice: collect('device:').map((bucket) => ({ ...bucket, key: bucket.key.slice(7) })),
        };
    }
    scheduleSave() {
        if (this.disposed)
            return;
        if (this.timer !== undefined)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.save();
        }, 2000);
        this.timer.unref?.();
    }
    async save() {
        if (this.disposed)
            return;
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            const file = path.join(this.dataDir, 'traffic.json');
            await fs.writeFile(`${file}.tmp`, JSON.stringify({ buckets: Object.fromEntries(this.buckets) }), 'utf8');
            await fs.rename(`${file}.tmp`, file);
        }
        catch {
            // Best-effort.
        }
    }
    async clear() {
        this.buckets.clear();
        await fs.rm(path.join(this.dataDir, 'traffic.json'), { force: true }).catch(() => { });
    }
    async flush() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        await this.save();
    }
    dispose() {
        this.disposed = true;
        if (this.timer !== undefined)
            clearTimeout(this.timer);
        this.timer = undefined;
    }
}
