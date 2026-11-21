import { fail } from '../errors.js';
function safeRelative(value) {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.length > 300)
        return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed))
        return false;
    if (trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes('\0'))
        return false;
    return !trimmed.split('/').some((part) => part === '' || part === '.' || part === '..');
}
function mapUri(line) {
    const match = /^#EXT-X-MAP:URI="([^"]+)"$/.exec(line.trim());
    return match === null ? '' : match[1] ?? '';
}
export function parseHlsPlaylist(raw) {
    const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim());
    if (!lines.includes('#EXTM3U'))
        return fail('unsupported', 'HLS playlist is missing its header');
    let init = '';
    let complete = false;
    let durationSec = 0;
    const segments = [];
    for (const line of lines) {
        if (line === '')
            continue;
        if (line.startsWith('#EXT-X-KEY')) {
            if (!/METHOD=NONE/i.test(line))
                return fail('unsupported', 'Encrypted HLS is not supported');
            continue;
        }
        if (line.startsWith('#EXT-X-MAP:')) {
            init = mapUri(line);
            if (!safeRelative(init))
                return fail('unsupported', 'HLS init segment path is invalid');
            continue;
        }
        if (line === '#EXT-X-ENDLIST') {
            complete = true;
            continue;
        }
        if (line.startsWith('#EXTINF:')) {
            const value = Number.parseFloat(line.slice('#EXTINF:'.length).split(',', 1)[0] ?? '');
            if (Number.isFinite(value) && value > 0)
                durationSec += value;
            continue;
        }
        if (line.startsWith('#'))
            continue;
        if (!safeRelative(line))
            return fail('unsupported', 'HLS segment path is invalid');
        if (segments.length >= 5000)
            return fail('unsupported', 'HLS playlist is too large');
        segments.push(line);
    }
    if (init === '')
        return fail('unsupported', 'HLS playlist has no init segment');
    if (segments.length === 0)
        return fail('unsupported', 'HLS playlist has no segments');
    return { ok: true, data: { init, segments, complete, durationSec } };
}
