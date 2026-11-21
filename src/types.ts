/**
 * Shared data model for the Host half.
 *
 * Secrets live in `FnosTarget.token` only inside the Host process and the
 * profile credential record. `DeviceView` is the redacted shape that may cross
 * to the browser, logs, and tool results.
 */

export type DeviceMode = 'fnid' | 'direct' | 'auto';
export type TransportKind = 'fnid' | 'direct' | 'unix' | 'auto';
export type DirectVia = 'fnid' | 'direct' | 'unix';
export type PlayMode = 'list' | 'one' | 'shuffle';

export interface FnosTarget {
  id: string;
  name: string;
  mode: DeviceMode;
  fnid?: string;
  address?: string;
  unixPath?: string;
  /** fnOS music-account userToken. Never sent to the browser. */
  token: string;
  allowSelfSigned: boolean;
  /** Stable 32-hex device id used by the native password-login endpoint. */
  deviceId: string;
  accountName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceView {
  id: string;
  name: string;
  mode: DeviceMode;
  transport: TransportKind;
  fnid?: string;
  address?: string;
  tokenSet: boolean;
  allowSelfSigned: boolean;
  accountName?: string;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  last?: ConnectionView;
  webUrl?: string;
}

export interface Settings {
  /** Require a confirmToken before bulk favorite removal and future destructive tools. */
  confirmHighRisk: boolean;
  /** Disk cache ceiling for covers + lyrics. 0 disables disk cache. */
  cacheLimitMb: number;
  /** Concurrent fnOS API requests (1-6). */
  requestConcurrency: number;
  /** Connected-device probe interval in seconds (10-300). */
  probeIntervalSec: number;
  logsEnabled: boolean;
  /** Show the optional floating player when a track is playing. */
  floatingPlayer: boolean;
  /** Use a blurred cover background in the expanded floating player. */
  immersiveCover: boolean;
  /** Draw the spectrum canvas in the expanded floating player. */
  spectrum: boolean;
  /** Enable global player keyboard shortcuts outside editable fields. */
  shortcuts: boolean;
  /** Append a similar local track when the queue ends. */
  autoDj: boolean;
  /** Probe every saved device in the background (opt-in). */
  backgroundProbe: boolean;
  /** Background probe interval in seconds (60-600). */
  backgroundProbeIntervalSec: number;
  /** Record local listening history for the active listener. */
  historyEnabled: boolean;
  /** Show the optional browser-SpeechRecognition microphone. */
  voiceEnabled: boolean;
  /** Allow Agent tools to write playlists/favorites/local data. */
  agentWrites: boolean;
  /** Aggregate non-secret traffic counters. */
  trafficStats: boolean;
}

export type Quality = 'hires' | 'lossless' | 'standard';

export interface TrackRef {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  year: number;
  durationSec: number;
  coverId: string;
  quality: Quality;
  bitrateKbps: number;
  format: string;
  codec: string;
  channels: number;
  bitDepth: number;
  sampleRate: number;
  favorite: boolean;
  folder: string;
  fileName: string;
  genre: string;
  /** Native `hasLyric` flag; V2 smart playlists can filter instrumental tracks. */
  hasLyric: boolean;
}

export interface ArtistRef {
  id: string;
  name: string;
  coverId: string;
  albumCount: number;
  trackCount: number;
}

export interface AlbumRef {
  id: string;
  title: string;
  artist: string;
  year: number;
  coverId: string;
  trackCount: number;
}

export interface PlaylistRef {
  id: string;
  title: string;
  coverId: string;
  trackCount: number;
}

export interface PlayerState {
  deviceId: string | null;
  /** The full queue stays in Host memory; serialized views may carry a window. */
  queue: TrackRef[];
  queueTotal: number;
  queueRevision: number;
  /** Current queue index (not the order cursor). */
  currentIndex: number;
  track: TrackRef | null;
  /** Playback order as indexes into `queue`; list/shuffle share one model. */
  order: number[];
  /** Index into `order`, not into `queue`. */
  cursor: number;
  status: 'playing' | 'paused' | 'stopped';
  positionMs: number;
  volume: number;
  muted: boolean;
  mode: PlayMode;
  rev: number;
  seekToken: number;
  audioError?: string;
  driverClientId?: string;
  updatedAt: number;
}

export interface ProbeLayer {
  ok: boolean;
  latencyMs: number;
  code?: ErrorCode;
  message?: string;
}

export interface ProbeLayers {
  gateway: ProbeLayer;
  device: ProbeLayer;
  service: ProbeLayer;
}

export type ConnectionPhase =
  | 'idle'
  | 'probing'
  | 'online'
  | 'degraded'
  | 'offline'
  | 'auth'
  | 'service-missing';

export interface ConnectionView {
  phase: ConnectionPhase;
  layers: ProbeLayers;
  latencyMs: number;
  slowRelay: boolean;
  code?: ErrorCode;
  message?: string;
  hint?: string;
  checkedAt: number;
  transport: TransportKind;
  /** Real path chosen by an auto-mode transport. */
  via?: DirectVia;
}

export interface LogEntry {
  at: number;
  kind: 'request' | 'play' | 'error' | 'system';
  method?: string;
  path?: string;
  status?: number;
  ms?: number;
  bytes?: number;
  via?: 'fnid' | 'direct' | 'unix' | 'auto';
  code?: ErrorCode;
  trackId?: string;
  title?: string;
  message?: string;
}

export interface CacheSummary {
  covers: number;
  lyrics: number;
  bytes: number;
  limitMb: number;
}

export interface LibrarySummary {
  tracks: number;
  albums: number;
  artists: number;
  playlists: number;
}

export type CompatBackend = 'ffmpeg' | 'mse';

export interface CompatStatus {
  backend: CompatBackend;
  ffmpeg: boolean;
}

export interface Snapshot {
  version: 1;
  rev: number;
  activeDeviceId: string | null;
  devices: DeviceView[];
  connection: ConnectionView;
  player: PlayerState;
  listener: ListenerProfile;
  settings: Settings;
  compat: CompatStatus;
  cache: CacheSummary;
  library: LibrarySummary | null;
  audioClients: number;
  persistent: boolean;
  at: number;
}

export type ErrorCode =
  | 'not_configured'
  | 'no_active_device'
  | 'auth'
  | 'forbidden'
  | 'gateway_unreachable'
  | 'gateway_timeout'
  | 'device_offline'
  | 'service_missing'
  | 'relay_timeout'
  | 'relay_rejected'
  | 'tls'
  | 'refused'
  | 'dns'
  | 'network'
  | 'server'
  | 'business'
  | 'protocol'
  | 'rate_limited'
  | 'not_found'
  | 'unsupported'
  | 'cancelled'
  | 'confirmation_required'
  | 'bad_request';

export interface FnosError {
  code: ErrorCode;
  message: string;
  hint?: string;
  status?: number;
  detail?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: FnosError };

export interface ToolError extends FnosError {
  confirmToken?: string;
}

export type ToolResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: ToolError };

export interface CredentialRecordLike {
  kind?: string;
  payload?: unknown;
}

export interface CredentialsLike {
  readRecord(key: string): Promise<CredentialRecordLike | undefined>;
  modifyRecord(
    key: string,
    mutate: (
      current: CredentialRecordLike | undefined,
    ) => Promise<CredentialRecordLike | undefined>,
  ): Promise<CredentialRecordLike | undefined>;
  deleteRecord(key: string): Promise<void>;
}

export interface ListenerProfile {
  id: string;
  name: string;
  createdAt: number;
}

export interface VaultData {
  version: 3;
  activeDeviceId: string | null;
  devices: FnosTarget[];
  listeners: ListenerProfile[];
  activeListenerId: string;
  settings: Settings;
}

export interface HistoryEntry {
  id: string;
  at: number;
  updatedAt: number;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  coverId: string;
  genre: string;
  quality: Quality;
  format: string;
  codec: string;
  channels: number;
  durationSec: number;
  listenedMs: number;
  completed: boolean;
  deviceId: string;
  listenerId: string;
  source: 'play' | 'queue' | 'dj' | 'scene';
}

export type StatsRange = '7d' | '30d' | 'all';

export interface StatsItem {
  key: string;
  label: string;
  sub?: string;
  plays: number;
  listenedSec: number;
}

export interface StatsReport {
  range: StatsRange;
  from: number;
  to: number;
  plays: number;
  listenedSec: number;
  uniqueTracks: number;
  activeDays: number;
  daily: Array<{ date: string; plays: number; listenedSec: number }>;
  hourly: number[];
  topTracks: StatsItem[];
  topArtists: StatsItem[];
  topAlbums: StatsItem[];
  topGenres: StatsItem[];
  quality: Array<{ quality: Quality; plays: number }>;
}

export type SceneId = 'auto' | 'morning' | 'focus' | 'evening' | 'late' | 'instrumental';

export interface SceneState {
  scene: SceneId | null;
  active: boolean;
  startedAt: number;
  tracks: number;
}

export interface DjState {
  enabled: boolean;
  mode: 'similar' | 'pool' | 'scene';
  scene: SceneId | null;
  poolTotal: number;
  poolRemaining: number;
  updatedAt: number;
}

export interface AuditEntry {
  at: number;
  tool: string;
  action: string;
  target: string;
  ok: boolean;
  code?: string;
}

export interface TrafficBucket {
  key: string;
  requests: number;
  errors: number;
  bytes: number;
  ms: number;
}

export interface TrafficSummary {
  from: number;
  to: number;
  total: { requests: number; errors: number; bytes: number; ms: number };
  byDay: TrafficBucket[];
  byVia: TrafficBucket[];
  byDevice: TrafficBucket[];
}

/** A translation/word-timed lyric document parsed on the Host. */
export interface LyricWord {
  timeMs: number;
  text: string;
}

export interface LyricLine {
  timeMs: number;
  endMs: number;
  text: string;
  translation?: string;
  words?: LyricWord[];
}

export interface LyricDocument {
  timed: boolean;
  offsetMs: number;
  lines: LyricLine[];
}

/** Portable, plugin-owned playlist JSON. fnOS has no official file format. */
export interface PlaylistFileTrack {
  guid?: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  fileName?: string;
  path?: string;
}

export interface PlaylistFile {
  format: 'dsh-fnos-music-playlist';
  version: 1;
  name: string;
  exportedAt?: string;
  truncated?: boolean;
  tracks: PlaylistFileTrack[];
}

export type PlaylistExportFormat = 'json' | 'm3u8';

export interface PlaylistExportData {
  format: PlaylistExportFormat;
  filename: string;
  contentType: string;
  body: string;
  total: number;
  truncated: boolean;
}

export interface PlaylistImportReport {
  created: boolean;
  playlist?: PlaylistRef;
  added: number;
  missing: PlaylistFileTrack[];
  failed: number;
  total: number;
}

export interface RawResponse {
  status?: number;
  headers: Record<string, string | undefined>;
  body?: Buffer;
  stream?: import('node:http').IncomingMessage;
  error?: FnosError;
  ms: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  anonymous?: boolean;
  headers?: Record<string, string>;
  stream?: boolean;
}

export interface StreamResponse {
  status: number;
  headers: Record<string, string | undefined>;
  stream: import('node:http').IncomingMessage;
}

export interface StreamOptions {
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  method?: 'GET' | 'HEAD';
}
