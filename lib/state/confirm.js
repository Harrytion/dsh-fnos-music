/**
 * Two-step confirmation for destructive Agent tools.
 *
 * The first call issues a short-lived, single-use token bound to the operation,
 * device, and exact arguments. The model must call again with that token. This
 * stops one-shot accidental destructive calls; it is not a defense against a
 * deliberately malicious model, and the user can switch it off in Settings.
 */
import { createHash, randomUUID } from 'node:crypto';
import { makeError } from '../errors.js';
const TTL_MS = 120_000;
const MAX_PENDING = 50;
function canonical(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    const record = value;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}
export function argsHash(args) {
    return createHash('sha256').update(canonical(args), 'utf8').digest('hex');
}
export class ConfirmGate {
    pending = new Map();
    issue(op, args, deviceId) {
        this.prune();
        while (this.pending.size >= MAX_PENDING) {
            const first = this.pending.keys().next().value;
            if (first === undefined)
                break;
            this.pending.delete(first);
        }
        const token = randomUUID();
        this.pending.set(token, {
            op,
            argsHash: argsHash(args),
            deviceId,
            expiresAt: Date.now() + TTL_MS,
        });
        return token;
    }
    verify(token, op, args, deviceId) {
        this.prune();
        const entry = this.pending.get(token);
        if (entry === undefined) {
            return {
                ok: false,
                error: makeError('confirmation_required', 'Confirmation token is missing, expired, or already used', {
                    hint: '请重新发起一次高危操作，并按返回的 confirmToken 再确认。',
                }),
            };
        }
        this.pending.delete(token);
        if (entry.op !== op || entry.deviceId !== deviceId || entry.argsHash !== argsHash(args)) {
            return {
                ok: false,
                error: makeError('confirmation_required', 'Confirmation token does not match this operation', {
                    hint: '参数或设备与首次请求不一致，已拒绝执行。',
                }),
            };
        }
        return { ok: true };
    }
    prune() {
        const now = Date.now();
        for (const [token, entry] of this.pending) {
            if (entry.expiresAt <= now)
                this.pending.delete(token);
        }
    }
    dispose() {
        this.pending.clear();
    }
}
