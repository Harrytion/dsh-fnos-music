/** The model-facing tools. Mutating tools honor the Agent read-only switch and write a small local audit entry. */
import type { HostToolDefinition, ToolContentBlock } from './dsh.js';
import type { MusicBridge } from './bridge.js';

type Schema = Record<string, unknown>;

const ERROR_SCHEMA: Schema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    hint: { type: 'string' },
    confirmToken: { type: 'string' },
  },
  required: ['code', 'message'],
};

function envelope(properties: Record<string, Schema>): Schema {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      ok: { type: 'boolean' },
      error: ERROR_SCHEMA,
      ...properties,
    },
    required: ['ok'],
  };
}

function textBlock(text: string): ToolContentBlock[] {
  return [{ type: 'text', text }];
}

function render(value: unknown): ToolContentBlock[] {
  if (value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
    const error = (value as { error?: { code?: string; message?: string; hint?: string; confirmToken?: string } }).error;
    if (error !== undefined) {
      const lines = [`Error [${error.code ?? 'unknown'}]: ${error.message ?? 'failed'}`];
      if (error.hint !== undefined) lines.push(`Hint: ${error.hint}`);
      if (error.confirmToken !== undefined) {
        lines.push(`confirmToken: ${error.confirmToken}`);
        lines.push('Call the same tool again with confirmToken to execute the destructive operation.');
      }
      return textBlock(lines.join('\n'));
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch {
    serialized = String(value);
  }
  if (serialized.length > 9000) serialized = `${serialized.slice(0, 9000)}\n…(truncated)`;
  return textBlock(serialized);
}

const MUTATING_TOOLS = new Set([
  'fnos_music_playlist',
  'fnos_music_smart_playlist',
  'fnos_music_favorite',
  'fnos_music_history',
  'fnos_music_profile',
]);

function isMutation(toolName: string, args: Record<string, unknown>): boolean {
  const action = typeof args.action === 'string' ? args.action : '';
  if (toolName === 'fnos_music_playlist') return ['create', 'rename', 'delete', 'add', 'remove'].includes(action);
  if (toolName === 'fnos_music_favorite') return ['add', 'remove', 'remove_many'].includes(action);
  if (toolName === 'fnos_music_history') return action === 'clear';
  if (toolName === 'fnos_music_profile') return ['create', 'rename', 'delete'].includes(action);
  return MUTATING_TOOLS.has(toolName) && toolName !== 'fnos_music_playlist';
}

function mutationTarget(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'fnos_music_profile') return typeof args.listenerId === 'string' ? args.listenerId : typeof args.id === 'string' ? args.id : '';
  if (toolName === 'fnos_music_playlist' || toolName === 'fnos_music_smart_playlist') return typeof args.playlistId === 'string' ? args.playlistId : '';
  if (toolName === 'fnos_music_favorite') return typeof args.trackId === 'string' ? args.trackId : Array.isArray(args.trackIds) ? `${args.trackIds.length} tracks` : '';
  if (toolName === 'fnos_music_history') return 'current listener';
  return '';
}

function wrapTool(tool: HostToolDefinition, bridge: MusicBridge): HostToolDefinition {
  return {
    ...tool,
    async execute(args, exec) {
      const record = args !== null && typeof args === 'object' ? args as Record<string, unknown> : {};
      const mutating = isMutation(tool.name, record);
      if (mutating && !bridge.vault.settings.agentWrites) {
        bridge.audit.record({ tool: tool.name, action: typeof record.action === 'string' ? record.action : '', target: mutationTarget(tool.name, record), ok: false, code: 'forbidden' });
        return { ok: false, error: { code: 'forbidden', message: 'Agent write access is disabled in the plugin settings' } };
      }
      const result = await tool.execute(args, exec);
      if (mutating) {
        const ok = result !== null && typeof result === 'object' && (result as { ok?: unknown }).ok === true;
        const error = !ok && result !== null && typeof result === 'object' ? (result as { error?: { code?: string } }).error : undefined;
        bridge.audit.record({
          tool: tool.name,
          action: typeof record.action === 'string' ? record.action : '',
          target: mutationTarget(tool.name, record),
          ok,
          ...(error?.code !== undefined ? { code: error.code } : {}),
        });
      }
      return result;
    },
  };
}

function present(title: string): (args: unknown) => { card: 'generic'; title: string; kind: 'other'; rawInput: unknown } {
  return (args) => ({ card: 'generic', title, kind: 'other', rawInput: args });
}

export function createTools(bridge: MusicBridge): HostToolDefinition[] {
  const tools: HostToolDefinition[] = [
    {
      name: 'fnos_music_status',
      description:
        'Read the active fnOS music device, its three-layer connection state (gateway, device, music service), and the plugin\'s shared playback session. Use when the user asks whether the NAS/FNID is online, what is playing, or before other music actions. Playback state belongs to this DSH plugin, not the official fnOS app.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          includeQueue: {
            type: 'boolean',
            description: 'Include the first 50 tracks of the shared queue in the result.',
          },
        },
      },
      output: {
        schema: envelope({
          configured: { type: 'boolean' },
          activeDevice: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
          connection: { type: 'object', additionalProperties: true },
          player: { type: 'object', additionalProperties: true },
          library: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
          cache: { type: 'object', additionalProperties: true },
          settings: { type: 'object', additionalProperties: true },
          persistent: { type: 'boolean' },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 20_000,
      isConcurrencySafe: () => true,
      presentCall: present('Feiniu Music · status'),
      async execute(args) {
        return { ok: true, ...bridge.status(args.includeQueue === true) };
      },
    },
    {
      name: 'fnos_music_devices',
      description:
        'List saved fnOS music devices, switch the active device, or probe it. Devices and tokens are configured in the plugin\'s Settings view; this tool never accepts or returns credentials.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'switch', 'probe'], description: 'list saved devices, switch to one, or probe one.' },
          device: { type: 'string', description: 'Saved device name or id; required for switch and optional for probe (defaults to active).' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          activeDeviceId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          devices: { type: 'array', items: { type: 'object', additionalProperties: true } },
          activeDevice: { type: 'object', additionalProperties: true },
          device: { type: 'object', additionalProperties: true },
          layers: { type: 'object', additionalProperties: true },
          connection: { type: 'object', additionalProperties: true },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 30_000,
      presentCall: present('Feiniu Music · devices'),
      async execute(args) {
        return bridge.devicesTool(
          typeof args.action === 'string' ? args.action : 'list',
          typeof args.device === 'string' ? args.device : undefined,
        );
      },
    },
    {
      name: 'fnos_music_search',
      description:
        'Search the active device\'s local fnOS library by title, artist, album, year, genre, or folder path. Returns bounded pages with track ids for playback. Text queries use server-side search; folder/genre/filter scans are bounded and report scanned/truncated. V3 still only covers the local library, not online sources.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Search text. Required for artist/album/playlist search; for folder kind this is the folder path fragment.' },
          kind: { type: 'string', enum: ['track', 'artist', 'album', 'playlist', 'folder'], description: 'What to search. Default track.' },
          offset: { type: 'integer', minimum: 0, description: 'Result offset for paging. Default 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size 1-50. Default 20.' },
          artist: { type: 'string', description: 'Optional artist filter; scans a bounded number of pages.' },
          album: { type: 'string', description: 'Optional album filter.' },
          folder: { type: 'string', description: 'Optional folder path filter.' },
          genre: { type: 'string', description: 'Optional genre filter when the NAS metadata provides it.' },
          year: { type: 'integer', minimum: 0, maximum: 3000, description: 'Optional exact album year.' },
          lossless: { type: 'boolean', description: 'Only tracks with lossless or hi-res quality.' },
          hasLyric: { type: 'boolean', description: 'true/false to filter tracks with or without lyrics (instrumentals).' },
          minDurationSec: { type: 'integer', minimum: 0, description: 'Minimum track duration in seconds.' },
          maxDurationSec: { type: 'integer', minimum: 0, description: 'Maximum track duration in seconds.' },
        },
      },
      output: {
        schema: envelope({
          kind: { type: 'string' },
          total: { type: 'integer' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          offset: { type: 'integer' },
          limit: { type: 'integer' },
          hasMore: { type: 'boolean' },
          scanned: { type: 'integer' },
          truncated: { type: 'boolean' },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 40_000,
      isConcurrencySafe: () => true,
      presentCall: present('Feiniu Music · search'),
      async execute(args, exec) {
        return bridge.search({
          ...(typeof args.query === 'string' ? { query: args.query } : {}),
          kind: typeof args.kind === 'string' ? args.kind as 'track' | 'artist' | 'album' | 'playlist' | 'folder' : 'track',
          ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
          ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
          ...(typeof args.artist === 'string' ? { artist: args.artist } : {}),
          ...(typeof args.album === 'string' ? { album: args.album } : {}),
          ...(typeof args.folder === 'string' ? { folder: args.folder } : {}),
          ...(typeof args.genre === 'string' ? { genre: args.genre } : {}),
          ...(typeof args.year === 'number' ? { year: args.year } : {}),
          ...(typeof args.lossless === 'boolean' ? { lossless: args.lossless } : {}),
          ...(typeof args.hasLyric === 'boolean' ? { hasLyric: args.hasLyric } : {}),
          ...(typeof args.minDurationSec === 'number' ? { minDurationSec: args.minDurationSec } : {}),
          ...(typeof args.maxDurationSec === 'number' ? { maxDurationSec: args.maxDurationSec } : {}),
          signal: exec.signal,
        });
      },
    },
    {
      name: 'fnos_music_play',
      description:
        'Play a track, a search query, a playlist, or an album from the active fnOS device, replacing or extending the shared queue. Use fnos_music_search first when the track id is unknown. Audio plays in a connected DSH page.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          trackId: { type: 'string', description: 'Track id from search or the current queue.' },
          query: { type: 'string', description: 'Natural-language track query, e.g. "周杰伦 晴天". Matching tracks are queued (bounded by limit).' },
          playlistId: { type: 'string', description: 'Play all tracks of a saved playlist (bounded by limit).' },
          albumId: { type: 'string', description: 'Play all tracks of an album. Uses the native album track-list endpoint when the firmware album-detail response has no tracks, with a bounded title-search fallback.' },
          mode: { type: 'string', enum: ['replace', 'append', 'next'], description: 'replace the queue (default), append to it, or insert after the current track.' },
          shuffle: { type: 'boolean', description: 'Use shuffle order for this playback.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum tracks to add from a query/playlist/album. Default 50.' },
        },
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          played: { type: 'object', additionalProperties: true },
          added: { type: 'integer' },
          queueLength: { type: 'integer' },
          queueIndex: { type: 'integer' },
          mode: { type: 'string' },
          player: { type: 'object', additionalProperties: true },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 40_000,
      presentCall: present('Feiniu Music · play'),
      async execute(args) {
        return bridge.play(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_control',
      description:
        'Control the shared fnOS playback session: pause/resume/toggle, next/previous, seek, volume, mute, or set list/one/shuffle. The audio itself is played by a connected DSH page; without one the state changes but no sound is produced.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['pause', 'resume', 'toggle', 'next', 'previous', 'seek', 'volume', 'mute', 'unmute', 'mode'],
            description: 'Control to perform.',
          },
          positionSec: { type: 'number', minimum: 0, description: 'Seek position in seconds; used with seek.' },
          volume: { type: 'integer', minimum: 0, maximum: 100, description: 'Volume percentage; used with volume.' },
          mode: { type: 'string', enum: ['list', 'one', 'shuffle'], description: 'Playback mode; used with mode.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          player: { type: 'object', additionalProperties: true },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 15_000,
      presentCall: present('Feiniu Music · control'),
      async execute(args) {
        return bridge.control(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_queue',
      description:
        'Read or edit the shared playback queue: get a page, append, insert, remove, clear, or move tracks. Track ids come from search. Removing and clearing are immediate; this tool is not the high-risk favorite/playlist deletion path.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['get', 'add', 'insert', 'remove', 'clear', 'move'], description: 'Queue operation.' },
          trackIds: { type: 'array', items: { type: 'string' }, description: 'Track ids for add/insert/remove.' },
          query: { type: 'string', description: 'Alternative to trackIds for add/insert: search and add matching tracks.' },
          index: { type: 'integer', minimum: 0, description: 'Insert position or source index for move.' },
          position: { type: 'integer', minimum: 0, description: 'Destination index for move.' },
          offset: { type: 'integer', minimum: 0, description: 'Page offset for get/add results. Default 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Page size 1-200. Default 50.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          queue: { type: 'array', items: { type: 'object', additionalProperties: true } },
          queueTotal: { type: 'integer' },
          queueRevision: { type: 'integer' },
          currentIndex: { type: 'integer' },
          hasMore: { type: 'boolean' },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 30_000,
      presentCall: present('Feiniu Music · queue'),
      async execute(args) {
        return bridge.queueTool(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_playlist',
      description:
        'List/read or manage saved fnOS playlists. list/get are read-only. create/rename/add/remove mutate the NAS; delete and removing more than one track are high-risk and require the confirmToken returned by a previous confirmation_required result when the confirmation switch is on. Adding by query uses the server search.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'create', 'rename', 'delete', 'add', 'remove'], description: 'Playlist operation.' },
          playlistId: { type: 'string', description: 'Playlist id for get/rename/delete/add/remove.' },
          name: { type: 'string', description: 'Playlist name for create/rename.' },
          trackIds: { type: 'array', items: { type: 'string' }, description: 'Track ids for add/remove.' },
          trackId: { type: 'string', description: 'Single track id for add/remove.' },
          query: { type: 'string', description: 'Search text for add when trackIds are not supplied.' },
          offset: { type: 'integer', minimum: 0, description: 'Result offset for list. Default 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size for list. Default 20.' },
          confirmToken: { type: 'string', description: 'The token returned by a previous confirmation_required result.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          playlist: { type: 'object', additionalProperties: true },
          playlistId: { type: 'string' },
          name: { type: 'string' },
          total: { type: 'integer' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          truncated: { type: 'boolean' },
          hasMore: { type: 'boolean' },
          added: { type: 'integer' },
          removed: { type: 'integer' },
          failed: { type: 'integer' },
          failedIds: { type: 'array', items: { type: 'string' } },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 60_000,
      isConcurrencySafe: () => false,
      presentCall: present('Feiniu Music · playlist'),
      async execute(args) {
        return bridge.playlistTool(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_smart_playlist',
      description:
        'Create a local playlist. The calling model interprets the user\'s natural-language mood and supplies either chosen trackIds or deterministic filters (artist/album/genre/folder/year/lossless/hasLyric/duration/query); the plugin only builds the playlist from local library data and never calls an LLM or an online source.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'New playlist name.' },
          trackIds: { type: 'array', items: { type: 'string' }, description: 'Model-selected local track ids, preferred over filters.' },
          filters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string', description: 'Optional text search.' },
              artist: { type: 'string' },
              album: { type: 'string' },
              genre: { type: 'string' },
              folder: { type: 'string' },
              year: { type: 'integer', minimum: 0, maximum: 3000 },
              lossless: { type: 'boolean' },
              hasLyric: { type: 'boolean', description: 'false selects instrumental/no-lyric tracks.' },
              minDurationSec: { type: 'integer', minimum: 0 },
              maxDurationSec: { type: 'integer', minimum: 0 },
            },
          },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max tracks when filters are used. Default 50.' },
        },
        required: ['name'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          playlist: { type: 'object', additionalProperties: true },
          added: { type: 'integer' },
          failed: { type: 'integer' },
          failedIds: { type: 'array', items: { type: 'string' } },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 90_000,
      isConcurrencySafe: () => false,
      presentCall: present('Feiniu Music · smart playlist'),
      async execute(args) {
        return bridge.smartPlaylist(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_recommend',
      description:
        'Recommend local tracks similar to the current/seed track using artist, album, genre, year and lossless heuristics. No online service and no LLM call. Use this before smart_playlist or to answer “more like this”.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seedTrackId: { type: 'string', description: 'Track id, or "current". Default current.' },
          strategy: { type: 'string', enum: ['similar', 'shuffle', 'lossless'], description: 'similar by metadata, random local, or lossless only.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max tracks. Default 10.' },
        },
      },
      output: {
        schema: envelope({
          seed: { type: 'object', additionalProperties: true },
          strategy: { type: 'string' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          scanned: { type: 'integer' },
          truncated: { type: 'boolean' },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 60_000,
      isConcurrencySafe: () => true,
      presentCall: present('Feiniu Music · recommend'),
      async execute(args, exec) {
        return bridge.recommend({ ...args, signal: exec.signal } as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_dj',
      description:
        'Control the continuous local AI DJ. start accepts a model-selected trackId pool and/or a local scene; the Host keeps playing/refilling the queue at the end without needing a chat turn per song. Nothing is generated online and no LLM is called inside the plugin.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status', 'enable', 'disable'] },
          trackIds: { type: 'array', items: { type: 'string' }, description: 'Optional model-selected local track pool for start.' },
          scene: { type: 'string', enum: ['auto', 'morning', 'focus', 'evening', 'late', 'instrumental'], description: 'Optional local scene for start.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max tracks when starting from a scene.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          enabled: { type: 'boolean' },
          dj: { type: 'object', additionalProperties: true },
          scene: { type: 'object', additionalProperties: true },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 60_000,
      isConcurrencySafe: () => false,
      presentCall: present('Feiniu Music · DJ'),
      async execute(args) {
        return bridge.dj(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_stats',
      description:
        'Return local listening statistics for the active listener: plays, listened time, unique tracks, active days, daily/hourly history and top tracks/artists/albums. Data never leaves the Host and is not read from the NAS.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          range: { type: 'string', enum: ['7d', '30d', 'all'], description: 'Stats range. Default 30d.' },
        },
      },
      output: {
        schema: envelope({
          range: { type: 'string' },
          plays: { type: 'integer' },
          listenedSec: { type: 'integer' },
          uniqueTracks: { type: 'integer' },
          activeDays: { type: 'integer' },
          daily: { type: 'array', items: { type: 'object', additionalProperties: true } },
          hourly: { type: 'array', items: { type: 'integer' } },
          topTracks: { type: 'array', items: { type: 'object', additionalProperties: true } },
          topArtists: { type: 'array', items: { type: 'object', additionalProperties: true } },
          topAlbums: { type: 'array', items: { type: 'object', additionalProperties: true } },
          topGenres: { type: 'array', items: { type: 'object', additionalProperties: true } },
          listener: { type: 'object', additionalProperties: true },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 15_000,
      isConcurrencySafe: () => true,
      presentCall: present('Feiniu Music · stats'),
      async execute(args) {
        return bridge.stats(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_history',
      description:
        'List the active listener\'s local listening history. Set unique=true for the recent-tracks view (latest play per track); leave false for raw play events. clear removes local history for this listener and is high-risk when the confirmation switch is on (returns a confirmToken first).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'clear'], description: 'History operation.' },
          range: { type: 'string', enum: ['7d', '30d', 'all'], description: 'List range. Default 30d.' },
          offset: { type: 'integer', minimum: 0, description: 'Result offset. Default 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size. Default 50.' },
          unique: { type: 'boolean', description: 'When true, keep only the latest play of each track (recent songs); default false keeps every play event.' },
          confirmToken: { type: 'string', description: 'Token returned by a previous confirmation_required result.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          range: { type: 'string' },
          unique: { type: 'boolean' },
          total: { type: 'integer' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          listener: { type: 'object', additionalProperties: true },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 20_000,
      isConcurrencySafe: () => false,
      presentCall: present('Feiniu Music · history'),
      async execute(args) {
        const action = args.action === 'clear' ? 'clear' : 'list';
        return action === 'clear' ? bridge.clearHistory(args as Record<string, unknown>) : bridge.historyTool(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_scene',
      description:
        'Start/stop/status a local BGM scene. Scenes use the local clock, listening profile and library metadata only; there is no weather or online request. Starting a scene replaces the queue and enables continuous local DJ.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status'] },
          scene: { type: 'string', enum: ['auto', 'morning', 'focus', 'evening', 'late', 'instrumental'], description: 'Scene for start. auto follows local time.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max tracks. Default 20.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          scene: { type: 'object', additionalProperties: true },
          sceneState: { type: 'object', additionalProperties: true },
          resolvedScene: { type: 'string' },
          tracks: { type: 'array', items: { type: 'object', additionalProperties: true } },
          fallback: { type: 'boolean' },
          player: { type: 'object', additionalProperties: true },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 60_000,
      isConcurrencySafe: () => false,
      presentCall: present('Feiniu Music · scene'),
      async execute(args) {
        return bridge.scene(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_profile',
      description:
        'Manage local listener profiles for separated history/statistics/recommendations. Profiles are UX separation, not authentication; the DSH profile remains the security boundary. Deleting a profile is high-risk and returns a confirmToken when confirmation is on.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'switch', 'rename', 'delete'] },
          listenerId: { type: 'string', description: 'Listener id for switch/rename/delete.' },
          name: { type: 'string', description: 'Name for create/rename.' },
          confirmToken: { type: 'string', description: 'Token returned by a previous confirmation_required result.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          listener: { type: 'object', additionalProperties: true },
          listeners: { type: 'array', items: { type: 'object', additionalProperties: true } },
          activeListenerId: { type: 'string' },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 20_000,
      isConcurrencySafe: () => false,
      presentCall: present('Feiniu Music · listener'),
      async execute(args) {
        return bridge.listenersTool(args as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_favorite',
      description:
        'List, add, or remove favorites on the NAS. Use trackId="current" for the now-playing track. Removing more than one favorite is destructive and requires a confirmToken when the plugin\'s high-risk confirmation switch is on; the first call returns that token.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'remove', 'remove_many'], description: 'Favorite operation.' },
          trackId: { type: 'string', description: 'One track id, or "current" for the now-playing track.' },
          trackIds: { type: 'array', items: { type: 'string' }, description: 'Multiple track ids for remove_many.' },
          offset: { type: 'integer', minimum: 0, description: 'List offset. Default 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'List page size. Default 20.' },
          confirmToken: { type: 'string', description: 'The token returned by a previous confirmation_required result.' },
        },
        required: ['action'],
      },
      output: {
        schema: envelope({
          action: { type: 'string' },
          changed: { type: 'integer' },
          failed: { type: 'integer' },
          failedIds: { type: 'array', items: { type: 'string' } },
          favorite: { type: 'boolean' },
          total: { type: 'integer' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          hasMore: { type: 'boolean' },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 40_000,
      presentCall: present('Feiniu Music · favorite'),
      async execute(args, exec) {
        return bridge.favorite({ ...args, signal: exec.signal } as Record<string, unknown>);
      },
    },
    {
      name: 'fnos_music_lyrics',
      description:
        'Fetch the server-side LRC lyrics for a track on the active device. Use trackId="current" for the now-playing track. V3 does not read local LRC files from the NAS; bilingual/word timing depend on the server LRC content.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          trackId: { type: 'string', description: 'Track id, or "current".' },
          maxLines: { type: 'integer', minimum: 1, maximum: 5000, description: 'Optional line limit.' },
        },
        required: ['trackId'],
      },
      output: {
        schema: envelope({
          trackId: { type: 'string' },
          title: { type: 'string' },
          lrc: { type: 'string' },
          lineCount: { type: 'integer' },
          truncated: { type: 'boolean' },
          offsetMs: { type: 'integer' },
          isLRC: { type: 'boolean' },
        }),
        render: (_args, value) => render(value),
      },
      timeoutMs: 30_000,
      isConcurrencySafe: () => true,
      presentCall: present('Feiniu Music · lyrics'),
      async execute(args) {
        return bridge.lyrics(args as Record<string, unknown>);
      },
    },
  ];
  return tools.map((tool) => wrapTool(tool, bridge));
}
