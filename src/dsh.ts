/**
 * The tiny slice of the Cordis/DSH Host API this plugin actually touches.
 *
 * Deliberately local: a profile-installed bundle must not resolve internal
 * `@deepseek-ai/*` packages from the workspace, and these structural types are
 * enough for strict checking. The live methods were verified through Inspect
 * (tools.register, credentials records, webServer.register, connection fence)
 * before this package was written.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CredentialsLike } from './types.js';

export interface ToolContentBlock {
  type: 'text';
  text: string;
}

export interface HostToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): ToolContentBlock[];
    presentationMeta?(args: unknown, value: unknown): unknown;
  };
  execute(args: any, exec: { signal: AbortSignal; agent?: { session?: unknown } }): Promise<unknown>;
  timeoutMs?: number;
  isConcurrencySafe?(args: unknown): boolean;
  presentCall?(args: unknown): unknown;
}

export interface ToolsServiceLike {
  register(definition: HostToolDefinition): () => void;
}

export interface WebRouteLike {
  kind: 'exact';
  path: string;
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

export interface WebServerLike {
  register(route: WebRouteLike): () => void;
}

export interface ConnectionLike {
  requestRejection(request: IncomingMessage, response: ServerResponse): number | undefined;
}

export interface DshScope {
  effect(callback: () => (() => void) | void, label?: string): () => void;
  tools?: ToolsServiceLike;
  credentials?: CredentialsLike;
  webServer?: WebServerLike;
  connection?: ConnectionLike;
}

export interface DshContext extends DshScope {
  inject(names: readonly string[], callback: (scope: DshScope) => void): () => void;
  get(name: string): unknown;
}
