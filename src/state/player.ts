/**
 * The shared playback session.
 *
 * fnOS exposes no server-side player or queue, so this is deliberately a
 * plugin-owned state machine. It is authoritative for every connected DSH page
 * (SSE + driver lease); the official fnOS app is not part of this state. The
 * browser `<audio>` element is the clock and reports progress back here.
 */
import type { FnosError, PlayMode, PlayerState, Result, TrackRef } from '../types.js';
import { fail } from '../errors.js';

const MAX_QUEUE = 2000;
const CLIENT_TTL_MS = 25_000;

export interface QueueMutationResult {
  state: PlayerState;
  added: number;
  skipped: number;
  skippedIds: string[];
  duplicateIds: string[];
}

export interface PlayerDeps {
  rng?: () => number;
  onChange?: (state: PlayerState) => void;
}

function emptyState(deviceId: string | null): PlayerState {
  return {
    deviceId,
    queue: [],
    queueTotal: 0,
    queueRevision: 0,
    currentIndex: -1,
    track: null,
    order: [],
    cursor: -1,
    status: 'stopped',
    positionMs: 0,
    volume: 70,
    muted: false,
    mode: 'list',
    rev: 0,
    seekToken: 0,
    updatedAt: Date.now(),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export class PlayerService {
  private state: PlayerState;
  private readonly clients = new Map<string, number>();
  private readonly rng: () => number;

  constructor(private readonly deps: PlayerDeps = {}) {
    this.state = emptyState(null);
    this.rng = deps.rng ?? Math.random;
  }

  get deviceId(): string | null {
    return this.state.deviceId;
  }

  get queueRevision(): number {
    return this.state.queueRevision;
  }

  get driverClientId(): string | undefined {
    return this.state.driverClientId;
  }

  currentTrack(): TrackRef | null {
    return this.state.track;
  }

  /** Full internal state; callers must clone before serializing. */
  raw(): PlayerState {
    return this.state;
  }

  /** A serializable view; `queue` is windowed so player events stay small. */
  view(options: { queue?: boolean; limit?: number } = {}): PlayerState {
    const limit = clamp(options.limit ?? 200, 0, 1000);
    const queue = options.queue === false ? [] : this.state.queue.slice(0, limit);
    return {
      ...this.state,
      queue,
      order: [],
      track: this.state.track === null ? null : { ...this.state.track },
      queueTotal: this.state.queue.length,
    };
  }

  /** Player events omit the queue; the client refetches when queueRevision changes. */
  eventView(): PlayerState {
    return this.view({ queue: false });
  }

  queuePage(offset: number, limit: number): TrackRef[] {
    const start = clamp(offset, 0, Math.max(0, this.state.queue.length));
    const end = Math.min(this.state.queue.length, start + clamp(limit, 1, 200));
    return this.state.queue.slice(start, end).map((track) => ({ ...track }));
  }

  private emit(queueChanged = false): void {
    if (queueChanged) this.state.queueRevision += 1;
    this.state.queueTotal = this.state.queue.length;
    this.state.rev += 1;
    this.state.updatedAt = Date.now();
    this.deps.onChange?.(this.state);
  }

  private syncCurrent(): void {
    const index = this.state.cursor >= 0 && this.state.cursor < this.state.order.length
      ? this.state.order[this.state.cursor] ?? -1
      : -1;
    this.state.currentIndex = index;
    this.state.track = index >= 0 ? this.state.queue[index] ?? null : null;
  }

  private shuffleOrder(): number[] {
    const order = this.state.queue.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      const current = order[i] as number;
      order[i] = order[j] as number;
      order[j] = current;
    }
    return order;
  }

  private rebuildOrder(preserve: boolean): void {
    const oldTrackId = preserve ? this.state.track?.id : undefined;
    this.state.order = this.state.mode === 'shuffle' && this.state.queue.length > 1
      ? this.shuffleOrder()
      : this.state.queue.map((_, index) => index);
    if (this.state.order.length === 0) {
      this.state.cursor = -1;
      this.syncCurrent();
      return;
    }
    const found = oldTrackId === undefined
      ? -1
      : this.state.order.findIndex((queueIndex) => this.state.queue[queueIndex]?.id === oldTrackId);
    if (found >= 0) {
      this.state.cursor = found;
    } else {
      this.state.cursor = clamp(this.state.cursor, 0, this.state.order.length - 1);
    }
    this.syncCurrent();
  }

  private startAtFirst(): void {
    if (this.state.order.length === 0) {
      this.state.status = 'stopped';
      this.state.cursor = -1;
    } else {
      this.state.cursor = 0;
      this.state.status = 'playing';
      this.state.positionMs = 0;
      this.state.seekToken += 1;
    }
    this.syncCurrent();
  }

  setDevice(deviceId: string | null): void {
    this.state = emptyState(deviceId);
    this.clients.clear();
    this.emit();
  }

  reset(): void {
    this.state = emptyState(this.state.deviceId);
    this.clients.clear();
    this.emit();
  }

  setMode(mode: PlayMode): void {
    this.state.mode = mode;
    this.rebuildOrder(true);
    this.emit();
  }

  /** Replace the queue and start at index 0. */
  replaceQueue(tracks: TrackRef[], mode?: PlayMode): PlayerState {
    this.state.queue = tracks.slice(0, MAX_QUEUE).map((track) => ({ ...track }));
    if (mode !== undefined) this.state.mode = mode;
    this.rebuildOrder(false);
    this.startAtFirst();
    this.emit(true);
    return this.view();
  }

  /** Start an existing queue track without replacing the queue. */
  playTrack(trackId: string): Result<PlayerState> {
    const index = this.state.queue.findIndex((track) => track.id === trackId);
    if (index < 0) return fail('not_found', 'Track is not in the queue');
    const cursor = this.state.order.indexOf(index);
    if (cursor < 0) return fail('not_found', 'Track is not in the current playback order');
    this.state.cursor = cursor;
    this.state.status = 'playing';
    this.state.positionMs = 0;
    this.state.seekToken += 1;
    this.syncCurrent();
    this.emit();
    return { ok: true, data: this.view() };
  }

  /** Whether the normal advance has another ordered track before wrapping. */
  hasNext(): boolean {
    if (this.state.queue.length === 0) return false;
    if (this.state.mode === 'one') return true;
    return this.state.cursor >= 0 && this.state.cursor + 1 < this.state.order.length;
  }

  /** Append one track and start it (used by basic AI DJ, including shuffle). */
  appendAndPlay(track: TrackRef): Result<PlayerState> {
    if (this.state.queue.length >= MAX_QUEUE) return fail('business', 'Queue is full');
    this.appendQueue([track]);
    let index = -1;
    for (let i = this.state.queue.length - 1; i >= 0; i -= 1) {
      if (this.state.queue[i]?.id === track.id) {
        index = i;
        break;
      }
    }
    const cursor = index >= 0 ? this.state.order.indexOf(index) : -1;
    if (cursor < 0) return fail('not_found', 'The appended track is not in the queue');
    this.state.cursor = cursor;
    this.state.status = 'playing';
    this.state.positionMs = 0;
    this.state.seekToken += 1;
    this.syncCurrent();
    this.emit();
    return { ok: true, data: this.view() };
  }

  appendQueue(tracks: TrackRef[], mode?: PlayMode): PlayerState {
    this.state.queue = this.state.queue.concat(tracks.map((track) => ({ ...track }))).slice(0, MAX_QUEUE);
    if (mode !== undefined) this.state.mode = mode;
    this.rebuildOrder(true);
    if (this.state.track === null) this.startAtFirst();
    this.emit(true);
    return this.view();
  }

  /** Append only ids not already in the queue; atomic against concurrent callers. */
  appendQueueUnique(tracks: TrackRef[], mode?: PlayMode): QueueMutationResult {
    const existing = new Set(this.state.queue.map((track) => track.id));
    const unique: TrackRef[] = [];
    const skippedIds: string[] = [];
    const duplicateIds: string[] = [];
    for (const track of tracks) {
      if (existing.has(track.id)) {
        skippedIds.push(track.id);
        duplicateIds.push(track.id);
        continue;
      }
      existing.add(track.id);
      unique.push({ ...track });
    }
    const room = Math.max(0, MAX_QUEUE - this.state.queue.length);
    const accepted = unique.slice(0, room);
    for (const track of unique.slice(room)) skippedIds.push(track.id);
    if (accepted.length === 0) {
      return {
        state: this.view(),
        added: 0,
        skipped: skippedIds.length,
        skippedIds: skippedIds.slice(0, 50),
        duplicateIds: duplicateIds.slice(0, 50),
      };
    }
    this.state.queue = this.state.queue.concat(accepted);
    if (mode !== undefined) this.state.mode = mode;
    this.rebuildOrder(true);
    if (this.state.track === null) this.startAtFirst();
    this.emit(true);
    return {
      state: this.view(),
      added: accepted.length,
      skipped: skippedIds.length,
      skippedIds: skippedIds.slice(0, 50),
      duplicateIds: duplicateIds.slice(0, 50),
    };
  }

  /** Insert only ids not already in the queue; never moves an existing track. */
  insertQueueUnique(tracks: TrackRef[], index: number, mode?: PlayMode): QueueMutationResult {
    const existing = new Set(this.state.queue.map((track) => track.id));
    const unique: TrackRef[] = [];
    const skippedIds: string[] = [];
    const duplicateIds: string[] = [];
    for (const track of tracks) {
      if (existing.has(track.id)) {
        skippedIds.push(track.id);
        duplicateIds.push(track.id);
        continue;
      }
      existing.add(track.id);
      unique.push({ ...track });
    }
    const room = Math.max(0, MAX_QUEUE - this.state.queue.length);
    const accepted = unique.slice(0, room);
    for (const track of unique.slice(room)) skippedIds.push(track.id);
    if (accepted.length === 0) {
      return {
        state: this.view(),
        added: 0,
        skipped: skippedIds.length,
        skippedIds: skippedIds.slice(0, 50),
        duplicateIds: duplicateIds.slice(0, 50),
      };
    }
    const at = clamp(index, 0, this.state.queue.length);
    this.state.queue.splice(at, 0, ...accepted);
    if (mode !== undefined) this.state.mode = mode;
    this.rebuildOrder(true);
    if (this.state.track === null) this.startAtFirst();
    this.emit(true);
    return {
      state: this.view(),
      added: accepted.length,
      skipped: skippedIds.length,
      skippedIds: skippedIds.slice(0, 50),
      duplicateIds: duplicateIds.slice(0, 50),
    };
  }

  playNext(tracks: TrackRef[], mode?: PlayMode): PlayerState {
    const insertAt = this.state.currentIndex >= 0 ? this.state.currentIndex + 1 : 0;
    const next = tracks.map((track) => ({ ...track }));
    this.state.queue.splice(insertAt, 0, ...next);
    if (this.state.queue.length > MAX_QUEUE) this.state.queue.length = MAX_QUEUE;
    if (mode !== undefined) this.state.mode = mode;
    this.rebuildOrder(true);
    if (this.state.track === null) this.startAtFirst();
    this.emit(true);
    return this.view();
  }

  setStatus(status: PlayerState['status'], clientId?: string): Result<PlayerState> {
    if (this.state.queue.length === 0 || this.state.track === null) {
      return fail('not_found', 'Queue is empty');
    }
    if (clientId !== undefined && this.state.driverClientId !== undefined && this.state.driverClientId !== clientId) {
      return { ok: true, data: this.view() };
    }
    this.state.status = status;
    if (status === 'paused') this.state.positionMs = clamp(this.state.positionMs, 0, this.state.track.durationSec * 1000);
    this.emit();
    return { ok: true, data: this.view() };
  }

  advance(delta: number, fromEnded = false): Result<PlayerState> {
    if (this.state.queue.length === 0) return fail('not_found', 'Queue is empty');
    if (fromEnded && this.state.mode === 'one') {
      this.state.positionMs = 0;
      this.state.status = 'playing';
      this.state.seekToken += 1;
      this.emit();
      return { ok: true, data: this.view() };
    }
    let cursor = this.state.cursor + delta;
    if (cursor >= this.state.order.length) {
      if (this.state.mode === 'shuffle' && this.state.order.length > 1) {
        this.state.order = this.shuffleOrder();
        cursor = 0;
      } else {
        cursor = 0;
      }
    } else if (cursor < 0) {
      cursor = this.state.order.length - 1;
    }
    this.state.cursor = cursor;
    this.state.status = 'playing';
    this.state.positionMs = 0;
    this.state.seekToken += 1;
    this.syncCurrent();
    this.emit();
    return { ok: true, data: this.view() };
  }

  seek(positionMs: number): Result<PlayerState> {
    if (this.state.track === null) return fail('not_found', 'Nothing is playing');
    this.state.positionMs = clamp(positionMs, 0, this.state.track.durationSec * 1000);
    this.state.seekToken += 1;
    this.emit();
    return { ok: true, data: this.view() };
  }

  volume(value: number): Result<PlayerState> {
    this.state.volume = clamp(value, 0, 100);
    this.state.muted = false;
    this.emit();
    return { ok: true, data: this.view() };
  }

  mute(muted: boolean): PlayerState {
    this.state.muted = muted;
    this.emit();
    return this.view();
  }

  progress(clientId: string, positionMs: number, status?: PlayerState['status']): Result<PlayerState> {
    if (this.state.driverClientId !== undefined && this.state.driverClientId !== clientId) {
      return { ok: true, data: this.view() };
    }
    if (status !== undefined && status !== this.state.status) {
      this.state.status = status;
    }
    this.state.positionMs = this.state.track === null
      ? 0
      : clamp(positionMs, 0, this.state.track.durationSec * 1000);
    this.emit();
    return { ok: true, data: this.view() };
  }

  setAudioError(message: string): PlayerState {
    this.state.audioError = message === '' ? undefined : message;
    if (message !== '') this.state.status = 'paused';
    this.emit();
    return this.view();
  }

  heartbeat(clientId: string): number {
    if (clientId === '') return this.clients.size;
    this.clients.set(clientId, Date.now());
    this.pruneClients();
    // A live driver keeps control; only an absent/stale driver is replaced.
    // An explicit claim() is how a page takes over.
    if (this.state.driverClientId !== undefined && this.clients.has(this.state.driverClientId)) {
      return this.clients.size;
    }
    let driver = '';
    let latest = 0;
    for (const [id, seen] of this.clients) {
      if (seen >= latest) {
        latest = seen;
        driver = id;
      }
    }
    if (driver !== '' && this.state.driverClientId !== driver) {
      this.state.driverClientId = driver;
      this.state.seekToken += 1;
      this.emit();
    }
    return this.clients.size;
  }

  claim(clientId: string): PlayerState {
    this.clients.set(clientId, Date.now());
    this.pruneClients();
    if (this.state.driverClientId !== clientId) {
      // A new driver must seek to the Host's current position, not resume its
      // own stale audio clock.
      this.state.driverClientId = clientId;
      this.state.seekToken += 1;
      this.emit();
    }
    return this.view();
  }

  /** A page is closing; release its lease immediately instead of waiting for TTL. */
  leave(clientId: string): PlayerState {
    this.clients.delete(clientId);
    this.pruneClients();
    this.emit();
    return this.view();
  }

  clientsCount(): number {
    this.pruneClients();
    return this.clients.size;
  }

  private pruneClients(): void {
    const now = Date.now();
    for (const [id, seen] of this.clients) {
      if (now - seen > CLIENT_TTL_MS) this.clients.delete(id);
    }
    if (this.state.driverClientId !== undefined && !this.clients.has(this.state.driverClientId)) {
      // Elect the most recently seen remaining client, if any.
      let driver: string | undefined;
      let latest = 0;
      for (const [id, seen] of this.clients) {
        if (seen >= latest) {
          latest = seen;
          driver = id;
        }
      }
      if (driver !== this.state.driverClientId) {
        this.state.driverClientId = driver;
        this.state.seekToken += 1;
        this.emit();
      }
    }
  }

  queueAction(action: string, tracks: TrackRef[], ids: string[], index: number, position: number): Result<PlayerState> {
    switch (action) {
      case 'add':
        return { ok: true, data: this.appendQueueUnique(tracks).state };
      case 'insert':
        return { ok: true, data: this.insertQueueUnique(tracks, index).state };
      case 'remove': {
        const wanted = new Set(ids);
        const oldCurrent = this.state.track?.id;
        this.state.queue = this.state.queue.filter((track) => !wanted.has(track.id));
        this.rebuildOrder(true);
        if (oldCurrent === undefined || !this.state.queue.some((track) => track.id === oldCurrent)) {
          if (this.state.queue.length === 0) {
            this.state.cursor = -1;
            this.state.status = 'stopped';
            this.state.positionMs = 0;
            this.syncCurrent();
          } else {
            this.state.cursor = clamp(this.state.cursor, 0, this.state.order.length - 1);
            this.state.positionMs = 0;
            this.syncCurrent();
          }
        }
        this.emit(true);
        return { ok: true, data: this.view() };
      }
      case 'clear':
        this.state.queue = [];
        this.state.order = [];
        this.state.cursor = -1;
        this.state.positionMs = 0;
        this.state.status = 'stopped';
        this.syncCurrent();
        this.emit(true);
        return { ok: true, data: this.view() };
      case 'move': {
        const from = clamp(index, 0, this.state.queue.length - 1);
        const to = clamp(position, 0, this.state.queue.length - 1);
        if (this.state.queue.length === 0) return fail('not_found', 'Queue is empty');
        const [moved] = this.state.queue.splice(from, 1);
        if (moved !== undefined) this.state.queue.splice(to, 0, moved);
        this.rebuildOrder(true);
        this.emit(true);
        return { ok: true, data: this.view() };
      }
      default:
        return fail('bad_request', `Unknown queue action: ${action}`);
    }
  }

  setFavorite(trackId: string, favorite: boolean): void {
    let changed = false;
    this.state.queue = this.state.queue.map((track) => {
      if (track.id !== trackId || track.favorite === favorite) return track;
      changed = true;
      return { ...track, favorite };
    });
    if (this.state.track !== null && this.state.track.id === trackId && this.state.track.favorite !== favorite) {
      this.state.track = { ...this.state.track, favorite };
      changed = true;
    }
    if (changed) this.emit(true);
  }
}

export type PlayerError = FnosError;
