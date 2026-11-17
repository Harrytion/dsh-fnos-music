/** Transport factory: the only place that branches on the connection mode. */
import type { FnosTarget, LogEntry, Result, TransportKind } from '../types.js';
import type { Transport } from './contract.js';
import { createAutoTransport } from './auto.js';
import { createDirectTransport } from './direct.js';
import { createFnidTransport } from './fnid.js';

export type { Transport } from './contract.js';
export { createAutoTransport } from './auto.js';
export { createDirectTransport } from './direct.js';
export { createFnidTransport } from './fnid.js';

export function createTransport(
  target: FnosTarget,
  onLog?: (entry: LogEntry) => void,
): Result<Transport> {
  if (target.mode === 'fnid') return createFnidTransport(target, { onLog });
  if (target.mode === 'auto') return createAutoTransport(target, { onLog });
  return createDirectTransport(target, { onLog });
}

export function transportKindOf(target: Pick<FnosTarget, 'mode' | 'address' | 'unixPath'>): TransportKind {
  if (target.mode === 'fnid') return 'fnid';
  if (target.mode === 'auto') return 'auto';
  const raw = (target.address ?? '').trim() || (target.unixPath ?? '').trim();
  if (raw.startsWith('unix://') || raw.startsWith('/')) return 'unix';
  return 'direct';
}
