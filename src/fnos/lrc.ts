/**
 * LRC parsing for the V2 lyrics panel.
 *
 * fnOS only gives us raw lyric text, so translation and per-word timing are
 * best-effort: duplicate timestamps are treated as translation lines and
 * `<mm:ss.xx>` tags are treated as enhanced-LRC word timings. Plain lyric text
 * still renders, just without timing.
 */
import type { LyricDocument, LyricLine, LyricWord } from '../types.js';

const TIME_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const META_TAG = /^\[(ti|ar|al|by|offset|re|ve|length):(.*)\]$/i;
const LAST_LINE_MS = 5000;
const DEFAULT_MAX_LINES = 2000;

interface RawLine {
  timeMs: number;
  text: string;
  words?: LyricWord[];
  order: number;
}

function fractionToMs(fraction: string | undefined): number {
  if (fraction === undefined || fraction === '') return 0;
  return Number(fraction.padEnd(3, '0').slice(0, 3));
}

function timeToMs(minutes: string, seconds: string, fraction?: string): number {
  const m = Number(minutes);
  const s = Number(seconds);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return Math.max(0, m * 60_000 + s * 1000 + fractionToMs(fraction));
}

function stripWordTags(text: string): string {
  return text.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
}

/** Extract `<mm:ss.xx>` word timings from a line of enhanced LRC. */
function parseWords(text: string, lineTimeMs: number): LyricWord[] | undefined {
  const matches = [...text.matchAll(WORD_TAG)];
  if (matches.length === 0) return undefined;
  const words: LyricWord[] = [];
  let cursor = 0;
  let time = lineTimeMs;
  for (const match of matches) {
    const index = match.index ?? 0;
    const chunk = text.slice(cursor, index).trim();
    if (chunk !== '') words.push({ timeMs: Math.max(0, time), text: chunk });
    time = timeToMs(match[1] ?? '0', match[2] ?? '0', match[3]);
    cursor = index + match[0].length;
  }
  const tail = text.slice(cursor).trim();
  if (tail !== '') words.push({ timeMs: Math.max(0, time), text: tail });
  return words.length > 0 ? words : undefined;
}

function plainLines(text: string, maxLines: number): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of text.split('\n')) {
    const value = line.trim();
    if (value === '' || META_TAG.test(value) || /^\[[^\]]+\]$/.test(value)) continue;
    lines.push({ timeMs: 0, endMs: 0, text: value });
    if (lines.length >= maxLines) break;
  }
  return lines;
}

/**
 * Parse LRC text. `offsetMs` is the native lyric-list offset, while an
 * in-content `[offset:...]` tag is added to it. Positive offsets move lines
 * later; this matches the values observed in the fnOS lyric list.
 */
export function parseLrc(content: string, offsetMs = 0, maxLines = DEFAULT_MAX_LINES): LyricDocument {
  const limit = Math.max(0, Math.min(DEFAULT_MAX_LINES, Math.trunc(maxLines)));
  const normalized = content.replace(/\r\n?/g, '\n');
  const offsetTag = /\[offset:(-?\d+)\]/i.exec(normalized);
  const tagOffset = offsetTag === null ? 0 : Number(offsetTag[1]);
  const totalOffset = (Number.isFinite(offsetMs) ? offsetMs : 0) + (Number.isFinite(tagOffset) ? tagOffset : 0);
  const raw: RawLine[] = [];
  let order = 0;

  for (const line of normalized.split('\n')) {
    const value = line.trim();
    if (value === '') continue;
    // A line may start with several timestamp tags; tags later in the line
    // are lyric text and must not be consumed.
    const leading = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)/.exec(value);
    if (leading === null) continue; // untimed lines are handled if nothing is timed
    const stamps: number[] = [];
    for (const stamp of leading[1]!.matchAll(TIME_TAG)) {
      stamps.push(timeToMs(stamp[1] ?? '0', stamp[2] ?? '0', stamp[3]));
    }
    if (stamps.length === 0) continue;
    const text = value.slice(leading[0].length).trim();
    if (text === '') continue;
    const cleaned = stripWordTags(text);
    const words = parseWords(text, stamps[0] ?? 0);
    for (const stamp of stamps) {
      raw.push({
        timeMs: Math.max(0, stamp + totalOffset),
        text: cleaned,
        ...(words !== undefined
          ? { words: words.map((word) => ({ timeMs: Math.max(0, word.timeMs + totalOffset), text: word.text })) }
          : {}),
        order: order += 1,
      });
    }
  }

  if (raw.length === 0) {
    return {
      timed: false,
      offsetMs: Number.isFinite(totalOffset) ? totalOffset : 0,
      lines: plainLines(normalized, limit),
    };
  }

  raw.sort((a, b) => (a.timeMs - b.timeMs) || (a.order - b.order));
  const lines: LyricLine[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const current = raw[index]!;
    // Same-timestamp duplicates become translation lines. A repeated exact
    // text is ignored instead of creating a duplicate row.
    const translations: string[] = [];
    let cursor = index + 1;
    while (cursor < raw.length && raw[cursor]!.timeMs === current.timeMs) {
      const candidate = raw[cursor]!.text;
      if (candidate !== '' && candidate !== current.text && !translations.includes(candidate)) translations.push(candidate);
      cursor += 1;
    }
    let endMs = cursor < raw.length ? raw[cursor]!.timeMs : current.timeMs + LAST_LINE_MS;
    if (endMs <= current.timeMs) endMs = current.timeMs + LAST_LINE_MS;
    const words = current.words === undefined
      ? undefined
      : current.words.map((word) => ({ ...word }));
    lines.push({
      timeMs: current.timeMs,
      endMs,
      text: current.text,
      ...(translations.length > 0 ? { translation: translations.join(' / ') } : {}),
      ...(words !== undefined ? { words } : {}),
    });
    index = cursor - 1;
    if (lines.length >= limit) break;
  }

  return {
    timed: true,
    offsetMs: Number.isFinite(totalOffset) ? totalOffset : 0,
    lines,
  };
}
