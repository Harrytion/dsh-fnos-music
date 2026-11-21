import { statusFor } from './errors.js';
const PREFIX = '/fnos-music';
const MAX_BODY_BYTES = 32 * 1024;
const MAX_IMPORT_BODY_BYTES = 2 * 1024 * 1024;
function sendJson(response, status, value) {
    if (response.writableEnded)
        return;
    const body = JSON.stringify(value);
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(body);
}
function sendError(response, error) {
    sendJson(response, statusFor(error), { ok: false, error });
}
function reject(scope, request, response) {
    const connection = scope.connection;
    if (connection === undefined || typeof connection.requestRejection !== 'function')
        return false;
    const status = connection.requestRejection(request, response);
    if (status === undefined)
        return false;
    response.statusCode = status;
    response.end();
    return true;
}
function readJson(request, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve) => {
        let size = 0;
        const chunks = [];
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                resolve(null);
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (size === 0) {
                resolve({});
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                resolve(parsed !== null && typeof parsed === 'object' ? parsed : undefined);
            }
            catch {
                resolve(undefined);
            }
        });
        request.on('error', () => resolve(undefined));
    });
}
function sendAttachment(response, contentType, filename, body) {
    if (response.writableEnded)
        return;
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    response.statusCode = 200;
    response.setHeader('content-type', contentType);
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    response.end(body);
}
function sendToolResult(response, result) {
    if (result.ok === true) {
        sendJson(response, 200, result);
        return;
    }
    sendError(response, result.error);
}
function sendMediaBuffer(request, response, buffer, contentType, cacheControl = 'private, max-age=3600') {
    if (response.writableEnded || response.destroyed)
        return;
    const total = buffer.length;
    const header = String(request.headers.range ?? '').trim();
    let start = 0;
    let end = total - 1;
    let status = 200;
    if (header !== '') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (match === null) {
            response.statusCode = 416;
            response.setHeader('content-range', `bytes */${total}`);
            response.setHeader('accept-ranges', 'bytes');
            response.end();
            return;
        }
        const first = match[1] ?? '';
        const last = match[2] ?? '';
        if (first === '' && last === '') {
            response.statusCode = 416;
            response.setHeader('content-range', `bytes */${total}`);
            response.end();
            return;
        }
        if (first === '') {
            const suffix = Number(last);
            if (!Number.isSafeInteger(suffix) || suffix <= 0) {
                response.statusCode = 416;
                response.setHeader('content-range', `bytes */${total}`);
                response.end();
                return;
            }
            start = Math.max(0, total - suffix);
        }
        else {
            start = Number(first);
            end = last === '' ? total - 1 : Math.min(Number(last), total - 1);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
            response.statusCode = 416;
            response.setHeader('content-range', `bytes */${total}`);
            response.setHeader('accept-ranges', 'bytes');
            response.end();
            return;
        }
        status = 206;
    }
    const length = end - start + 1;
    response.statusCode = status;
    response.setHeader('content-type', contentType);
    response.setHeader('content-length', String(length));
    response.setHeader('accept-ranges', 'bytes');
    response.setHeader('cache-control', cacheControl);
    if (status === 206)
        response.setHeader('content-range', `bytes ${start}-${end}/${total}`);
    if ((request.method ?? 'GET').toUpperCase() === 'HEAD') {
        response.end();
        return;
    }
    try {
        response.end(buffer.subarray(start, end + 1));
    }
    catch {
        // The browser can abort a media request while the response is being written.
    }
}
function queryOf(request) {
    return new URL(String(request.url ?? '/'), 'http://127.0.0.1').searchParams;
}
function methodOf(request) {
    return (request.method ?? 'GET').toUpperCase();
}
export function registerRoutes(scope, bridge) {
    const web = scope.webServer;
    if (web === undefined)
        return;
    const table = new Map();
    const route = (method, path, handler) => {
        const entry = table.get(path) ?? {};
        if (entry[method] !== undefined)
            throw new Error(`duplicate route ${method} ${path}`);
        entry[method] = handler;
        table.set(path, entry);
    };
    route('GET', '/state', async (_request, response) => {
        sendJson(response, 200, await bridge.snapshotAsync());
    });
    route('GET', '/events', async (request, response) => {
        const remove = bridge.hub.add(response);
        if (response.writableEnded)
            return;
        const snapshot = await bridge.snapshotAsync();
        if (!response.writableEnded) {
            response.write(`data: ${JSON.stringify({ type: 'snapshot', data: snapshot, at: Date.now() })}\n\n`);
        }
        request.once('close', remove);
        response.once('close', remove);
    });
    route('GET', '/home', async (_request, response) => {
        sendToolResult(response, await bridge.home());
    });
    route('GET', '/album', async (request, response) => {
        const query = queryOf(request);
        sendToolResult(response, await bridge.album({ id: query.get('id') ?? '' }));
    });
    route('GET', '/artist', async (request, response) => {
        const query = queryOf(request);
        sendToolResult(response, await bridge.artist({ name: query.get('name') ?? '' }));
    });
    route('GET', '/track-meta', async (request, response) => {
        sendToolResult(response, await bridge.trackMetadata(queryOf(request).get('guid') ?? ''));
    });
    route('GET', '/stats', async (request, response) => {
        sendToolResult(response, await bridge.stats({ range: queryOf(request).get('range') ?? '30d' }));
    });
    route('GET', '/history', async (request, response) => {
        const query = queryOf(request);
        sendToolResult(response, await bridge.historyTool({
            range: query.get('range') ?? '30d',
            offset: Number(query.get('offset') ?? 0),
            limit: Number(query.get('limit') ?? 50),
            unique: query.get('unique') ?? '0',
        }));
    });
    route('POST', '/history/clear', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.clearHistory(body));
    });
    route('GET', '/listeners', async (_request, response) => {
        sendToolResult(response, await bridge.listenersTool({ action: 'list' }));
    });
    route('POST', '/listeners', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.listenersTool(body));
    });
    route('GET', '/scene', async (_request, response) => {
        sendToolResult(response, await bridge.scene({ action: 'status' }));
    });
    route('POST', '/scene', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.scene(body));
    });
    route('GET', '/dj', async (_request, response) => {
        sendToolResult(response, await bridge.dj({ action: 'status' }));
    });
    route('POST', '/dj', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.dj(body));
    });
    route('POST', '/voice', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.voice(body));
    });
    route('GET', '/audit', async (request, response) => {
        const limit = Number(queryOf(request).get('limit') ?? 100);
        sendJson(response, 200, { ok: true, entries: bridge.auditList(Number.isFinite(limit) ? limit : 100) });
    });
    route('POST', '/audit/clear', async (_request, response) => {
        await bridge.clearAudit();
        sendJson(response, 200, { ok: true });
    });
    route('GET', '/traffic', async (_request, response) => {
        sendJson(response, 200, { ok: true, traffic: bridge.trafficSummary() });
    });
    route('POST', '/traffic/clear', async (_request, response) => {
        await bridge.clearTraffic();
        sendJson(response, 200, { ok: true });
    });
    route('GET', '/devices', async (_request, response) => {
        sendToolResult(response, await bridge.devicesTool('list'));
    });
    route('POST', '/devices', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.saveDevice(body));
    });
    route('POST', '/devices/login', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.loginDevice(body));
    });
    route('POST', '/devices/switch', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        const device = typeof body.id === 'string' ? body.id : typeof body.device === 'string' ? body.device : '';
        if (device === '')
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'id is required' } });
        sendToolResult(response, await bridge.devicesTool('switch', device));
    });
    route('POST', '/devices/remove', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        const id = typeof body.id === 'string' ? body.id : '';
        if (id === '')
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'id is required' } });
        sendToolResult(response, await bridge.removeDevice(id));
    });
    route('POST', '/devices/probe', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        const device = typeof body.id === 'string' ? body.id : typeof body.device === 'string' ? body.device : undefined;
        sendToolResult(response, await bridge.devicesTool('probe', device));
    });
    route('GET', '/search', async (request, response) => {
        const query = queryOf(request);
        const kind = query.get('kind') ?? 'track';
        const yearText = query.get('year');
        const losslessText = query.get('lossless');
        const result = await bridge.search({
            query: query.get('q') ?? undefined,
            kind: (['track', 'artist', 'album', 'playlist', 'folder'].includes(kind) ? kind : 'track'),
            offset: Number(query.get('offset') ?? 0),
            limit: Number(query.get('limit') ?? 20),
            ...(query.get('artist') !== null ? { artist: query.get('artist') ?? '' } : {}),
            ...(query.get('album') !== null ? { album: query.get('album') ?? '' } : {}),
            ...(query.get('folder') !== null ? { folder: query.get('folder') ?? '' } : {}),
            ...(query.get('genre') !== null ? { genre: query.get('genre') ?? '' } : {}),
            ...(yearText !== null ? { year: Number(yearText) } : {}),
            ...(losslessText !== null ? { lossless: losslessText === '1' || losslessText === 'true' } : {}),
        });
        sendToolResult(response, result);
    });
    route('GET', '/library/playlists', async (request, response) => {
        const query = queryOf(request);
        sendToolResult(response, await bridge.playlistTool({
            action: 'list',
            offset: Number(query.get('offset') ?? 0),
            limit: Number(query.get('limit') ?? 20),
        }));
    });
    route('GET', '/playlist', async (request, response) => {
        const query = queryOf(request);
        const playlistId = query.get('id') ?? '';
        if (playlistId === '')
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'id is required' } });
        sendToolResult(response, await bridge.playlistTool({ action: 'get', playlistId }));
    });
    route('POST', '/playlist/create', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.playlistCreate(body.name));
    });
    route('POST', '/playlist/edit', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.playlistRename(String(body.playlistId ?? ''), body.name));
    });
    route('POST', '/playlist/delete', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.playlistDelete(body));
    });
    route('POST', '/playlist/add', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.playlistAdd(body));
    });
    route('POST', '/playlist/remove', async (request, response) => {
        const body = await readJson(request);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.playlistRemove(body));
    });
    route('GET', '/playlist/export', async (request, response) => {
        const query = queryOf(request);
        const playlistId = query.get('id') ?? '';
        if (playlistId === '')
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'id is required' } });
        const format = query.get('format') === 'm3u8' ? 'm3u8' : 'json';
        const result = await bridge.exportPlaylist(playlistId, format, query.get('name') ?? undefined);
        if (result.ok !== true)
            return sendError(response, result.error);
        sendAttachment(response, result.data.contentType, result.data.filename, result.data.body);
    });
    route('POST', '/playlist/import', async (request, response) => {
        const body = await readJson(request, MAX_IMPORT_BODY_BYTES);
        if (body === null)
            return sendJson(response, 413, { ok: false, error: { code: 'bad_request', message: 'Body too large' } });
        if (body === undefined)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        const text = typeof body.text === 'string' ? body.text : '';
        if (text === '')
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'text is required' } });
        sendToolResult(response, await bridge.importPlaylist(text, typeof body.filename === 'string' ? body.filename : ''));
    });
    route('GET', '/favorites', async (request, response) => {
        const query = queryOf(request);
        sendToolResult(response, await bridge.favorite({
            action: 'list',
            offset: Number(query.get('offset') ?? 0),
            limit: Number(query.get('limit') ?? 20),
        }, true));
    });
    route('GET', '/lyrics', async (request, response) => {
        const query = queryOf(request);
        const trackId = query.get('trackId') ?? '';
        if (trackId === '')
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'trackId is required' } });
        sendToolResult(response, await bridge.lyricsDocument({ trackId, ...(query.get('maxLines') !== null ? { maxLines: Number(query.get('maxLines')) } : {}) }));
    });
    route('GET', '/settings', async (_request, response) => {
        sendJson(response, 200, { ok: true, settings: bridge.settings() });
    });
    route('POST', '/settings', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.updateSettings(body));
    });
    route('POST', '/player', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        const action = typeof body.action === 'string' ? body.action : '';
        if (action === 'play') {
            sendToolResult(response, await bridge.play(body));
            return;
        }
        if (action === 'progress') {
            sendToolResult(response, await bridge.progress(body));
            return;
        }
        sendToolResult(response, await bridge.control(body));
    });
    route('POST', '/queue', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.queueTool(body));
    });
    route('POST', '/favorite', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.favorite(body, true));
    });
    route('POST', '/client/heartbeat', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.heartbeat(typeof body.clientId === 'string' ? body.clientId : ''));
    });
    route('POST', '/client/claim', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.claim(typeof body.clientId === 'string' ? body.clientId : ''));
    });
    route('POST', '/client/leave', async (request, response) => {
        const body = await readJson(request);
        if (body === undefined || body === null)
            return sendJson(response, 400, { ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
        sendToolResult(response, await bridge.leave(typeof body.clientId === 'string' ? body.clientId : ''));
    });
    route('GET', '/logs', async (request, response) => {
        const query = queryOf(request);
        sendJson(response, 200, { ok: true, entries: bridge.logList(Number(query.get('limit') ?? 50)) });
    });
    route('POST', '/logs/clear', async (_request, response) => {
        bridge.clearLogs();
        sendJson(response, 200, { ok: true });
    });
    route('POST', '/cache/clear', async (_request, response) => {
        sendToolResult(response, await bridge.clearCache());
    });
    route('POST', '/reset', async (_request, response) => {
        sendToolResult(response, await bridge.reset());
    });
    route('GET', '/cover', async (request, response) => {
        const query = queryOf(request);
        const coverId = query.get('coverId') ?? '';
        const size = query.get('size') ?? '160';
        const result = await bridge.cover(coverId, size);
        if (result.ok !== true) {
            sendError(response, result.error);
            return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', result.data.contentType);
        response.setHeader('content-length', String(result.data.buffer.length));
        response.setHeader('cache-control', 'private, max-age=86400');
        if (methodOf(request) === 'HEAD') {
            response.end();
            return;
        }
        response.end(result.data.buffer);
    });
    route('GET', '/compat', async (request, response) => {
        // The browser may open, abort and retry the media request. Keep the
        // conversion independent of any one request so a retry can join the same
        // build instead of cancelling it.
        const result = await bridge.compatAudio(queryOf(request).get('guid') ?? '');
        if (result.ok !== true) {
            sendError(response, result.error);
            return;
        }
        sendMediaBuffer(request, response, result.data.buffer, result.data.contentType);
    });
    route('GET', '/stream', async (request, response) => {
        const query = queryOf(request);
        const guid = query.get('guid') ?? '';
        const range = String(request.headers.range ?? '');
        const ifRange = String(request.headers['if-range'] ?? '');
        const result = await bridge.stream(guid, range, ifRange, methodOf(request) === 'HEAD' ? 'HEAD' : 'GET');
        if (result.ok !== true) {
            sendError(response, result.error);
            return;
        }
        const upstream = result.data;
        response.statusCode = upstream.status;
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
            const value = upstream.headers[name];
            if (typeof value === 'string')
                response.setHeader(name, value);
        }
        response.setHeader('cache-control', 'no-store');
        response.flushHeaders?.();
        if (methodOf(request) === 'HEAD') {
            upstream.stream.destroy();
            response.end();
            return;
        }
        upstream.stream.once('error', () => {
            response.destroy();
        });
        upstream.stream.once('aborted', () => {
            response.destroy();
        });
        response.once('close', () => {
            upstream.stream.destroy();
        });
        upstream.stream.pipe(response);
    });
    for (const [path, methods] of table) {
        const allow = [
            ...(methods.GET !== undefined ? ['GET', 'HEAD'] : []),
            ...(methods.POST !== undefined ? ['POST'] : []),
        ].join(', ');
        scope.effect(() => web.register({
            kind: 'exact',
            path: `${PREFIX}${path}`,
            handler(request, response) {
                if (reject(scope, request, response))
                    return;
                const requestMethod = methodOf(request);
                const direct = requestMethod === 'GET' || requestMethod === 'POST' ? methods[requestMethod] : undefined;
                const headFallback = requestMethod === 'HEAD' && (path === '/cover' || path === '/stream' || path === '/compat') ? methods.GET : undefined;
                const handler = direct ?? headFallback;
                if (handler === undefined) {
                    response.statusCode = 405;
                    response.setHeader('allow', allow);
                    sendJson(response, 405, { ok: false, error: { code: 'bad_request', message: 'Method not allowed' } });
                    return;
                }
                Promise.resolve(handler(request, response)).catch((error) => {
                    if (response.writableEnded)
                        return;
                    sendJson(response, 500, {
                        ok: false,
                        error: { code: 'server', message: error instanceof Error ? error.message : 'Handler failed' },
                    });
                });
            },
        }), `dsh-fnos-music: route ${path}`);
    }
}
