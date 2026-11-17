/**
 * Active-device lifecycle: create the transport, probe the three layers,
 * broadcast status, and reconnect with exponential backoff. Auth failures stop
 * automatic retries so a bad token does not hammer the NAS.
 */
import type {
  ConnectionView,
  FnosError,
  FnosTarget,
  LogEntry,
  ProbeLayers,
  Result,
  StreamOptions,
  StreamResponse,
} from '../types.js';
import { fail, makeError } from '../errors.js';
import { createTransport, transportKindOf, type Transport } from '../transport/index.js';
import type { Vault } from './vault.js';

const MAX_BACKOFF_MS = 30_000;
const RELAY_SLOW_MS = 800;

export const IDLE_CONNECTION: ConnectionView = {
  phase: 'idle',
  layers: {
    gateway: { ok: false, latencyMs: 0 },
    device: { ok: false, latencyMs: 0 },
    service: { ok: false, latencyMs: 0 },
  },
  latencyMs: 0,
  slowRelay: false,
  checkedAt: 0,
  transport: 'direct',
};

export function nextBackoffMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt, 5));
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** exponent);
}

export interface ConnectionDeps {
  onLog?: (entry: LogEntry) => void;
  onStatus?: (view: ConnectionView) => void;
}

export class ConnectionManager {
  private transport: Transport | null = null;
  private device: FnosTarget | null = null;
  private view: ConnectionView = { ...IDLE_CONNECTION };
  private timer: NodeJS.Timeout | undefined;
  private probing: Promise<ConnectionView> | undefined;
  private attempts = 0;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly vault: Vault,
    private readonly deps: ConnectionDeps = {},
  ) {}

  get currentDevice(): FnosTarget | null {
    return this.device;
  }

  get currentTransport(): Transport | null {
    return this.transport;
  }

  status(): ConnectionView {
    return {
      ...this.view,
      layers: {
        gateway: { ...this.view.layers.gateway },
        device: { ...this.view.layers.device },
        service: { ...this.view.layers.service },
      },
    };
  }

  async start(): Promise<void> {
    this.generation += 1;
    this.device = this.vault.activeDevice() ?? null;
    if (this.device === null) {
      this.setView({ ...IDLE_CONNECTION, transport: 'direct' });
      return;
    }
    if (this.buildTransport()) await this.probe();
  }

  async setActive(device: FnosTarget | undefined): Promise<void> {
    this.generation += 1;
    this.probing = undefined;
    this.clearTimer();
    this.transport?.dispose();
    this.transport = null;
    this.device = device ?? null;
    this.attempts = 0;
    if (this.device === null) {
      this.setView({ ...IDLE_CONNECTION, transport: 'direct' });
      return;
    }
    if (this.buildTransport()) await this.probe();
  }

  private buildTransport(): boolean {
    if (this.device === null) return false;
    const created = createTransport(this.device, this.deps.onLog);
    if (created.ok !== true) {
      this.setView({
        ...IDLE_CONNECTION,
        phase: 'offline',
        transport: transportKindOf(this.device),
        code: created.error.code,
        message: created.error.message,
        hint: created.error.hint,
        checkedAt: Date.now(),
      });
      return false;
    }
    this.transport = created.data;
    return true;
  }

  private setView(next: ConnectionView): void {
    this.view = next;
    this.deps.onStatus?.(this.status());
  }

  async probe(): Promise<ConnectionView> {
    if (this.disposed) return this.status();
    if (this.device === null) {
      const idle = { ...IDLE_CONNECTION };
      this.setView(idle);
      return idle;
    }
    if (this.probing !== undefined) return this.probing;
    if (this.transport === null && !this.buildTransport()) return this.status();

    const generation = this.generation;
    const kind = transportKindOf(this.device);
    this.setView({ ...this.view, phase: 'probing', transport: kind, checkedAt: Date.now() });
    const run = (async (): Promise<ConnectionView> => {
      const transport = this.transport;
      if (transport === null) {
        return this.applyProbe({
          gateway: { ok: false, latencyMs: 0, code: 'network' },
          device: { ok: false, latencyMs: 0, code: 'network' },
          service: { ok: false, latencyMs: 0, code: 'network' },
        }, kind, generation);
      }
      let layers: ProbeLayers;
      try {
        layers = await transport.probe();
      } catch (error) {
        const mapped = makeError('network', error instanceof Error ? error.message : 'Probe failed');
        layers = {
          gateway: { ok: false, latencyMs: 0, code: mapped.code, message: mapped.message },
          device: { ok: false, latencyMs: 0, code: mapped.code, message: mapped.message },
          service: { ok: false, latencyMs: 0, code: mapped.code, message: mapped.message },
        };
      }
      return this.applyProbe(layers, kind, generation);
    })();
    this.probing = run;
    const result = await run;
    if (this.probing === run) this.probing = undefined;
    return result;
  }

  private applyProbe(layers: ProbeLayers, kind: ConnectionView['transport'], generation: number): ConnectionView {
    if (generation !== this.generation) return this.status();
    const latencyMs = Math.max(
      layers.gateway.latencyMs,
      layers.device.latencyMs,
      layers.service.latencyMs,
    );
    const via = this.transport?.via;
    const slowRelay = via === 'fnid' && latencyMs > RELAY_SLOW_MS;
    let phase: ConnectionView['phase'];
    let error: FnosError | undefined;
    if (layers.gateway.ok !== true) {
      phase = 'offline';
      error = this.layerError(layers.gateway);
    } else if (layers.device.ok !== true) {
      phase = 'offline';
      error = this.layerError(layers.device);
    } else if (layers.service.ok !== true) {
      phase = layers.service.code === 'service_missing' ? 'service-missing' : 'offline';
      error = this.layerError(layers.service);
    } else if (layers.service.code === 'auth') {
      phase = 'auth';
      error = makeError('auth', layers.service.message ?? 'Token rejected');
    } else if (layers.service.code === 'business') {
      phase = 'degraded';
      error = makeError('business', layers.service.message ?? 'Service business error');
    } else {
      phase = slowRelay ? 'degraded' : 'online';
    }

    if (phase === 'online' || phase === 'degraded') {
      if (phase === 'online') this.attempts = 0;
    } else if (phase !== 'auth') {
      this.attempts += 1;
    }

    const view: ConnectionView = {
      phase,
      layers,
      latencyMs,
      slowRelay,
      ...(error !== undefined ? { code: error.code, message: error.message, hint: error.hint } : {}),
      checkedAt: Date.now(),
      transport: kind,
      ...(via !== undefined ? { via } : {}),
    };
    this.setView(view);
    this.schedule();
    return view;
  }

  private layerError(layer: ProbeLayers['gateway']): FnosError {
    const code = layer.code ?? 'network';
    return makeError(code, layer.message ?? code);
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed || this.device === null) return;
    if (this.view.phase === 'auth') return;
    const interval = this.view.phase === 'online' || this.view.phase === 'degraded'
      ? Math.max(10, this.vault.settings.probeIntervalSec) * 1000
      : Math.round(nextBackoffMs(this.attempts) * (0.8 + Math.random() * 0.4));
    const delay = this.view.phase === 'service-missing'
      ? Math.max(interval, Math.max(10, this.vault.settings.probeIntervalSec) * 1000)
      : interval;
    this.timer = setTimeout(() => {
      void this.probe();
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Note an error observed by a bridge call and update the status line. */
  noteError(error: FnosError): void {
    if (error.code === 'auth') {
      this.setView({
        ...this.view,
        phase: 'auth',
        code: 'auth',
        message: error.message,
        hint: error.hint,
        checkedAt: Date.now(),
        transport: this.device === null ? this.view.transport : transportKindOf(this.device),
        ...(this.transport !== null ? { via: this.transport.via } : {}),
      });
      this.clearTimer();
      return;
    }
    if (['network', 'dns', 'refused', 'tls', 'gateway_timeout', 'gateway_unreachable', 'device_offline', 'relay_timeout', 'relay_rejected', 'service_missing'].includes(error.code)) {
      this.setView({
        ...this.view,
        phase: error.code === 'service_missing' ? 'service-missing' : 'offline',
        code: error.code,
        message: error.message,
        hint: error.hint,
        checkedAt: Date.now(),
        transport: this.device === null ? this.view.transport : transportKindOf(this.device),
        ...(this.transport !== null ? { via: this.transport.via } : {}),
      });
      this.attempts += 1;
      this.schedule();
    }
  }

  async request<T>(path: string, options: import('../types.js').RequestOptions = {}): Promise<Result<T>> {
    const transport = this.transport;
    if (transport === null) {
      const error = this.device === null
        ? makeError('no_active_device', 'No active device')
        : makeError('not_configured', 'Transport is not ready');
      return { ok: false, error };
    }
    const result = await transport.request<T>(path, options);
    if (result.ok !== true) {
      this.noteError(result.error);
    } else if (this.view.transport === 'auto' && this.view.via !== transport.via) {
      this.setView({ ...this.view, via: transport.via, checkedAt: Date.now() });
    }
    return result;
  }

  async stream(path: string, options: StreamOptions = {}): Promise<Result<StreamResponse>> {
    const transport = this.transport;
    if (transport === null) {
      return fail('no_active_device', 'No active device');
    }
    const result = await transport.stream(path, options);
    if (result.ok !== true) {
      this.noteError(result.error);
    } else if (this.view.transport === 'auto' && this.view.via !== transport.via) {
      this.setView({ ...this.view, via: transport.via, checkedAt: Date.now() });
    }
    return result;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.clearTimer();
    this.transport?.dispose();
    this.transport = null;
    this.device = null;
  }
}
