import { createAutoTransport } from './auto.js';
import { createDirectTransport } from './direct.js';
import { createFnidTransport } from './fnid.js';
export { createAutoTransport } from './auto.js';
export { createDirectTransport } from './direct.js';
export { createFnidTransport } from './fnid.js';
export function createTransport(target, onLog) {
    if (target.mode === 'fnid')
        return createFnidTransport(target, { onLog });
    if (target.mode === 'auto')
        return createAutoTransport(target, { onLog });
    return createDirectTransport(target, { onLog });
}
export function transportKindOf(target) {
    if (target.mode === 'fnid')
        return 'fnid';
    if (target.mode === 'auto')
        return 'auto';
    const raw = (target.address ?? '').trim() || (target.unixPath ?? '').trim();
    if (raw.startsWith('unix://') || raw.startsWith('/'))
        return 'unix';
    return 'direct';
}
