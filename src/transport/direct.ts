/**
 * LAN / reverse-proxy / Unix-socket transport.
 *
 * The address may be an IP, a hostname, a full URL with a reverse-proxy path,
 * or a Unix socket path. The fnOS Music API always sits under `/music/api/v1`.
 */
import type { FnosTarget, ProbeLayers, Result } from '../types.js';
import { fail } from '../errors.js';
import {
  DirectAddress,
  HttpTransportBase,
  classifyServiceProbe,
  isPrivateHost,
  isRelayHostname,
  normalizeDirectAddress,
  tcpProbe,
} from './http.js';
import type { TransportOptions } from './contract.js';

export class DirectTransport extends HttpTransportBase {
  private readonly address: DirectAddress;

  constructor(target: FnosTarget, address: DirectAddress, options: Pick<TransportOptions, 'onLog'> = {}) {
    const relay = address.relay;
    const hostname = new URL(address.base).hostname;
    const allowSelfSigned = target.allowSelfSigned && !relay && isPrivateHost(hostname);
    super(
      address.kind,
      target,
      address.base,
      relay,
      address.socketPath,
      allowSelfSigned,
      options,
    );
    this.address = address;
  }

  get via(): 'direct' | 'unix' {
    return this.address.kind;
  }

  async probe(): Promise<ProbeLayers> {
    const gateway = await tcpProbe(this.address.base, this.address.socketPath, 6000);
    if (gateway.ok !== true) {
      return {
        gateway,
        device: { ...gateway, ok: false },
        service: { ...gateway, ok: false },
      };
    }
    const raw = await this.raw('/user/me', { timeoutMs: 6000 });
    const service = classifyServiceProbe(raw, this.relay);
    const device = {
      ok: true,
      latencyMs: gateway.latencyMs,
    } as const;
    return { gateway, device, service };
  }

  get webUrl(): string | undefined {
    if (this.address.kind === 'unix') return undefined;
    return this.relay ? this.address.base : this.address.base;
  }
}

export function createDirectTransport(
  target: FnosTarget,
  options: Pick<TransportOptions, 'onLog'> = {},
): Result<DirectTransport> {
  const rawAddress = (target.address ?? '').trim() || (target.unixPath ?? '').trim();
  const normalized = normalizeDirectAddress(rawAddress);
  if (normalized.ok !== true) return { ok: false, error: normalized.error };
  try {
    return { ok: true, data: new DirectTransport(target, normalized.data, options) };
  } catch (error) {
    return fail('bad_request', error instanceof Error ? error.message : 'Invalid device address');
  }
}

/** Exported for the tests and for the settings-page hints. */
export function directLabels(address: string): { kind: 'direct' | 'unix'; relay: boolean; host: string } | undefined {
  const normalized = normalizeDirectAddress(address);
  if (normalized.ok !== true) return undefined;
  const host = normalized.data.base.startsWith('http')
    ? new URL(normalized.data.base).hostname
    : normalized.data.socketPath ?? '';
  return {
    kind: normalized.data.kind,
    relay: normalized.data.relay || isRelayHostname(host),
    host,
  };
}
