/**
 * Optional background probe for saved (non-active) devices. It is deliberately
 * opt-in, skips auth-failed devices so a bad token cannot hammer the NAS, and
 * runs only while a browser client is connected.
 */
import type { FnosTarget, Settings } from '../types.js';

export interface DeviceProbeSchedulerDeps {
  devices: () => FnosTarget[];
  activeId: () => string | null;
  settings: () => Settings;
  hasClients: () => boolean;
  probe: (device: FnosTarget) => Promise<void>;
  skip?: (device: FnosTarget) => boolean;
  onRound?: () => void;
}

const MAX_PARALLEL = 2;

export class DeviceProbeScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private disposed = false;

  constructor(private readonly deps: DeviceProbeSchedulerDeps) {}

  start(): void {
    this.configure(this.deps.settings());
  }

  configure(settings: Settings): void {
    this.clearTimer();
    if (this.disposed || !settings.backgroundProbe) return;
    const interval = Math.max(60, Math.min(600, Math.trunc(settings.backgroundProbeIntervalSec) || 120)) * 1000;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.configure(this.deps.settings()));
    }, interval);
    this.timer.unref?.();
  }

  /** One round; public for tests and manual triggers. */
  async runOnce(): Promise<void> {
    if (this.disposed || this.running) return;
    const settings = this.deps.settings();
    if (!settings.backgroundProbe || !this.deps.hasClients()) return;
    const active = this.deps.activeId();
    const queue = this.deps.devices().filter((device) => device.id !== active && this.deps.skip?.(device) !== true);
    if (queue.length === 0) return;
    this.running = true;
    try {
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (!this.disposed && cursor < queue.length) {
          const device = queue[cursor];
          cursor += 1;
          if (device === undefined) return;
          try {
            await this.deps.probe(device);
          } catch {
            // A single broken device must not stop the round.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, queue.length) }, () => worker()));
      if (!this.disposed) this.deps.onRound?.();
    } finally {
      this.running = false;
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }
}
