/**
 * Bounded concurrency with a minimum gap between starts. Used for library and
 * search calls so a large library never floods the NAS or the DSH event loop.
 */
export class Limiter {
    max;
    minGapMs;
    active = 0;
    waiting = [];
    nextStart = 0;
    constructor(max, minGapMs) {
        this.max = max;
        this.minGapMs = minGapMs;
    }
    setMax(max) {
        this.max = Math.max(1, Math.min(6, Math.round(max)));
        this.drain();
    }
    setGap(ms) {
        this.minGapMs = Math.max(0, Math.round(ms));
    }
    drain() {
        while (this.active < this.max && this.waiting.length > 0) {
            const resolve = this.waiting.shift();
            resolve?.();
        }
    }
    async acquire(signal) {
        if (signal?.aborted === true) {
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
        }
        if (this.active >= this.max) {
            await new Promise((resolve, reject) => {
                const onAbort = () => {
                    const index = this.waiting.indexOf(wrapped);
                    if (index >= 0)
                        this.waiting.splice(index, 1);
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                };
                const wrapped = () => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve();
                };
                if (signal !== undefined)
                    signal.addEventListener('abort', onAbort, { once: true });
                this.waiting.push(wrapped);
            });
        }
        const delay = this.nextStart - Date.now();
        if (delay > 0) {
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, delay);
                timer.unref?.();
            });
        }
        this.active += 1;
        this.nextStart = Date.now() + this.minGapMs;
    }
    release() {
        this.active = Math.max(0, this.active - 1);
        this.drain();
    }
    async run(task, signal) {
        await this.acquire(signal);
        try {
            return await task();
        }
        finally {
            this.release();
        }
    }
}
