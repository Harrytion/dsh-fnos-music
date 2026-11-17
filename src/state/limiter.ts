/**
 * Bounded concurrency with a minimum gap between starts. Used for library and
 * search calls so a large library never floods the NAS or the DSH event loop.
 */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private nextStart = 0;

  constructor(
    private max: number,
    private minGapMs: number,
  ) {}

  setMax(max: number): void {
    this.max = Math.max(1, Math.min(6, Math.round(max)));
    this.drain();
  }

  setGap(ms: number): void {
    this.minGapMs = Math.max(0, Math.round(ms));
  }

  private drain(): void {
    while (this.active < this.max && this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve?.();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (this.active >= this.max) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          const index = this.waiting.indexOf(wrapped);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        };
        const wrapped = (): void => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });
        this.waiting.push(wrapped);
      });
    }
    const delay = this.nextStart - Date.now();
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        timer.unref?.();
      });
    }
    this.active += 1;
    this.nextStart = Date.now() + this.minGapMs;
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
