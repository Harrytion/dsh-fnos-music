/**
 * The transport seam: every fnOS request in this plugin goes through one of
 * these implementations. The bridge, tools, and UI never branch on FNID vs
 * direct vs Unix socket.
 */
import type {
  DirectVia,
  FnosTarget,
  LogEntry,
  ProbeLayers,
  RequestOptions,
  Result,
  StreamOptions,
  StreamResponse,
  TransportKind,
} from '../types.js';

export const API_PREFIX = '/music/api/v1';
/** FN Connect clusters. An FN ID is pinned to one of them by the NAS setting. */
export const RELAY_DOMAINS = ['fnos.net', '5ddd.com'] as const;
/** The FN Connect gateway only passes API calls through when this is present. */
export const RELAY_COOKIE = 'mode=relay';
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export interface TransportOptions {
  target: FnosTarget;
  onLog?: (entry: LogEntry) => void;
}

export interface Transport {
  readonly kind: TransportKind;
  /** The real path currently used; auto transports may switch between direct and fnid. */
  readonly via: DirectVia;
  /** Normalized origin/base, or the unix display base. Never includes a token. */
  readonly base: string;
  readonly relay: boolean;
  request<T>(path: string, options?: RequestOptions): Promise<Result<T>>;
  stream(path: string, options?: StreamOptions): Promise<Result<StreamResponse>>;
  probe(): Promise<ProbeLayers>;
  login(username: string, password: string): Promise<Result<{ token: string; user: string }>>;
  setToken(token: string): void;
  dispose(): void;
}
