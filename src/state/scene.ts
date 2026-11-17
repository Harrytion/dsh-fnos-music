/** Time/manual local scenes; no weather or online source. */
import type { Result, SceneId, TrackRef } from '../types.js';
import type { ProfileService } from './profile.js';
import type { LibraryService } from './library.js';

export type ResolvedScene = Exclude<SceneId, 'auto'>;

export function sceneForHour(hour: number): ResolvedScene {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'focus';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late';
}

export class SceneService {
  constructor(
    private readonly profile: ProfileService,
    private readonly library: LibraryService,
  ) {}

  resolve(scene: SceneId): ResolvedScene {
    return scene === 'auto' ? sceneForHour(new Date().getHours()) : scene;
  }

  async tracks(sceneInput: SceneId, limit = 20, signal?: AbortSignal): Promise<Result<{ scene: ResolvedScene; items: TrackRef[]; fallback: boolean }>> {
    const scene = this.resolve(sceneInput);
    const wanted = Math.max(1, Math.min(50, limit));
    const items = new Map<string, TrackRef>();
    let fallback = false;
    if (scene === 'instrumental') {
      const result = await this.library.search({ kind: 'track', hasLyric: false, limit: wanted, signal });
      if (result.ok === true) for (const track of result.data.items as TrackRef[]) items.set(track.id, track);
    } else if (scene === 'focus') {
      const profile = await this.profile.recommend(wanted, signal);
      if (profile.ok === true) for (const track of profile.data.items) items.set(track.id, track);
      if (items.size < wanted) {
        const instrumental = await this.library.search({ kind: 'track', hasLyric: false, limit: wanted, signal });
        if (instrumental.ok === true) for (const track of instrumental.data.items as TrackRef[]) items.set(track.id, track);
      }
    } else {
      const profile = await this.profile.recommend(wanted, signal);
      if (profile.ok === true) for (const track of profile.data.items) items.set(track.id, track);
    }
    if (items.size < wanted) {
      fallback = true;
      const more = await this.library.search({ kind: 'track', lossless: true, limit: wanted, signal });
      if (more.ok === true) for (const track of more.data.items as TrackRef[]) items.set(track.id, track);
    }
    if (items.size === 0) {
      const page = await this.library.listTracks(0, Math.min(50, wanted), signal);
      if (page.ok !== true) return page;
      for (const track of page.data.items) items.set(track.id, track);
    }
    const result = [...items.values()].slice(0, wanted);
    if (result.length === 0) return { ok: false, error: { code: 'not_found', message: 'No local tracks are available for this scene' } };
    return { ok: true, data: { scene, items: result, fallback } };
  }
}
