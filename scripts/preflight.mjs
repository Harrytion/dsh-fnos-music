#!/usr/bin/env node
/**
 * Pre-install / pre-flight check for dsh-fnos-music.
 *
 * ffmpeg is the preferred compatibility backend (DTS/APE -> WebM). When it is
 * absent, the plugin falls back to browser MSE with the Opus/fMP4 stream from
 * fnOS, so ffmpeg is optional. This script never changes the Host.
 */
import { accessSync, constants } from 'node:fs';
import path from 'node:path';

function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findFfmpeg() {
  if (process.env.DSH_FNOS_COMPAT_FORCE_MSE === '1') return undefined;
  const configured = process.env.DSH_FNOS_FFMPEG;
  const candidates = [];
  if (typeof configured === 'string' && configured.trim() !== '') candidates.push(configured.trim());
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (dir !== '') candidates.push(path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  }
  if (process.platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  } else if (process.platform === 'win32') {
    candidates.push('ffmpeg.exe');
  } else {
    candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  }
  return candidates.find((candidate) => candidate === 'ffmpeg.exe' || executable(candidate));
}

const major = Number(process.versions.node.split('.')[0] || 0);
const ffmpeg = findFfmpeg();
const nodeOk = major >= 22;
const strict = process.argv.includes('--strict');
console.log('dsh-fnos-music preflight');
console.log(`node: ${process.version} (${nodeOk ? 'ok' : 'requires >= 22'})`);
console.log(`platform: ${process.platform}/${process.arch}`);
console.log(`ffmpeg: ${ffmpeg ?? 'missing'}`);
console.log(`backend: ${ffmpeg ? 'ffmpeg' : 'mse'}`);
console.log(`fallback: ${ffmpeg ? 'not needed' : 'browser MSE (Opus/fMP4)'}`);
if (!nodeOk) process.exitCode = 1;
else if (strict && ffmpeg === undefined) process.exitCode = 1;
