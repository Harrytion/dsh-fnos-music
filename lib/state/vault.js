/**
 * Profile-scoped credential record.
 *
 * The DSH credential store is addressed by `<owner>/<id>`; including the
 * active profile in the id keeps two profiles that share one DSH home from
 * seeing each other's NAS tokens. The whole vault (devices + settings) is one
 * `grant` record, so writes are serialized by `modifyRecord`.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const DEFAULT_SETTINGS = {
    confirmHighRisk: true,
    cacheLimitMb: 200,
    requestConcurrency: 3,
    probeIntervalSec: 30,
    logsEnabled: true,
    floatingPlayer: true,
    immersiveCover: true,
    spectrum: true,
    shortcuts: true,
    autoDj: false,
    backgroundProbe: false,
    backgroundProbeIntervalSec: 120,
    historyEnabled: true,
    voiceEnabled: false,
    agentWrites: true,
    trafficStats: true,
};
export function randomDeviceId() {
    return randomBytes(16).toString('hex');
}
export function randomId() {
    return randomBytes(9).toString('hex');
}
function sanitizeProfile(profile) {
    const value = profile.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    return value === '' ? 'default' : value;
}
function recordOf(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
function text(value) {
    return typeof value === 'string' ? value : '';
}
function clampInt(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}
function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
export function sanitizeSettings(value) {
    const raw = recordOf(value);
    return {
        confirmHighRisk: bool(raw.confirmHighRisk, DEFAULT_SETTINGS.confirmHighRisk),
        cacheLimitMb: clampInt(raw.cacheLimitMb, DEFAULT_SETTINGS.cacheLimitMb, 0, 4096),
        requestConcurrency: clampInt(raw.requestConcurrency, DEFAULT_SETTINGS.requestConcurrency, 1, 6),
        probeIntervalSec: clampInt(raw.probeIntervalSec, DEFAULT_SETTINGS.probeIntervalSec, 10, 300),
        logsEnabled: bool(raw.logsEnabled, DEFAULT_SETTINGS.logsEnabled),
        floatingPlayer: bool(raw.floatingPlayer, DEFAULT_SETTINGS.floatingPlayer),
        immersiveCover: bool(raw.immersiveCover, DEFAULT_SETTINGS.immersiveCover),
        spectrum: bool(raw.spectrum, DEFAULT_SETTINGS.spectrum),
        shortcuts: bool(raw.shortcuts, DEFAULT_SETTINGS.shortcuts),
        autoDj: bool(raw.autoDj, DEFAULT_SETTINGS.autoDj),
        backgroundProbe: bool(raw.backgroundProbe, DEFAULT_SETTINGS.backgroundProbe),
        backgroundProbeIntervalSec: clampInt(raw.backgroundProbeIntervalSec, DEFAULT_SETTINGS.backgroundProbeIntervalSec, 60, 600),
        historyEnabled: bool(raw.historyEnabled, DEFAULT_SETTINGS.historyEnabled),
        voiceEnabled: bool(raw.voiceEnabled, DEFAULT_SETTINGS.voiceEnabled),
        agentWrites: bool(raw.agentWrites, DEFAULT_SETTINGS.agentWrites),
        trafficStats: bool(raw.trafficStats, DEFAULT_SETTINGS.trafficStats),
    };
}
const MAX_LISTENERS = 8;
function listenerName(value, fallback = '我') {
    const cleaned = text(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
    return cleaned === '' ? fallback : cleaned;
}
function sanitizeListener(value) {
    const raw = recordOf(value);
    const id = text(raw.id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
    if (id === '')
        return undefined;
    return {
        id,
        name: listenerName(raw.name),
        createdAt: Number(raw.createdAt) > 0 ? Number(raw.createdAt) : Date.now(),
    };
}
function defaultListener() {
    return { id: 'default', name: '我', createdAt: Date.now() };
}
function sanitizeDevice(value) {
    const raw = recordOf(value);
    const id = text(raw.id);
    const mode = raw.mode === 'fnid' ? 'fnid' : raw.mode === 'direct' ? 'direct' : raw.mode === 'auto' ? 'auto' : undefined;
    if (id === '' || mode === undefined)
        return undefined;
    const token = text(raw.token);
    const fnid = text(raw.fnid).trim().toLowerCase();
    const address = text(raw.address).trim();
    const unixPath = text(raw.unixPath).trim();
    if (mode === 'fnid' && fnid === '')
        return undefined;
    if (mode === 'direct' && address === '' && unixPath === '')
        return undefined;
    if (mode === 'auto' && (fnid === '' || address === '' || address.startsWith('unix://') || address.startsWith('/')))
        return undefined;
    return {
        id,
        name: text(raw.name).trim() || (mode === 'fnid' ? fnid : address) || 'fnOS',
        mode,
        ...(fnid !== '' ? { fnid } : {}),
        ...(address !== '' ? { address } : {}),
        ...(mode === 'direct' && unixPath !== '' ? { unixPath } : {}),
        token,
        allowSelfSigned: raw.allowSelfSigned === true,
        deviceId: /^[0-9a-f]{32}$/i.test(text(raw.deviceId)) ? text(raw.deviceId).toLowerCase() : randomDeviceId(),
        ...(text(raw.accountName) !== '' ? { accountName: text(raw.accountName) } : {}),
        createdAt: Number(raw.createdAt) > 0 ? Number(raw.createdAt) : Date.now(),
        updatedAt: Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : Date.now(),
    };
}
function defaultData() {
    const listener = defaultListener();
    return {
        version: 3,
        activeDeviceId: null,
        devices: [],
        listeners: [listener],
        activeListenerId: listener.id,
        settings: { ...DEFAULT_SETTINGS },
    };
}
function parseData(value) {
    const raw = recordOf(value);
    if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3)
        return undefined;
    const devices = Array.isArray(raw.devices)
        ? raw.devices.map(sanitizeDevice).filter((device) => device !== undefined)
        : [];
    const activeDeviceId = text(raw.activeDeviceId);
    const rawListeners = Array.isArray(raw.listeners)
        ? raw.listeners.map(sanitizeListener).filter((listener) => listener !== undefined)
        : [];
    const listeners = rawListeners.length > 0 ? rawListeners.slice(0, MAX_LISTENERS) : [defaultListener()];
    const requestedListener = text(raw.activeListenerId);
    const activeListenerId = listeners.some((listener) => listener.id === requestedListener)
        ? requestedListener
        : listeners[0].id;
    return {
        version: 3,
        activeDeviceId: devices.some((device) => device.id === activeDeviceId) ? activeDeviceId : null,
        devices,
        listeners,
        activeListenerId,
        settings: sanitizeSettings(raw.settings),
    };
}
/**
 * Merge two vault snapshots. The first one is the local copy, the second one
 * the DSH credential record; a device missing from the local copy is restored
 * from the record so an interrupted write can never lose a device.
 */
function mergeVaultData(local, record) {
    if (local === undefined)
        return record;
    if (record === undefined)
        return local;
    const devices = [...local.devices];
    const index = new Map(devices.map((device, position) => [device.id, position]));
    for (const device of record.devices) {
        const at = index.get(device.id);
        if (at === undefined) {
            index.set(device.id, devices.length);
            devices.push(device);
            continue;
        }
        const current = devices[at];
        if (device.updatedAt > current.updatedAt)
            devices[at] = device;
    }
    const listeners = local.listeners.length > 0 ? local.listeners : record.listeners;
    const activeListenerId = listeners.some((listener) => listener.id === local.activeListenerId)
        ? local.activeListenerId
        : listeners.some((listener) => listener.id === record.activeListenerId)
            ? record.activeListenerId
            : listeners[0]?.id ?? 'default';
    const activeDeviceId = devices.some((device) => device.id === local.activeDeviceId)
        ? local.activeDeviceId
        : devices.some((device) => device.id === record.activeDeviceId)
            ? record.activeDeviceId
            : null;
    return {
        version: 3,
        activeDeviceId,
        devices,
        listeners,
        activeListenerId,
        settings: local.settings,
    };
}
export class Vault {
    key;
    data = defaultData();
    opened = false;
    credentials;
    filePath;
    constructor(credentials, profile, filePath) {
        this.key = `dsh-fnos-music/${sanitizeProfile(profile)}`;
        this.credentials = credentials;
        this.filePath = filePath;
    }
    /** True when the vault survives a Host restart (local file or credential record). */
    get persistent() {
        return this.filePath !== undefined || this.credentials !== undefined;
    }
    /** Absolute path of the local vault file; empty when only the record is used. */
    get vaultFile() {
        return this.filePath ?? '';
    }
    async open() {
        if (this.opened)
            return;
        this.opened = true;
        const record = await this.readRecord();
        const local = await this.readFile();
        const merged = mergeVaultData(local, record);
        if (merged === undefined)
            return;
        this.data = merged;
        if (local === undefined)
            await this.writeFile();
    }
    /** Adopt a credentials service that appeared after startup and re-sync. */
    async setCredentials(credentials) {
        this.credentials = credentials;
        if (!this.opened)
            return;
        const record = await this.readRecord();
        if (record === undefined)
            return;
        const merged = mergeVaultData(this.data, record);
        if (merged === undefined)
            return;
        this.data = merged;
        await this.save();
    }
    async readRecord() {
        if (this.credentials === undefined)
            return undefined;
        try {
            const record = await this.credentials.readRecord(this.key);
            return parseData(record?.payload);
        }
        catch {
            // A corrupt or unreadable record falls back to the local copy.
            return undefined;
        }
    }
    async readFile() {
        if (this.filePath === undefined)
            return undefined;
        try {
            const raw = await readFile(this.filePath, 'utf8');
            return parseData(JSON.parse(raw));
        }
        catch {
            // No local copy yet, or it cannot be read.
            return undefined;
        }
    }
    async writeFile() {
        if (this.filePath === undefined)
            return;
        const directory = path.dirname(this.filePath);
        const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
            await rename(temporary, this.filePath);
        }
        catch {
            await rm(temporary, { force: true }).catch(() => undefined);
        }
    }
    get settings() {
        return { ...this.data.settings };
    }
    get devices() {
        return this.data.devices.map((device) => ({ ...device }));
    }
    get listeners() {
        return this.data.listeners.map((listener) => ({ ...listener }));
    }
    get activeListenerId() {
        return this.data.activeListenerId;
    }
    activeListener() {
        return this.data.listeners.find((listener) => listener.id === this.data.activeListenerId)
            ?? this.data.listeners[0]
            ?? defaultListener();
    }
    get activeDeviceId() {
        return this.data.activeDeviceId;
    }
    activeDevice() {
        return this.data.devices.find((device) => device.id === this.data.activeDeviceId);
    }
    findDevice(idOrName) {
        const needle = idOrName.trim();
        if (needle === '')
            return undefined;
        const lower = needle.toLowerCase();
        return this.data.devices.find((device) => device.id === needle)
            ?? this.data.devices.find((device) => device.name.toLowerCase() === lower);
    }
    async save() {
        // The local data file is the primary store: it always exists, even when
        // the DSH credential service is unavailable.
        await this.writeFile();
        if (this.credentials === undefined)
            return;
        try {
            await this.credentials.modifyRecord(this.key, async () => ({
                kind: 'grant',
                payload: this.data,
            }));
        }
        catch {
            // The local copy already holds the state; the record catches up later.
        }
    }
    async setActive(id) {
        this.data.activeDeviceId = id !== null && this.data.devices.some((device) => device.id === id)
            ? id
            : null;
        await this.save();
    }
    async upsert(device) {
        const index = this.data.devices.findIndex((entry) => entry.id === device.id);
        if (index >= 0) {
            const previous = this.data.devices[index];
            this.data.devices[index] = {
                ...device,
                createdAt: previous?.createdAt ?? device.createdAt,
                updatedAt: Date.now(),
            };
        }
        else {
            this.data.devices.push({ ...device, updatedAt: Date.now() });
        }
        await this.save();
    }
    async removeDevice(id) {
        const index = this.data.devices.findIndex((device) => device.id === id);
        if (index < 0)
            return undefined;
        const [removed] = this.data.devices.splice(index, 1);
        if (this.data.activeDeviceId === id)
            this.data.activeDeviceId = null;
        await this.save();
        return removed;
    }
    async createListener(nameValue) {
        const name = listenerName(nameValue);
        if (this.data.listeners.length >= MAX_LISTENERS)
            throw new Error(`At most ${MAX_LISTENERS} listener profiles`);
        const listener = { id: `l-${randomId()}`, name, createdAt: Date.now() };
        this.data.listeners.push(listener);
        this.data.activeListenerId = listener.id;
        await this.save();
        return { ...listener };
    }
    async renameListener(id, nameValue) {
        const listener = this.data.listeners.find((entry) => entry.id === id);
        if (listener === undefined)
            return undefined;
        listener.name = listenerName(nameValue);
        await this.save();
        return { ...listener };
    }
    async setActiveListener(id) {
        if (!this.data.listeners.some((listener) => listener.id === id))
            return false;
        this.data.activeListenerId = id;
        await this.save();
        return true;
    }
    async removeListener(id) {
        if (this.data.listeners.length <= 1)
            return false;
        const index = this.data.listeners.findIndex((listener) => listener.id === id);
        if (index < 0)
            return false;
        this.data.listeners.splice(index, 1);
        if (this.data.activeListenerId === id)
            this.data.activeListenerId = this.data.listeners[0].id;
        await this.save();
        return true;
    }
    async updateSettings(patch) {
        this.data.settings = sanitizeSettings({ ...this.data.settings, ...patch });
        await this.save();
        return this.settings;
    }
    async reset() {
        this.data = defaultData();
        if (this.filePath !== undefined) {
            await rm(this.filePath, { force: true }).catch(() => undefined);
        }
        if (this.credentials !== undefined) {
            try {
                await this.credentials.deleteRecord(this.key);
            }
            catch {
                // The in-memory reset is still authoritative for this run.
            }
        }
    }
    views(last, webUrls) {
        return this.data.devices.map((device) => ({
            id: device.id,
            name: device.name,
            mode: device.mode,
            transport: device.mode === 'fnid'
                ? 'fnid'
                : device.mode === 'auto'
                    ? 'auto'
                    : (device.unixPath !== undefined || (device.address ?? '').startsWith('unix://') || (device.address ?? '').startsWith('/'))
                        ? 'unix'
                        : 'direct',
            ...(device.fnid !== undefined ? { fnid: device.fnid } : {}),
            ...(device.address !== undefined ? { address: device.address } : {}),
            tokenSet: device.token !== '',
            allowSelfSigned: device.allowSelfSigned,
            ...(device.accountName !== undefined ? { accountName: device.accountName } : {}),
            createdAt: device.createdAt,
            updatedAt: device.updatedAt,
            active: device.id === this.data.activeDeviceId,
            ...(last.get(device.id) !== undefined ? { last: last.get(device.id) } : {}),
            ...(webUrls.get(device.id) !== undefined ? { webUrl: webUrls.get(device.id) } : {}),
        }));
    }
}
