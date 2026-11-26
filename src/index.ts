/**
 * `dsh-fnos-music` Host entry.
 *
 * The plugin is intentionally dependency-free at runtime: it registers Agent
 * tools through `ctx.tools`, Web routes through `ctx.inject(['webServer',
 * 'connection'])`, and keeps credentials in the profile credential store.
 * Removing/disabling the bundle disposes every timer, stream, SSE client, and
 * the plugin cache directory.
 */
import os from 'node:os';
import path from 'node:path';
import type { CredentialsLike } from './types.js';
import type { DshContext } from './dsh.js';
import { MusicBridge } from './bridge.js';
import { createTools } from './tools.js';
import { registerRoutes } from './routes.js';

export const name = 'dsh-fnos-music';

function profileName(): string {
  const raw = process.env.DSH_PROFILE ?? 'default';
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  return sanitized === '' ? 'default' : sanitized;
}

function cacheDir(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'cache', 'dsh-fnos-music', profileName());
}

function dataDir(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'data', 'dsh-fnos-music', profileName());
}

export function apply(ctx: DshContext): void {
  const rawCredentials = ctx.get('credentials');
  const credentials = rawCredentials !== null && typeof rawCredentials === 'object'
    ? rawCredentials as CredentialsLike
    : undefined;

  const bridge = new MusicBridge({
    credentials,
    profile: profileName(),
    cacheDir: cacheDir(),
    dataDir: dataDir(),
  });

  ctx.effect(() => {
    void bridge.start();
    return () => {
      bridge.dispose();
    };
  }, 'dsh-fnos-music: bridge');

  // The credentials service may appear after this bundle is applied; adopt it
  // whenever it shows up so the saved devices survive a Host restart.
  ctx.inject(['credentials'], (scope) => {
    if (scope.credentials === undefined) return;
    void bridge.attachCredentials(scope.credentials);
  });

  ctx.inject(['tools'], (scope) => {
    if (scope.tools === undefined) return;
    for (const tool of createTools(bridge)) {
      scope.effect(
        () => scope.tools?.register(tool) ?? (() => {}),
        `dsh-fnos-music: tool ${tool.name}`,
      );
    }
  });

  // Only compose the HTTP routes where the browser-auth fence is present.
  ctx.inject(['webServer', 'connection'], (scope) => {
    try {
      registerRoutes(scope, bridge);
    } catch (error) {
      // Keep a failing route registration visible in the Host log instead of
      // silently dropping the whole Web surface.
      console.error('[dsh-fnos-music] failed to register Web routes:', error);
    }
  });
}

export { MusicBridge } from './bridge.js';
