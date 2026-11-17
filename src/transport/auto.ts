/**
 * Auto transport: prefer a reachable direct/LAN endpoint, otherwise FNID.
 * Selection is cached until a probe or a network-class failure forces it to
 * re-evaluate; auth errors never fail over because the token is the same.
 */
import type {
  DirectVia,
  FnosError,
  FnosTarget,
  LogEntry,
  ProbeLayers,
  RequestOptions,
  Result,
  StreamOptions,
  StreamResponse,
} from '../types.js';
import { fail } from '../errors.js';
import type { Transport, TransportOptions } from './contract.js';
import { createDirectTransport } from './direct.js';
import { createFnidTransport } from './fnid.js';

const FAILOVER_CODES = new Set<FnosError['code']>([
  'network', 'dns', 'refused', 'tls', 'gateway_timeout', 'gateway_unreachable',
  'device_offline', 'relay_timeout', 'relay_rejected', 'service_missing',
]);

export interface AutoTransportDeps {
  createDirect?: (target: FnosTarget, options?: Pick<TransportOptions, 'onLog'>) => Result<Transport>;
  createFnid?: (target: FnosTarget, options?: Pick<TransportOptions, 'onLog'>) => Result<Transport>;
}

function reachable(layers: ProbeLayers): boolean {
  return layers.gateway.ok === true
    && layers.device.ok === true
    && (layers.service.ok === true || layers.service.code === 'auth' || layers.service.code === 'business');
}

function better(layers: ProbeLayers): boolean {
  return layers.gateway.ok === true && layers.device.ok === true;
}

export class AutoTransport implements Transport {
  readonly kind = 'auto' as const;
  private readonly direct: Transport;
  private readonly fnid: Transport;
  private selected: Transport | null = null;

  constructor(target: FnosTarget, direct: Transport, fnid: Transport) {
    this.direct = direct;
    this.fnid = fnid;
  }

  get via(): DirectVia {
    return this.selected?.via ?? this.direct.via;
  }

  get base(): string {
    return this.selected?.base ?? this.direct.base;
  }

  get relay(): boolean {
    return this.selected?.relay ?? this.direct.relay;
  }

  private select(transport: Transport): void {
    this.selected = transport;
  }

  async probe(): Promise<ProbeLayers> {
    const directLayers = await this.direct.probe();
    if (reachable(directLayers)) {
      this.select(this.direct);
      return directLayers;
    }
    const fnidLayers = await this.fnid.probe();
    if (reachable(fnidLayers) || (better(fnidLayers) && !better(directLayers))) {
      this.select(this.fnid);
      return fnidLayers;
    }
    // Keep the direct path when both fail: it gives the most specific
    // LAN/TLS error in the status bar.
    this.select(this.direct);
    return directLayers;
  }

  private async ensureSelected(): Promise<Transport> {
    if (this.selected !== null) return this.selected;
    await this.probe();
    return this.selected ?? this.direct;
  }

  private async retry<T>(
    call: (transport: Transport) => Promise<Result<T>>,
    allowFailover: boolean,
  ): Promise<Result<T>> {
    const first = await this.ensureSelected();
    const result = await call(first);
    if (result.ok === true) return result;
    if (!allowFailover || !FAILOVER_CODES.has(result.error.code)) return result;
    const other = first === this.direct ? this.fnid : this.direct;
    const retried = await call(other);
    if (retried.ok === true) {
      this.select(other);
      return retried;
    }
    return retried.error.code === 'cancelled' ? retried : result;
  }

  request<T>(path: string, options?: RequestOptions): Promise<Result<T>> {
    const method = options && options.method ? options.method : 'GET';
    // A POST may already have mutated the NAS even if its response was lost;
    // replaying it on the other path would duplicate playlist/favorite writes.
    return this.retry((transport) => transport.request<T>(path, options), method === 'GET' || method === 'HEAD');
  }

  stream(path: string, options?: StreamOptions): Promise<Result<StreamResponse>> {
    return this.retry((transport) => transport.stream(path, options), true);
  }

  async login(username: string, password: string): Promise<Result<{ token: string; user: string }>> {
    const direct = await this.direct.login(username, password);
    if (direct.ok === true) {
      this.select(this.direct);
      return direct;
    }
    if (!FAILOVER_CODES.has(direct.error.code)) return direct;
    const fnid = await this.fnid.login(username, password);
    if (fnid.ok === true) {
      this.select(this.fnid);
      return fnid;
    }
    return direct;
  }

  setToken(token: string): void {
    this.direct.setToken(token);
    this.fnid.setToken(token);
  }

  dispose(): void {
    this.selected = null;
    this.direct.dispose();
    this.fnid.dispose();
  }
}

export function createAutoTransport(
  target: FnosTarget,
  options: Pick<TransportOptions, 'onLog'> = {},
  deps: AutoTransportDeps = {},
): Result<AutoTransport> {
  if (target.fnid === undefined || target.fnid.trim() === '') {
    return fail('bad_request', 'Auto mode requires an FN ID');
  }
  if (target.address === undefined || target.address.trim() === '') {
    return fail('bad_request', 'Auto mode requires a direct address');
  }
  const direct = (deps.createDirect ?? createDirectTransport)(target, options);
  if (direct.ok !== true) return direct;
  const fnid = (deps.createFnid ?? createFnidTransport)(target, options);
  if (fnid.ok !== true) {
    direct.data.dispose();
    return fnid;
  }
  return { ok: true, data: new AutoTransport(target, direct.data, fnid.data) };
}
