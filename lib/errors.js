export const ERROR_HINTS = {
    not_configured: '还没有添加飞牛设备。打开侧栏的「飞牛音乐」→ 设置，添加 FNID 或直连地址。',
    no_active_device: '没有激活的设备。在插件设置页切换到要使用的 NAS。',
    auth: 'token 已失效或没有权限。在插件设置页重新登录，或粘贴新的飞牛音乐 token。',
    forbidden: '飞牛服务拒绝了这次请求，请检查账号的音乐库权限。',
    gateway_unreachable: '网络无法到达 FNID 中继或 NAS 地址。检查网络、地址和代理设置。',
    gateway_timeout: '连接超时。检查 NAS 是否开机、FN Connect 是否开启，或改用局域网直连。',
    device_offline: 'FN Connect 中继连不上这台设备。确认 NAS 开机、FN Connect 已开启，且 FNID 正确。',
    service_missing: '地址可达，但没有找到飞牛音乐服务。确认 fnOS 已安装「音乐」，并使用 /music 服务地址。',
    relay_timeout: 'FNID 中继响应超时。中继带宽或网络较差时，大曲库/无损播放可能卡顿。',
    relay_rejected: 'FNID 中继拒绝了请求（可能返回了登录页或重定向）。确认 FN Connect 与 FNID 设置。',
    tls: 'TLS 证书校验失败。局域网自签证书可在这台设备的设置中允许自签名；公网地址请使用受信任证书。',
    refused: '设备端口拒绝连接。检查地址、端口，以及 fnOS 是否开启了对应的 HTTP/HTTPS 服务。',
    dns: '域名无法解析。检查地址拼写、DNS 或 FNID。',
    network: '网络中断或连接被重置。稍后重试。',
    server: '飞牛音乐服务返回了服务器错误。稍后重试。',
    business: '飞牛音乐服务返回了业务错误。',
    protocol: '响应格式不是预期的飞牛音乐 API。确认地址指向 fnOS 的「音乐」服务。',
    rate_limited: '请求过于频繁，已被本地节流或飞牛服务限流。稍后重试。',
    not_found: '没有找到对应的曲目、歌单或设备。',
    unsupported: '当前环境或接口不支持这个操作。',
    cancelled: '操作已取消。',
    confirmation_required: '这是高危操作，需要二次确认后才能执行。',
    bad_request: '请求参数不完整或格式不正确。',
};
export function makeError(code, message, extra = {}) {
    return { code, message, hint: extra.hint ?? ERROR_HINTS[code], ...extra };
}
export function fail(code, message, extra = {}) {
    return { ok: false, error: makeError(code, message, extra) };
}
export function ok(data) {
    return { ok: true, data };
}
export function isError(result) {
    return result.ok === false;
}
/** Map a thrown Node/undici-ish error onto the shared vocabulary. */
export function errorFromNode(error, relay = false) {
    const candidate = (error ?? {});
    const code = typeof candidate.code === 'string' ? candidate.code : '';
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    const message = typeof candidate.message === 'string' && candidate.message !== ''
        ? candidate.message
        : 'Network request failed';
    if (code === 'ABORT_ERR' || name === 'AbortError' || /aborted/i.test(message)) {
        return makeError('cancelled', 'Request cancelled');
    }
    if (code === 'ECONNREFUSED')
        return makeError('refused', 'Connection refused');
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
        return makeError('dns', 'Host not found');
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        return makeError('gateway_unreachable', 'Network unreachable');
    }
    if (code === 'ETIMEDOUT' || code === 'ERR_SOCKET_CONNECTION_TIMEOUT' || /timeout/i.test(message)) {
        return relay
            ? makeError('relay_timeout', 'FNID relay timed out')
            : makeError('gateway_timeout', 'Connection timed out');
    }
    if (code.startsWith('CERT_')
        || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
        || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
        || code === 'SELF_SIGNED_CERT_IN_CHAIN'
        || code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        return makeError('tls', 'TLS certificate verification failed');
    }
    if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
        return makeError('network', 'Connection reset');
    }
    if (code === 'ERR_INVALID_URL')
        return makeError('bad_request', 'Invalid URL');
    return makeError(relay ? 'relay_timeout' : 'network', message);
}
/** HTTP status for a bridge/tool error when it crosses the Web route. */
export function statusFor(error) {
    switch (error.code) {
        case 'bad_request':
            return 400;
        case 'auth':
            return 401;
        case 'forbidden':
            return 403;
        case 'not_found':
            return 404;
        case 'not_configured':
        case 'no_active_device':
        case 'confirmation_required':
            return 409;
        case 'unsupported':
            return 422;
        case 'rate_limited':
            return 429;
        case 'cancelled':
            return 499;
        default:
            return 502;
    }
}
/** The first non-ok layer, used for a single status line. */
export function firstLayerError(layers) {
    for (const layer of [layers.gateway, layers.device, layers.service]) {
        if (!layer.ok) {
            const code = layer.code ?? 'network';
            return makeError(code, layer.message ?? ERROR_HINTS[code]);
        }
    }
    return undefined;
}
