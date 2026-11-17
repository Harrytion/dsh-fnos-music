/**
 * Shared HTTP plumbing for the two real transports.
 *
 * All fnOS calls use the native music session:
 *   Cookie: music-token=<userToken>[; mode=relay]
 *   X-Music-API: v1
 *
 * Redirects are never followed (a relay login redirect must not receive the
 * token on another host), TLS is strict unless the device explicitly allows a
 * self-signed LAN certificate, and every request is cancellable.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type {
  FnosError,
  FnosTarget,
  LogEntry,
  ProbeLayer,
  RawResponse,
  RequestOptions,
  Result,
  StreamOptions,
  StreamResponse,
  TransportKind,
} from '../types.js';
import { errorFromNode, fail, makeError } from '../errors.js';
import {
  API_PREFIX,
  MAX_JSON_BYTES,
  type Transport,
  type TransportOptions,
} from './contract.js';

const DEFAULT_HTTP_TIMEOUT = 12_000;
const RELAY_TIMEOUT = 20_000;
const MAX_REDIRECTS = 0;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isRelayHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'fnos.net'
    || host.endsWith('.fnos.net')
    || host === '5ddd.com'
    || host.endsWith('.5ddd.com');
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan')) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  if (host.includes(':')) {
    if (host === '::1') return true;
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  }
  return false;
}

/** Build the Cookie header used by every authenticated request. */
export function buildAuthCookie(token: string, relay: boolean): string | null {
  const parts: string[] = [];
  if (token !== '') parts.push(`music-token=${encodeURIComponent(token)}`);
  if (relay) parts.push('mode=relay');
  return parts.length === 0 ? null : parts.join('; ');
}

export interface DirectAddress {
  base: string;
  socketPath?: string;
  kind: 'direct' | 'unix';
  relay: boolean;
}

/**
 * Accept `ip[:port]`, `scheme://host[:port][/path]`, `unix:///abs/path` and a
 * bare absolute socket path. A pasted full FNID hostname is treated as a relay
 * host (always https, no fnOS port).
 */
export function normalizeDirectAddress(input: string): Result<DirectAddress> {
  const raw = input.trim();
  if (raw === '') return fail('bad_request', 'Device address is empty');
  if (raw.includes('\0')) return fail('bad_request', 'Device address contains a null byte');

  if (raw.startsWith('unix://') || (raw.startsWith('/') && !raw.startsWith('//'))) {
    const socketPath = raw.startsWith('unix://') ? raw.slice('unix://'.length) : raw;
    if (!socketPath.startsWith('/')) {
      return fail('bad_request', 'Unix socket path must be absolute', { hint: 'Unix Socket 请填写如 unix:///path/to/trim.music.sock 的绝对路径。' });
    }
    return { ok: true, data: { base: 'http://localhost', socketPath, kind: 'unix', relay: false } };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fail('bad_request', 'Invalid device address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('bad_request', 'Only http, https, and unix sockets are supported');
  }
  if (url.username !== '' || url.password !== '') {
    return fail('bad_request', 'Credentials must not be embedded in the address');
  }
  if (url.hostname === '') return fail('bad_request', 'Device host is empty');

  const relay = isRelayHostname(url.hostname);
  if (relay) {
    url.protocol = 'https:';
    url.port = '';
  } else if (url.port === '') {
    url.port = url.protocol === 'https:' ? '5667' : '5666';
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/music$/i.test(path)) path = path.slice(0, -'/music'.length);
  // A bare `/music/` paste becomes the origin; deeper reverse-proxy paths stay.
  const base = `${url.origin}${path}`;
  return { ok: true, data: { base, kind: 'direct', relay } };
}

/** A bare FN ID is one DNS label; `localhost` is never treated as an FN ID. */
export function normalizeFnid(input: string): Result<string> {
  const value = input.trim().toLowerCase();
  if (value === '') return fail('bad_request', 'FN ID is empty');
  if (value === 'localhost') return fail('bad_request', 'localhost is not an FN ID');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    return fail('bad_request', 'Invalid FN ID', {
      hint: 'FNID 只填字母/数字/短横线（例如 mynas），不要带域名、端口或路径。',
    });
  }
  return { ok: true, data: value };
}

export function relayCandidates(fnid: string): string[] {
  return [`https://${fnid}.fnos.net`, `https://${fnid}.5ddd.com`];
}

function hostPortOf(base: string, socketPath?: string): { host: string; port: number } {
  if (socketPath !== undefined) return { host: 'localhost', port: 0 };
  const url = new URL(base);
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
  };
}

function queryString(query: RequestOptions['query']): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const textValue = params.toString();
  return textValue === '' ? '' : `?${textValue}`;
}

function isJsonContentType(headers: Record<string, string | undefined>): boolean {
  const value = (headers['content-type'] ?? '').toLowerCase();
  return value.includes('application/json') || value.includes('text/plain');
}

function isHtmlContentType(headers: Record<string, string | undefined>): boolean {
  return (headers['content-type'] ?? '').toLowerCase().includes('text/html');
}

export function tryJson(buffer: Buffer | undefined): Record<string, unknown> | undefined {
  if (buffer === undefined || buffer.length === 0) return undefined;
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function userDisplayName(user: unknown, fallback = '飞牛音乐'): string {
  if (user === null || typeof user !== 'object') return fallback;
  const candidate = user as Record<string, unknown>;
  for (const key of ['nickname', 'name', 'username'] as const) {
    const value = text(candidate[key]);
    if (value !== '') return value;
  }
  return fallback;
}

/** Classify one already-sent probe request into the service layer. */
export function classifyServiceProbe(raw: RawResponse, relay: boolean): ProbeLayer {
  if (raw.error !== undefined) {
    return { ok: false, latencyMs: raw.ms, code: raw.error.code, message: raw.error.message };
  }
  const status = raw.status ?? 0;
  if (status === 401 || status === 403) {
    return { ok: true, latencyMs: raw.ms, code: 'auth', message: 'Token rejected' };
  }
  if (status === 404) {
    return { ok: false, latencyMs: raw.ms, code: 'service_missing', message: 'Music API not found' };
  }
  if (status >= 300 && status < 400) {
    return {
      ok: false,
      latencyMs: raw.ms,
      code: relay ? 'device_offline' : 'protocol',
      message: `HTTP ${status}`,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      latencyMs: raw.ms,
      code: relay ? 'device_offline' : 'server',
      message: `HTTP ${status}`,
    };
  }
  const json = tryJson(raw.body);
  if (json !== undefined) {
    const code = Number(json.code);
    if (code === 0 || code === 200) return { ok: true, latencyMs: raw.ms };
    if (code === 401 || code === 120001) {
      return { ok: true, latencyMs: raw.ms, code: 'auth', message: 'Token rejected' };
    }
    return { ok: true, latencyMs: raw.ms, code: 'business', message: text(json.msg) || `code ${String(json.code)}` };
  }
  if (isHtmlContentType(raw.headers)) {
    return {
      ok: false,
      latencyMs: raw.ms,
      code: 'service_missing',
      message: 'HTML login page instead of the music API',
    };
  }
  return { ok: false, latencyMs: raw.ms, code: 'protocol', message: 'Unexpected response' };
}

/** One TCP connect for the gateway layer; TLS/HTTP is checked by the probe request. */
export function tcpProbe(base: string, socketPath: string | undefined, timeoutMs = 6000): Promise<ProbeLayer> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (layer: ProbeLayer): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(layer);
    };
    const socket = socketPath !== undefined
      ? net.connect({ path: socketPath })
      : (() => {
        const { host, port } = hostPortOf(base);
        return net.connect({ host, port });
      })();
    const timer = setTimeout(() => {
      finish({ ok: false, latencyMs: Date.now() - started, code: 'gateway_timeout', message: 'TCP connect timed out' });
    }, timeoutMs);
    timer.unref?.();
    socket.once('connect', () => {
      clearTimeout(timer);
      finish({ ok: true, latencyMs: Date.now() - started });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      const mapped = errorFromNode(error, false);
      finish({ ok: false, latencyMs: Date.now() - started, code: mapped.code, message: mapped.message });
    });
  });
}

export async function readStreamBuffer(stream: IncomingMessage, maxBytes: number): Promise<Result<Buffer>> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > maxBytes) {
        stream.destroy();
        return fail('unsupported', 'Media response is too large');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    return { ok: false, error: errorFromNode(error, false) };
  }
  return { ok: true, data: Buffer.concat(chunks) };
}

/** Base class shared by DirectTransport and FnidTransport. */
export abstract class HttpTransportBase implements Transport {
  readonly kind: TransportKind;
  abstract get via(): import('../types.js').DirectVia;
  readonly relay: boolean;
  protected target: FnosTarget;
  protected token: string;
  protected allowSelfSigned: boolean;
  protected baseUrl: string;
  protected socketPath?: string;
  protected agent: http.Agent | https.Agent;
  protected onLog?: (entry: LogEntry) => void;
  protected disposed = false;
  private readonly activeStreams = new Set<IncomingMessage>();

  constructor(
    kind: TransportKind,
    target: FnosTarget,
    base: string,
    relay: boolean,
    socketPath: string | undefined,
    allowSelfSigned: boolean,
    options: Pick<TransportOptions, 'onLog'> = {},
  ) {
    this.kind = kind;
    this.target = target;
    this.baseUrl = base;
    this.relay = relay;
    this.socketPath = socketPath;
    this.token = target.token;
    this.allowSelfSigned = allowSelfSigned;
    this.onLog = options.onLog;
    const secure = base.startsWith('https://');
    this.agent = secure
      ? new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: !allowSelfSigned })
      : new http.Agent({ keepAlive: true, maxSockets: 4 });
  }

  get base(): string {
    return this.baseUrl;
  }

  setToken(token: string): void {
    this.token = token;
  }

  protected buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      accept: options.stream === true ? '*/*' : 'application/json',
      ...options.headers,
    };
    if (options.anonymous !== true) {
      headers['x-music-api'] = 'v1';
      const cookie = buildAuthCookie(this.token, this.relay);
      if (cookie !== null) headers.cookie = cookie;
    } else if (this.relay) {
      // Login is anonymous but the relay still needs its marker.
      headers.cookie = 'mode=relay';
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    return headers;
  }

  protected async rawAt(base: string, path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const started = Date.now();
    if (this.disposed) {
      return { headers: {}, error: makeError('cancelled', 'Transport disposed'), ms: 0 };
    }
    const urlText = `${base}${API_PREFIX}${path}${queryString(options.query)}`;
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      return { headers: {}, error: makeError('bad_request', 'Invalid fnOS URL'), ms: 0 };
    }
    const secure = url.protocol === 'https:';
    const method = options.method ?? 'GET';
    const timeoutMs = options.timeoutMs
      ?? (this.relay ? RELAY_TIMEOUT : DEFAULT_HTTP_TIMEOUT);
    const headers = this.buildHeaders(options);
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (payload !== undefined) headers['content-length'] = String(Buffer.byteLength(payload));

    return new Promise<RawResponse>((resolve) => {
      let settled = false;
      let timedOut = false;
      let responseSeen = false;
      let timer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;
      const finish = (value: RawResponse): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort !== undefined) options.signal?.removeEventListener('abort', onAbort);
        const responseBytes = value.body?.length ?? Math.max(0, Number(value.headers['content-length'] ?? 0) || 0);
        this.logRequest(method, path, value.status, Date.now() - started, value.error?.code, responseBytes);
        resolve(value);
      };

      const requestOptions: http.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: this.agent,
        ...(this.socketPath !== undefined ? { socketPath: this.socketPath } : {}),
        ...(secure ? { rejectUnauthorized: !this.allowSelfSigned } : {}),
      };

      let request: http.ClientRequest;
      try {
        request = (secure ? https.request : http.request)(requestOptions, (response) => {
          responseSeen = true;
          const responseHeaders: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
          }
          if (options.stream === true) {
            clearTimeout(timer);
            request.setTimeout(0);
            response.setTimeout(0);
            response.once('close', () => {
              this.activeStreams.delete(response);
            });
            this.activeStreams.add(response);
            finish({ status: response.statusCode ?? 0, headers: responseHeaders, stream: response, ms: Date.now() - started });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_JSON_BYTES) {
              response.destroy();
              finish({
                headers: responseHeaders,
                error: makeError('server', 'Response body is too large'),
                ms: Date.now() - started,
              });
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            finish({
              status: response.statusCode ?? 0,
              headers: responseHeaders,
              body: Buffer.concat(chunks),
              ms: Date.now() - started,
            });
          });
          response.on('error', (error) => {
            finish({ headers: responseHeaders, error: errorFromNode(error, this.relay), ms: Date.now() - started });
          });
        });
      } catch (error) {
        finish({ headers: {}, error: errorFromNode(error, this.relay), ms: Date.now() - started });
        return;
      }

      timer = setTimeout(() => {
        timedOut = true;
        request.destroy(new Error('timeout'));
      }, timeoutMs);
      timer.unref?.();

      onAbort = (): void => {
        request.destroy(new Error('aborted'));
      };
      if (options.signal !== undefined) {
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener('abort', onAbort, { once: true });
      }
      request.on('error', (error) => {
        const mapped = timedOut ? makeError('gateway_timeout', 'Request timed out') : errorFromNode(error, this.relay);
        if (responseSeen) mapped.code = mapped.code === 'network' ? 'network' : mapped.code;
        finish({ headers: {}, error: mapped, ms: Date.now() - started });
      });
      request.end(payload);
    });
  }

  protected async raw(path: string, options: RequestOptions = {}): Promise<RawResponse> {
    return this.rawAt(this.baseUrl, path, options);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
    const raw = await this.raw(path, options);
    if (raw.error !== undefined) return { ok: false, error: raw.error };
    return this.parseResult<T>(raw);
  }

  protected parseResult<T>(raw: RawResponse): Result<T> {
    const status = raw.status ?? 0;
    if (status === 401 || status === 403) {
      return fail('auth', `HTTP ${status}`, { status });
    }
    if (status === 404) {
      return fail('protocol', 'fnOS music API path not found', { status });
    }
    if (status >= 300 && status < 400) {
      return this.relay
        ? fail('relay_rejected', `FNID relay returned HTTP ${status}`, { status })
        : fail('protocol', `Unexpected HTTP ${status}`, { status });
    }
    if (status >= 500) {
      return fail('server', `fnOS service returned HTTP ${status}`, { status });
    }
    const json = tryJson(raw.body);
    if (json === undefined) {
      return fail(
        this.relay ? 'relay_rejected' : 'protocol',
        this.relay ? 'FNID relay did not return the music API' : 'fnOS music API did not return JSON',
        { status },
      );
    }
    const code = Number(json.code);
    if (code === 0 || code === 200) return { ok: true, data: (json.data ?? null) as T };
    if (code === 401 || code === 120001) {
      return fail('auth', text(json.msg) || 'Token rejected', { status, detail: `code ${String(json.code)}` });
    }
    return fail('business', text(json.msg) || `fnOS business code ${String(json.code)}`, {
      status,
      detail: `code ${String(json.code)}`,
    });
  }

  async stream(path: string, options: StreamOptions = {}): Promise<Result<StreamResponse>> {
    const raw = await this.raw(path, {
      ...options,
      method: options.method ?? 'GET',
      stream: true,
    });
    if (raw.error !== undefined) return { ok: false, error: raw.error };
    const status = raw.status ?? 0;
    if (status === 401 || status === 403) {
      raw.stream?.destroy();
      return fail('auth', `HTTP ${status}`, { status });
    }
    if (status >= 300 && status < 400) {
      raw.stream?.destroy();
      return this.relay
        ? fail('relay_rejected', `FNID relay returned HTTP ${status}`, { status })
        : fail('protocol', `Unexpected HTTP ${status}`, { status });
    }
    if (status >= 400) {
      raw.stream?.destroy();
      return fail(status >= 500 ? 'server' : 'protocol', `Media request failed with HTTP ${status}`, { status });
    }
    if (raw.stream === undefined) return fail('protocol', 'Media response has no body');
    return { ok: true, data: { status, headers: raw.headers, stream: raw.stream } };
  }

  async login(username: string, password: string): Promise<Result<{ token: string; user: string }>> {
    const result = await this.request<{ userToken?: unknown; user?: unknown }>('/user/password-login', {
      method: 'POST',
      anonymous: true,
      body: {
        username,
        password: sha256Hex(password),
        deviceId: this.target.deviceId,
      },
    });
    if (result.ok !== true) return result;
    const token = text(result.data?.userToken);
    if (token === '') return fail('protocol', 'Login response did not include userToken');
    this.token = token;
    return { ok: true, data: { token, user: userDisplayName(result.data?.user, username) } };
  }

  dispose(): void {
    this.disposed = true;
    for (const stream of this.activeStreams) stream.destroy();
    this.activeStreams.clear();
    this.agent.destroy();
  }

  private logRequest(method: string, path: string, status: number | undefined, ms: number, code: string | undefined, bytes = 0): void {
    if (this.onLog === undefined) return;
    this.onLog({
      at: Date.now(),
      kind: 'request',
      method,
      path,
      status,
      ms,
      bytes,
      via: this.via,
      code: code as LogEntry['code'],
    });
  }

  abstract probe(): Promise<import('../types.js').ProbeLayers>;
}

export type { FnosError };
