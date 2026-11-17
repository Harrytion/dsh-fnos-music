/** Continuous local AI DJ state: a pool supplied by the model, a scene, or similar-track replenishment. */
import type { DjState, SceneId, TrackRef } from '../types.js';

export class DjService {
  private enabled = false;
  private mode: 'similar' | 'pool' | 'scene' = 'similar';
  private scene: SceneId | null = null;
  private pool: TrackRef[] = [];
  private cursor = 0;
  private updatedAt = Date.now();

  start(pool: TrackRef[], mode: 'pool' | 'scene', scene: SceneId | null): DjState {
    this.enabled = true;
    this.pool = pool.slice(0, 200).map((track) => ({ ...track }));
    this.cursor = 0;
    this.mode = mode;
    this.scene = scene;
    this.updatedAt = Date.now();
    return this.status();
  }

  stop(): DjState {
    this.enabled = false;
    this.pool = [];
    this.cursor = 0;
    this.scene = null;
    this.mode = 'similar';
    this.updatedAt = Date.now();
    return this.status();
  }

  setEnabled(enabled: boolean): DjState {
    this.enabled = enabled;
    this.updatedAt = Date.now();
    if (!enabled) {
      this.pool = [];
      this.cursor = 0;
    }
    return this.status();
  }

  takeNext(exclude: Set<string>): TrackRef | undefined {
    while (this.cursor < this.pool.length) {
      const track = this.pool[this.cursor];
      this.cursor += 1;
      if (track !== undefined && !exclude.has(track.id)) {
        this.updatedAt = Date.now();
        return { ...track };
      }
    }
    return undefined;
  }

  replenish(tracks: TrackRef[]): void {
    const existing = new Set(this.pool.map((track) => track.id));
    for (const track of tracks) {
      if (!existing.has(track.id)) {
        this.pool.push({ ...track });
        existing.add(track.id);
      }
      if (this.pool.length >= 200) break;
    }
    this.updatedAt = Date.now();
  }

  get remaining(): number {
    return Math.max(0, this.pool.length - this.cursor);
  }

  get state(): DjState {
    return this.status();
  }

  status(): DjState {
    return {
      enabled: this.enabled,
      mode: this.mode,
      scene: this.scene,
      poolTotal: this.pool.length,
      poolRemaining: this.remaining,
      updatedAt: this.updatedAt,
    };
  }
}
