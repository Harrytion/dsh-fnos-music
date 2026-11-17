/** Deterministic local voice-command intents. No ASR, no LLM, no transcript storage. */
export type VoiceAction =
  | 'play'
  | 'pause'
  | 'resume'
  | 'next'
  | 'previous'
  | 'mute'
  | 'unmute'
  | 'volume'
  | 'shuffle'
  | 'repeat_all'
  | 'repeat_one'
  | 'favorite'
  | 'unfavorite'
  | 'play_query'
  | 'open_lyrics'
  | 'open_float'
  | 'open_panel';

export interface VoiceIntent {
  matched: boolean;
  action?: VoiceAction;
  query?: string;
  volume?: number;
  clientAction?: 'openLyrics' | 'openFloat' | 'openPanel';
}

function normalize(text: string): string {
  return text.trim().replace(/[，。！？,.!?]+$/g, '').replace(/\s+/g, ' ');
}

export function parseVoiceIntent(input: string): VoiceIntent {
  const text = normalize(input);
  if (text === '') return { matched: false };
  const lower = text.toLowerCase();
  if (/^(暂停|暂停播放|pause)$/.test(text) || lower === 'pause') return { matched: true, action: 'pause' };
  if (/^(继续|继续播放|恢复播放|播放|resume|play)$/.test(text) || lower === 'resume' || lower === 'play') return { matched: true, action: text === '播放' || lower === 'play' ? 'play' : 'resume' };
  if (/^(下一首|下一曲|切歌|next)$/.test(text) || lower === 'next') return { matched: true, action: 'next' };
  if (/^(上一首|上一曲|previous|prev)$/.test(text) || lower === 'previous') return { matched: true, action: 'previous' };
  if (/^(静音|mute)$/.test(text) || lower === 'mute') return { matched: true, action: 'mute' };
  if (/^(取消静音|恢复声音|unmute)$/.test(text) || lower === 'unmute') return { matched: true, action: 'unmute' };
  const volume = /音量(?:调到|调至|调整到)?\s*(\d{1,3})/.exec(text) ?? /volume\s*(?:to\s*)?(\d{1,3})/i.exec(text);
  if (volume !== null) return { matched: true, action: 'volume', volume: Math.max(0, Math.min(100, Number(volume[1]))) };
  if (/^(随机播放|随机|shuffle)$/.test(text) || lower === 'shuffle') return { matched: true, action: 'shuffle' };
  if (/^(单曲循环|单曲|repeat one)$/.test(text) || lower === 'repeat one') return { matched: true, action: 'repeat_one' };
  if (/^(列表循环|循环|repeat all)$/.test(text) || lower === 'repeat all') return { matched: true, action: 'repeat_all' };
  if (/^(取消收藏|取消红心|unfavorite)$/.test(text) || lower === 'unfavorite') return { matched: true, action: 'unfavorite' };
  if (/^(收藏|红心|喜欢|favorite|like)$/.test(text) || lower === 'favorite' || lower === 'like') return { matched: true, action: 'favorite' };
  if (/^(打开歌词|显示歌词|歌词|lyrics)$/.test(text) || lower === 'lyrics') return { matched: true, action: 'open_lyrics', clientAction: 'openLyrics' };
  if (/^(打开悬浮|悬浮播放器|悬浮窗|float)$/.test(text) || lower === 'float') return { matched: true, action: 'open_float', clientAction: 'openFloat' };
  if (/^(打开面板|打开播放器|面板)$/.test(text)) return { matched: true, action: 'open_panel', clientAction: 'openPanel' };
  const play = /^(?:播放|放一首|来一首|点歌|play)\s*[:：]?\s*(.+)$/i.exec(text);
  if (play !== null && play[1] !== undefined && play[1].trim() !== '') return { matched: true, action: 'play_query', query: play[1].trim() };
  return { matched: false };
}
