import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compatBackendFor, findFfmpeg, resetFfmpegCache, remuxFmp4ToWebm } from '../lib/media/remux.js';

test('compatibility backend prefers ffmpeg and falls back to MSE', () => {
  assert.equal(compatBackendFor('/usr/bin/ffmpeg'), 'ffmpeg');
  assert.equal(compatBackendFor(undefined), 'mse');
});

test('ffmpeg detection can be reset and reports an executable', () => {
  resetFfmpegCache();
  const found = findFfmpeg();
  assert.ok(found === undefined || found.length > 0);
  resetFfmpegCache();
  assert.equal(findFfmpeg(), found);
});

test('empty compatibility input is rejected without invoking ffmpeg', async () => {
  const result = await remuxFmp4ToWebm(Buffer.alloc(0));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unsupported');
});

test('preflight reports node/platform/backend/fallback', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/preflight.mjs')], { encoding: 'utf8' });
  assert.match(output, /node: v\d+/);
  assert.match(output, /backend: (ffmpeg|mse)/);
  assert.match(output, /fallback:/);
});

test('preflight reports the MSE fallback when ffmpeg is unavailable', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/preflight.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, DSH_FNOS_COMPAT_FORCE_MSE: '1' },
  });
  assert.match(output, /ffmpeg: missing/);
  assert.match(output, /backend: mse/);
  assert.match(output, /fallback: browser MSE/);
});
