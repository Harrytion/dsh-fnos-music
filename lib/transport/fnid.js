import { fail } from '../errors.js';
import { HttpTransportBase, classifyServiceProbe, normalizeFnid, relayCandidates, tryJson, } from './http.js';
const RESOLVE_TTL_MS = 10 * 60 * 1000;
const RESOLVE_TIMEOUT_MS = 6000;
export class FnidTransport extends HttpTransportBase {
    fnid;
    cachedBase;
    cachedAt = 0;
    resolving;
    lastGatewayLatency = 0;
    constructor(target, fnid, options = {}) {
        super('fnid', target, `https://${fnid}.fnos.net`, true, undefined, false, options);
        this.fnid = fnid;
    }
    get via() {
        return 'fnid';
    }
    get webUrl() {
        return this.cachedBase ?? `https://${this.fnid}.fnos.net`;
    }
    async ensureBase() {
        if (this.cachedBase !== undefined && Date.now() - this.cachedAt < RESOLVE_TTL_MS) {
            return { ok: true, data: this.cachedBase };
        }
        if (this.resolving !== undefined)
            return this.resolving;
        const resolving = this.resolve();
        this.resolving = resolving;
        const result = await resolving;
        this.resolving = undefined;
        if (result.ok === true) {
            this.cachedBase = result.data;
            this.cachedAt = Date.now();
            this.baseUrl = result.data;
        }
        return result;
    }
    async resolve() {
        const candidates = relayCandidates(this.fnid);
        const answers = await Promise.all(candidates.map(async (base) => {
            const raw = await this.rawAt(base, '/user/me', {
                anonymous: true,
                timeoutMs: RESOLVE_TIMEOUT_MS,
            });
            return { base, raw };
        }));
        let offline = false;
        let lastError;
        for (const answer of answers) {
            const raw = answer.raw;
            if (raw.error !== undefined) {
                lastError = { ok: false, error: raw.error };
                continue;
            }
            this.lastGatewayLatency = raw.ms;
            const status = raw.status ?? 0;
            const json = tryJson(raw.body);
            const contentType = (raw.headers['content-type'] ?? '').toLowerCase();
            if (status === 200 || status === 401 || status === 403) {
                // A JSON API answer (even auth) proves this cluster fronts the FN ID.
                if (json !== undefined || contentType.includes('application/json')) {
                    return { ok: true, data: answer.base };
                }
                offline = true;
                continue;
            }
            if (status === 404 || contentType.includes('text/html') || status >= 300) {
                offline = true;
            }
        }
        if (offline) {
            return fail('device_offline', 'Neither FN Connect cluster reached this device', {
                detail: 'The relay answered, but not with the fnOS music API.',
            });
        }
        if (lastError !== undefined)
            return lastError;
        return fail('relay_rejected', 'FN Connect relay did not answer for this FN ID');
    }
    async request(path, options = {}) {
        const base = await this.ensureBase();
        if (base.ok !== true)
            return { ok: false, error: base.error };
        return super.request(path, options);
    }
    async stream(path, options = {}) {
        const base = await this.ensureBase();
        if (base.ok !== true)
            return { ok: false, error: base.error };
        return super.stream(path, options);
    }
    async login(username, password) {
        const base = await this.ensureBase();
        if (base.ok !== true)
            return { ok: false, error: base.error };
        return super.login(username, password);
    }
    async probe() {
        const base = await this.ensureBase();
        if (base.ok !== true) {
            const code = base.error.code;
            const gatewayOk = code === 'device_offline';
            return {
                gateway: gatewayOk
                    ? { ok: true, latencyMs: this.lastGatewayLatency }
                    : { ok: false, latencyMs: 0, code, message: base.error.message },
                device: { ok: false, latencyMs: this.lastGatewayLatency, code: 'device_offline', message: base.error.message },
                service: { ok: false, latencyMs: this.lastGatewayLatency, code: 'device_offline', message: base.error.message },
            };
        }
        const raw = await this.rawAt(base.data, '/user/me', { timeoutMs: RESOLVE_TIMEOUT_MS });
        if (raw.error !== undefined) {
            const gatewayOk = !['network', 'dns', 'tls', 'gateway_timeout', 'relay_timeout', 'cancelled'].includes(raw.error.code);
            return {
                gateway: gatewayOk
                    ? { ok: true, latencyMs: raw.ms }
                    : { ok: false, latencyMs: raw.ms, code: raw.error.code, message: raw.error.message },
                device: { ok: false, latencyMs: raw.ms, code: 'device_offline', message: raw.error.message },
                service: { ok: false, latencyMs: raw.ms, code: raw.error.code, message: raw.error.message },
            };
        }
        const status = raw.status ?? 0;
        const contentType = (raw.headers['content-type'] ?? '').toLowerCase();
        const relayOffline = (status >= 300 && status < 400) || status >= 500 || contentType.includes('text/html');
        const service = classifyServiceProbe(raw, true);
        return {
            gateway: { ok: true, latencyMs: raw.ms },
            device: relayOffline
                ? { ok: false, latencyMs: raw.ms, code: 'device_offline', message: `Relay returned HTTP ${status}` }
                : { ok: true, latencyMs: raw.ms },
            service,
        };
    }
}
export function createFnidTransport(target, options = {}) {
    const normalized = normalizeFnid(target.fnid ?? '');
    if (normalized.ok !== true)
        return { ok: false, error: normalized.error };
    try {
        return { ok: true, data: new FnidTransport(target, normalized.data, options) };
    }
    catch (error) {
        return fail('bad_request', error instanceof Error ? error.message : 'Invalid FN ID');
    }
}
