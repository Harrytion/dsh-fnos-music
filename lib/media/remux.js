/**
 * Compatibility container conversion for tracks the browser cannot decode.
 *
 * fnOS does the expensive decode/transcode to Opus/fMP4. This module only
 * remuxes that stream to a seekable WebM file, which Chromium's <audio>
 * element can play without MSE/HLS.js. ffmpeg is intentionally optional: when
 * it is missing the caller returns a clear error instead of playing noise.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fail } from '../errors.js';
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 60_000;
let cachedFfmpeg;
function executable(file) {
    try {
        accessSync(file, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
/** Locate ffmpeg without a shell; `DSH_FNOS_FFMPEG` can pin an explicit path. */
export function findFfmpeg() {
    if (cachedFfmpeg !== undefined)
        return cachedFfmpeg ?? undefined;
    const candidates = [];
    const configured = process.env.DSH_FNOS_FFMPEG;
    if (typeof configured === 'string' && configured.trim() !== '')
        candidates.push(configured.trim());
    for (const dir of String(process.env.PATH ?? '').split(path.delimiter)) {
        if (dir !== '')
            candidates.push(path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
    }
    if (process.platform === 'darwin') {
        candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
    }
    else if (process.platform === 'win32') {
        candidates.push('ffmpeg.exe');
    }
    else {
        candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
    }
    for (const candidate of candidates) {
        if (candidate === 'ffmpeg.exe' || executable(candidate)) {
            cachedFfmpeg = candidate;
            return candidate;
        }
    }
    cachedFfmpeg = null;
    return undefined;
}
function run(command, args, timeoutMs, signal) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const finish = (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve({ code, stderr: stderr.slice(-4000), timedOut });
        };
        const kill = () => {
            try {
                child.kill('SIGKILL');
            }
            catch {
                // The process may already be gone.
            }
        };
        const onAbort = () => kill();
        const timer = setTimeout(() => {
            timedOut = true;
            kill();
        }, timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        child.stderr?.on('data', (chunk) => {
            if (stderr.length < 8000)
                stderr += chunk.toString('utf8');
        });
        child.once('error', (error) => {
            stderr += error instanceof Error ? error.message : String(error);
            finish(-1);
        });
        child.once('close', (code) => finish(code ?? -1));
    });
}
/** Remux fnOS Opus/fMP4 into a seekable WebM buffer. */
export async function remuxFmp4ToWebm(input, signal) {
    if (input.length === 0)
        return fail('unsupported', 'Empty transcode output');
    const ffmpeg = findFfmpeg();
    if (ffmpeg === undefined) {
        return fail('unsupported', 'Compatible playback requires ffmpeg', {
            hint: '当前曲目的格式浏览器无法直接播放。请安装 ffmpeg（或在 DSH_FNOS_FFMPEG 中指定路径）后重试。',
        });
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fnos-music-ffmpeg-'));
    const inputPath = path.join(dir, 'input.mp4');
    const outputPath = path.join(dir, 'output.webm');
    try {
        await fs.writeFile(inputPath, input);
        const attempts = [
            ['-v', 'error', '-y', '-f', 'mp4', '-i', inputPath, '-map', '0:a:0', '-c:a', 'copy', '-f', 'webm', outputPath],
            ['-v', 'error', '-y', '-f', 'mp4', '-i', inputPath, '-map', '0:a:0', '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', outputPath],
        ];
        let last;
        for (const args of attempts) {
            last = await run(ffmpeg, args, FFMPEG_TIMEOUT_MS, signal);
            if (last.code === 0)
                break;
        }
        if (last === undefined || last.code !== 0) {
            return fail('unsupported', 'Audio compatibility conversion failed', {
                detail: last?.timedOut === true ? 'ffmpeg timed out' : last?.stderr ?? '',
                hint: '当前曲目无法转换为浏览器可播放的格式，请换一首歌或使用官方客户端。',
            });
        }
        const stat = await fs.stat(outputPath);
        if (!stat.isFile() || stat.size === 0)
            return fail('unsupported', 'Audio compatibility conversion produced no output');
        if (stat.size > MAX_OUTPUT_BYTES)
            return fail('unsupported', 'Audio compatibility output is too large');
        const buffer = await fs.readFile(outputPath);
        return { ok: true, data: buffer };
    }
    catch (error) {
        return fail('server', 'Audio compatibility conversion failed', {
            detail: error instanceof Error ? error.message : String(error),
        });
    }
    finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}
