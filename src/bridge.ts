/**
 * The bridge: one operation implementation shared by the Agent tools and the
 * Web routes. The UI never talks to fnOS directly; the browser only sees
 * redacted snapshots and same-origin media/event routes.
 */
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type {
  AuditEntry,
  CacheSummary,
  CompatStatus,
  ConnectionView,
  CredentialsLike,
  DeviceView,
  DjState,
  FnosError,
  FnosTarget,
  HistoryEntry,
  LibrarySummary,
  ListenerProfile,
  LogEntry,
  PlayMode,
  PlayerState,
  PlaylistExportData,
  PlaylistExportFormat,
  PlaylistFileTrack,
  Result,
  SceneId,
  SceneState,
  Settings,
  Snapshot,
  StatsRange,
  StatsReport,
  StreamResponse,
  ToolResult,
  TrackRef,
  TrafficSummary,
} from './types.js';
import { fail, makeError } from './errors.js';
import { FnosApi } from './fnos/api.js';
import { parseLrc } from './fnos/lrc.js';
import { parseHlsPlaylist, type HlsPlaylist } from './fnos/hls.js';
import { compatBackend, findFfmpeg, remuxFmp4ToWebm } from './media/remux.js';
import { sanitizePlaylistName, parsePlaylistFile, playlistFileName, toJsonPlaylist, toM3u8Playlist } from './fnos/playlist-file.js';
import { createTransport, transportKindOf } from './transport/index.js';
import { readStreamBuffer, normalizeDirectAddress, normalizeFnid } from './transport/http.js';
import { Vault, randomDeviceId, randomId } from './state/vault.js';
import { ConnectionManager } from './state/connection.js';
import { LibraryService } from './state/library.js';
import { Limiter } from './state/limiter.js';
import { PlayerService } from './state/player.js';
import { DeviceProbeScheduler } from './state/probe.js';
import { HistoryService } from './state/history.js';
import { ProfileService } from './state/profile.js';
import { SceneService } from './state/scene.js';
import { DjService } from './state/dj.js';
import { AuditService } from './state/audit.js';
import { TrafficService } from './state/traffic.js';
import { parseVoiceIntent } from './fnos/voice.js';
import { RecommendService, type RecommendStrategy } from './state/recommend.js';
import { MediaCache } from './state/cache.js';
import { RingLog } from './state/logs.js';
import { ConfirmGate } from './state/confirm.js';
import { EventHub } from './state/sse.js';

const MAX_FAVORITE_BULK = 100;
const MAX_PLAYLIST_BATCH = 200;
const MAX_SMART_PLAYLIST = 200;
const PLAYLIST_CHUNK = 100;
const DEFAULT_COVER_SIZE = '160';
const COMPAT_CACHE_ENTRIES = 3;
const COMPAT_CACHE_BYTES = 96 * 1024 * 1024;
const COMPAT_STREAM_BYTES = 64 * 1024 * 1024;
const COMPAT_HLS_TIMEOUT_MS = 30_000;
const COMPAT_PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;
const COMPAT_SEGMENT_MAX_BYTES = 8 * 1024 * 1024;
const COMPAT_SEGMENT_WORKERS = 4;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function rawStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function isPlayMode(value: unknown): value is PlayMode {
  return value === 'list' || value === 'one' || value === 'shuffle';
}

function statsRangeOf(value: unknown): StatsRange {
  return value === '7d' || value === '30d' || value === 'all' ? value : '30d';
}

function sceneIdOf(value: unknown): SceneId {
  return value === 'auto' || value === 'morning' || value === 'focus' || value === 'evening' || value === 'late' || value === 'instrumental'
    ? value
    : 'auto';
}

function listenerIdOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface BridgeOptions {
  credentials: CredentialsLike | undefined;
  profile: string;
  cacheDir: string;
  dataDir?: string;
}

export class MusicBridge {
  readonly vault: Vault;
  readonly connection: ConnectionManager;
  readonly library: LibraryService;
  readonly player: PlayerService;
  readonly recommendService: RecommendService;
  readonly probeScheduler: DeviceProbeScheduler;
  readonly history: HistoryService;
  readonly profile: ProfileService;
  readonly sceneService: SceneService;
  readonly djService: DjService;
  readonly audit: AuditService;
  readonly traffic: TrafficService;
  readonly cache: MediaCache;
  readonly logs: RingLog;
  readonly confirm: ConfirmGate;
  readonly hub = new EventHub();
  private readonly limiter: Limiter;
  private readonly lastStatus = new Map<string, ConnectionView | undefined>();
  private librarySummary: LibrarySummary | null = null;
  private cacheSummary: CacheSummary;
  private rev = 0;
  private disposed = false;
  private activeStreams = new Set<IncomingMessage>();
  private compatStatus: CompatStatus = { backend: 'mse', ffmpeg: false };
  private readonly compatCache = new Map<string, { at: number; buffer: Buffer; contentType: string }>();
  private compatCacheBytes = 0;
  private readonly compatPending = new Map<string, Promise<Result<{ buffer: Buffer; contentType: string }>>>();
  private historyTrackId: string | null = null;
  private historySource: 'play' | 'queue' | 'dj' | 'scene' = 'play';
  private homeCache: { at: number; key: string; data: Record<string, unknown> } | undefined;
  private sceneState: SceneState = { scene: null, active: false, startedAt: 0, tracks: 0 };

  constructor(private readonly options: BridgeOptions) {
    this.vault = new Vault(options.credentials, options.profile);
    this.limiter = new Limiter(3, 50);
    this.logs = new RingLog(200, true);
    this.confirm = new ConfirmGate();
    this.cache = new MediaCache(options.cacheDir, 200);
    this.cacheSummary = {
      covers: 0,
      lyrics: 0,
      bytes: 0,
      limitMb: 200,
    };
    this.connection = new ConnectionManager(this.vault, {
      onLog: (entry) => this.log(entry),
      onStatus: (view) => this.onStatus(view),
    });
    this.library = new LibraryService({
      api: () => this.apiOrNull(),
      limiter: this.limiter,
    });
    this.player = new PlayerService({
      onChange: () => this.onPlayerChange(),
    });
    this.recommendService = new RecommendService(this.library);
    const dataDir = options.dataDir ?? path.join(options.cacheDir, 'data');
    this.history = new HistoryService(dataDir);
    this.profile = new ProfileService(this.history, this.library);
    this.sceneService = new SceneService(this.profile, this.library);
    this.djService = new DjService();
    this.audit = new AuditService(dataDir);
    this.traffic = new TrafficService(dataDir);
    this.probeScheduler = new DeviceProbeScheduler({
      devices: () => this.vault.devices,
      activeId: () => this.vault.activeDeviceId,
      settings: () => this.vault.settings,
      hasClients: () => this.hub.size > 0 || this.player.clientsCount() > 0,
      skip: (device) => this.lastStatus.get(device.id)?.phase === 'auth',
      probe: async (device) => {
        await this.probeDevice(device);
      },
      onRound: () => {
        this.hub.send('devices', this.deviceViews());
      },
    });
  }

  async start(): Promise<void> {
    await this.vault.open();
    await this.history.start(this.vault.activeListenerId);
    await this.audit.load();
    await this.traffic.load();
    const settings = this.vault.settings;
    this.djService.setEnabled(settings.autoDj);
    this.limiter.setMax(settings.requestConcurrency);
    this.cache.setLimit(settings.cacheLimitMb);
    this.logs.setEnabled(settings.logsEnabled);
    const backend = compatBackend();
    this.compatStatus = { backend, ffmpeg: backend === 'ffmpeg' };
    const active = this.vault.activeDevice();
    this.player.setDevice(active?.id ?? null);
    await this.connection.start();
    this.probeScheduler.start();
    void this.refreshCacheSummary();
    if (active !== undefined) void this.refreshLibrarySummary();
  }

  private apiOrNull(): FnosApi | null {
    const transport = this.connection.currentTransport;
    return transport === null ? null : new FnosApi(transport);
  }

  private ensureApi(): Result<FnosApi> {
    const api = this.apiOrNull();
    if (api === null) {
      const device = this.vault.activeDevice();
      return fail(
        device === undefined ? 'not_configured' : 'no_active_device',
        device === undefined ? 'No fnOS device is configured' : 'No active fnOS music transport',
      );
    }
    return { ok: true, data: api };
  }

  private log(entry: LogEntry): void {
    this.logs.add(entry);
    if (this.vault.settings.trafficStats) this.traffic.record(entry, this.vault.activeDeviceId ?? '');
  }

  private onStatus(view: ConnectionView): void {
    const active = this.vault.activeDevice();
    if (active !== undefined) this.lastStatus.set(active.id, view);
    this.hub.send('connection', view);
    if (view.phase === 'online') void this.refreshLibrarySummary();
  }

  private onPlayerChange(): void {
    const view = this.player.eventView();
    if (this.vault.settings.historyEnabled) {
      const deviceId = this.vault.activeDeviceId ?? '';
      const currentId = view.track === null ? null : view.track.id;
      if (currentId === null) {
        if (this.historyTrackId !== null) {
          this.history.finish(false);
          this.historyTrackId = null;
        }
      } else if (currentId !== this.historyTrackId) {
        this.history.startTrack(view.track!, deviceId, this.historySource);
        this.historyTrackId = currentId;
        this.historySource = 'play';
      } else {
        this.history.progress(view.positionMs, view.status);
      }
    }
    // `undefined` fields are dropped by JSON; explicit nulls let the client
    // clear a released driver / audio error instead of keeping stale state.
    this.hub.send('player', {
      ...view,
      driverClientId: view.driverClientId ?? null,
      audioError: view.audioError ?? null,
      audioClients: this.player.clientsCount(),
    });
  }

  private get activeDevice(): FnosTarget | undefined {
    return this.vault.activeDevice();
  }

  private webUrlFor(device: FnosTarget): string | undefined {
    if (transportKindOf(device) === 'unix') return undefined;
    if (device.id !== this.vault.activeDeviceId) return undefined;
    const transport = this.connection.currentTransport;
    const base = transport?.base;
    if (base === undefined || !base.startsWith('http')) return undefined;
    return `${base.replace(/\/+$/, '')}/music/`;
  }

  private deviceViews(): DeviceView[] {
    const urls = new Map<string, string>();
    for (const device of this.vault.devices) {
      const url = this.webUrlFor(device);
      if (url !== undefined) urls.set(device.id, url);
    }
    return this.vault.views(this.lastStatus, urls);
  }

  private snapshot(): Snapshot {
    return {
      version: 1,
      rev: this.rev,
      activeDeviceId: this.vault.activeDeviceId,
      devices: this.deviceViews(),
      connection: this.connection.status(),
      player: this.player.view({ queue: true, limit: 200 }),
      listener: this.vault.activeListener(),
      settings: this.vault.settings,
      compat: { ...this.compatStatus },
      cache: { ...this.cacheSummary },
      library: this.librarySummary,
      audioClients: this.player.clientsCount(),
      persistent: this.vault.persistent,
      at: Date.now(),
    };
  }

  async snapshotAsync(): Promise<Snapshot> {
    await this.refreshCacheSummary();
    return this.snapshot();
  }

  private async refreshCacheSummary(): Promise<void> {
    try {
      this.cacheSummary = await this.cache.summary();
      this.hub.send('cache', this.cacheSummary);
    } catch {
      // A broken cache must not affect playback or status.
    }
  }

  private async refreshLibrarySummary(): Promise<void> {
    if (this.apiOrNull() === null) return;
    try {
      const summary = await this.library.summary();
      if (summary !== null) {
        this.librarySummary = summary;
        this.hub.send('library', summary);
      }
    } catch {
      // Counts are cosmetic.
    }
  }

  private async emitState(): Promise<void> {
    this.rev += 1;
    this.hub.send('snapshot', await this.snapshotAsync());
  }

  private playerSummary(): Record<string, unknown> {
    const view = this.player.view({ queue: false });
    return {
      track: view.track,
      status: view.status,
      positionMs: view.positionMs,
      durationMs: view.track === null ? 0 : view.track.durationSec * 1000,
      volume: view.volume,
      muted: view.muted,
      mode: view.mode,
      queueTotal: view.queueTotal,
      currentIndex: view.currentIndex,
      audioClients: this.player.clientsCount(),
      seekToken: view.seekToken,
      rev: view.rev,
      ...(view.driverClientId !== undefined ? { driverClientId: view.driverClientId } : {}),
      ...(view.audioError !== undefined ? { audioError: view.audioError } : {}),
    };
  }

  // ------------------------------------------------------------------
  // Status / devices
  // ------------------------------------------------------------------

  status(includeQueue = false): Record<string, unknown> {
    const active = this.activeDevice;
    return {
      configured: active !== undefined,
      activeDevice: active === undefined
        ? null
        : {
          id: active.id,
          name: active.name,
          mode: active.mode,
          transport: transportKindOf(active),
          tokenSet: active.token !== '',
          accountName: active.accountName ?? '',
        },
      connection: this.connection.status(),
      player: this.playerSummary(),
      ...(includeQueue ? { queue: this.player.queuePage(0, 50) } : {}),
      library: this.librarySummary,
      cache: { ...this.cacheSummary },
      settings: this.vault.settings,
      compat: { ...this.compatStatus },
      persistent: this.vault.persistent,
      slowRelay: this.connection.status().slowRelay,
    };
  }

  private async activate(device: FnosTarget): Promise<void> {
    this.clearCompatCache();
    this.library.invalidate();
    this.homeCache = undefined;
    this.librarySummary = null;
    this.player.setDevice(device.id);
    await this.vault.setActive(device.id);
    await this.connection.setActive(device);
    this.rev += 1;
    await this.emitState();
  }

  async devicesTool(action: string, deviceName?: string): Promise<ToolResult> {
    if (action === 'list') {
      return { ok: true, activeDeviceId: this.vault.activeDeviceId, devices: this.deviceViews() };
    }
    if (action === 'switch') {
      const device = this.vault.findDevice(deviceName ?? '');
      if (device === undefined) return { ok: false, error: makeError('not_found', 'Saved device not found') };
      await this.activate(device);
      const view = this.deviceViews().find((entry) => entry.id === device.id);
      return { ok: true, ...(view !== undefined ? { activeDevice: view } : {}), connection: this.connection.status() };
    }
    if (action === 'probe') {
      const device = deviceName === undefined || deviceName === ''
        ? this.activeDevice
        : this.vault.findDevice(deviceName);
      if (device === undefined) return { ok: false, error: makeError('not_found', 'Saved device not found') };
      const result = await this.probeDevice(device);
      if (result.ok !== true) return result;
      return { ok: true, device: result.data.device, layers: result.data.layers };
    }
    return { ok: false, error: makeError('bad_request', `Unknown devices action: ${action}`) };
  }

  private async probeDevice(device: FnosTarget): Promise<Result<{ device: DeviceView; layers: ConnectionView['layers'] }>> {
    if (device.id === this.vault.activeDeviceId) {
      const view = await this.connection.probe();
      this.lastStatus.set(device.id, view);
      return {
        ok: true,
        data: {
          device: this.deviceViews().find((entry) => entry.id === device.id) ?? this.fallbackView(device),
          layers: view.layers,
        },
      };
    }
    const created = createTransport(device, (entry) => this.log(entry));
    if (created.ok !== true) return created;
    try {
      const layers = await created.data.probe();
      const via = created.data.via;
      const view: ConnectionView = {
        phase: layers.gateway.ok && layers.device.ok && layers.service.ok
          ? (layers.service.code === 'auth' ? 'auth' : 'online')
          : 'offline',
        layers,
        latencyMs: Math.max(layers.gateway.latencyMs, layers.device.latencyMs, layers.service.latencyMs),
        slowRelay: via === 'fnid',
        checkedAt: Date.now(),
        transport: transportKindOf(device),
        via,
        ...(layers.service.code !== undefined ? { code: layers.service.code } : {}),
        ...(layers.service.message !== undefined ? { message: layers.service.message } : {}),
      };
      this.lastStatus.set(device.id, view);
      return {
        ok: true,
        data: {
          device: this.deviceViews().find((entry) => entry.id === device.id) ?? this.fallbackView(device),
          layers,
        },
      };
    } finally {
      created.data.dispose();
    }
  }

  private fallbackView(device: FnosTarget): DeviceView {
    return {
      id: device.id,
      name: device.name,
      mode: device.mode,
      transport: transportKindOf(device),
      tokenSet: device.token !== '',
      allowSelfSigned: device.allowSelfSigned,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
      active: device.id === this.vault.activeDeviceId,
    };
  }

  async saveDevice(body: Record<string, unknown>): Promise<ToolResult> {
    const id = str(body.id) || randomId();
    const mode = body.mode === 'fnid' ? 'fnid' : body.mode === 'direct' ? 'direct' : body.mode === 'auto' ? 'auto' : undefined;
    if (mode === undefined) return { ok: false, error: makeError('bad_request', 'mode must be fnid, direct or auto') };
    const existing = this.vault.devices.find((entry) => entry.id === id);
    const name = str(body.name) || existing?.name || (mode === 'fnid' ? str(body.fnid) : str(body.address)) || 'fnOS';
    const fnid = str(body.fnid).toLowerCase();
    const address = str(body.address);
    const unix = address.startsWith('unix://') || address.startsWith('/');
    let token = rawStr(body.token).trim();
    let accountName = existing?.accountName;
    const username = str(body.username);
    const password = rawStr(body.password);

    if (mode === 'fnid') {
      const normalized = normalizeFnid(fnid);
      if (normalized.ok !== true) return normalized;
    } else if (mode === 'auto') {
      const normalizedFnid = normalizeFnid(fnid);
      if (normalizedFnid.ok !== true) return normalizedFnid;
      if (fnid === '') return { ok: false, error: makeError('bad_request', 'Auto mode requires an FN ID') };
      const normalizedAddress = normalizeDirectAddress(address);
      if (normalizedAddress.ok !== true) return normalizedAddress;
      if (unix) return { ok: false, error: makeError('bad_request', 'Auto mode cannot use a Unix socket') };
    } else {
      const normalized = normalizeDirectAddress(address);
      if (normalized.ok !== true) return normalized;
    }

    const draft: FnosTarget = {
      id,
      name,
      mode,
      ...(mode === 'fnid' || mode === 'auto' ? { fnid } : {}),
      ...(mode === 'direct' || mode === 'auto' ? { address } : {}),
      ...(mode === 'direct' && unix ? { unixPath: address } : {}),
      token: token || existing?.token || '',
      allowSelfSigned: bool(body.allowSelfSigned, existing?.allowSelfSigned ?? false),
      deviceId: existing?.deviceId ?? randomDeviceId(),
      ...(accountName !== undefined ? { accountName } : {}),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    if (username !== '' && password !== '') {
      const probe = createTransport({ ...draft, token: '' }, (entry) => this.log(entry));
      if (probe.ok !== true) return probe;
      try {
        const result = await probe.data.login(username, password);
        if (result.ok !== true) return result;
        token = result.data.token;
        accountName = result.data.user;
      } finally {
        probe.data.dispose();
      }
    }

    if (token === '' && (existing?.token ?? '') === '') {
      return {
        ok: false,
        error: makeError('bad_request', 'A music-account token or a username/password is required', {
          hint: '设置页可以填飞牛音乐独立账号和密码换取 token，或直接粘贴已有 token。',
        }),
      };
    }

    const saved: FnosTarget = {
      ...draft,
      token: token || existing?.token || '',
      ...(accountName !== undefined ? { accountName } : {}),
    };
    const created = createTransport(saved, (entry) => this.log(entry));
    if (created.ok !== true) return created;
    created.data.dispose();

    await this.vault.upsert(saved);
    // A new token must make the background scheduler consider this device again.
    this.lastStatus.delete(id);
    if (this.vault.activeDeviceId === id || this.vault.activeDeviceId === null) {
      await this.activate(saved);
    } else {
      await this.emitState();
    }
    const view = this.deviceViews().find((entry) => entry.id === id);
    return {
      ok: true,
      ...(view !== undefined ? { device: view } : {}),
      active: this.vault.activeDeviceId === id,
    };
  }

  async loginDevice(body: Record<string, unknown>): Promise<ToolResult> {
    const username = str(body.username);
    const password = rawStr(body.password);
    if (username === '' || password === '') {
      return { ok: false, error: makeError('bad_request', 'username and password are required') };
    }
    return this.saveDevice({ ...body, token: '', username, password });
  }

  async removeDevice(id: string): Promise<ToolResult> {
    const device = this.vault.devices.find((entry) => entry.id === id);
    if (device === undefined) return { ok: false, error: makeError('not_found', 'Saved device not found') };
    if (this.vault.activeDeviceId === id) {
      await this.connection.setActive(undefined);
      this.player.setDevice(null);
      this.library.invalidate();
      this.librarySummary = null;
    }
    await this.vault.removeDevice(id);
    this.lastStatus.delete(id);
    this.rev += 1;
    await this.emitState();
    return { ok: true, removed: id, activeDeviceId: this.vault.activeDeviceId };
  }

  // ------------------------------------------------------------------
  // Library / playback
  // ------------------------------------------------------------------

  async search(params: Parameters<LibraryService['search']>[0]): Promise<ToolResult> {
    const result = await this.library.search(params);
    if (result.ok !== true) return result;
    return { ok: true, ...result.data };
  }

  private async resolvePlayTracks(params: Record<string, unknown>): Promise<Result<TrackRef[]>> {
    const limit = int(params.limit, 50, 1, 200);
    const trackId = str(params.trackId);
    if (trackId !== '') {
      const queued = this.player.raw().queue.find((track) => track.id === trackId);
      const found = queued ?? this.library.findTrack(trackId) ?? this.history.findTrack(trackId);
      if (found === undefined) {
        return fail('not_found', 'Track is not in the loaded library; search for it first');
      }
      const enriched = await this.enrichTrack(found);
      return { ok: true, data: [enriched] };
    }
    const playlistId = str(params.playlistId) || str(params.playlist);
    if (playlistId !== '') {
      const result = await this.library.playlistDetail(playlistId);
      if (result.ok !== true) return result;
      if (result.data.items.length === 0) return fail('not_found', 'Playlist has no tracks');
      return { ok: true, data: result.data.items.slice(0, limit) };
    }
    const albumId = str(params.albumId) || str(params.album);
    if (albumId !== '') {
      const result = await this.library.albumTracks(albumId);
      if (result.ok !== true) return result;
      if (result.data.items.length === 0) {
        return fail('unsupported', 'Album detail did not include tracks', {
          hint: '这个 fnOS 版本的专辑详情没有曲目列表，请改用歌单或搜索播放。',
        });
      }
      return { ok: true, data: result.data.items.slice(0, limit) };
    }
    const artist = str(params.artist);
    if (artist !== '') {
      const result = await this.library.artistTracksByName(artist, limit);
      if (result.ok !== true) return result;
      const items = result.data.items as TrackRef[];
      if (items.length === 0) return fail('not_found', `No track matched artist "${artist}"`);
      return { ok: true, data: items };
    }
    const query = str(params.query);
    if (query !== '') {
      const result = await this.library.search({ query, kind: 'track', limit: Math.min(limit, 20) });
      if (result.ok !== true) return result;
      const items = result.data.items;
      if (!Array.isArray(items) || items.length === 0) return fail('not_found', `No track matched "${query}"`);
      return { ok: true, data: (items as TrackRef[]).slice(0, limit) };
    }
    return fail('bad_request', 'Provide trackId, query, playlistId, or albumId');
  }

  async play(params: Record<string, unknown>): Promise<ToolResult> {
    this.historySource = 'play';
    const clientId = str(params.clientId);
    if (clientId !== '') this.player.claim(clientId);
    const resolved = await this.resolvePlayTracks(params);
    if (resolved.ok !== true) return resolved;
    const mode = params.mode === 'append' ? 'append' : params.mode === 'next' ? 'next' : 'replace';
    const playMode: PlayMode | undefined = params.shuffle === true ? 'shuffle' : undefined;
    const before = this.player.view({ queue: false });
    let state: PlayerState;
    if (mode === 'append') state = this.player.appendQueue(resolved.data, playMode);
    else if (mode === 'next') state = this.player.playNext(resolved.data, playMode);
    else state = this.player.replaceQueue(resolved.data, playMode);
    this.log({
      at: Date.now(),
      kind: 'play',
      trackId: state.track?.id,
      title: state.track?.title,
      message: `${mode} ${resolved.data.length} track(s)`,
    });
    return {
      ok: true,
      action: mode,
      played: state.track,
      added: resolved.data.length,
      queueLength: state.queueTotal,
      queueIndex: state.currentIndex,
      mode: state.mode,
      previousQueueLength: before.queueTotal,
      player: this.playerSummary(),
    };
  }

  async control(params: Record<string, unknown>): Promise<ToolResult> {
    const clientId = str(params.clientId);
    if (clientId !== '') this.player.claim(clientId);
    const action = str(params.action);
    if (action === 'pause' || action === 'resume' || action === 'toggle') {
      const current = this.player.raw().status;
      const next = action === 'toggle' ? (current === 'playing' ? 'paused' : 'playing') : action === 'pause' ? 'paused' : 'playing';
      const result = this.player.setStatus(next, clientId || undefined);
      if (result.ok !== true) return result;
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'ended' && this.vault.settings.autoDj) {
      this.history.finish(true);
      this.historyTrackId = null;
      const exclude = new Set(this.player.raw().queue.map((track) => track.id));
      let next = this.djService.takeNext(exclude);
      if (next === undefined) {
        const replenished = await this.djReplenish();
        if (replenished !== undefined) {
          this.djService.replenish(replenished);
          next = this.djService.takeNext(exclude);
        }
      }
      if (next !== undefined) {
        this.historySource = 'dj';
        const appended = this.player.appendAndPlay(next);
        if (appended.ok === true) return { ok: true, action, autoDj: true, player: this.playerSummary() };
      }
    }
    if (action === 'playTrack') {
      const trackId = str(params.trackId);
      if (trackId === '') return { ok: false, error: makeError('bad_request', 'trackId is required') };
      const result = this.player.playTrack(trackId);
      if (result.ok !== true) return result;
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'next' || action === 'ended') {
      if (action === 'ended') {
        this.history.finish(true);
        this.historyTrackId = null;
      }
      const result = this.player.advance(1, action === 'ended');
      if (result.ok !== true) return result;
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'previous') {
      const result = this.player.advance(-1);
      if (result.ok !== true) return result;
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'seek') {
      const result = this.player.seek(Number(params.positionMs ?? Number(params.positionSec ?? 0) * 1000));
      if (result.ok !== true) return result;
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'volume') {
      const result = this.player.volume(int(params.volume, this.player.raw().volume, 0, 100));
      if (result.ok !== true) return result;
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'mute' || action === 'unmute') {
      this.player.mute(action === 'mute');
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'mode') {
      if (!isPlayMode(params.mode)) return { ok: false, error: makeError('bad_request', 'mode must be list, one, or shuffle') };
      this.player.setMode(params.mode);
      return { ok: true, action, player: this.playerSummary() };
    }
    if (action === 'error') {
      const message = str(params.message) || 'Audio playback failed';
      this.player.setAudioError(message);
      this.log({ at: Date.now(), kind: 'error', message, trackId: this.player.currentTrack()?.id });
      return { ok: true, action, player: this.playerSummary() };
    }
    return { ok: false, error: makeError('bad_request', `Unknown control action: ${action}`) };
  }

  async progress(body: Record<string, unknown>): Promise<ToolResult> {
    const clientId = str(body.clientId);
    if (clientId === '') return { ok: false, error: makeError('bad_request', 'clientId is required') };
    const positionMs = Number(body.positionMs ?? 0);
    const status = body.status === 'playing' || body.status === 'paused' || body.status === 'stopped'
      ? body.status
      : undefined;
    const result = this.player.progress(clientId, positionMs, status);
    if (result.ok !== true) return result;
    return { ok: true, player: this.playerSummary() };
  }

  async heartbeat(clientId: string): Promise<ToolResult> {
    if (clientId === '') return { ok: false, error: makeError('bad_request', 'clientId is required') };
    this.player.heartbeat(clientId);
    return {
      ok: true,
      driverClientId: this.player.driverClientId,
      isDriver: this.player.driverClientId === clientId,
      audioClients: this.player.clientsCount(),
    };
  }

  async claim(clientId: string): Promise<ToolResult> {
    if (clientId === '') return { ok: false, error: makeError('bad_request', 'clientId is required') };
    this.player.claim(clientId);
    return {
      ok: true,
      driverClientId: this.player.driverClientId ?? null,
      isDriver: this.player.driverClientId === clientId,
      audioClients: this.player.clientsCount(),
    };
  }

  async leave(clientId: string): Promise<ToolResult> {
    if (clientId === '') return { ok: false, error: makeError('bad_request', 'clientId is required') };
    this.player.leave(clientId);
    return {
      ok: true,
      driverClientId: this.player.driverClientId ?? null,
      audioClients: this.player.clientsCount(),
    };
  }

  async queueTool(params: Record<string, unknown>): Promise<ToolResult> {
    const action = str(params.action) || 'get';
    const offset = int(params.offset, 0, 0, 100_000);
    const limit = int(params.limit, 50, 1, 200);
    if (action === 'get') {
      return {
        ok: true,
        action,
        queue: this.player.queuePage(offset, limit),
        queueTotal: this.player.raw().queue.length,
        queueRevision: this.player.queueRevision,
        currentIndex: this.player.raw().currentIndex,
        hasMore: offset + limit < this.player.raw().queue.length,
      };
    }
    const ids = Array.isArray(params.trackIds) ? params.trackIds.map((value) => str(value)).filter((value) => value !== '') : [];
    let tracks: TrackRef[] = [];
    if (action === 'add' || action === 'insert') {
      if (ids.length > 0) {
        tracks = ids.map((id) => this.player.raw().queue.find((track) => track.id === id) ?? this.library.findTrack(id))
          .filter((track): track is TrackRef => track !== undefined)
          .map((track) => ({ ...track }));
      }
      if (tracks.length === 0 && str(params.query) !== '') {
        const result = await this.library.search({ query: str(params.query), kind: 'track', limit: 20 });
        if (result.ok !== true) return result;
        tracks = (result.data.items as TrackRef[]).slice(0, 20);
      }
      if (tracks.length === 0) return { ok: false, error: makeError('not_found', 'No tracks matched the queue request') };
    }
    const result = this.player.queueAction(
      action,
      tracks,
      ids,
      int(params.index, 0, 0, 10_000),
      int(params.position, 0, 0, 10_000),
    );
    if (result.ok !== true) return result;
    return {
      ok: true,
      action,
      queue: this.player.queuePage(offset, limit),
      queueTotal: this.player.raw().queue.length,
      queueRevision: this.player.queueRevision,
      currentIndex: this.player.raw().currentIndex,
    };
  }

  private playlistTrackIds(params: Record<string, unknown>): string[] {
    const ids = Array.isArray(params.trackIds)
      ? params.trackIds.map((value) => str(value)).filter((value) => value !== '')
      : [];
    const single = str(params.trackId);
    if (single !== '' && single !== 'current') ids.unshift(single);
    return [...new Set(ids)];
  }

  async playlistCreate(nameValue: unknown): Promise<ToolResult> {
    const rawName = str(nameValue);
    if (rawName === '') return { ok: false, error: makeError('bad_request', 'name is required') };
    const name = sanitizePlaylistName(rawName, '新建歌单');
    const result = await this.library.createPlaylist(name);
    if (result.ok !== true) return result;
    await this.emitState();
    return { ok: true, action: 'create', playlist: result.data };
  }

  async playlistRename(id: string, nameValue: unknown): Promise<ToolResult> {
    if (id === '') return { ok: false, error: makeError('bad_request', 'playlistId is required') };
    const rawName = str(nameValue);
    if (rawName === '') return { ok: false, error: makeError('bad_request', 'name is required') };
    const name = sanitizePlaylistName(rawName, '歌单');
    const result = await this.library.renamePlaylist(id, name);
    if (result.ok !== true) return result;
    await this.emitState();
    return { ok: true, action: 'rename', playlistId: id, name };
  }

  private confirmPlaylistOp(
    params: Record<string, unknown>,
    op: string,
    args: Record<string, unknown>,
    deviceId: string,
    description: string,
  ): ToolResult | null {
    if (!this.vault.settings.confirmHighRisk) return null;
    const token = str(params.confirmToken);
    if (token === '') {
      const issued = this.confirm.issue(op, args, deviceId);
      return {
        ok: false,
        error: {
          ...makeError('confirmation_required', description, {
            hint: '这是高危歌单操作。把 confirmToken 一并传回再次调用才会执行；也可在设置中关闭二次确认。',
          }),
          confirmToken: issued,
        },
      };
    }
    const verified = this.confirm.verify(token, op, args, deviceId);
    if (verified.ok !== true) return { ok: false, error: verified.error };
    return null;
  }

  async playlistDelete(params: Record<string, unknown>): Promise<ToolResult> {
    const id = str(params.playlistId);
    if (id === '') return { ok: false, error: makeError('bad_request', 'playlistId is required') };
    const device = this.activeDevice;
    if (device === undefined) return { ok: false, error: makeError('no_active_device', 'No active device') };
    const gate = this.confirmPlaylistOp(params, 'playlist.delete', { playlistId: id }, device.id, 'About to delete a NAS playlist');
    if (gate !== null) return gate;
    const result = await this.library.deletePlaylist(id);
    if (result.ok !== true) return result;
    await this.emitState();
    return { ok: true, action: 'delete', playlistId: id };
  }

  async playlistAdd(params: Record<string, unknown>): Promise<ToolResult> {
    const id = str(params.playlistId);
    if (id === '') return { ok: false, error: makeError('bad_request', 'playlistId is required') };
    let ids = this.playlistTrackIds(params);
    if (ids.length === 0 && str(params.query) !== '') {
      const result = await this.library.search({ query: str(params.query), kind: 'track', limit: 20 });
      if (result.ok !== true) return result;
      ids = (result.data.items as TrackRef[]).map((track) => track.id);
    }
    if (ids.length === 0) return { ok: false, error: makeError('bad_request', 'trackIds or query is required') };
    if (ids.length > MAX_PLAYLIST_BATCH) return { ok: false, error: makeError('bad_request', `At most ${MAX_PLAYLIST_BATCH} tracks per call`) };
    const failures: string[] = [];
    let added = 0;
    for (let index = 0; index < ids.length; index += PLAYLIST_CHUNK) {
      const chunk = ids.slice(index, index + PLAYLIST_CHUNK);
      const result = await this.library.addPlaylistTracks(id, chunk);
      if (result.ok !== true) {
        failures.push(...chunk);
        continue;
      }
      added += chunk.length;
    }
    await this.emitState();
    if (added === 0 && failures.length > 0) {
      return { ok: false, error: makeError('business', 'The NAS rejected every playlist add', { detail: failures.slice(0, 5).join(', ') }) };
    }
    return {
      ok: true,
      action: 'add',
      playlistId: id,
      added,
      failed: failures.length,
      ...(failures.length > 0 ? { failedIds: failures.slice(0, 20) } : {}),
    };
  }

  async playlistRemove(params: Record<string, unknown>): Promise<ToolResult> {
    const id = str(params.playlistId);
    if (id === '') return { ok: false, error: makeError('bad_request', 'playlistId is required') };
    const ids = this.playlistTrackIds(params);
    if (ids.length === 0) return { ok: false, error: makeError('bad_request', 'trackIds is required') };
    if (ids.length > MAX_PLAYLIST_BATCH) return { ok: false, error: makeError('bad_request', `At most ${MAX_PLAYLIST_BATCH} tracks per call`) };
    const device = this.activeDevice;
    if (device === undefined) return { ok: false, error: makeError('no_active_device', 'No active device') };
    if (ids.length > 1) {
      const gate = this.confirmPlaylistOp(
        params,
        'playlist.remove_many',
        { playlistId: id, trackIds: ids },
        device.id,
        `About to remove ${ids.length} tracks from a NAS playlist`,
      );
      if (gate !== null) return gate;
    }
    let removed = 0;
    const failures: string[] = [];
    for (let index = 0; index < ids.length; index += PLAYLIST_CHUNK) {
      const chunk = ids.slice(index, index + PLAYLIST_CHUNK);
      const result = await this.library.removePlaylistTracks(id, chunk);
      if (result.ok !== true) {
        failures.push(...chunk);
        continue;
      }
      removed += chunk.length;
    }
    await this.emitState();
    if (removed === 0 && failures.length > 0) {
      return { ok: false, error: makeError('business', 'The NAS rejected every playlist removal', { detail: failures.slice(0, 5).join(', ') }) };
    }
    return {
      ok: true,
      action: 'remove',
      playlistId: id,
      removed,
      failed: failures.length,
      ...(failures.length > 0 ? { failedIds: failures.slice(0, 20) } : {}),
    };
  }

  async exportPlaylist(id: string, format: PlaylistExportFormat, nameValue?: unknown): Promise<Result<PlaylistExportData>> {
    if (id === '') return fail('bad_request', 'playlistId is required');
    const result = await this.library.playlistTracksAll(id, 2000);
    if (result.ok !== true) return result;
    let name = sanitizePlaylistName(nameValue, '歌单');
    if (str(nameValue) === '') {
      const listed = await this.library.listPlaylists(0, 100);
      if (listed.ok === true) {
        const found = listed.data.items.find((playlist) => playlist.id === id);
        if (found !== undefined) name = found.title;
      }
    }
    const body = format === 'm3u8'
      ? toM3u8Playlist(name, result.data.items, result.data.truncated)
      : JSON.stringify(toJsonPlaylist(name, result.data.items, result.data.truncated), null, 2);
    return {
      ok: true,
      data: {
        format,
        filename: playlistFileName(name, format),
        contentType: format === 'm3u8' ? 'audio/x-mpegurl; charset=utf-8' : 'application/json; charset=utf-8',
        body,
        total: result.data.total,
        truncated: result.data.truncated,
      },
    };
  }

  async importPlaylist(text: string, filename = ''): Promise<ToolResult> {
    if (text.length > 1024 * 1024) return { ok: false, error: makeError('bad_request', 'Playlist file is larger than 1 MB') };
    const fallback = filename.replace(/\.[^.]+$/, '').trim() || '导入歌单';
    const parsed = parsePlaylistFile(text, fallback);
    if (parsed.ok !== true) return parsed;
    const resolved: string[] = [];
    const missing: PlaylistFileTrack[] = [];
    for (const track of parsed.data.tracks) {
      if (track.guid !== undefined && track.guid !== '') {
        resolved.push(track.guid);
        continue;
      }
      const needles = [track.title, `${track.title} ${track.artist}`.trim()]
        .map((value) => value.trim())
        .filter((value, index, all) => value !== '' && all.indexOf(value) === index);
      let match;
      for (const needle of needles) {
        const search = await this.library.search({ query: needle, kind: 'track', limit: 10 });
        if (search.ok !== true) continue;
        const items = search.data.items as TrackRef[];
        const normalizedTitle = track.title.toLowerCase();
        const normalizedArtist = track.artist.toLowerCase();
        match = items.find((item) => item.title.toLowerCase() === normalizedTitle
          && (normalizedArtist === '' || item.artist.toLowerCase().includes(normalizedArtist)))
          ?? items.find((item) => item.fileName !== '' && (track.fileName ?? '') !== ''
            && item.fileName.toLowerCase() === (track.fileName ?? '').toLowerCase());
        if (match !== undefined) break;
      }
      if (match !== undefined) {
        resolved.push(match.id);
        continue;
      }
      missing.push(track);
    }
    if (resolved.length === 0) {
      return { ok: false, error: makeError('not_found', 'No tracks from this file exist in the active library', { detail: `${missing.length} unmatched` }) };
    }
    const created = await this.library.createPlaylist(parsed.data.name);
    if (created.ok !== true) return created;
    let added = 0;
    let failed = 0;
    for (let index = 0; index < resolved.length; index += PLAYLIST_CHUNK) {
      const chunk = resolved.slice(index, index + PLAYLIST_CHUNK);
      const result = await this.library.addPlaylistTracks(created.data.id, chunk);
      if (result.ok === true) added += chunk.length;
      else failed += chunk.length;
    }
    if (added === 0) {
      await this.library.deletePlaylist(created.data.id).catch(() => undefined);
      return {
        ok: false,
        error: makeError('business', 'The NAS rejected every imported track; the empty playlist was removed', {
          detail: `${failed} failed, ${missing.length} missing`,
        }),
      };
    }
    await this.emitState();
    return {
      ok: true,
      action: 'import',
      created: true,
      playlist: created.data,
      added,
      failed,
      total: parsed.data.tracks.length,
      missing: missing.slice(0, 100),
    };
  }

  async smartPlaylist(params: Record<string, unknown>): Promise<ToolResult> {
    const rawName = str(params.name);
    if (rawName === '') return { ok: false, error: makeError('bad_request', 'name is required') };
    const name = sanitizePlaylistName(rawName, 'AI 歌单');
    let ids = this.playlistTrackIds(params);
    if (ids.length === 0) {
      const filters = asRecord(params.filters);
      const limit = int(params.limit, 50, 1, MAX_SMART_PLAYLIST);
      let offset = 0;
      while (ids.length < limit) {
        const result = await this.library.search({
          query: str(filters.query) || undefined,
          kind: 'track',
          offset,
          limit: Math.min(50, limit - ids.length),
          artist: str(filters.artist) || undefined,
          album: str(filters.album) || undefined,
          folder: str(filters.folder) || undefined,
          genre: str(filters.genre) || undefined,
          year: int(filters.year, 0, 0, 3000) || undefined,
          lossless: typeof filters.lossless === 'boolean' ? filters.lossless : undefined,
          hasLyric: typeof filters.hasLyric === 'boolean' ? filters.hasLyric : undefined,
          minDurationSec: int(filters.minDurationSec, 0, 0, 86_400) || undefined,
          maxDurationSec: int(filters.maxDurationSec, 0, 0, 86_400) || undefined,
        });
        if (result.ok !== true) return result;
        const items = (result.data.items as TrackRef[]).slice(0, limit - ids.length);
        ids.push(...items.map((track) => track.id));
        if (items.length === 0 || result.data.hasMore !== true) break;
        offset += items.length;
      }
      ids = [...new Set(ids)].slice(0, limit);
    }
    ids = [...new Set(ids)].slice(0, MAX_SMART_PLAYLIST);
    if (ids.length === 0) return { ok: false, error: makeError('not_found', 'No local tracks matched this playlist request') };
    const created = await this.library.createPlaylist(name);
    if (created.ok !== true) return created;
    let added = 0;
    const failures: string[] = [];
    for (let index = 0; index < ids.length; index += PLAYLIST_CHUNK) {
      const chunk = ids.slice(index, index + PLAYLIST_CHUNK);
      const result = await this.library.addPlaylistTracks(created.data.id, chunk);
      if (result.ok === true) added += chunk.length;
      else failures.push(...chunk);
    }
    await this.emitState();
    return {
      ok: true,
      action: 'smart_create',
      playlist: created.data,
      added,
      failed: failures.length,
      ...(failures.length > 0 ? { failedIds: failures.slice(0, 20) } : {}),
    };
  }

  async recommend(params: Record<string, unknown>): Promise<ToolResult> {
    const device = this.activeDevice;
    if (device === undefined) return { ok: false, error: makeError('no_active_device', 'No active device') };
    let seed: TrackRef | undefined;
    const seedId = str(params.seedTrackId) || 'current';
    if (seedId === 'current') seed = this.player.currentTrack() ?? undefined;
    else seed = this.player.raw().queue.find((track) => track.id === seedId) ?? this.library.findTrack(seedId);
    if (seed === undefined) return { ok: false, error: makeError('not_found', 'Seed track is not loaded; pass a track id from search or play it first') };
    const strategy = params.strategy === 'shuffle' || params.strategy === 'lossless' ? params.strategy : 'similar';
    const limit = int(params.limit, 10, 1, 50);
    const excludeIds = new Set(this.player.raw().queue.map((track) => track.id));
    const result = await this.recommendService.recommend({
      seed,
      strategy: strategy as RecommendStrategy,
      limit,
      excludeIds,
      ...(this.signalOf(params) !== undefined ? { signal: this.signalOf(params) } : {}),
    });
    if (result.ok !== true) return result;
    if (this.vault.activeDeviceId !== device.id) return { ok: false, error: makeError('cancelled', 'Active device changed during recommendation') };
    return {
      ok: true,
      seed,
      strategy,
      items: result.data.items,
      scanned: result.data.scanned,
      truncated: result.data.truncated,
    };
  }

  async home(): Promise<ToolResult> {
    const device = this.activeDevice;
    if (device === undefined) return { ok: false, error: makeError('no_active_device', 'No active device') };
    const key = `${device.id}\0${this.vault.activeListenerId}`;
    if (this.homeCache !== undefined && this.homeCache.key === key && Date.now() - this.homeCache.at < 15_000) {
      return { ok: true, ...this.homeCache.data };
    }
    const warnings: string[] = [];
    const [tracks, albums, artists, playlists, favorites] = await Promise.all([
      this.library.listTracks(0, 12),
      this.library.listAlbums(0, 12),
      this.library.listArtists(0, 12),
      this.library.listPlaylists(0, 12),
      this.library.favorites(0, 12),
    ]);
    if (tracks.ok !== true) warnings.push('tracks');
    if (albums.ok !== true) warnings.push('albums');
    if (artists.ok !== true) warnings.push('artists');
    if (playlists.ok !== true) warnings.push('playlists');
    if (favorites.ok !== true) warnings.push('favorites');
    const history = await this.history.list('30d', 0, 12, true);
    const profile = await this.profile.recommend(12);
    if (profile.ok !== true) warnings.push('recommended');
    const recommended = profile.ok === true ? profile.data.items : (tracks.ok === true ? tracks.data.items : []);
    const data: Record<string, unknown> = {
      activeDevice: { id: device.id, name: device.name, mode: device.mode, transport: transportKindOf(device) },
      listener: this.vault.activeListener(),
      current: this.player.currentTrack(),
      recent: history.items,
      recommended,
      recommendationSource: profile.ok === true ? profile.data.source : 'fallback',
      latestAlbums: albums.ok === true ? albums.data.items : [],
      artists: artists.ok === true ? artists.data.items : [],
      playlists: playlists.ok === true ? playlists.data.items : [],
      favorites: favorites.ok === true ? favorites.data.items : [],
      counts: {
        tracks: tracks.ok === true ? tracks.data.total : (this.librarySummary?.tracks ?? 0),
        albums: albums.ok === true ? albums.data.total : (this.librarySummary?.albums ?? 0),
        artists: artists.ok === true ? artists.data.total : (this.librarySummary?.artists ?? 0),
        playlists: playlists.ok === true ? playlists.data.total : (this.librarySummary?.playlists ?? 0),
      },
      profile: this.profile.summary(),
      scene: this.sceneState,
      dj: this.djService.status(),
      warnings,
    };
    this.homeCache = { at: Date.now(), key, data };
    return { ok: true, ...data };
  }

  async album(params: Record<string, unknown>): Promise<ToolResult> {
    const id = str(params.id) || str(params.albumId);
    if (id === '') return { ok: false, error: makeError('bad_request', 'album id is required') };
    const result = await this.library.albumDetail(id);
    if (result.ok !== true) return result;
    return {
      ok: true,
      ...(result.data.album !== undefined ? { album: result.data.album } : {}),
      total: result.data.tracks.length,
      tracks: result.data.tracks,
    };
  }

  async artist(params: Record<string, unknown>): Promise<ToolResult> {
    const name = str(params.name) || str(params.artist);
    if (name === '') return { ok: false, error: makeError('bad_request', 'artist name is required') };
    const tracks = await this.library.artistTracksByName(name, 50);
    if (tracks.ok !== true) return tracks;
    const albums = await this.library.search({ kind: 'album', query: name, limit: 20 });
    return {
      ok: true,
      name,
      tracks: tracks.data.items,
      albums: albums.ok === true ? albums.data.items : [],
      total: tracks.data.total,
      truncated: tracks.data.hasMore === true,
    };
  }

  async stats(params: Record<string, unknown>): Promise<ToolResult> {
    const range = statsRangeOf(params.range);
    const report = this.history.stats(range);
    return { ok: true, ...report, listener: this.vault.activeListener() };
  }

  async historyTool(params: Record<string, unknown>): Promise<ToolResult> {
    const range = statsRangeOf(params.range);
    const unique = params.unique === true || params.unique === '1' || params.unique === 'true';
    const result = await this.history.list(range, int(params.offset, 0, 0, 100_000), int(params.limit, 50, 1, 100), unique);
    return { ok: true, range, unique, listener: this.vault.activeListener(), ...result };
  }

  async clearHistory(params: Record<string, unknown>): Promise<ToolResult> {
    const device = this.activeDevice;
    const gate = this.confirmPlaylistOp(
      params,
      'history.clear',
      { listenerId: this.vault.activeListenerId },
      device?.id ?? 'local',
      'Clear this listener\'s local listening history',
    );
    if (gate !== null) return gate;
    await this.history.clear();
    this.historyTrackId = null;
    this.homeCache = undefined;
    await this.emitState();
    return { ok: true, action: 'clear', listener: this.vault.activeListener() };
  }

  async listenersTool(params: Record<string, unknown>): Promise<ToolResult> {
    const action = str(params.action) || 'list';
    if (action === 'list') return { ok: true, action, listeners: this.vault.listeners, activeListenerId: this.vault.activeListenerId };
    if (action === 'create') {
      try {
        const listener = await this.vault.createListener(params.name);
        await this.history.switchListener(listener.id);
        this.historyTrackId = null;
        this.homeCache = undefined;
        await this.emitState();
        return { ok: true, action, listener, listeners: this.vault.listeners, activeListenerId: this.vault.activeListenerId };
      } catch (error) {
        return { ok: false, error: makeError('bad_request', error instanceof Error ? error.message : 'create listener failed') };
      }
    }
    const id = listenerIdOf(params.listenerId) || listenerIdOf(params.id);
    if (action === 'switch') {
      if (id === '') return { ok: false, error: makeError('bad_request', 'listenerId is required') };
      const changed = await this.vault.setActiveListener(id);
      if (!changed) return { ok: false, error: makeError('not_found', 'Listener not found') };
      await this.history.switchListener(id);
      this.historyTrackId = null;
      this.homeCache = undefined;
      await this.emitState();
      return { ok: true, action, listener: this.vault.activeListener(), activeListenerId: this.vault.activeListenerId, listeners: this.vault.listeners };
    }
    if (action === 'rename') {
      if (id === '') return { ok: false, error: makeError('bad_request', 'listenerId is required') };
      const listener = await this.vault.renameListener(id, params.name);
      if (listener === undefined) return { ok: false, error: makeError('not_found', 'Listener not found') };
      await this.emitState();
      return { ok: true, action, listener };
    }
    if (action === 'delete') {
      if (id === '') return { ok: false, error: makeError('bad_request', 'listenerId is required') };
      if (id === this.vault.activeListenerId) return { ok: false, error: makeError('bad_request', 'Switch to another listener before deleting this one') };
      const gate = this.confirmPlaylistOp(
        params,
        'listener.delete',
        { listenerId: id },
        this.activeDevice?.id ?? 'local',
        'Delete a local listener profile and its history',
      );
      if (gate !== null) return gate;
      const removed = await this.vault.removeListener(id);
      if (!removed) return { ok: false, error: makeError('bad_request', 'Cannot delete this listener') };
      await this.history.removeListenerFile(id);
      this.homeCache = undefined;
      await this.emitState();
      return { ok: true, action, listeners: this.vault.listeners, activeListenerId: this.vault.activeListenerId };
    }
    return { ok: false, error: makeError('bad_request', `Unknown listener action: ${action}`) };
  }

  private async startScene(scene: SceneId, limit: number): Promise<ToolResult> {
    const result = await this.sceneService.tracks(scene, limit);
    if (result.ok !== true) return result;
    this.historySource = 'scene';
    this.player.replaceQueue(result.data.items);
    this.djService.start(result.data.items, 'scene', result.data.scene);
    this.sceneState = { scene: result.data.scene, active: true, startedAt: Date.now(), tracks: result.data.items.length };
    await this.vault.updateSettings({ autoDj: true });
    await this.emitState();
    return {
      ok: true,
      action: 'start',
      resolvedScene: result.data.scene,
      sceneState: this.sceneState,
      fallback: result.data.fallback,
      tracks: result.data.items,
      player: this.playerSummary(),
    };
  }

  async scene(params: Record<string, unknown>): Promise<ToolResult> {
    const action = str(params.action) || 'status';
    if (action === 'status') return { ok: true, action, scene: this.sceneState, dj: this.djService.status() };
    if (action === 'start') return this.startScene(sceneIdOf(params.scene), int(params.limit, 20, 1, 50));
    if (action === 'stop') {
      this.djService.stop();
      this.sceneState = { scene: null, active: false, startedAt: 0, tracks: 0 };
      await this.vault.updateSettings({ autoDj: false });
      await this.emitState();
      return { ok: true, action, scene: this.sceneState };
    }
    return { ok: false, error: makeError('bad_request', `Unknown scene action: ${action}`) };
  }

  private async djReplenish(): Promise<TrackRef[] | undefined> {
    if (this.sceneState.active && this.sceneState.scene !== null) {
      const result = await this.sceneService.tracks(this.sceneState.scene, 12);
      if (result.ok === true) return result.data.items;
    }
    const seed = this.player.currentTrack();
    if (seed !== null) {
      const result = await this.recommend({ seedTrackId: seed.id, strategy: 'similar', limit: 8 });
      if (result.ok === true && Array.isArray(result.items)) return result.items as TrackRef[];
    }
    const profile = await this.profile.recommend(8);
    return profile.ok === true ? profile.data.items : undefined;
  }

  async dj(params: Record<string, unknown>): Promise<ToolResult> {
    const action = str(params.action) || 'status';
    if (action === 'status') {
      return { ok: true, action, ...this.djService.status(), scene: this.sceneState, settings: { autoDj: this.vault.settings.autoDj } };
    }
    if (action === 'start') {
      const scene = str(params.scene) !== '' ? sceneIdOf(params.scene) : null;
      let tracks: TrackRef[] = [];
      if (Array.isArray(params.trackIds)) {
        for (const value of params.trackIds) {
          const id = str(value);
          if (id === '') continue;
          const found = this.player.raw().queue.find((track) => track.id === id) ?? this.library.findTrack(id);
          if (found !== undefined) tracks.push({ ...found });
        }
      }
      if (tracks.length === 0 && scene !== null) {
        const sceneResult = await this.sceneService.tracks(scene, int(params.limit, 20, 1, 50));
        if (sceneResult.ok !== true) return sceneResult;
        tracks = sceneResult.data.items;
        this.sceneState = { scene: sceneResult.data.scene, active: true, startedAt: Date.now(), tracks: tracks.length };
      }
      if (tracks.length === 0) return { ok: false, error: makeError('bad_request', 'trackIds or scene is required to start the DJ') };
      this.historySource = 'dj';
      this.player.replaceQueue(tracks.slice(0, 200));
      this.djService.start(tracks.slice(0, 200), scene === null ? 'pool' : 'scene', scene);
      await this.vault.updateSettings({ autoDj: true });
      await this.emitState();
      return { ok: true, action, dj: this.djService.status(), scene: this.sceneState, player: this.playerSummary() };
    }
    if (action === 'stop' || action === 'disable') {
      this.djService.stop();
      this.sceneState = { scene: null, active: false, startedAt: 0, tracks: 0 };
      await this.vault.updateSettings({ autoDj: false });
      await this.emitState();
      return { ok: true, action, enabled: false, dj: this.djService.status() };
    }
    if (action === 'enable') {
      this.djService.setEnabled(true);
      await this.vault.updateSettings({ autoDj: true });
      await this.emitState();
      return { ok: true, action, enabled: true, dj: this.djService.status() };
    }
    return { ok: false, error: makeError('bad_request', `Unknown DJ action: ${action}`) };
  }

  async voice(params: Record<string, unknown>): Promise<ToolResult> {
    const text = rawStr(params.text).trim();
    if (text === '') return { ok: false, error: makeError('bad_request', 'text is required') };
    const intent = parseVoiceIntent(text);
    if (intent.matched !== true) return { ok: true, matched: false };
    if (intent.clientAction !== undefined) {
      return { ok: true, matched: true, action: intent.action, clientAction: intent.clientAction };
    }
    if (intent.action === 'play_query' && intent.query !== undefined) {
      const result = await this.play({ query: intent.query, clientId: 'voice' });
      return result.ok === true ? { ok: true, matched: true, action: intent.action, player: this.playerSummary() } : result;
    }
    if (intent.action === 'favorite' || intent.action === 'unfavorite') {
      const result = await this.favorite({ action: intent.action === 'favorite' ? 'add' : 'remove', trackId: 'current' });
      return result.ok === true ? { ok: true, matched: true, action: intent.action, changed: 1 } : result;
    }
    if (intent.action === 'volume') {
      const result = await this.control({ action: 'volume', volume: intent.volume ?? 50 });
      return result.ok === true ? { ok: true, matched: true, action: intent.action, player: this.playerSummary() } : result;
    }
    const action = intent.action === 'play' ? 'resume'
      : intent.action === 'shuffle' ? 'mode'
        : intent.action === 'repeat_all' ? 'mode'
          : intent.action === 'repeat_one' ? 'mode'
            : intent.action ?? '';
    const result = await this.control({
      action,
      ...(intent.action === 'shuffle' ? { mode: 'shuffle' } : {}),
      ...(intent.action === 'repeat_all' ? { mode: 'list' } : {}),
      ...(intent.action === 'repeat_one' ? { mode: 'one' } : {}),
    });
    return result.ok === true ? { ok: true, matched: true, action: intent.action, player: this.playerSummary() } : result;
  }

  auditList(limit = 100): AuditEntry[] {
    return this.audit.list(limit);
  }

  async clearAudit(): Promise<void> {
    await this.audit.clear();
  }

  trafficSummary(): TrafficSummary {
    return this.traffic.summary();
  }

  async clearTraffic(): Promise<void> {
    await this.traffic.clear();
  }

  async playlistTool(params: Record<string, unknown>): Promise<ToolResult> {
    const action = str(params.action) || 'list';
    if (action === 'list') {
      const result = await this.library.listPlaylists(int(params.offset, 0, 0, 100_000), int(params.limit, 20, 1, 100));
      if (result.ok !== true) return result;
      return { ok: true, action, ...result.data };
    }
    if (action === 'get') {
      const id = str(params.playlistId);
      if (id === '') return { ok: false, error: makeError('bad_request', 'playlistId is required') };
      const result = await this.library.playlistDetail(id);
      if (result.ok !== true) return result;
      return {
        ok: true,
        action,
        ...(result.data.playlist !== undefined ? { playlist: result.data.playlist } : {}),
        total: result.data.total,
        items: result.data.items,
        truncated: result.data.truncated,
      };
    }
    if (action === 'create') return this.playlistCreate(params.name);
    if (action === 'rename') return this.playlistRename(str(params.playlistId), params.name);
    if (action === 'delete') return this.playlistDelete(params);
    if (action === 'add') return this.playlistAdd(params);
    if (action === 'remove') return this.playlistRemove(params);
    return { ok: false, error: makeError('bad_request', `Unknown playlist action: ${action}`) };
  }

  async favorite(params: Record<string, unknown>, confirmedByUser = false): Promise<ToolResult> {
    const action = str(params.action) || 'list';
    const device = this.activeDevice;
    if (device === undefined) return { ok: false, error: makeError('no_active_device', 'No active device') };
    const api = this.ensureApi();
    if (api.ok !== true) return api;

    if (action === 'list') {
      const result = await this.library.favorites(int(params.offset, 0, 0, 100_000), int(params.limit, 20, 1, 100), this.signalOf(params));
      if (result.ok !== true) return result;
      return { ok: true, action, ...result.data };
    }

    let ids: string[] = [];
    if (Array.isArray(params.trackIds)) ids = params.trackIds.map((value) => str(value)).filter((value) => value !== '');
    const single = str(params.trackId);
    if (single === 'current') {
      const current = this.player.currentTrack();
      if (current === null) return { ok: false, error: makeError('not_found', 'Nothing is playing') };
      ids = [current.id];
    } else if (single !== '') {
      ids = [single, ...ids];
    }
    ids = [...new Set(ids)];
    if (ids.length === 0) return { ok: false, error: makeError('bad_request', 'trackId or trackIds is required') };
    if (ids.length > MAX_FAVORITE_BULK) return { ok: false, error: makeError('bad_request', `At most ${MAX_FAVORITE_BULK} tracks per call`) };

    const on = action === 'add';
    if (action !== 'add' && action !== 'remove' && action !== 'remove_many') {
      return { ok: false, error: makeError('bad_request', `Unknown favorite action: ${action}`) };
    }
    if (!on && ids.length > 1 && !confirmedByUser && this.vault.settings.confirmHighRisk) {
      const confirmArgs = { action: 'remove_many', trackIds: ids };
      const token = str(params.confirmToken);
      if (token === '') {
        const issued = this.confirm.issue('favorite.remove_many', confirmArgs, device.id);
        return {
          ok: false,
          error: {
            ...makeError('confirmation_required', `About to remove ${ids.length} favorites from the NAS`, {
              hint: '这是批量高危操作。把 confirmToken 一并传回再次调用才会执行；也可在设置中关闭二次确认。',
            }),
            confirmToken: issued,
          },
        };
      }
      const verified = this.confirm.verify(token, 'favorite.remove_many', confirmArgs, device.id);
      if (verified.ok !== true) return { ok: false, error: verified.error };
    }

    let changed = 0;
    const failures: string[] = [];
    for (const id of ids) {
      const result = await api.data.favorite(id, on);
      if (result.ok !== true) {
        failures.push(id);
        continue;
      }
      changed += 1;
      this.library.applyFavorite(id, on);
      this.player.setFavorite(id, on);
      this.hub.send('favorite', { trackId: id, favorite: on });
    }
    if (changed === 0 && failures.length > 0) {
      return {
        ok: false,
        error: makeError('business', 'The NAS rejected every favorite change', {
          detail: `failed: ${failures.slice(0, 5).join(', ')}`,
        }),
      };
    }
    return {
      ok: true,
      action,
      changed,
      failed: failures.length,
      favorite: on,
      ...(failures.length > 0 ? { failedIds: failures.slice(0, 20) } : {}),
    };
  }

  private signalOf(params: Record<string, unknown>): AbortSignal | undefined {
    const signal = params.signal;
    return signal instanceof AbortSignal ? signal : undefined;
  }

  async lyrics(params: Record<string, unknown>): Promise<ToolResult> {
    const device = this.activeDevice;
    if (device === undefined) return { ok: false, error: makeError('no_active_device', 'No active device') };
    let trackId = str(params.trackId);
    if (trackId === 'current') {
      const current = this.player.currentTrack();
      if (current === null) return { ok: false, error: makeError('not_found', 'Nothing is playing') };
      trackId = current.id;
    }
    if (trackId === '') return { ok: false, error: makeError('bad_request', 'trackId is required') };
    const transport = this.connection.currentTransport;
    const deviceKey = `${device.id}\0${transport?.base ?? ''}`;
    const maxLines = int(params.maxLines, 0, 0, 5000);
    const cached = await this.cache.lyrics(deviceKey, trackId, async () => {
      const result = await this.library.lyrics(trackId);
      if (result.ok !== true) return result;
      return {
        ok: true,
        data: { lrc: result.data.lrc, offsetMs: result.data.offsetMs, isLRC: result.data.isLRC },
      };
    });
    if (cached.ok !== true) return cached;
    const allLines = cached.data.lrc === '' ? [] : cached.data.lrc.split('\n');
    const lines = maxLines > 0 ? allLines.slice(0, maxLines) : allLines;
    return {
      ok: true,
      trackId,
      title: this.library.findTrack(trackId)?.title ?? this.player.raw().queue.find((track) => track.id === trackId)?.title ?? '',
      lrc: lines.join('\n'),
      lineCount: lines.length,
      truncated: lines.length < allLines.length,
      offsetMs: cached.data.offsetMs,
      isLRC: cached.data.isLRC,
    };
  }

  /** The lyrics panel route gets a structured, best-effort parsed document. */
  async lyricsDocument(params: Record<string, unknown>): Promise<ToolResult> {
    const raw = await this.lyrics(params);
    if (raw.ok !== true) return raw;
    const lrc = typeof raw.lrc === 'string' ? raw.lrc : '';
    const offsetMs = Number(raw.offsetMs) || 0;
    const document = parseLrc(lrc, offsetMs, 2000);
    return {
      ...raw,
      offsetMs: document.offsetMs,
      timed: document.timed,
      lines: document.lines,
    };
  }

  // ------------------------------------------------------------------
  // Settings / cache / logs / reset
  // ------------------------------------------------------------------

  settings(): Settings {
    return this.vault.settings;
  }

  async updateSettings(patch: Record<string, unknown>): Promise<ToolResult> {
    const next = await this.vault.updateSettings({
      ...(typeof patch.confirmHighRisk === 'boolean' ? { confirmHighRisk: patch.confirmHighRisk } : {}),
      ...(patch.cacheLimitMb !== undefined ? { cacheLimitMb: Number(patch.cacheLimitMb) } : {}),
      ...(patch.requestConcurrency !== undefined ? { requestConcurrency: Number(patch.requestConcurrency) } : {}),
      ...(patch.probeIntervalSec !== undefined ? { probeIntervalSec: Number(patch.probeIntervalSec) } : {}),
      ...(typeof patch.logsEnabled === 'boolean' ? { logsEnabled: patch.logsEnabled } : {}),
      ...(typeof patch.floatingPlayer === 'boolean' ? { floatingPlayer: patch.floatingPlayer } : {}),
      ...(typeof patch.immersiveCover === 'boolean' ? { immersiveCover: patch.immersiveCover } : {}),
      ...(typeof patch.spectrum === 'boolean' ? { spectrum: patch.spectrum } : {}),
      ...(typeof patch.shortcuts === 'boolean' ? { shortcuts: patch.shortcuts } : {}),
      ...(typeof patch.autoDj === 'boolean' ? { autoDj: patch.autoDj } : {}),
      ...(typeof patch.backgroundProbe === 'boolean' ? { backgroundProbe: patch.backgroundProbe } : {}),
      ...(patch.backgroundProbeIntervalSec !== undefined ? { backgroundProbeIntervalSec: Number(patch.backgroundProbeIntervalSec) } : {}),
      ...(typeof patch.historyEnabled === 'boolean' ? { historyEnabled: patch.historyEnabled } : {}),
      ...(typeof patch.voiceEnabled === 'boolean' ? { voiceEnabled: patch.voiceEnabled } : {}),
      ...(typeof patch.agentWrites === 'boolean' ? { agentWrites: patch.agentWrites } : {}),
      ...(typeof patch.trafficStats === 'boolean' ? { trafficStats: patch.trafficStats } : {}),
    });
    this.djService.setEnabled(next.autoDj);
    if (!next.historyEnabled) {
      this.history.finish(false);
      this.historyTrackId = null;
    }
    this.limiter.setMax(next.requestConcurrency);
    this.probeScheduler.configure(next);
    this.cache.setLimit(next.cacheLimitMb);
    this.logs.setEnabled(next.logsEnabled);
    await this.refreshCacheSummary();
    this.rev += 1;
    await this.emitState();
    return { ok: true, settings: next };
  }

  async clearCache(): Promise<ToolResult> {
    await this.cache.clear();
    await this.refreshCacheSummary();
    this.rev += 1;
    await this.emitState();
    return { ok: true, cache: { ...this.cacheSummary } };
  }

  logList(limit: number): LogEntry[] {
    return this.logs.list(limit);
  }

  clearLogs(): void {
    this.logs.clear();
  }

  async reset(): Promise<ToolResult> {
    this.confirm.dispose();
    await this.connection.setActive(undefined);
    this.player.setDevice(null);
    this.library.invalidate();
    this.librarySummary = null;
    await this.vault.reset();
    await this.cache.clear();
    this.clearCompatCache();
    this.lastStatus.clear();
    await this.refreshCacheSummary();
    this.rev += 1;
    await this.emitState();
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Media
  // ------------------------------------------------------------------

  private mediaDeviceKey(): string {
    return `${this.activeDevice?.id ?? 'none'}\0${this.connection.currentTransport?.base ?? ''}`;
  }

  async trackMetadata(guid: string): Promise<ToolResult> {
    const id = guid.trim();
    if (id === '' || id.length > 300 || /[\s&?#]/.test(id)) {
      return fail('bad_request', 'Invalid track guid');
    }
    const result = await this.fetchTrackMetadata(id);
    if (result.ok !== true) return result;
    return { ok: true, track: result.data };
  }

  private async fetchTrackMetadata(guid: string): Promise<Result<TrackRef>> {
    const api = this.apiOrNull();
    if (api === null) return fail('no_active_device', 'No active fnOS music transport');
    return api.trackMetadata(guid);
  }

  /** Fill codec/channels for a queue/history track created before metadata was recorded. */
  private async enrichTrack(track: TrackRef): Promise<TrackRef> {
    if (track.format !== '' || track.codec !== '') return track;
    const result = await this.fetchTrackMetadata(track.id);
    if (result.ok !== true) return track;
    return { ...track, ...result.data, favorite: track.favorite };
  }

  private clearCompatCache(): void {
    this.compatCache.clear();
    this.compatCacheBytes = 0;
  }

  private rememberCompat(key: string, value: { buffer: Buffer; contentType: string }): void {
    const existing = this.compatCache.get(key);
    if (existing !== undefined) this.compatCacheBytes -= existing.buffer.length;
    this.compatCache.set(key, { at: Date.now(), ...value });
    this.compatCacheBytes += value.buffer.length;
    while (this.compatCache.size > COMPAT_CACHE_ENTRIES || this.compatCacheBytes > COMPAT_CACHE_BYTES) {
      const oldest = this.compatCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const entry = this.compatCache.get(oldest);
      if (entry !== undefined) this.compatCacheBytes -= entry.buffer.length;
      this.compatCache.delete(oldest);
    }
  }

  private hlsPathOf(value: string): string | undefined {
    let pathname = value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      try {
        pathname = new URL(value).pathname;
      } catch {
        return undefined;
      }
    }
    if (pathname.startsWith('/music/api/v1')) pathname = pathname.slice('/music/api/v1'.length);
    if (!pathname.startsWith('/track/hls/')) return undefined;
    if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) return undefined;
    return pathname;
  }

  private async readHlsPath(
    api: FnosApi,
    pathname: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Result<Buffer>> {
    let last: Result<Buffer> | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (signal?.aborted) return fail('cancelled', 'Compatibility conversion was cancelled');
      const result = await api.hls(pathname, signal);
      if (result.ok === true) {
        if (result.data.status >= 400) {
          last = fail('server', `HLS returned HTTP ${result.data.status}`);
        } else {
          const buffer = await readStreamBuffer(result.data.stream, maxBytes);
          if (buffer.ok === true) return buffer;
          last = buffer;
        }
      } else {
        last = result;
      }
      if (last.ok === false && last.error.code === 'cancelled') return last;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return last ?? fail('server', 'HLS request failed');
  }

  private async readCompatSegments(
    api: FnosApi,
    base: string,
    init: string,
    segments: string[],
    signal?: AbortSignal,
  ): Promise<Result<Buffer[]>> {
    const names = [init, ...segments];
    const output: Buffer[] = new Array(names.length);
    let total = 0;
    for (let start = 0; start < names.length; start += COMPAT_SEGMENT_WORKERS) {
      if (signal?.aborted) return fail('cancelled', 'Compatibility conversion was cancelled');
      const batch = names
        .slice(start, start + COMPAT_SEGMENT_WORKERS)
        .map((name, offset) => ({ name, index: start + offset }));
      const results = await Promise.all(batch.map(({ name }) => this.readHlsPath(
        api,
        `${base}/${name}`,
        COMPAT_SEGMENT_MAX_BYTES,
        signal,
      )));
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result === undefined) return fail('server', 'HLS segment result is missing');
        if (result.ok !== true) return result;
        total += result.data.length;
        if (total > COMPAT_STREAM_BYTES) return fail('unsupported', 'Compatible audio stream is too large');
        output[start + index] = result.data;
      }
    }
    return { ok: true, data: output };
  }

  private async buildCompatAudio(guid: string, signal?: AbortSignal): Promise<Result<{ buffer: Buffer; contentType: string }>> {
    const api = this.apiOrNull();
    if (api === null) return fail('no_active_device', 'No active fnOS music transport');
    const started = await api.transcode(guid, 'opus', 2);
    if (started.ok !== true) return started;
    const playlistPath = this.hlsPathOf(started.data);
    if (playlistPath === undefined) return fail('protocol', 'Transcode returned an invalid HLS URL');
    try {
      let playlist: HlsPlaylist | undefined;
      const deadline = Date.now() + COMPAT_HLS_TIMEOUT_MS;
      while (playlist === undefined) {
        if (signal?.aborted) return fail('cancelled', 'Compatibility conversion was cancelled');
        const raw = await this.readHlsPath(api, playlistPath, COMPAT_PLAYLIST_MAX_BYTES, signal);
        if (raw.ok === true) {
          const parsed = parseHlsPlaylist(raw.data.toString('utf8'));
          if (parsed.ok !== true) return parsed;
          if (parsed.data.complete) {
            playlist = parsed.data;
            break;
          }
        }
        if (Date.now() >= deadline) {
          return fail('unsupported', 'Timed out waiting for the compatibility transcode', {
            hint: 'NAS 转码未在时限内完成，请检查 NAS 负载后重试。',
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const base = playlistPath.slice(0, playlistPath.lastIndexOf('/'));
      const chunks = await this.readCompatSegments(api, base, playlist.init, playlist.segments, signal);
      if (chunks.ok !== true) return chunks;
      if (signal?.aborted) return fail('cancelled', 'Compatibility conversion was cancelled');
      const fmp4 = Buffer.concat(chunks.data);
      if (fmp4.length === 0) return fail('unsupported', 'Compatibility transcode produced no audio');
      // ffmpeg is preferred, but its absence or a remux failure must not make
      // the track unplayable: Chromium can append the same Opus/fMP4 to MSE.
      if (findFfmpeg() !== undefined) {
        const webm = await remuxFmp4ToWebm(fmp4, signal);
        if (webm.ok === true) {
          return { ok: true, data: { buffer: webm.data, contentType: 'audio/webm' } };
        }
      }
      this.compatStatus = { backend: 'mse', ffmpeg: false };
      return { ok: true, data: { buffer: fmp4, contentType: 'audio/mp4' } };
    } finally {
      await api.transcodeQuit(guid).catch(() => undefined);
    }
  }

  async compatAudio(guid: string): Promise<Result<{ buffer: Buffer; contentType: string }>> {
    const id = guid.trim();
    if (id === '' || id.length > 300 || /[\s&?#]/.test(id)) return fail('bad_request', 'Invalid track guid');
    const key = `${this.mediaDeviceKey()}\0${id}`;
    const cached = this.compatCache.get(key);
    if (cached !== undefined) {
      this.compatCache.delete(key);
      this.compatCache.set(key, cached);
      return { ok: true, data: { buffer: cached.buffer, contentType: cached.contentType } };
    }
    const pending = this.compatPending.get(key);
    if (pending !== undefined) return pending;
    const task = this.buildCompatAudio(id)
      .then((result) => {
        if (result.ok === true) this.rememberCompat(key, result.data);
        return result;
      })
      .finally(() => {
        this.compatPending.delete(key);
      });
    this.compatPending.set(key, task);
    return task;
  }

  async cover(coverId: string, size: string): Promise<Result<{ buffer: Buffer; contentType: string }>> {
    const id = coverId.trim();
    if (id === '') return fail('bad_request', 'coverId is required');
    if (id.length > 300) return fail('bad_request', 'coverId is too long');
    const result = await this.cache.cover(
      this.mediaDeviceKey(),
      id,
      size.trim() || DEFAULT_COVER_SIZE,
      async () => {
        const stream = await this.connection.stream('/static/cover', {
          query: { coverId: id, size: size.trim() || DEFAULT_COVER_SIZE },
          timeoutMs: 20_000,
        });
        if (stream.ok !== true) return stream;
        const buffer = await readStreamBuffer(stream.data.stream, 8 * 1024 * 1024);
        if (buffer.ok !== true) return buffer;
        return {
          ok: true,
          data: {
            buffer: buffer.data,
            contentType: stream.data.headers['content-type'] ?? 'application/octet-stream',
          },
        };
      },
    );
    return result;
  }

  async stream(guid: string, range: string, ifRange: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Result<StreamResponse>> {
    const id = guid.trim();
    if (id === '' || id.length > 300 || /[\s&?#]/.test(id)) {
      return fail('bad_request', 'Invalid track guid');
    }
    const headers: Record<string, string> = {};
    if (range !== '') headers.range = range;
    if (ifRange !== '') headers['if-range'] = ifRange;
    const result = await this.connection.stream('/track/stream', {
      query: { guid: id },
      headers,
      method,
      timeoutMs: 20_000,
    });
    if (result.ok !== true) {
      this.log({ at: Date.now(), kind: 'error', code: result.error.code, trackId: id, message: result.error.message });
      return result;
    }
    this.activeStreams.add(result.data.stream);
    result.data.stream.once('close', () => {
      this.activeStreams.delete(result.data.stream);
    });
    if (method === 'GET') {
      const known = this.player.currentTrack();
      this.log({
        at: Date.now(),
        kind: 'play',
        trackId: id,
        title: known?.id === id ? known.title : undefined,
        message: 'audio stream started',
      });
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.confirm.dispose();
    this.history.finish(false);
    void this.history.flush().finally(() => this.history.dispose());
    void this.audit.flush().finally(() => this.audit.dispose());
    void this.traffic.flush().finally(() => this.traffic.dispose());
    this.probeScheduler.dispose();
    this.connection.dispose();
    this.clearCompatCache();
    for (const stream of this.activeStreams) stream.destroy();
    this.activeStreams.clear();
    this.hub.dispose();
    void this.cache.dispose();
  }
}

