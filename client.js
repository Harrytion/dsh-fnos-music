/**
 * Browser half of `dsh-fnos-music`.
 *
 * Three native DSH surfaces:
 *   sidebar.panellist      — the "Feiniu Music" entry; its icon is the current cover.
 *   sidebar.footer.action  — the resident now-playing row above Settings.
 *   main (key fnos-music)  — the tabbed control panel (queue / search / playlists / settings).
 *
 * All networking is same-origin to the plugin Host (`/fnos-music/*`); the
 * browser never receives the NAS token. The Host owns the shared player state
 * and streams audio through its approved Range relay. Audio elements, SSE,
 * timers, listeners, and the style tag are all released through ctx.effect.
 */
window.__ModuleLoader__.load({
  id: 'dsh-fnos-music',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {
      createContext,
      useCallback,
      useContext,
      useEffect,
      useMemo,
      useReducer,
      useRef,
      useState,
    } = React;

    const NS = 'fnos-music';
    const PANEL_ID = 'fnos-music';
    const API = '/fnos-music';

    /* ------------------------------------------------------------------ *
     * Locale
     * ------------------------------------------------------------------ */

    const zh = {
      panel: '飞牛音乐',
      subtitle: '你的 fnOS 音乐库',
      loading: '正在加载…',
      retry: '重试',
      refresh: '刷新',
      queue: '播放队列',
      search: '曲库搜索',
      playlists: '歌单',
      settings: '设置',
      noDevice: '还没有连接飞牛设备',
      noDeviceHint: '在「设置」里添加 FNID 或局域网地址，然后就能在这里控歌。',
      addDevice: '添加设备',
      noTrack: '未在播放',
      playing: '播放中',
      paused: '已暂停',
      stopped: '已停止',
      prev: '上一首',
      next: '下一首',
      play: '播放',
      pause: '暂停',
      like: '红心',
      unlike: '取消红心',
      shuffle: '随机播放',
      repeatAll: '列表循环',
      repeatOne: '单曲循环',
      volume: '音量',
      mute: '静音',
      unmute: '取消静音',
      seek: '播放进度',
      queueEmpty: '队列是空的',
      queueEmptyHint: '从搜索或歌单里播放一首歌。',
      clearQueue: '清空队列',
      remove: '移除',
      addToQueue: '加入队列',
      searchPlaceholder: '搜索本地曲库…',
      searchHint: '输入歌名、歌手、专辑或文件夹路径。',
      searchEmpty: '没有找到结果',
      kindTrack: '歌曲',
      kindArtist: '歌手',
      kindAlbum: '专辑',
      kindPlaylist: '歌单',
      kindFolder: '文件夹',
      playAll: '全部播放',
      favorites: '红心歌单',
      userPlaylists: '我的歌单',
      noPlaylists: '还没有自建歌单',
      favoritesEmpty: '还没有红心歌曲',
      playlistEmpty: '歌单是空的',
      back: '返回',
      tracks: '首',
      settingsTitle: '插件设置',
      deviceName: '备注名称',
      mode: '连接方式',
      modeFnid: 'FNID 中继',
      modeDirect: '直连 / Unix Socket',
      fnid: 'FNID',
      fnidHint: '只填字母/数字/短横线，例如 mynas；不要带域名或端口。',
      address: '地址',
      addressHint: '192.168.1.10、https://nas:5667、unix:///path/to/trim.music.sock',
      token: 'Token',
      tokenPlaceholder: '粘贴 music-token，留空则保留已保存的 token',
      tokenHint: '已保存 token；留空不修改。',
      loginUser: '飞牛音乐账号',
      loginPass: '密码',
      loginHint: '使用飞牛音乐里的独立账号，不是 fnOS 系统账号。密码只用于换取 token，不保存。',
      save: '保存',
      cancel: '取消',
      edit: '编辑',
      removeDevice: '删除设备',
      probe: '测试连接',
      switch: '切换',
      active: '当前',
      openWeb: '在浏览器打开飞牛音乐',
      confirmHighRisk: '高危操作二次确认',
      confirmHighRiskHint: '批量取消红心等 Agent 操作需要 confirmToken。',
      cacheLimit: '缓存上限 (MB)',
      probeInterval: '连接探测间隔 (秒)',
      logs: '请求日志',
      clearLogs: '清空日志',
      clearCache: '清理缓存',
      reset: '重置凭证',
      resetHint: '删除已保存设备与 token，不影响 NAS。',
      settingsSaved: '已保存',
      online: '在线',
      offline: '离线',
      auth: '登录失效',
      serviceMissing: '音乐服务未启动',
      degraded: '中继较慢',
      idle: '未连接',
      probing: '检测中…',
      relay: 'FNID 中继',
      direct: '直连',
      unix: 'Unix Socket',
      gateway: '网关',
      device: '设备',
      devices: '设备',
      service: '服务',
      slowRelayHint: 'FNID 中继延迟偏高，大曲库/无损播放可能卡顿。',
      largeLibraryHint: '曲库较大，已启用分页加载。',
      audioError: '音频播放失败',
      audioRetry: '重试播放',
      compatLoading: '正在准备兼容音轨…',
      compatError: '兼容播放失败：ffmpeg 与浏览器 MSE 均不可用',
      compatBackend: '兼容播放',
      compatFfmpeg: 'ffmpeg 已启用',
      compatMse: '未检测到 ffmpeg，使用浏览器 MSE 备用',
      compatHint: 'DTS/APE 等格式自动选择后端；普通 FLAC/MP3/PCM WAV 仍直连。',
      autoplayBlocked: '浏览器拦截了自动播放，点一下播放按钮即可。',
      claimPlayback: '在此页面播放',
      otherPagePlaying: '另一个页面正在播放',
      noAudioClient: '当前没有 DSH 页面在出声',
      loginExpired: 'token 已失效，请在设置里重新登录。',
      deviceFormTitle: '添加 / 编辑设备',
      allowSelfSigned: '允许私网自签名证书',
      allowSelfSignedHint: '仅对局域网地址生效；公网仍然严格校验证书。',
      confirmDeleteDevice: '删除设备「{name}」及其 token？',
      confirmClearQueue: '清空当前播放队列？',
      confirmReset: '重置所有设备与 token？',
      confirmClearCache: '清理封面与歌词缓存？',
      yes: '确认',
      no: '取消',
      errorGeneric: '操作失败',
      networkError: '无法连接插件后台，请确认插件已启用。',
      tokenSet: '已保存 token',
      account: '账号',
      lastChecked: '上次检测',
      never: '未检测',
      loadMore: '加载更多',
      addedToQueue: '已加入队列',
      noWebUrl: '当前设备没有可打开的网页地址（Unix Socket 模式）。',
      openPanel: '打开飞牛音乐',
      currentTrack: '当前播放',
      qualityHires: 'Hi-Res',
      qualityLossless: '无损',
      qualityStandard: '标准',
      more: '更多',
      folderLabel: '文件夹',
      yearLabel: '年份',
      lossless: '只看无损',
      browseHint: '浏览第一页歌曲',
      errAuth: 'token 已失效，请在设置中重新登录。',
      errNoDevice: '没有激活设备，请先在设置中添加。',
      errOffline: '设备离线或网络不可达。',
      errService: '没有找到飞牛音乐服务。',
      errTls: 'TLS 证书校验失败；局域网自签证书可在设备设置中允许。',
      errRefused: '端口拒绝连接。',
      errGeneric: '请求失败',
      cacheInfo: '{covers} 张封面 · {lyrics} 份歌词 · {size}',
      pageOf: '第 {index} / {total} 首',
      modeAuto: '自动（同网优先直连）',
      modeAutoHint: '同时保存 FNID 和直连地址：局域网可达时走直连，否则走 FNID。',
      viaDirect: '经直连',
      viaFnid: '经 FNID',
      viaAuto: '自动选路',
      floatingPlayer: '悬浮播放器',
      floatingPlayerHint: '有歌曲时在 DSH 窗口内显示可拖拽迷你播放器；关闭后可在这里重新打开。',
      immersiveCover: '沉浸式封面',
      immersiveCoverHint: '展开播放器时使用模糊封面背景。',
      spectrum: '频谱可视化',
      spectrumHint: '展开播放器时显示实时频谱（Web Audio，可能受浏览器限制）。',
      shortcuts: '全局快捷键',
      shortcutsHint: '焦点不在输入框时：空格播放/暂停，←/→ 快退/快进，Shift+←/→ 切歌，M 静音，L 红心。',
      autoDj: '基础 AI DJ',
      autoDjHint: '播放到队尾时自动续播本地曲目；Agent 可通过 fnos_music_dj 提供曲目池或场景，实现连续 DJ。',
      backgroundProbe: '后台探测全部设备',
      backgroundProbeHint: '定期探测已保存的非当前设备，设备列表显示红绿状态。',
      backgroundProbeInterval: '后台探测间隔 (秒)',
      playbackSettings: '播放与界面',
      playlistSettings: '歌单',
      newPlaylist: '新建歌单',
      createPlaylist: '创建',
      renamePlaylist: '重命名',
      deletePlaylist: '删除歌单',
      playlistName: '歌单名称',
      playlistNamePlaceholder: '例如：深夜专注',
      playlistCreated: '歌单已创建',
      playlistRenamed: '歌单已重命名',
      playlistDeleted: '歌单已删除',
      confirmDeletePlaylist: '删除歌单「{name}」？NAS 上的歌单及其中曲目会被移除。',
      confirmRemoveTracks: '从歌单中移除选中的 {count} 首歌曲？',
      addToPlaylist: '加入歌单',
      choosePlaylist: '选择歌单',
      noPlaylistHint: '还没有歌单，先在歌单页新建一个。',
      importPlaylist: '导入歌单',
      exportPlaylist: '导出歌单',
      exportJson: '导出 JSON',
      exportM3u8: '导出 M3U8',
      importing: '正在导入…',
      imported: '导入完成：新增 {added} 首，缺失 {missing} 首，失败 {failed} 首',
      importFailed: '导入失败',
      select: '选择',
      selectAll: '全选',
      clearSelection: '取消选择',
      removeSelected: '移除所选',
      addSelected: '加入歌单',
      selectedCount: '已选 {count} 首',
      tracksAdded: '已加入 {count} 首',
      tracksRemoved: '已移除 {count} 首',
      noTracksSelected: '先选择曲目',
      playingFloat: '悬浮播放',
      openFloat: '打开悬浮播放器',
      closeFloat: '关闭悬浮播放器',
      minimize: '最小化',
      expand: '展开',
      fullPlayer: '完整播放器',
      lyrics: '歌词',
      lyricsLoading: '正在加载歌词…',
      noLyrics: '这首歌没有服务端歌词',
      noTimedLyrics: '歌词没有时间轴，仅显示文本',
      translation: '翻译',
      spectrumUnavailable: '频谱不可用（浏览器 Web Audio 受限）',
      playerSettings: '播放器设置',
      selectPlaylist: '选择目标歌单',
      noPlaylistsHint: '没有可用歌单',
      playlistExportEmpty: '歌单没有曲目',
      renameHint: '输入新名称',
      importFileHint: '支持插件 JSON 或 M3U8 文件',
      backgroundProbeOn: '后台探测已开启',
      autoDjOn: 'AI DJ 已开启',
      autoDjOff: 'AI DJ 已关闭',
      floatHint: '拖动标题区域移动；点边缘可收起',
      lyricsHint: '点击歌词跳转',
      queueNext: '接下来',
      muteShortcut: '静音',
      deleteConfirmTitle: '需要确认',
      home: '首页',
      nowPlaying: '正在播放',
      recent: '最近播放',
      songs: '歌曲',
      albums: '专辑',
      artists: '歌手',
      liked: '我喜欢的音乐',
      folder: '文件夹',
      scenes: '场景',
      stats: '统计',
      library: '音乐库',
      tools: '工具',
      forward: '前进',
      title: '标题',
      quality: '音质',
      duration: '时长',
      noResults: '没有找到内容',
      unknownArtist: '未知歌手',
      libraryEmpty: '曲库还没有歌曲',
      likedEmpty: '还没有红心歌曲',
      album: '专辑',
      artist: '歌手',
      addAllQueue: '全部加入队列',
      albumEmpty: '专辑没有曲目',
      playSelected: '播放所选',
      addSelectedQueue: '加入队列',
      addSelectedPlaylist: '加入歌单',
      favoriteSelected: '加入红心',
      selectTrack: '选择歌曲',
      viewAll: '查看全部',
      results: '条结果',
      topTracks: '最常听歌曲',
      topArtists: '最常听歌手',
      topAlbums: '最常听专辑',
      topGenres: '最常听流派',
      statPlays: '播放次数',
      statListened: '收听时长',
      statUnique: '独立歌曲',
      statDays: '活跃天数',
      statDaily: '每日收听',
      statHourly: '时段分布',
      statsEmpty: '还没有足够的收听数据',
      range7: '近 7 天',
      range30: '近 30 天',
      rangeAll: '全部',
      clearHistory: '清空历史',
      confirmClearHistory: '清空当前成员的本地收听历史？此操作不可撤销。',
      historyEmpty: '还没有收听记录',
      homeRecent: '最近播放',
      homeForYou: '为你推荐',
      homeLatestAlbums: '最新专辑',
      homeArtists: '热门歌手',
      homePlaylists: '歌单',
      homeRecommended: '为你推荐',
      addQueue: '加入队列',
      playNext: '下一首播放',
      goAlbum: '打开专辑',
      goArtist: '打开歌手',
      addPlaylist: '加入歌单',
      connectTitle: '连接你的飞牛音乐',
      connectHint: '添加 FNID 或局域网地址后，即可浏览和播放你的本地音乐库。',
      listeners: '成员',
      listenersHint: '成员之间独立保存收听历史和推荐，播放队列共享。',
      listener: '成员',
      listenerActive: '当前',
      listenerNamePlaceholder: '新成员昵称',
      addListener: '添加成员',
      manageListeners: '管理成员',
      rename: '重命名',
      confirmDeleteListener: '删除这个本地成员及其收听历史？此操作不可撤销。',
      listenerSecurityNote: '成员 profile 只是本地界面隔离，不是身份认证；DSH Profile 仍是安全边界。',
      securityAudit: '安全与审计',
      auditHint: '只记录 Agent 的写操作，不含曲库内容、token 或完整参数。',
      auditEmpty: '还没有 Agent 写操作记录',
      auditOk: '成功',
      auditFail: '失败',
      clear: '清空',
      traffic: '网络流量',
      requests: '请求',
      errors: '错误',
      bytes: '字节',
      avgLatency: '平均延迟',
      settingsMeta: '设备、播放、AI 与本地数据设置',
      sceneAuto: '自动场景',
      sceneAutoHint: '按本地时间选择晨间、专注、夜晚或深夜',
      sceneAutoStart: '按时间开始',
      sceneMorning: '晨间',
      sceneMorningHint: '轻快开始一天',
      sceneFocus: '专注',
      sceneFocusHint: '纯音乐与耐听曲目',
      sceneEvening: '夜晚',
      sceneEveningHint: '放松的晚间音乐',
      sceneLate: '深夜',
      sceneLateHint: '安静、舒缓的本地曲目',
      sceneInstrumental: '纯音乐',
      sceneInstrumentalHint: '只选无歌词曲目',
      sceneStart: '开始',
      sceneStop: '停止场景',
      sceneStarted: '场景已开始',
      sceneActive: '当前场景',
      scenePrivacy: '只使用本地时间、画像和元数据，不请求天气或在线内容',
      sceneNote: '场景会替换当前队列并启用连续本地 DJ；不会自动在后台启动。',
      voice: '语音指令',
      voiceDisabled: '语音指令已在设置中关闭',
      voiceUnsupported: '当前浏览器不支持语音识别',
      voiceNotMatched: '没有识别到可执行的指令',
      voiceDone: '已执行',
      djOn: '连续 DJ 开启',
      djOff: '连续 DJ 关闭',
      upNext: '接下来',

      folderEmpty: '按路径筛选你的曲库',
      folderHint: '按文件夹路径过滤本地曲目',
      folderPlaceholder: '输入文件夹路径，例如 /音乐/华语',

      localData: '本地数据与 AI',
      historyEnabled: '记录本地收听历史',
      historyEnabledHint: '只保存在本机插件数据目录，不上传；用于统计、画像和场景。',
      agentWrites: '允许 Agent 写操作',
      agentWritesHint: '关闭后 Agent 只能读取和播控，不能改歌单、红心或本地成员数据。',
      trafficStats: '统计网络流量',
      trafficStatsHint: '只汇总请求数、字节和延迟，不记录 query、Cookie 或 token。',
      voiceHint: '默认关闭。开启后使用浏览器语音识别；音频可能由浏览器/系统处理，插件只接收识别文本且不保存。',

    };

    const en = {
      panel: 'Feiniu Music',
      subtitle: 'Your fnOS music library',
      loading: 'Loading…',
      retry: 'Retry',
      refresh: 'Refresh',
      queue: 'Queue',
      search: 'Search',
      playlists: 'Playlists',
      settings: 'Settings',
      noDevice: 'No Feiniu Music device yet',
      noDeviceHint: 'Add an FNID or LAN address in Settings, then control playback here.',
      addDevice: 'Add device',
      noTrack: 'Nothing playing',
      playing: 'Playing',
      paused: 'Paused',
      stopped: 'Stopped',
      prev: 'Previous',
      next: 'Next',
      play: 'Play',
      pause: 'Pause',
      like: 'Favorite',
      unlike: 'Unfavorite',
      shuffle: 'Shuffle',
      repeatAll: 'Repeat all',
      repeatOne: 'Repeat one',
      volume: 'Volume',
      mute: 'Mute',
      unmute: 'Unmute',
      seek: 'Seek',
      queueEmpty: 'The queue is empty',
      queueEmptyHint: 'Play a track from Search or a playlist.',
      clearQueue: 'Clear queue',
      remove: 'Remove',
      addToQueue: 'Add to queue',
      searchPlaceholder: 'Search the local library…',
      searchHint: 'Try a title, artist, album, or folder path.',
      searchEmpty: 'No results',
      kindTrack: 'Songs',
      kindArtist: 'Artists',
      kindAlbum: 'Albums',
      kindPlaylist: 'Playlists',
      kindFolder: 'Folders',
      playAll: 'Play all',
      favorites: 'Favorites',
      userPlaylists: 'My playlists',
      noPlaylists: 'No playlists yet',
      favoritesEmpty: 'No favorites yet',
      playlistEmpty: 'This playlist is empty',
      back: 'Back',
      tracks: 'tracks',
      settingsTitle: 'Plugin settings',
      deviceName: 'Name',
      mode: 'Connection',
      modeFnid: 'FNID relay',
      modeDirect: 'Direct / Unix socket',
      fnid: 'FNID',
      fnidHint: 'One label, e.g. mynas; no domain or port.',
      address: 'Address',
      addressHint: '192.168.1.10, https://nas:5667, unix:///path/to/trim.music.sock',
      token: 'Token',
      tokenPlaceholder: 'Paste a music-token; leave blank to keep the saved one',
      tokenHint: 'A token is saved; leave blank to keep it.',
      loginUser: 'Feiniu Music account',
      loginPass: 'Password',
      loginHint: 'Use the music app account, not the fnOS system account. The password is used once to mint a token and is not saved.',
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      removeDevice: 'Remove device',
      probe: 'Test connection',
      switch: 'Switch',
      active: 'Active',
      openWeb: 'Open Feiniu Music in browser',
      confirmHighRisk: 'Confirm destructive agent actions',
      confirmHighRiskHint: 'Bulk unfavorite and similar operations need a confirmToken.',
      cacheLimit: 'Cache limit (MB)',
      probeInterval: 'Probe interval (seconds)',
      logs: 'Request log',
      clearLogs: 'Clear log',
      clearCache: 'Clear cache',
      reset: 'Reset credentials',
      resetHint: 'Remove saved devices and tokens; the NAS is untouched.',
      settingsSaved: 'Saved',
      online: 'Online',
      offline: 'Offline',
      auth: 'Sign-in expired',
      serviceMissing: 'Music service missing',
      degraded: 'Slow relay',
      idle: 'Not connected',
      probing: 'Checking…',
      relay: 'FNID relay',
      direct: 'Direct',
      unix: 'Unix socket',
      gateway: 'Gateway',
      device: 'Device',
      devices: 'Devices',
      service: 'Service',
      slowRelayHint: 'The FNID relay is slow; large libraries or lossless playback may stutter.',
      largeLibraryHint: 'Large library; paging is enabled.',
      audioError: 'Audio playback failed',
      audioRetry: 'Retry audio',
      compatLoading: 'Preparing compatible audio…',
      compatError: 'Compatibility playback failed: ffmpeg and browser MSE are unavailable.',
      compatBackend: 'Compatibility',
      compatFfmpeg: 'ffmpeg enabled',
      compatMse: 'ffmpeg not detected; using browser MSE fallback',
      compatHint: 'DTS/APE formats pick a backend automatically; FLAC/MP3/PCM WAV stay direct.',
      autoplayBlocked: 'The browser blocked autoplay; press play once.',
      claimPlayback: 'Play in this page',
      otherPagePlaying: 'Another page is playing',
      noAudioClient: 'No DSH page is producing audio',
      loginExpired: 'The token expired; sign in again in Settings.',
      deviceFormTitle: 'Add / edit device',
      allowSelfSigned: 'Allow private self-signed certificate',
      allowSelfSignedHint: 'Only for private addresses; public hosts stay strict.',
      confirmDeleteDevice: 'Remove device “{name}” and its token?',
      confirmClearQueue: 'Clear the current queue?',
      confirmReset: 'Reset all devices and tokens?',
      confirmClearCache: 'Clear cover and lyric cache?',
      yes: 'Confirm',
      no: 'Cancel',
      errorGeneric: 'Operation failed',
      networkError: 'Cannot reach the plugin Host. Is the plugin enabled?',
      tokenSet: 'Token saved',
      account: 'Account',
      lastChecked: 'Last checked',
      never: 'Never',
      loadMore: 'Load more',
      addedToQueue: 'Added to queue',
      noWebUrl: 'This device has no openable web address (Unix socket mode).',
      openPanel: 'Open Feiniu Music',
      currentTrack: 'Now playing',
      qualityHires: 'Hi-Res',
      qualityLossless: 'Lossless',
      qualityStandard: 'Standard',
      more: 'More',
      folderLabel: 'Folder',
      yearLabel: 'Year',
      lossless: 'Lossless only',
      browseHint: 'Browse the first page of songs',
      errAuth: 'Token expired; sign in again in Settings.',
      errNoDevice: 'No active device; add one in Settings.',
      errOffline: 'Device offline or network unreachable.',
      errService: 'Feiniu Music service not found.',
      errTls: 'TLS certificate verification failed; allow a private self-signed certificate in the device settings.',
      errRefused: 'The port refused the connection.',
      errGeneric: 'Request failed',
      cacheInfo: '{covers} covers · {lyrics} lyrics · {size}',
      pageOf: '{index} / {total}',
      modeAuto: 'Auto (LAN first)',
      modeAutoHint: 'Save both an FNID and a direct address: use direct when reachable, otherwise FNID.',
      viaDirect: 'via direct',
      viaFnid: 'via FNID',
      viaAuto: 'auto path',
      floatingPlayer: 'Floating player',
      floatingPlayerHint: 'Show a draggable mini player inside the DSH window while a track is playing. Reopen it here after closing.',
      immersiveCover: 'Immersive cover',
      immersiveCoverHint: 'Use a blurred cover background in the expanded player.',
      spectrum: 'Spectrum',
      spectrumHint: 'Show a live spectrum in the expanded player (Web Audio; browser support varies).',
      shortcuts: 'Global shortcuts',
      shortcutsHint: 'When focus is not in an input: Space play/pause, ←/→ seek, Shift+←/→ previous/next, M mute, L favorite.',
      autoDj: 'Basic AI DJ',
      autoDjHint: 'Keep playing local tracks at the end of the queue; the Agent can provide a pool or scene via fnos_music_dj for a continuous DJ.',
      backgroundProbe: 'Probe all devices in background',
      backgroundProbeHint: 'Periodically probe saved non-active devices and show red/green status.',
      backgroundProbeInterval: 'Background probe interval (seconds)',
      playbackSettings: 'Playback & UI',
      playlistSettings: 'Playlists',
      newPlaylist: 'New playlist',
      createPlaylist: 'Create',
      renamePlaylist: 'Rename',
      deletePlaylist: 'Delete playlist',
      playlistName: 'Playlist name',
      playlistNamePlaceholder: 'e.g. Late-night focus',
      playlistCreated: 'Playlist created',
      playlistRenamed: 'Playlist renamed',
      playlistDeleted: 'Playlist deleted',
      confirmDeletePlaylist: 'Delete playlist “{name}”? The NAS playlist and its tracks will be removed.',
      confirmRemoveTracks: 'Remove the selected {count} tracks from this playlist?',
      addToPlaylist: 'Add to playlist',
      choosePlaylist: 'Choose a playlist',
      noPlaylistHint: 'No playlists yet — create one on the Playlists tab.',
      importPlaylist: 'Import playlist',
      exportPlaylist: 'Export playlist',
      exportJson: 'Export JSON',
      exportM3u8: 'Export M3U8',
      importing: 'Importing…',
      imported: 'Imported: {added} added, {missing} missing, {failed} failed',
      importFailed: 'Import failed',
      select: 'Select',
      selectAll: 'Select all',
      clearSelection: 'Clear selection',
      removeSelected: 'Remove selected',
      addSelected: 'Add to playlist',
      selectedCount: '{count} selected',
      tracksAdded: '{count} added',
      tracksRemoved: '{count} removed',
      noTracksSelected: 'Select some tracks first',
      playingFloat: 'Floating player',
      openFloat: 'Open floating player',
      closeFloat: 'Close floating player',
      minimize: 'Minimize',
      expand: 'Expand',
      fullPlayer: 'Full player',
      lyrics: 'Lyrics',
      lyricsLoading: 'Loading lyrics…',
      noLyrics: 'No server-side lyrics for this track',
      noTimedLyrics: 'Lyrics have no timeline; text only',
      translation: 'Translation',
      spectrumUnavailable: 'Spectrum unavailable (Web Audio blocked)',
      playerSettings: 'Player settings',
      selectPlaylist: 'Choose a playlist',
      noPlaylistsHint: 'No playlists available',
      playlistExportEmpty: 'This playlist has no tracks',
      renameHint: 'Enter a new name',
      importFileHint: 'Plugin JSON or M3U8',
      backgroundProbeOn: 'Background probe enabled',
      autoDjOn: 'AI DJ enabled',
      autoDjOff: 'AI DJ disabled',
      floatHint: 'Drag the header; click an edge to collapse',
      lyricsHint: 'Click a lyric line to seek',
      queueNext: 'Up next',
      muteShortcut: 'Mute',
      deleteConfirmTitle: 'Confirmation required',
      home: 'Home',
      nowPlaying: 'Now playing',
      recent: 'Recently played',
      songs: 'Songs',
      albums: 'Albums',
      artists: 'Artists',
      liked: 'Liked',
      folder: 'Folders',
      scenes: 'Scenes',
      stats: 'Statistics',
      library: 'Library',
      tools: 'Tools',
      forward: 'Forward',
      title: 'Title',
      quality: 'Quality',
      duration: 'Duration',
      noResults: 'Nothing found',
      unknownArtist: 'Unknown artist',
      libraryEmpty: 'No songs in this library yet',
      likedEmpty: 'No liked songs yet',
      album: 'Album',
      artist: 'Artist',
      addAllQueue: 'Add all to queue',
      albumEmpty: 'This album has no tracks',
      playSelected: 'Play selected',
      addSelectedQueue: 'Add to queue',
      addSelectedPlaylist: 'Add to playlist',
      favoriteSelected: 'Like selected',
      selectTrack: 'Select track',
      viewAll: 'View all',
      results: 'results',
      topTracks: 'Top tracks',
      topArtists: 'Top artists',
      topAlbums: 'Top albums',
      topGenres: 'Top genres',
      statPlays: 'Plays',
      statListened: 'Listening time',
      statUnique: 'Unique tracks',
      statDays: 'Active days',
      statDaily: 'Daily listening',
      statHourly: 'Hourly distribution',
      statsEmpty: 'Not enough listening data yet',
      range7: 'Last 7 days',
      range30: 'Last 30 days',
      rangeAll: 'All time',
      clearHistory: 'Clear history',
      confirmClearHistory: 'Clear local listening history for this listener? This cannot be undone.',
      historyEmpty: 'No listening history yet',
      homeRecent: 'Recently played',
      homeForYou: 'For you',
      homeLatestAlbums: 'Latest albums',
      homeArtists: 'Artists',
      homePlaylists: 'Playlists',
      homeRecommended: 'For you',
      addQueue: 'Add to queue',
      playNext: 'Play next',
      goAlbum: 'Open album',
      goArtist: 'Open artist',
      addPlaylist: 'Add to playlist',
      connectTitle: 'Connect Feiniu Music',
      connectHint: 'Add an FNID or LAN address to browse and play your local library.',
      listeners: 'Listeners',
      listenersHint: 'History and recommendations are separate; the playback queue is shared.',
      listener: 'Listener',
      listenerActive: 'Current',
      listenerNamePlaceholder: 'New listener name',
      addListener: 'Add listener',
      manageListeners: 'Manage listeners',
      rename: 'Rename',
      confirmDeleteListener: 'Delete this local listener and its listening history? This cannot be undone.',
      listenerSecurityNote: 'Listener profiles are local UI separation, not authentication; the DSH profile remains the security boundary.',
      securityAudit: 'Security & audit',
      auditHint: 'Only Agent write operations are recorded; no library content, token, or full arguments.',
      auditEmpty: 'No Agent write operations yet',
      auditOk: 'ok',
      auditFail: 'failed',
      clear: 'Clear',
      traffic: 'Traffic',
      requests: 'Requests',
      errors: 'Errors',
      bytes: 'Bytes',
      avgLatency: 'Avg latency',
      settingsMeta: 'Devices, playback, AI and local data',
      sceneAuto: 'Auto scene',
      sceneAutoHint: 'Pick morning, focus, evening or late from local time',
      sceneAutoStart: 'Start by time',
      sceneMorning: 'Morning',
      sceneMorningHint: 'A light start to the day',
      sceneFocus: 'Focus',
      sceneFocusHint: 'Instrumental and easy-listening tracks',
      sceneEvening: 'Evening',
      sceneEveningHint: 'Relaxed evening music',
      sceneLate: 'Late night',
      sceneLateHint: 'Quiet, gentle local tracks',
      sceneInstrumental: 'Instrumental',
      sceneInstrumentalHint: 'Only tracks without lyrics',
      sceneStart: 'Start',
      sceneStop: 'Stop scene',
      sceneStarted: 'Scene started',
      sceneActive: 'Current scene',
      scenePrivacy: 'Local time, profile and metadata only; no weather or online request',
      sceneNote: 'A scene replaces the queue and enables continuous local DJ; it never starts in the background automatically.',
      voice: 'Voice command',
      voiceDisabled: 'Voice commands are disabled in settings',
      voiceUnsupported: 'Speech recognition is unavailable in this browser',
      voiceNotMatched: 'No executable command was recognized',
      voiceDone: 'Done',
      djOn: 'continuous DJ on',
      djOff: 'continuous DJ off',
      upNext: 'Up next',

      folderEmpty: 'Filter your library by folder path',
      folderHint: 'Filter local tracks by folder path',
      folderPlaceholder: 'Enter a folder path, e.g. /Music/Jazz',

      localData: 'Local data & AI',
      historyEnabled: 'Record local listening history',
      historyEnabledHint: 'Stored only in the local plugin data directory, never uploaded; used for stats, profile and scenes.',
      agentWrites: 'Allow Agent writes',
      agentWritesHint: 'When off, the Agent can read and control playback but cannot change playlists, favorites or local listeners.',
      trafficStats: 'Collect traffic counters',
      trafficStatsHint: 'Only request counts, bytes and latency; no query, Cookie or token.',
      voiceHint: 'Off by default. Uses browser speech recognition; audio may be processed by the browser/OS, while the plugin only receives text and does not store it.',

    };

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        values && values[key] !== undefined ? String(values[key]) : `{${key}}`
      ));
    }

    function errorText(t, error) {
      if (!error) return t('errGeneric');
      const code = error.code || '';
      if (code === 'auth') return t('errAuth');
      if (code === 'no_active_device' || code === 'not_configured') return t('errNoDevice');
      if (code === 'device_offline' || code === 'gateway_timeout' || code === 'relay_timeout' || code === 'relay_rejected') return t('errOffline');
      if (code === 'service_missing') return t('errService');
      if (code === 'tls') return t('errTls');
      if (code === 'refused') return t('errRefused');
      if (code === 'network') return t('networkError');
      return error.hint || error.message || t('errGeneric');
    }

    /* ------------------------------------------------------------------ *
     * Store, client identity, API
     * ------------------------------------------------------------------ */

    let translate = (key) => key;

    const store = {
      snapshot: null,
      sse: 'idle',
      toast: null,
      audioError: '',
      compatLoading: false,
      isDriver: false,
      favorites: {},
      loadError: '',
    };
    const storeListeners = new Set();
    function setStore(patch) {
      store.snapshot = patch.snapshot !== undefined ? patch.snapshot : store.snapshot;
      store.sse = patch.sse !== undefined ? patch.sse : store.sse;
      store.toast = patch.toast !== undefined ? patch.toast : store.toast;
      store.audioError = patch.audioError !== undefined ? patch.audioError : store.audioError;
      store.compatLoading = patch.compatLoading !== undefined ? patch.compatLoading : store.compatLoading;
      store.isDriver = patch.isDriver !== undefined ? patch.isDriver : store.isDriver;
      store.favorites = patch.favorites !== undefined ? patch.favorites : store.favorites;
      store.loadError = patch.loadError !== undefined ? patch.loadError : store.loadError;
      for (const listener of storeListeners) listener();
    }
    function subscribeStore(listener) {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    }
    function useStoreValue(selector) {
      const [, force] = useReducer((value) => value + 1, 0);
      useEffect(() => subscribeStore(force), []);
      return selector(store);
    }

    function makeClientId() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `c-${crypto.randomUUID()}`;
      } catch {
        // Fall through to the random string.
      }
      return `c-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    }
    const clientId = makeClientId();

    async function apiFetch(path, options) {
      const settings = options || {};
      let response;
      try {
        response = await fetch(`${API}${path}`, {
          method: settings.method || 'GET',
          credentials: 'same-origin',
          headers: settings.body !== undefined ? { 'content-type': 'application/json' } : {},
          body: settings.body !== undefined ? JSON.stringify(settings.body) : undefined,
          signal: settings.signal,
        });
      } catch (cause) {
        const error = new Error('network');
        error.code = 'network';
        throw error;
      }
      let data = null;
      try {
        data = await response.json();
      } catch {
        const error = new Error('protocol');
        error.code = 'protocol';
        throw error;
      }
      if (data && data.ok === false) {
        const error = new Error(data.error && data.error.message ? data.error.message : 'failed');
        error.code = data.error ? data.error.code : 'unknown';
        error.hint = data.error ? data.error.hint : undefined;
        error.confirmToken = data.error ? data.error.confirmToken : undefined;
        throw error;
      }
      return data;
    }

    let toastTimer = null;
    function showToast(text, kind) {
      setStore({ toast: { text, kind: kind || 'info', at: Date.now() } });
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        setStore({ toast: null });
        toastTimer = null;
      }, 4500);
    }
    function showError(t, error) {
      showToast(errorText(t, error), 'error');
    }

    function formatTime(seconds) {
      const value = Number(seconds);
      if (!Number.isFinite(value) || value < 0) return '0:00';
      const total = Math.floor(value);
      const minutes = Math.floor(total / 60);
      const rest = total % 60;
      return `${minutes}:${String(rest).padStart(2, '0')}`;
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
      if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    function coverUrl(coverId, size) {
      if (!coverId) return null;
      return `${API}/cover?coverId=${encodeURIComponent(coverId)}&size=${size || 160}`;
    }

    function qualityLabel(t, quality) {
      if (quality === 'hires') return t('qualityHires');
      if (quality === 'lossless') return t('qualityLossless');
      return t('qualityStandard');
    }

    function modeLabel(t, mode) {
      if (mode === 'fnid') return t('relay');
      if (mode === 'unix') return t('unix');
      if (mode === 'auto') return t('viaAuto');
      return t('direct');
    }

    function viaLabel(t, via) {
      if (via === 'fnid') return t('viaFnid');
      if (via === 'direct') return t('viaDirect');
      if (via === 'unix') return t('unix');
      return '';
    }

    /* ------------------------------------------------------------------ *
     * Audio controller
     * ------------------------------------------------------------------ */

    let audio = null;
    let audioTrackId = null;
    let audioSource = '';
    let compatAbort = null;
    let compatObjectUrl = null;
    let compatMediaSource = null;
    let compatGeneration = 0;
    let lastOpen = { id: '', at: 0 };
    let lastSeekToken = -1;
    let lastProgressAt = 0;
    let progressInFlight = false;
    let volumeTimer = null;
    let audioContext = null;
    let analyserNode = null;
    let mediaSourceNode = null;
    let floatWindowToggle = null;
    let floatWindowOpen = null;
    let floatWindowClose = null;

    function ensureAnalyser() {
      if (typeof window === 'undefined') return null;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      const element = ensureAudio();
      if (audioContext === null) {
        try {
          audioContext = new Ctor();
          mediaSourceNode = audioContext.createMediaElementSource(element);
          analyserNode = audioContext.createAnalyser();
          analyserNode.fftSize = 256;
          mediaSourceNode.connect(analyserNode);
          analyserNode.connect(audioContext.destination);
        } catch {
          audioContext = null;
          analyserNode = null;
          mediaSourceNode = null;
          return null;
        }
      }
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return analyserNode;
    }

    function closeAudioContext() {
      if (audioContext !== null) {
        try {
          mediaSourceNode?.disconnect();
          analyserNode?.disconnect();
          void audioContext.close();
        } catch {
          // The context may already be closed.
        }
      }
      audioContext = null;
      analyserNode = null;
      mediaSourceNode = null;
    }

    function ensureAudio() {
      if (audio !== null) return audio;
      audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('loadedmetadata', () => {
        setStore({ compatLoading: false });
        const player = store.snapshot && store.snapshot.player;
        if (player && audio && Number.isFinite(player.positionMs) && player.positionMs > 0) {
          try {
            audio.currentTime = player.positionMs / 1000;
          } catch {
            // Metadata can arrive slightly late; the next sync fixes it.
          }
        }
      });
      audio.addEventListener('timeupdate', () => {
        if (!audio || audio.paused) return;
        const now = Date.now();
        if (now - lastProgressAt < 1000 || progressInFlight) return;
        lastProgressAt = now;
        progressInFlight = true;
        apiFetch('/player', {
          method: 'POST',
          body: {
            action: 'progress',
            clientId,
            positionMs: Math.round(audio.currentTime * 1000),
            status: 'playing',
          },
        }).catch(() => {}).finally(() => {
          progressInFlight = false;
        });
      });
      audio.addEventListener('ended', () => {
        apiFetch('/player', { method: 'POST', body: { action: 'ended', clientId } }).catch(() => {});
      });
      audio.addEventListener('error', () => {
        if (!audio || !audioTrackId) return;
        setStore({ audioError: audioSource === 'compat' ? 'compat' : 'audio', compatLoading: false });
        apiFetch('/player', {
          method: 'POST',
          body: { action: 'error', clientId, message: 'Audio element failed to load the stream' },
        }).catch(() => {});
      });
      return audio;
    }

    const COMPAT_CODECS = new Set(['dts', 'dtshd', 'dts-hd', 'ac3', 'eac3', 'truehd', 'ape', 'alac', 'dsd', 'wma', 'wmapro', 'tta', 'wv']);
    const COMPAT_FORMATS = new Set(['dsf', 'dff', 'ape', 'wma', 'dts', 'ac3']);

    function trackNeedsCompat(track) {
      if (!track) return false;
      const codec = String(track.codec || '').trim().toLowerCase();
      const format = String(track.format || '').trim().toLowerCase();
      if (COMPAT_CODECS.has(codec) || COMPAT_FORMATS.has(format)) return true;
      return Number(track.channels) > 2;
    }

    function cleanupCompat() {
      compatGeneration += 1;
      if (compatAbort !== null) {
        try { compatAbort.abort(); } catch { /* already aborted */ }
        compatAbort = null;
      }
      if (compatObjectUrl !== null) {
        try { URL.revokeObjectURL(compatObjectUrl); } catch { /* already revoked */ }
        compatObjectUrl = null;
      }
      if (compatMediaSource !== null) {
        try {
          if (compatMediaSource.readyState === 'open') compatMediaSource.endOfStream();
        } catch { /* source may already be closed */ }
        compatMediaSource = null;
      }
    }

    function audioSourceFor(track) {
      return trackNeedsCompat(track)
        ? 'compat'
        : `${API}/stream?guid=${encodeURIComponent(track.id)}`;
    }

    function attachCompatMse(buffer, track, generation) {
      return new Promise((resolve, reject) => {
        if (typeof MediaSource === 'undefined') {
          reject(new Error('mse-unavailable'));
          return;
        }
        const mime = 'audio/mp4; codecs="opus"';
        if (!MediaSource.isTypeSupported(mime)) {
          reject(new Error('mse-unsupported'));
          return;
        }
        const mediaSource = new MediaSource();
        compatMediaSource = mediaSource;
        const objectUrl = URL.createObjectURL(mediaSource);
        compatObjectUrl = objectUrl;
        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        mediaSource.addEventListener('sourceopen', () => {
          if (generation !== compatGeneration) {
            fail(new Error('stale'));
            return;
          }
          let sourceBuffer;
          try {
            sourceBuffer = mediaSource.addSourceBuffer(mime);
          } catch (error) {
            fail(error);
            return;
          }
          sourceBuffer.addEventListener('updateend', () => {
            if (settled) return;
            settled = true;
            try { mediaSource.duration = Math.max(1, Number(track.durationSec) || 1); } catch { /* duration is advisory */ }
            try {
              if (mediaSource.readyState === 'open') mediaSource.endOfStream();
            } catch { /* source may already be closed */ }
            resolve();
          }, { once: true });
          sourceBuffer.addEventListener('error', () => fail(new Error('mse-append')), { once: true });
          try {
            sourceBuffer.appendBuffer(buffer);
          } catch (error) {
            fail(error);
          }
        }, { once: true });
        mediaSource.addEventListener('error', () => fail(new Error('mse-source')), { once: true });
        const element = ensureAudio();
        element.src = objectUrl;
        element.load();
      });
    }

    async function loadCompatAudio(track, generation) {
      const controller = new AbortController();
      compatAbort = controller;
      try {
        const response = await fetch(`${API}/compat?guid=${encodeURIComponent(track.id)}`, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('compat-request');
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const buffer = await response.arrayBuffer();
        if (generation !== compatGeneration) return;
        const element = ensureAudio();
        if (contentType.includes('webm')) {
          const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/webm' }));
          compatObjectUrl = objectUrl;
          element.src = objectUrl;
          element.load();
        } else if (contentType.includes('mp4')) {
          await attachCompatMse(buffer, track, generation);
        } else {
          throw new Error('compat-format');
        }
        if (generation !== compatGeneration) return;
        setStore({ compatLoading: false, audioError: '' });
        const player = store.snapshot && store.snapshot.player;
        if (player && player.track && player.track.id === track.id) {
          if (player.positionMs > 0) {
            try { element.currentTime = player.positionMs / 1000; } catch { /* applied on loadedmetadata */ }
          }
          if (player.status === 'playing') {
            const started = element.play();
            if (started && typeof started.catch === 'function') {
              started.catch(() => setStore({ audioError: 'autoplay' }));
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted || generation !== compatGeneration) return;
        setStore({ audioError: 'compat', compatLoading: false });
      } finally {
        if (compatAbort === controller) compatAbort = null;
      }
    }

    function setAudioTrack(track) {
      const element = ensureAudio();
      if (!trackNeedsCompat(track)) {
        cleanupCompat();
        const source = audioSourceFor(track);
        if (audioTrackId === track.id && audioSource === source) return element;
        audioTrackId = track.id;
        audioSource = source;
        element.src = source;
        element.load();
        lastSeekToken = -1;
        setStore({ audioError: '', compatLoading: false });
        return element;
      }
      if (audioTrackId === track.id && audioSource === 'compat') return element;
      cleanupCompat();
      audioTrackId = track.id;
      audioSource = 'compat';
      try {
        element.pause();
        element.removeAttribute('src');
        element.load();
      } catch {
        // The element may already be detached.
      }
      lastSeekToken = -1;
      setStore({ audioError: '', compatLoading: true });
      const generation = compatGeneration;
      void loadCompatAudio(track, generation);
      return element;
    }

    async function hydrateTrack(track) {
      if (!track || track.codec || track.format) return track;
      try {
        const data = await apiFetch(`/track-meta?guid=${encodeURIComponent(track.id)}`);
        return data && data.track ? { ...track, ...data.track } : track;
      } catch {
        return track;
      }
    }

    function stopAudio() {
      cleanupCompat();
      setStore({ compatLoading: false });
      if (audio !== null) {
        try {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        } catch {
          // The element may already be detached.
        }
      }
      audio = null;
      audioTrackId = null;
      audioSource = '';
      lastSeekToken = -1;
    }

    function isDriverPlayer(player) {
      return Boolean(player && player.driverClientId && player.driverClientId === clientId);
    }

    function syncAudio() {
      const snapshot = store.snapshot;
      if (!snapshot) return;
      const player = snapshot.player;
      const driver = isDriverPlayer(player);
      if (store.isDriver !== driver) setStore({ isDriver: driver });
      if (!driver) {
        if (audio !== null && !audio.paused) audio.pause();
        return;
      }
      if (!player.track) {
        if (audio !== null && !audio.paused) audio.pause();
        audioTrackId = null;
        return;
      }
      const element = setAudioTrack(player.track);
      if (player.seekToken !== lastSeekToken) {
        lastSeekToken = player.seekToken;
        try {
          element.currentTime = Math.max(0, player.positionMs / 1000);
        } catch {
          // Will be applied on loadedmetadata.
        }
      }
      element.volume = player.muted ? 0 : Math.max(0, Math.min(1, player.volume / 100));
      element.muted = player.muted;
      if (store.audioError !== '' && player.status === 'playing' && !element.paused) setStore({ audioError: '' });
      if (player.status === 'playing' && !store.compatLoading) {
        const started = element.play();
        if (started && typeof started.catch === 'function') {
          started.catch(() => {
            setStore({ audioError: 'autoplay' });
            apiFetch('/player', {
              method: 'POST',
              body: { action: 'progress', clientId, positionMs: player.positionMs, status: 'paused' },
            }).catch(() => {});
          });
        }
      } else if (!element.paused) {
        element.pause();
      }
    }

    async function claimDriver() {
      try {
        const data = await apiFetch('/client/claim', { method: 'POST', body: { clientId } });
        setStore({ isDriver: Boolean(data.isDriver) });
        return Boolean(data.isDriver);
      } catch {
        return false;
      }
    }

    async function heartbeat() {
      try {
        const data = await apiFetch('/client/heartbeat', { method: 'POST', body: { clientId } });
        const driver = Boolean(data.isDriver);
        if (store.isDriver !== driver) {
          setStore({ isDriver: driver });
          syncAudio();
        }
      } catch {
        // The SSE/state fallback reports connection problems.
      }
    }

    async function postPlayer(body) {
      try {
        return await apiFetch('/player', { method: 'POST', body: { clientId, ...body } });
      } catch (error) {
        showError(translate, error);
        return null;
      }
    }

    async function playQueueTrack(track) {
      if (!track) return;
      void claimDriver();
      if (audioContext !== null && audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
      const data = await postPlayer({ action: 'playTrack', trackId: track.id });
      if (data) showToast(translate('playing'), 'info');
    }

    async function playTrackNow(track) {
      if (!track) return;
      void claimDriver();
      if (audioContext !== null && audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
      const playable = await hydrateTrack(track);
      if (store.audioError === 'compat' && trackNeedsCompat(playable)) {
        audioTrackId = null;
        audioSource = '';
        cleanupCompat();
      }
      const element = setAudioTrack(playable);
      if (!store.compatLoading) {
        const started = element.play();
        if (started && typeof started.catch === 'function') {
          started.catch(() => setStore({ audioError: 'autoplay' }));
        }
      }
      await postPlayer({ action: 'play', trackId: track.id });
    }

    async function openTrack(track) {
      if (!track) return;
      const now = Date.now();
      if (lastOpen.id === track.id && now - lastOpen.at < 500) return;
      lastOpen = { id: track.id, at: now };
      const player = store.snapshot && store.snapshot.player;
      if (player && player.track) {
        if (player.track.id === track.id) return;
        await addToQueue(track);
        return;
      }
      await playTrackNow(track);
    }

    async function playCollection(kind, id) {
      if (id === undefined || id === null || id === '') return;
      void claimDriver();
      const field = kind === 'album' ? 'albumId' : kind === 'playlist' ? 'playlistId' : kind;
      await postPlayer({ action: 'play', [field]: id });
    }

    async function togglePlay() {
      const snapshot = store.snapshot;
      const player = snapshot && snapshot.player;
      if (!player || !player.track) return;
      void claimDriver();
      if (audioContext !== null && audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
      const playable = await hydrateTrack(player.track);
      if (store.audioError === 'compat' && trackNeedsCompat(playable)) {
        audioTrackId = null;
        audioSource = '';
        cleanupCompat();
      }
      const element = setAudioTrack(playable);
      if (store.compatLoading) {
        await postPlayer({ action: player.status === 'playing' ? 'pause' : 'resume' });
        return;
      }
      if (player.status === 'playing' && !element.paused) {
        element.pause();
        await postPlayer({ action: 'pause' });
      } else {
        const started = element.play();
        if (started && typeof started.catch === 'function') {
          started.catch(() => setStore({ audioError: 'autoplay' }));
        }
        await postPlayer({ action: 'resume' });
      }
    }

    async function skip(delta) {
      await postPlayer({ action: delta > 0 ? 'next' : 'previous' });
    }

    async function seekTo(positionMs) {
      const snapshot = store.snapshot;
      const player = snapshot && snapshot.player;
      if (!player || !player.track) return;
      const max = player.track.durationSec * 1000;
      const value = Math.max(0, Math.min(max, Math.round(positionMs)));
      if (audio !== null && audioTrackId === player.track.id) {
        try {
          audio.currentTime = value / 1000;
        } catch {
          // Ignore a seek before metadata.
        }
      }
      await postPlayer({ action: 'seek', positionMs: value });
    }

    async function changeVolume(volume) {
      const value = Math.max(0, Math.min(100, Math.round(volume)));
      if (audio !== null) audio.volume = value / 100;
      if (volumeTimer !== null) clearTimeout(volumeTimer);
      volumeTimer = setTimeout(() => {
        volumeTimer = null;
        void postPlayer({ action: 'volume', volume: value });
      }, 120);
    }

    async function openFloatingPlayer(t) {
      try {
        await apiFetch('/settings', { method: 'POST', body: { floatingPlayer: true } });
        if (typeof floatWindowOpen === 'function') floatWindowOpen();
        else if (typeof floatWindowToggle === 'function') floatWindowToggle();
        showToast(t('openFloat'), 'info');
      } catch (error) {
        showError(t, error);
      }
    }

    async function toggleMute() {
      const snapshot = store.snapshot;
      const player = snapshot && snapshot.player;
      if (!player) return;
      await postPlayer({ action: player.muted ? 'unmute' : 'mute' });
    }

    async function cycleMode() {
      const snapshot = store.snapshot;
      const player = snapshot && snapshot.player;
      if (!player) return;
      const next = player.mode === 'list' ? 'shuffle' : player.mode === 'shuffle' ? 'one' : 'list';
      await postPlayer({ action: 'mode', mode: next });
    }

    async function toggleFavorite(track) {
      if (!track) return;
      const next = !track.favorite;
      const previousFavorites = store.favorites;
      const previousSnapshot = store.snapshot;
      setStore({ favorites: { ...store.favorites, [track.id]: next } });
      if (previousSnapshot && previousSnapshot.player.track && previousSnapshot.player.track.id === track.id) {
        setStore({
          snapshot: {
            ...previousSnapshot,
            player: { ...previousSnapshot.player, track: { ...previousSnapshot.player.track, favorite: next } },
          },
        });
      }
      try {
        await apiFetch('/favorite', {
          method: 'POST',
          body: { action: next ? 'add' : 'remove', trackId: track.id },
        });
      } catch (error) {
        setStore({ favorites: previousFavorites, snapshot: previousSnapshot });
        showError(translate, error);
      }
    }

    async function addToQueue(track) {
      if (!track) return;
      try {
        await apiFetch('/queue', { method: 'POST', body: { action: 'add', trackIds: [track.id] } });
        showToast(translate('addedToQueue'), 'info');
      } catch (error) {
        showError(translate, error);
      }
    }

    /* ------------------------------------------------------------------ *
     * SSE + state
     * ------------------------------------------------------------------ */

    let events = null;
    let pollTimer = null;
    let heartbeatTimer = null;

    function stopPolling() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPolling() {
      if (pollTimer !== null) return;
      pollTimer = setInterval(() => {
        void refreshState();
      }, 3000);
      pollTimer.unref?.();
    }

    async function refreshState() {
      try {
        const snapshot = await apiFetch('/state');
        setStore({ loadError: '' });
        applySnapshot(snapshot);
      } catch (error) {
        setStore({
          sse: 'error',
          ...(store.snapshot === null ? { loadError: errorText(translate, error) } : {}),
        });
        if (store.snapshot === null) showError(translate, error);
      }
    }

    function applySnapshot(snapshot) {
      if (!snapshot || snapshot.version !== 1) return;
      const previousDeviceId = store.snapshot ? store.snapshot.activeDeviceId : null;
      setStore({
        snapshot,
        loadError: '',
        ...(previousDeviceId !== snapshot.activeDeviceId ? { favorites: {} } : {}),
      });
      if (store.sse !== 'open') setStore({ sse: 'open' });
      syncAudio();
      if (snapshot.player && snapshot.player.driverClientId === undefined) {
        void heartbeat();
      }
    }

    async function fetchQueueWindow() {
      try {
        const data = await apiFetch('/queue', {
          method: 'POST',
          body: { action: 'get', offset: 0, limit: 200 },
        });
        const current = store.snapshot;
        if (!current || !data || data.ok !== true) return;
        setStore({
          snapshot: {
            ...current,
            player: {
              ...current.player,
              queue: data.queue,
              queueTotal: data.queueTotal,
              queueRevision: data.queueRevision,
              currentIndex: data.currentIndex,
            },
          },
        });
      } catch {
        // The next player event retries.
      }
    }

    function applyEvent(message) {
      const current = store.snapshot;
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'snapshot') {
        applySnapshot(message.data);
        return;
      }
      if (!current) return;
      if (message.type === 'player') {
        const player = message.data || {};
        const queueChanged = player.queueRevision !== current.player.queueRevision;
        setStore({
          snapshot: {
            ...current,
            player: {
              ...current.player,
              ...player,
              queue: queueChanged ? current.player.queue : current.player.queue,
            },
          },
        });
        if (queueChanged) void fetchQueueWindow();
        syncAudio();
        return;
      }
      if (message.type === 'connection') {
        setStore({ snapshot: { ...current, connection: message.data } });
        return;
      }
      if (message.type === 'devices') {
        setStore({ snapshot: { ...current, devices: Array.isArray(message.data) ? message.data : current.devices } });
        return;
      }
      if (message.type === 'library') {
        setStore({ snapshot: { ...current, library: message.data } });
        return;
      }
      if (message.type === 'cache') {
        setStore({ snapshot: { ...current, cache: message.data } });
        return;
      }
      if (message.type === 'favorite') {
        const data = message.data || {};
        setStore({
          favorites: { ...store.favorites, [data.trackId]: Boolean(data.favorite) },
          snapshot: {
            ...current,
            player: {
              ...current.player,
              track: current.player.track && current.player.track.id === data.trackId
                ? { ...current.player.track, favorite: Boolean(data.favorite) }
                : current.player.track,
            },
          },
        });
        return;
      }
      if (message.type === 'toast') {
        showToast(message.data && message.data.text ? message.data.text : '', 'info');
      }
    }

    function startEvents() {
      if (events !== null) return;
      try {
        events = new EventSource(`${API}/events`);
      } catch {
        startPolling();
        return;
      }
      events.onopen = () => {
        stopPolling();
        setStore({ sse: 'open' });
      };
      events.onmessage = (event) => {
        try {
          applyEvent(JSON.parse(event.data));
        } catch {
          // Ignore a malformed event; the next snapshot wins.
        }
      };
      events.onerror = () => {
        setStore({ sse: 'reconnecting' });
        if (events !== null && events.readyState === EventSource.CLOSED) {
          try {
            events.close();
          } catch {
            // Already closed.
          }
          events = null;
          startPolling();
        }
      };
    }

    function stopEvents() {
      stopPolling();
      if (events !== null) {
        try {
          events.close();
        } catch {
          // Already closed.
        }
        events = null;
      }
    }

    /* ------------------------------------------------------------------ *
     * Small components
     * ------------------------------------------------------------------ */

    function Icon(props) {
      const name = props.name;
      const size = props.size || 18;
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        'aria-hidden': true,
        className: `fnm-icon${props.className ? ` ${props.className}` : ''}`,
      };
      const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
      if (name === 'play') return h('svg', common, h('path', { d: 'M8 5.5v13l11-6.5z', fill: 'currentColor' }));
      if (name === 'pause') return h('svg', common, h('path', { d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', fill: 'currentColor' }));
      if (name === 'prev') return h('svg', common, h('path', { d: 'M6 6h2.4v12H6zM18.5 6v12L9.5 12z', fill: 'currentColor' }));
      if (name === 'next') return h('svg', common, h('path', { d: 'M15.6 6H18v12h-2.4zM5.5 6v12L14.5 12z', fill: 'currentColor' }));
      if (name === 'heart') return h('svg', common, h('path', { d: 'M12 20.5s-7-4.4-9.2-8.1C.9 9.4 2.5 5.6 6.2 5.2c1.8-.2 3.5.7 5.8 2.8 2.3-2.1 4-3 5.8-2.8 3.7.4 5.3 4.2 3.4 7.2-2.2 3.7-9.2 8.1-9.2 8.1z', fill: 'currentColor' }));
      if (name === 'heartOutline') return h('svg', common, h('path', { ...stroke, d: 'M12 20.5s-7-4.4-9.2-8.1C.9 9.4 2.5 5.6 6.2 5.2c1.8-.2 3.5.7 5.8 2.8 2.3-2.1 4-3 5.8-2.8 3.7.4 5.3 4.2 3.4 7.2-2.2 3.7-9.2 8.1-9.2 8.1z' }));
      if (name === 'repeat') return h('svg', common, h('path', { ...stroke, d: 'M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1' }));
      if (name === 'repeatOne') return h('svg', common, h('path', { ...stroke, d: 'M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1M11 10.5h1.5v3' }));
      if (name === 'shuffle') return h('svg', common, h('path', { ...stroke, d: 'M3 6h3.5c4 0 4 12 8 12H21M18 15l3 3-3 3M3 18h3.5c1.2 0 2-.4 2.7-1M21 6l-3 3M21 6h-3' }));
      if (name === 'volume') return h('svg', common, h('path', { ...stroke, d: 'M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12' }));
      if (name === 'mute') return h('svg', common, h('path', { ...stroke, d: 'M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6' }));
      if (name === 'search') return h('svg', common, h('circle', { cx: 10.5, cy: 10.5, r: 6.5, ...stroke }), h('path', { ...stroke, d: 'M15.5 15.5L21 21' }));
      if (name === 'queue') return h('svg', common, h('path', { ...stroke, d: 'M4 6h11M4 10h11M4 14h7M18 13v7M18 13l3-1v7' }), h('circle', { cx: 16.5, cy: 20, r: 1.8, fill: 'currentColor' }), h('circle', { cx: 21, cy: 19, r: 1.8, fill: 'currentColor' }));
      if (name === 'playlist') return h('svg', common, h('path', { ...stroke, d: 'M4 6h12M4 10h12M4 14h7M4 18h7' }), h('path', { d: 'M16 15v6l5-3z', fill: 'currentColor' }));
      if (name === 'settings') return h('svg', common, h('path', { ...stroke, d: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6' }), h('circle', { cx: 15, cy: 7, r: 2, ...stroke }), h('circle', { cx: 9, cy: 17, r: 2, ...stroke }));
      if (name === 'refresh') return h('svg', common, h('path', { ...stroke, d: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5' }));
      if (name === 'plus') return h('svg', common, h('path', { ...stroke, d: 'M12 5v14M5 12h14' }));
      if (name === 'trash') return h('svg', common, h('path', { ...stroke, d: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6' }));
      if (name === 'check') return h('svg', common, h('path', { ...stroke, d: 'M4 12.5l5 5L20 6.5' }));
      if (name === 'close') return h('svg', common, h('path', { ...stroke, d: 'M5 5l14 14M19 5L5 19' }));
      if (name === 'chevron') return h('svg', common, h('path', { ...stroke, d: 'M9 5l7 7-7 7' }));
      if (name === 'device') return h('svg', common, h('rect', { x: 4, y: 5, width: 16, height: 11, rx: 2, ...stroke }), h('path', { ...stroke, d: 'M9 20h6M12 16v4' }));
      if (name === 'wifi') return h('svg', common, h('path', { ...stroke, d: 'M4 9a13 13 0 0 1 16 0M7 12.5a8.5 8.5 0 0 1 10 0M10 16a3.5 3.5 0 0 1 4 0' }), h('circle', { cx: 12, cy: 19.5, r: 1.2, fill: 'currentColor' }));
      if (name === 'warning') return h('svg', common, h('path', { ...stroke, d: 'M12 3l9 17H3zM12 9v5M12 17.5v.1' }));
      if (name === 'music') return h('svg', common, h('path', { d: 'M9 18.5a3.5 3.5 0 1 1-2-3.2V4l11-2v4L10 7.5v8.3A3.5 3.5 0 0 1 9 18.5z', fill: 'currentColor' }));
      if (name === 'arrowLeft') return h('svg', common, h('path', { ...stroke, d: 'M15 5l-7 7 7 7' }));
      if (name === 'download') return h('svg', common, h('path', { ...stroke, d: 'M12 3v11M8 10l4 4 4-4M4 17v3h16v-3' }));
      if (name === 'upload') return h('svg', common, h('path', { ...stroke, d: 'M12 15V4M8 8l4-4 4 4M4 17v3h16v-3' }));
      if (name === 'float') return h('svg', common, h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2, ...stroke }), h('rect', { x: 12, y: 11, width: 7, height: 6, rx: 1, ...stroke }));
      if (name === 'lyrics') return h('svg', common, h('path', { ...stroke, d: 'M4 6h10M4 10h7M4 14h9M4 18h6M16 10h4M16 14h4M16 18h2' }));
      if (name === 'expand') return h('svg', common, h('path', { ...stroke, d: 'M9 4H4v5M15 4h5v5M9 20H4v-5M20 15v5h-5' }));
      if (name === 'minimize') return h('svg', common, h('path', { ...stroke, d: 'M5 12h14' }));
      if (name === 'home') return h('svg', common, h('path', { ...stroke, d: 'M3 11.5L12 4l9 7.5M5.5 10v9h5v-5h3v5h5v-9' }));
      if (name === 'disc') return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8.5, ...stroke }), h('circle', { cx: 12, cy: 12, r: 2.2, ...stroke }));
      if (name === 'artist') return h('svg', common, h('circle', { cx: 12, cy: 8, r: 3.4, ...stroke }), h('path', { ...stroke, d: 'M4.5 20a7.5 7.5 0 0 1 15 0' }));
      if (name === 'recent') return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8.5, ...stroke }), h('path', { ...stroke, d: 'M12 7v5l3.5 2' }));
      if (name === 'stats') return h('svg', common, h('path', { ...stroke, d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }));
      if (name === 'scene') return h('svg', common, h('path', { ...stroke, d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z' }));
      if (name === 'folder') return h('svg', common, h('path', { ...stroke, d: 'M3 7h6l2 2h10v10H3zM3 7v12' }));
      if (name === 'more') return h('svg', common, h('circle', { cx: 5, cy: 12, r: 1.6, fill: 'currentColor' }), h('circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor' }), h('circle', { cx: 19, cy: 12, r: 1.6, fill: 'currentColor' }));
      if (name === 'mic') return h('svg', common, h('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3, ...stroke }), h('path', { ...stroke, d: 'M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6' }));
      if (name === 'clock') return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8.5, ...stroke }), h('path', { ...stroke, d: 'M12 7v5l3.5 2' }));
      if (name === 'sun') return h('svg', common, h('circle', { cx: 12, cy: 12, r: 4, ...stroke }), h('path', { ...stroke, d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }));
      if (name === 'moon') return h('svg', common, h('path', { ...stroke, d: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z' }));
      if (name === 'focus') return h('svg', common, h('circle', { cx: 12, cy: 12, r: 7, ...stroke }), h('circle', { cx: 12, cy: 12, r: 2, ...stroke }), h('path', { ...stroke, d: 'M12 2v3M12 19v3M2 12h3M19 12h3' }));
      return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8, ...stroke }));
    }

    function Cover(props) {
      const size = props.size || 40;
      const url = coverUrl(props.coverId, size * 2);
      const [failed, setFailed] = useState(false);
      useEffect(() => setFailed(false), [props.coverId]);
      if (!url || failed) {
        return h('div', {
          className: `fnm-cover fnm-cover-empty${props.className ? ` ${props.className}` : ''}`,
          style: { width: size, height: size },
          'aria-hidden': true,
        }, h(Icon, { name: 'music', size: Math.max(14, Math.round(size * 0.45)) }));
      }
      return h('img', {
        className: `fnm-cover${props.className ? ` ${props.className}` : ''}`,
        src: url,
        width: size,
        height: size,
        alt: props.alt || '',
        loading: props.loading || 'lazy',
        onError: () => setFailed(true),
      });
    }

    function Marquee(props) {
      const value = props.text || '';
      const ref = useRef(null);
      const [overflow, setOverflow] = useState(false);
      useEffect(() => {
        const node = ref.current;
        if (!node) return;
        const measure = () => {
          setOverflow(node.scrollWidth > node.clientWidth + 4);
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(node);
          return () => observer.disconnect();
        }
        return undefined;
      }, [value, props.className]);
      return h('div', { ref, className: `fnm-marquee${overflow ? ' is-overflow' : ''}${props.className ? ` ${props.className}` : ''}`, title: value },
        h('span', { className: 'fnm-marquee-inner' }, value, overflow ? h('span', { className: 'fnm-marquee-gap', 'aria-hidden': true }, value) : null),
      );
    }

    function StatusDot(props) {
      const phase = props.phase || 'idle';
      return h('span', { className: `fnm-dot fnm-dot-${phase}`, 'aria-hidden': true });
    }

    function ConnectionLabel(props) {
      const t = props.t;
      const connection = props.connection;
      if (!connection) return h('span', { className: 'fnm-muted' }, t('idle'));
      const phase = connection.phase;
      const label = phase === 'online' ? t('online')
        : phase === 'degraded' ? t('degraded')
          : phase === 'auth' ? t('auth')
            : phase === 'service-missing' ? t('serviceMissing')
              : phase === 'probing' ? t('probing')
                : phase === 'idle' ? t('idle')
                  : t('offline');
      return h('span', { className: 'fnm-conn' },
        h(StatusDot, { phase }),
        h('span', null, label),
        h('span', { className: 'fnm-conn-mode' }, modeLabel(t, connection.transport)),
        connection.transport === 'auto' && connection.via ? h('span', { className: 'fnm-conn-mode' }, viaLabel(t, connection.via)) : null,
        connection.latencyMs > 0 ? h('span', { className: 'fnm-conn-latency' }, `${Math.round(connection.latencyMs)} ms`) : null,
      );
    }

    function ProgressBar(props) {
      const t = props.t;
      const duration = Math.max(1, props.durationSec || 0);
      const [dragging, setDragging] = useState(false);
      const [draft, setDraft] = useState(0);
      const draggingRef = useRef(false);
      const draftRef = useRef(0);
      draftRef.current = draft;
      const value = dragging ? draft : Math.min(duration, Math.max(0, (props.positionMs || 0) / 1000));
      const commit = (next) => {
        draggingRef.current = false;
        setDragging(false);
        props.onSeek(Math.max(0, Math.min(duration, Number(next) || 0)) * 1000);
      };
      useEffect(() => {
        if (!dragging) return undefined;
        const stop = () => {
          if (!draggingRef.current) return;
          commit(draftRef.current);
        };
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        window.addEventListener('blur', stop);
        return () => {
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('pointercancel', stop);
          window.removeEventListener('blur', stop);
        };
      }, [dragging]);
      return h('div', { className: 'fnm-progress' },
        h('span', { className: 'fnm-time' }, formatTime(value)),
        h('input', {
          className: 'fnm-range',
          type: 'range',
          min: 0,
          max: duration,
          step: 1,
          value,
          disabled: !props.durationSec,
          'aria-label': t('seek'),
          onPointerDown: () => {
            draggingRef.current = true;
            setDraft(value);
            setDragging(true);
          },
          onChange: (event) => {
            const next = Number(event.target.value);
            setDraft(next);
            draggingRef.current = true;
            if (!dragging) setDragging(true);
          },
          onPointerUp: (event) => commit(event.target.value),
          onKeyUp: (event) => commit(event.target.value),
          onBlur: (event) => {
            if (dragging) commit(event.target.value);
          },
        }),
        h('span', { className: 'fnm-time' }, formatTime(props.durationSec)),
      );
    }

    function VolumeControl(props) {
      const t = props.t;
      const [value, setValue] = useState(props.volume || 0);
      useEffect(() => setValue(props.volume || 0), [props.volume]);
      return h('div', { className: 'fnm-volume' },
        h('button', {
          type: 'button',
          className: 'fnm-icon-btn',
          'aria-label': props.muted ? t('unmute') : t('mute'),
          title: props.muted ? t('unmute') : t('mute'),
          onClick: props.onMute,
        }, h(Icon, { name: props.muted ? 'mute' : 'volume', size: 16 })),
        h('input', {
          className: 'fnm-range fnm-range-volume',
          type: 'range',
          min: 0,
          max: 100,
          step: 1,
          value: props.muted ? 0 : value,
          'aria-label': t('volume'),
          onChange: (event) => {
            const next = Number(event.target.value);
            setValue(next);
            props.onVolume(next);
          },
        }),
      );
    }

    function PlayerBar(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const player = snapshot.player;
      const track = player.track;
      const driver = isDriverPlayer(player);
      const hasDriver = Boolean(player.driverClientId);
      const modeIcon = player.mode === 'one' ? 'repeatOne' : player.mode === 'shuffle' ? 'shuffle' : 'repeat';
      const modeText = player.mode === 'one' ? t('repeatOne') : player.mode === 'shuffle' ? t('shuffle') : t('repeatAll');
      const audioError = useStoreValue((value) => value.audioError);
      const compatLoading = useStoreValue((value) => value.compatLoading);
      return h('section', { className: 'fnm-player', 'aria-label': t('currentTrack') },
        h('div', { className: 'fnm-now' },
          h(Cover, { coverId: track ? track.coverId : '', size: 52, alt: track ? track.title : '' }),
          h('div', { className: 'fnm-now-main' },
            h(Marquee, { text: track ? track.title : t('noTrack'), className: 'fnm-now-title' }),
            h(Marquee, { text: track ? `${track.artist}${track.album ? ` · ${track.album}` : ''}` : t('subtitle'), className: 'fnm-now-artist' }),
            h(ProgressBar, {
              t,
              positionMs: player.positionMs,
              durationSec: track ? track.durationSec : 0,
              onSeek: props.onSeek,
            }),
          ),
          h('div', { className: 'fnm-transport' },
            h('button', { type: 'button', className: 'fnm-icon-btn', title: t('prev'), 'aria-label': t('prev'), disabled: !track, onClick: () => props.onSkip(-1) }, h(Icon, { name: 'prev', size: 18 })),
            h('button', {
              type: 'button',
              className: 'fnm-play-btn',
              title: player.status === 'playing' ? t('pause') : t('play'),
              'aria-label': player.status === 'playing' ? t('pause') : t('play'),
              disabled: !track,
              onClick: props.onPlayPause,
            }, h(Icon, { name: player.status === 'playing' ? 'pause' : 'play', size: 20 })),
            h('button', { type: 'button', className: 'fnm-icon-btn', title: t('next'), 'aria-label': t('next'), disabled: !track, onClick: () => props.onSkip(1) }, h(Icon, { name: 'next', size: 18 })),
            h('button', {
              type: 'button',
              className: `fnm-icon-btn${track && track.favorite ? ' is-on' : ''}`,
              title: track && track.favorite ? t('unlike') : t('like'),
              'aria-label': track && track.favorite ? t('unlike') : t('like'),
              disabled: !track,
              onClick: () => props.onLike(track),
            }, h(Icon, { name: track && track.favorite ? 'heart' : 'heartOutline', size: 18 })),
          ),
          h('div', { className: 'fnm-player-side' },
            props.onOpenNow ? h('button', { type: 'button', className: 'fnm-icon-btn', title: t('nowPlaying'), 'aria-label': t('nowPlaying'), onClick: props.onOpenNow }, h(Icon, { name: 'expand', size: 16 })) : null,
            props.onOpenQueue ? h('button', { type: 'button', className: 'fnm-icon-btn', title: t('queue'), 'aria-label': t('queue'), onClick: props.onOpenQueue }, h(Icon, { name: 'queue', size: 16 })) : null,
            h('button', {
              type: 'button',
              className: 'fnm-icon-btn',
              title: t('openFloat'),
              'aria-label': t('openFloat'),
              onClick: () => void openFloatingPlayer(t),
            }, h(Icon, { name: 'float', size: 16 })),
            h('button', {
              type: 'button',
              className: 'fnm-icon-btn',
              title: modeText,
              'aria-label': modeText,
              onClick: props.onMode,
            }, h(Icon, { name: modeIcon, size: 17 })),
            h(VolumeControl, {
              t,
              volume: player.volume,
              muted: player.muted,
              onVolume: props.onVolume,
              onMute: props.onMute,
            }),
          ),
        ),
        h('div', { className: 'fnm-player-status' },
          h(ConnectionLabel, { t, connection: snapshot.connection }),
          snapshot.connection.slowRelay ? h('span', { className: 'fnm-warn' }, h(Icon, { name: 'warning', size: 13 }), t('slowRelayHint')) : null,
          !driver && track ? h('span', { className: 'fnm-hintline' },
            hasDriver ? t('otherPagePlaying') : t('noAudioClient'),
            h('button', { type: 'button', className: 'fnm-link', onClick: props.onClaim }, t('claimPlayback')),
          ) : null,
          compatLoading ? h('span', { className: 'fnm-hintline' }, t('compatLoading')) : null,
          audioError ? h('span', { className: 'fnm-hintline fnm-errorline' },
            audioError === 'autoplay' ? t('autoplayBlocked') : audioError === 'compat' ? t('compatError') : t('audioError'),
            h('button', { type: 'button', className: 'fnm-link', onClick: props.onPlayPause }, t('audioRetry')),
          ) : null,
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Queue / search / playlists
     * ------------------------------------------------------------------ */

    function TrackRow(props) {
      const t = props.t;
      const track = props.track;
      const override = useStoreValue((value) => value.favorites[track.id]);
      const favorite = override === undefined ? track.favorite : Boolean(override);
      const effective = favorite === track.favorite ? track : { ...track, favorite };
      return h('div', { className: `fnm-row${props.active ? ' is-active' : ''}${props.selected ? ' is-selected' : ''}`, role: 'group' },
        props.selectable
          ? h('input', {
            type: 'checkbox',
            className: 'fnm-row-check',
            checked: Boolean(props.selected),
            'aria-label': `${t('select')} ${track.title}`,
            onChange: () => props.onSelect(track),
            onClick: (event) => event.stopPropagation(),
          })
          : null,
        h('button', { type: 'button', className: 'fnm-row-play', title: t('play'), 'aria-label': `${t('play')} ${track.title}`, onClick: () => props.onPlay(track) },
          h(Cover, { coverId: track.coverId, size: 32, alt: '' }),
          h('span', { className: 'fnm-row-index' }, props.indexLabel !== undefined ? props.indexLabel : ''),
        ),
        h('div', { className: 'fnm-row-main' },
          h('div', { className: 'fnm-row-title', title: track.title }, track.title),
          h('div', { className: 'fnm-row-sub', title: `${track.artist}${track.album ? ` · ${track.album}` : ''}` }, `${track.artist}${track.album ? ` · ${track.album}` : ''}`),
        ),
        h('span', { className: `fnm-badge fnm-badge-${track.quality}` }, qualityLabel(t, track.quality)),
        h('span', { className: 'fnm-row-duration' }, formatTime(track.durationSec)),
        h('div', { className: 'fnm-row-actions' },
          props.showAdd ? h('button', { type: 'button', className: 'fnm-icon-btn', title: t('addToQueue'), 'aria-label': t('addToQueue'), onClick: () => props.onAdd(track) }, h(Icon, { name: 'plus', size: 16 })) : null,
          h('button', {
            type: 'button',
            className: `fnm-icon-btn${favorite ? ' is-on' : ''}`,
            title: favorite ? t('unlike') : t('like'),
            'aria-label': favorite ? t('unlike') : t('like'),
            onClick: () => props.onLike(effective),
          }, h(Icon, { name: favorite ? 'heart' : 'heartOutline', size: 16 })),
          props.onRemove ? h('button', { type: 'button', className: 'fnm-icon-btn', title: t('remove'), 'aria-label': t('remove'), onClick: () => props.onRemove(track) }, h(Icon, { name: 'trash', size: 16 })) : null,
        ),
      );
    }

    function QueueTab(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const player = snapshot.player;
      const [extra, setExtra] = useState([]);
      const [loadingMore, setLoadingMore] = useState(false);
      useEffect(() => {
        setExtra([]);
      }, [player.queueRevision]);
      const rows = useMemo(() => player.queue.concat(extra), [player.queue, extra]);
      const loadMore = async () => {
        setLoadingMore(true);
        try {
          const data = await apiFetch('/queue', {
            method: 'POST',
            body: { action: 'get', offset: rows.length, limit: 200 },
          });
          if (data.ok === true) setExtra((current) => current.concat(data.queue || []));
        } catch (error) {
          showError(t, error);
        } finally {
          setLoadingMore(false);
        }
      };
      const remove = async (track) => {
        try {
          await apiFetch('/queue', { method: 'POST', body: { action: 'remove', trackIds: [track.id] } });
        } catch (error) {
          showError(t, error);
        }
      };
      const clear = async () => {
        const ok = await props.confirm(t('confirmClearQueue'));
        if (!ok) return;
        try {
          await apiFetch('/queue', { method: 'POST', body: { action: 'clear' } });
        } catch (error) {
          showError(t, error);
        }
      };
      return h('div', { className: 'fnm-list-wrap' },
        h('div', { className: 'fnm-list-head' },
          h('div', null, t('queue'), ' ', h('span', { className: 'fnm-muted' }, `${player.queueTotal} ${t('tracks')}`)),
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: player.queueTotal === 0, onClick: clear }, h(Icon, { name: 'trash', size: 14 }), t('clearQueue')),
        ),
        rows.length === 0
          ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'queue', size: 28 }), h('div', { className: 'fnm-empty-title' }, t('queueEmpty')), h('div', { className: 'fnm-muted' }, t('queueEmptyHint')))
          : h('div', { className: 'fnm-list' }, rows.map((track, index) => h(TrackRow, {
            key: `${track.id}-${index}`,
            t,
            track,
            active: index === player.currentIndex,
            indexLabel: String(index + 1),
            onPlay: props.onPlayQueueTrack || props.onPlayTrack,
            onLike: props.onToggleLike,
            onRemove: remove,
          }))),
        rows.length < player.queueTotal
          ? h('button', { type: 'button', className: 'fnm-btn fnm-load-more', disabled: loadingMore, onClick: loadMore }, loadingMore ? t('loading') : t('loadMore'))
          : null,
      );
    }

    function SearchTab(props) {
      const t = props.t;
      const [query, setQuery] = useState('');
      const [kind, setKind] = useState('track');
      const [items, setItems] = useState([]);
      const [total, setTotal] = useState(0);
      const [hasMore, setHasMore] = useState(false);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [selectionMode, setSelectionMode] = useState(false);
      const [selected, setSelected] = useState([]);
      const [pickerIds, setPickerIds] = useState(null);
      const requestRef = useRef(0);
      const kindRef = useRef(kind);
      kindRef.current = kind;

      const run = useCallback(async (offset, replace) => {
        const requestId = requestRef.current + 1;
        requestRef.current = requestId;
        const searchKind = kindRef.current;
        setLoading(true);
        setError('');
        try {
          const params = new URLSearchParams();
          if (query.trim() !== '') params.set('q', query.trim());
          params.set('kind', searchKind);
          params.set('offset', String(offset));
          params.set('limit', '20');
          const data = await apiFetch(`/search?${params.toString()}`);
          if (requestRef.current !== requestId) return;
          setItems((current) => (replace ? data.items || [] : current.concat(data.items || [])));
          setTotal(data.total || 0);
          setHasMore(Boolean(data.hasMore));
        } catch (caught) {
          if (requestRef.current !== requestId) return;
          setError(errorText(t, caught));
          if (replace) setItems([]);
        } finally {
          if (requestRef.current === requestId) setLoading(false);
        }
      }, [query, t]);

      useEffect(() => {
        requestRef.current += 1;
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setSelectionMode(false);
        setSelected([]);
        if (query.trim() === '') return undefined;
        const timer = setTimeout(() => {
          void run(0, true);
        }, 350);
        return () => clearTimeout(timer);
      }, [query, kind, run]);

      const submit = (event) => {
        event.preventDefault();
        if (query.trim() !== '') void run(0, true);
      };

      const playCollection = async (type, id) => {
        void claimDriver();
        try {
          await apiFetch('/player', {
            method: 'POST',
            body: { action: 'play', [type]: id, clientId, limit: 200 },
          });
        } catch (caught) {
          showError(t, caught);
        }
      };

      return h('div', { className: 'fnm-search' },
        h('form', { className: 'fnm-search-form', onSubmit: submit },
          h('div', { className: 'fnm-search-input' },
            h(Icon, { name: 'search', size: 16 }),
            h('input', {
              type: 'search',
              value: query,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchPlaceholder'),
              onChange: (event) => setQuery(event.target.value),
            }),
          ),
          h('select', {
            className: 'fnm-select',
            value: kind,
            'aria-label': t('kindTrack'),
            onChange: (event) => setKind(event.target.value),
          }, ['track', 'artist', 'album', 'playlist', 'folder'].map((value) => h('option', { value, key: value }, t(value === 'track' ? 'kindTrack' : value === 'artist' ? 'kindArtist' : value === 'album' ? 'kindAlbum' : value === 'playlist' ? 'kindPlaylist' : 'kindFolder')))),
        ),
        (kind === 'track' || kind === 'folder') && items.length > 0
          ? h('div', { className: 'fnm-select-bar' },
            h('button', { type: 'button', className: `fnm-btn fnm-btn-quiet${selectionMode ? ' is-on' : ''}`, onClick: () => { setSelectionMode(!selectionMode); setSelected([]); } }, t('select')),
            selectionMode ? h('span', { className: 'fnm-muted' }, format(t('selectedCount'), { count: selected.length })) : null,
            selectionMode ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setSelected(items.map((item) => item.id)) }, t('selectAll')) : null,
            selectionMode ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setSelected([]) }, t('clearSelection')) : null,
            selectionMode ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', onClick: () => {
              if (selected.length === 0) showToast(t('noTracksSelected'), 'info');
              else setPickerIds(selected);
            } }, t('addSelected')) : null,
          ) : null,
        query.trim() === '' && kind === 'track'
          ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'search', size: 28 }), h('div', { className: 'fnm-empty-title' }, t('searchHint')))
          : null,
        loading && items.length === 0 ? h('div', { className: 'fnm-loading' }, t('loading')) : null,
        error ? h('div', { className: 'fnm-inline-error' }, error) : null,
        items.length > 0
          ? h('div', { className: 'fnm-list' }, items.map((item, index) => {
            if (kind === 'track' || kind === 'folder') {
              return h(TrackRow, {
                key: `${item.id}-${index}`,
                t,
                track: item,
                showAdd: true,
                selectable: selectionMode,
                selected: selected.includes(item.id),
                onSelect: (track) => setSelected((current) => current.includes(track.id) ? current.filter((id) => id !== track.id) : current.concat(track.id)),
                onPlay: props.onPlayTrack,
                onAdd: (track) => void addToQueue(track),
                onLike: props.onToggleLike,
              });
            }
            if (kind === 'artist') {
              return h('div', { className: 'fnm-card-row', key: `${item.id}-${index}` },
                h('div', { className: 'fnm-card-main' }, h('div', { className: 'fnm-row-title' }, item.name), h('div', { className: 'fnm-row-sub' }, `${item.albumCount || 0} · ${item.trackCount || 0}`)),
              );
            }
            if (kind === 'album') {
              return h('div', { className: 'fnm-card-row', key: `${item.id}-${index}` },
                h(Cover, { coverId: item.coverId, size: 36, alt: '' }),
                h('div', { className: 'fnm-card-main' }, h('div', { className: 'fnm-row-title' }, item.title), h('div', { className: 'fnm-row-sub' }, `${item.artist}${item.year ? ` · ${item.year}` : ''}`)),
                h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => playCollection('albumId', item.id) }, t('playAll')),
              );
            }
            return h('div', { className: 'fnm-card-row', key: `${item.id}-${index}` },
              h(Cover, { coverId: item.coverId, size: 36, alt: '' }),
              h('div', { className: 'fnm-card-main' }, h('div', { className: 'fnm-row-title' }, item.title), h('div', { className: 'fnm-row-sub' }, `${item.trackCount || 0} ${t('tracks')}`)),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => playCollection('playlistId', item.id) }, t('playAll')),
            );
          }))
          : null,
        !loading && query.trim() !== '' && items.length === 0 && !error
          ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'search', size: 28 }), h('div', { className: 'fnm-empty-title' }, t('searchEmpty')))
          : null,
        hasMore ? h('button', { type: 'button', className: 'fnm-btn fnm-load-more', disabled: loading, onClick: () => void run(items.length, false) }, loading ? t('loading') : t('loadMore')) : null,
        pickerIds
          ? h(PlaylistPicker, {
            t,
            trackIds: pickerIds,
            onDone: () => { setPickerIds(null); setSelected([]); setSelectionMode(false); },
            onClose: () => setPickerIds(null),
          })
          : null,
      );
    }

    async function withConfirmToken(t, confirm, message, run) {
      // The UI confirmation is independent of the server-side switch: a
      // destructive click must always be confirmed in the panel. The server
      // token is then an additional single-use check when it is enabled.
      const ok = await confirm(message, { title: t('deleteConfirmTitle'), danger: true });
      if (!ok) return null;
      try {
        return await run({});
      } catch (error) {
        if (error && error.code === 'confirmation_required' && typeof error.confirmToken === 'string') {
          return await run({ confirmToken: error.confirmToken });
        }
        throw error;
      }
    }

    function PlaylistPicker(props) {
      const t = props.t;
      const dialog = useRef(null);
      const [playlists, setPlaylists] = useState([]);
      const [newName, setNewName] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const data = await apiFetch('/library/playlists?limit=100');
            if (!cancelled) setPlaylists(data.items || []);
          } catch (caught) {
            if (!cancelled) setError(errorText(t, caught));
          }
        })();
        if (dialog.current) {
          try {
            dialog.current.showModal();
          } catch {
            // Inline fallback.
          }
        }
        return () => {
          cancelled = true;
          if (dialog.current && dialog.current.open) {
            try {
              dialog.current.close();
            } catch {
              // Already closed.
            }
          }
        };
      }, [t]);

      const addChunks = async (playlistId) => {
        let added = 0;
        for (let index = 0; index < props.trackIds.length; index += 200) {
          const chunk = props.trackIds.slice(index, index + 200);
          const data = await apiFetch('/playlist/add', {
            method: 'POST',
            body: { playlistId, trackIds: chunk },
          });
          added += data.added || chunk.length;
        }
        showToast(format(t('tracksAdded'), { count: added }), 'info');
      };

      const add = async (playlist) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await addChunks(playlist.id);
          props.onDone();
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setBusy(false);
        }
      };

      const createAndAdd = async (event) => {
        event.preventDefault();
        if (newName.trim() === '' || busy) return;
        setBusy(true);
        setError('');
        try {
          const created = await apiFetch('/playlist/create', { method: 'POST', body: { name: newName.trim() } });
          await addChunks(created.playlist.id);
          props.onDone();
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setBusy(false);
        }
      };

      return h('dialog', {
        ref: dialog,
        className: 'fnm-dialog fnm-picker',
        'aria-labelledby': 'fnm-picker-title',
        onCancel: (event) => {
          event.preventDefault();
          props.onClose();
        },
        onClick: (event) => {
          if (event.target === dialog.current) props.onClose();
        },
      },
      h('div', { className: 'fnm-dialog-body' },
        h('div', { className: 'fnm-dialog-title', id: 'fnm-picker-title' }, t('choosePlaylist')),
        h('div', { className: 'fnm-muted' }, format(t('selectedCount'), { count: props.trackIds.length })),
        h('div', { className: 'fnm-picker-list' },
          playlists.length === 0
            ? h('div', { className: 'fnm-muted fnm-picker-empty' }, t('noPlaylistsHint'))
            : playlists.map((playlist) => h('button', {
              key: playlist.id,
              type: 'button',
              className: 'fnm-card-row fnm-picker-row',
              disabled: busy,
              onClick: () => void add(playlist),
            },
            h(Cover, { coverId: playlist.coverId, size: 30, alt: '' }),
            h('div', { className: 'fnm-card-main' },
              h('div', { className: 'fnm-row-title' }, playlist.title),
              h('div', { className: 'fnm-row-sub' }, `${playlist.trackCount || 0} ${t('tracks')}`),
            ),
            h(Icon, { name: 'plus', size: 16 }),
            )),
        ),
        h('form', { className: 'fnm-inline-form', onSubmit: createAndAdd },
          h('input', { value: newName, onChange: (event) => setNewName(event.target.value), placeholder: t('playlistNamePlaceholder'), 'aria-label': t('newPlaylist') }),
          h('button', { type: 'submit', className: 'fnm-btn fnm-btn-primary', disabled: busy || newName.trim() === '' }, t('createPlaylist')),
        ),
        error ? h('div', { className: 'fnm-inline-error' }, error) : null,
        h('div', { className: 'fnm-dialog-actions' },
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: props.onClose }, t('cancel')),
        ),
      ));
    }

    function PlaylistsTab(props) {
      const t = props.t;
      const [view, setView] = useState({ mode: 'main' });
      const [playlists, setPlaylists] = useState([]);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [createOpen, setCreateOpen] = useState(false);
      const [createName, setCreateName] = useState('');
      const [renameOpen, setRenameOpen] = useState(false);
      const [renameName, setRenameName] = useState('');
      const [busy, setBusy] = useState(false);
      const [importing, setImporting] = useState(false);
      const [selectionMode, setSelectionMode] = useState(false);
      const [selected, setSelected] = useState([]);
      const fileRef = useRef(null);
      const openedInitial = useRef('');

      const loadMain = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const data = await apiFetch('/library/playlists?limit=100');
          setPlaylists(data.items || []);
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setLoading(false);
        }
      }, [t]);

      useEffect(() => {
        void loadMain();
      }, [loadMain]);

      const openFavorites = async () => {
        setLoading(true);
        setError('');
        setSelectionMode(false);
        setSelected([]);
        try {
          const data = await apiFetch('/favorites?limit=200');
          setView({ mode: 'favorites', items: data.items || [], total: data.total || 0 });
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setLoading(false);
        }
      };

      const openPlaylist = async (playlist, options) => {
        setLoading(true);
        setError('');
        setSelectionMode(false);
        setSelected([]);
        try {
          const data = await apiFetch(`/playlist?id=${encodeURIComponent(playlist.id)}`);
          setView({ mode: 'playlist', playlist, items: data.items || [], total: data.total || 0 });
          if (options && options.rename) {
            setRenameOpen(true);
            setRenameName(playlist.title);
          }
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setLoading(false);
        }
      };

      useEffect(() => {
        const initial = props.initialPlaylistId || '';
        if (initial === '' || openedInitial.current === initial || view.mode !== 'main' || playlists.length === 0) return;
        const found = playlists.find((playlist) => playlist.id === initial);
        if (found !== undefined) {
          openedInitial.current = initial;
          void openPlaylist(found);
        }
      }, [props.initialPlaylistId, playlists, view.mode]);

      const refreshDetail = async () => {
        if (view.mode !== 'playlist' || !view.playlist) return;
        const data = await apiFetch(`/playlist?id=${encodeURIComponent(view.playlist.id)}`);
        setView((current) => current.mode === 'playlist'
          ? { ...current, playlist: { ...current.playlist, trackCount: data.total || 0 }, items: data.items || [], total: data.total || 0 }
          : current);
      };

      const playAll = async (playlist) => {
        void claimDriver();
        try {
          await apiFetch('/player', { method: 'POST', body: { action: 'play', playlistId: playlist.id, clientId, limit: 200 } });
        } catch (caught) {
          showError(t, caught);
        }
      };

      const createPlaylist = async (event) => {
        event.preventDefault();
        if (createName.trim() === '') return;
        setBusy(true);
        setError('');
        try {
          const data = await apiFetch('/playlist/create', { method: 'POST', body: { name: createName.trim() } });
          setCreateOpen(false);
          setCreateName('');
          showToast(t('playlistCreated'), 'info');
          await loadMain();
          if (data.playlist) await openPlaylist(data.playlist);
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setBusy(false);
        }
      };

      const renamePlaylist = async (event) => {
        event.preventDefault();
        if (view.mode !== 'playlist' || !view.playlist || renameName.trim() === '') return;
        setBusy(true);
        setError('');
        try {
          await apiFetch('/playlist/edit', {
            method: 'POST',
            body: { playlistId: view.playlist.id, name: renameName.trim() },
          });
          setRenameOpen(false);
          setView((current) => current.mode === 'playlist' ? { ...current, playlist: { ...current.playlist, title: renameName.trim() } } : current);
          showToast(t('playlistRenamed'), 'info');
          await loadMain();
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setBusy(false);
        }
      };

      const deletePlaylist = async (playlist) => {
        setBusy(true);
        setError('');
        try {
          const result = await withConfirmToken(
            t,
            props.confirm,
            format(t('confirmDeletePlaylist'), { name: playlist.title }),
            (extra) => apiFetch('/playlist/delete', { method: 'POST', body: { playlistId: playlist.id, ...extra } }),
          );
          if (result === null) return;
          showToast(t('playlistDeleted'), 'info');
          if (view.mode === 'playlist' && view.playlist && view.playlist.id === playlist.id) setView({ mode: 'main' });
          await loadMain();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };

      const exportPlaylist = async (playlist, formatName) => {
        try {
          const query = new URLSearchParams({ id: playlist.id, format: formatName, name: playlist.title });
          const response = await fetch(`${API}/playlist/export?${query.toString()}`, { credentials: 'same-origin' });
          if (!response.ok) {
            let recorded;
            try {
              recorded = await response.json();
            } catch {
              recorded = null;
            }
            const error = new Error(recorded && recorded.error ? recorded.error.message : 'export failed');
            error.code = recorded && recorded.error ? recorded.error.code : 'protocol';
            error.hint = recorded && recorded.error ? recorded.error.hint : undefined;
            throw error;
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${playlist.title || 'playlist'}.${formatName === 'm3u8' ? 'm3u8' : 'json'}`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        } catch (caught) {
          showError(t, caught);
        }
      };

      const importFile = async (event) => {
        const input = event.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        setImporting(true);
        setError('');
        try {
          const text = await file.text();
          const data = await apiFetch('/playlist/import', {
            method: 'POST',
            body: { filename: file.name, text },
          });
          showToast(format(t('imported'), {
            added: data.added || 0,
            missing: Array.isArray(data.missing) ? data.missing.length : 0,
            failed: data.failed || 0,
          }), 'info');
          await loadMain();
          if (data.playlist) await openPlaylist(data.playlist);
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setImporting(false);
        }
      };

      const toggleSelected = (track) => {
        setSelected((current) => current.includes(track.id)
          ? current.filter((id) => id !== track.id)
          : current.concat(track.id));
      };

      const removeSelected = async () => {
        if (selected.length === 0) {
          showToast(t('noTracksSelected'), 'info');
          return;
        }
        if (view.mode !== 'playlist' || !view.playlist) return;
        const ok = await props.confirm(format(t('confirmRemoveTracks'), { count: selected.length }), { title: t('deleteConfirmTitle'), danger: true });
        if (!ok) return;
        setBusy(true);
        setError('');
        try {
          let removed = 0;
          for (let index = 0; index < selected.length; index += 200) {
            const chunk = selected.slice(index, index + 200);
            let result;
            try {
              result = await apiFetch('/playlist/remove', {
                method: 'POST',
                body: { playlistId: view.playlist.id, trackIds: chunk },
              });
            } catch (error) {
              if (!(error && error.code === 'confirmation_required' && typeof error.confirmToken === 'string')) throw error;
              result = await apiFetch('/playlist/remove', {
                method: 'POST',
                body: { playlistId: view.playlist.id, trackIds: chunk, confirmToken: error.confirmToken },
              });
            }
            removed += result.removed || chunk.length;
          }
          showToast(format(t('tracksRemoved'), { count: removed }), 'info');
          setSelected([]);
          setSelectionMode(false);
          await refreshDetail();
          await loadMain();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };

      const removeOne = async (track) => {
        if (view.mode !== 'playlist' || !view.playlist) return;
        try {
          await apiFetch('/playlist/remove', {
            method: 'POST',
            body: { playlistId: view.playlist.id, trackIds: [track.id] },
          });
          showToast(format(t('tracksRemoved'), { count: 1 }), 'info');
          await refreshDetail();
          await loadMain();
        } catch (caught) {
          showError(t, caught);
        }
      };

      if (view.mode !== 'main') {
        const playlist = view.playlist;
        const title = view.mode === 'favorites' ? t('favorites') : (playlist && playlist.title) || t('playlists');
        const isPlaylist = view.mode === 'playlist' && Boolean(playlist);
        return h('div', { className: 'fnm-list-wrap' },
          h('div', { className: 'fnm-list-head fnm-list-head-wrap' },
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => { setView({ mode: 'main' }); setRenameOpen(false); setSelectionMode(false); } }, h(Icon, { name: 'arrowLeft', size: 14 }), t('back')),
            isPlaylist ? h('div', { className: 'fnm-head-actions' },
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void playAll(playlist) }, h(Icon, { name: 'play', size: 14 }), t('playAll')),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', title: t('exportJson'), 'aria-label': t('exportJson'), onClick: () => void exportPlaylist(playlist, 'json') }, h(Icon, { name: 'download', size: 14 })),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', title: t('exportM3u8'), 'aria-label': t('exportM3u8'), onClick: () => void exportPlaylist(playlist, 'm3u8') }, h(Icon, { name: 'download', size: 14 })),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => { setRenameOpen(true); setRenameName(playlist.title); } }, t('renamePlaylist')),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-danger', onClick: () => void deletePlaylist(playlist) }, h(Icon, { name: 'trash', size: 14 })),
            ) : null,
          ),
          h('div', { className: 'fnm-detail-title' }, title, h('span', { className: 'fnm-muted' }, ` · ${view.total || view.items.length} ${t('tracks')}`)),
          isPlaylist && renameOpen
            ? h('form', { className: 'fnm-inline-form', onSubmit: renamePlaylist },
              h('input', { value: renameName, onChange: (event) => setRenameName(event.target.value), placeholder: t('renameHint'), 'aria-label': t('renamePlaylist') }),
              h('button', { type: 'submit', className: 'fnm-btn fnm-btn-primary', disabled: busy || renameName.trim() === '' }, t('save')),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setRenameOpen(false) }, t('cancel')),
            ) : null,
          isPlaylist && view.items.length > 0
            ? h('div', { className: 'fnm-select-bar' },
              h('button', { type: 'button', className: `fnm-btn fnm-btn-quiet${selectionMode ? ' is-on' : ''}`, onClick: () => { setSelectionMode(!selectionMode); setSelected([]); } }, t('select')),
              selectionMode ? h('span', { className: 'fnm-muted' }, format(t('selectedCount'), { count: selected.length })) : null,
              selectionMode ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setSelected(view.items.map((track) => track.id)) }, t('selectAll')) : null,
              selectionMode ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setSelected([]) }, t('clearSelection')) : null,
              selectionMode ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-danger', disabled: busy || selected.length === 0, onClick: () => void removeSelected() }, t('removeSelected')) : null,
            ) : null,
          error ? h('div', { className: 'fnm-inline-error' }, error) : null,
          view.items.length === 0
            ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'playlist', size: 28 }), h('div', { className: 'fnm-empty-title' }, view.mode === 'favorites' ? t('favoritesEmpty') : t('playlistEmpty')))
            : h('div', { className: 'fnm-list' }, view.items.map((track, index) => h(TrackRow, {
              key: `${track.id}-${index}`,
              t,
              track,
              selectable: isPlaylist && selectionMode,
              selected: selected.includes(track.id),
              onSelect: toggleSelected,
              showAdd: true,
              onPlay: props.onPlayTrack,
              onAdd: (item) => void addToQueue(item),
              onLike: props.onToggleLike,
              onRemove: isPlaylist ? (item) => void removeOne(item) : null,
            }))),
        );
      }

      return h('div', { className: 'fnm-list-wrap' },
        h('div', { className: 'fnm-list-head fnm-list-head-wrap' },
          h('div', null, t('playlists')),
          h('div', { className: 'fnm-head-actions' },
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setCreateOpen(!createOpen) }, h(Icon, { name: 'plus', size: 14 }), t('newPlaylist')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: importing, onClick: () => fileRef.current && fileRef.current.click() }, h(Icon, { name: 'upload', size: 14 }), importing ? t('importing') : t('importPlaylist')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', title: t('refresh'), 'aria-label': t('refresh'), onClick: () => void loadMain() }, h(Icon, { name: 'refresh', size: 14 })),
          ),
        ),
        h('input', { ref: fileRef, type: 'file', accept: '.json,.m3u,.m3u8,application/json,audio/x-mpegurl', className: 'fnm-hidden-input', onChange: importFile, 'aria-hidden': true, tabIndex: -1 }),
        createOpen
          ? h('form', { className: 'fnm-inline-form', onSubmit: createPlaylist },
            h('input', { value: createName, onChange: (event) => setCreateName(event.target.value), placeholder: t('playlistNamePlaceholder'), 'aria-label': t('playlistName') }),
            h('button', { type: 'submit', className: 'fnm-btn fnm-btn-primary', disabled: busy || createName.trim() === '' }, t('createPlaylist')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setCreateOpen(false) }, t('cancel')),
          ) : null,
        error ? h('div', { className: 'fnm-inline-error' }, error) : null,
        h('button', { type: 'button', className: 'fnm-card-row fnm-favorites-card', onClick: () => void openFavorites() },
          h('span', { className: 'fnm-favorites-icon' }, h(Icon, { name: 'heart', size: 20 })),
          h('div', { className: 'fnm-card-main' }, h('div', { className: 'fnm-row-title' }, t('favorites')), h('div', { className: 'fnm-row-sub' }, t('like'))),
          h(Icon, { name: 'chevron', size: 16 }),
        ),
        h('div', { className: 'fnm-section-label' }, t('userPlaylists')),
        loading ? h('div', { className: 'fnm-loading' }, t('loading')) : null,
        playlists.length === 0 && !loading
          ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'playlist', size: 28 }), h('div', { className: 'fnm-empty-title' }, t('noPlaylists')))
          : h('div', { className: 'fnm-card-list' }, playlists.map((playlist) => h('div', { className: 'fnm-card-row fnm-playlist-row', key: playlist.id },
            h('button', { type: 'button', className: 'fnm-card-open', onClick: () => void openPlaylist(playlist) },
              h(Cover, { coverId: playlist.coverId, size: 36, alt: '' }),
              h('div', { className: 'fnm-card-main' }, h('div', { className: 'fnm-row-title' }, playlist.title), h('div', { className: 'fnm-row-sub' }, `${playlist.trackCount || 0} ${t('tracks')}`)),
              h(Icon, { name: 'chevron', size: 16 }),
            ),
            h('div', { className: 'fnm-row-actions' },
              h('button', { type: 'button', className: 'fnm-icon-btn', title: t('renamePlaylist'), 'aria-label': t('renamePlaylist'), onClick: () => void openPlaylist(playlist, { rename: true }) }, h(Icon, { name: 'settings', size: 15 })),
              h('button', { type: 'button', className: 'fnm-icon-btn', title: t('exportJson'), 'aria-label': t('exportJson'), onClick: () => void exportPlaylist(playlist, 'json') }, h(Icon, { name: 'download', size: 15 })),
              h('button', { type: 'button', className: 'fnm-icon-btn fnm-danger', title: t('deletePlaylist'), 'aria-label': t('deletePlaylist'), onClick: () => void deletePlaylist(playlist) }, h(Icon, { name: 'trash', size: 15 })),
            ),
          ))),
      );
    }

    /* ------------------------------------------------------------------ *
     * Settings
     * ------------------------------------------------------------------ */

    function DeviceForm(props) {
      const t = props.t;
      const editing = props.device || null;
      const [name, setName] = useState(editing ? editing.name : '');
      const [mode, setMode] = useState(editing ? editing.mode : 'direct');
      const [fnid, setFnid] = useState(editing && editing.fnid ? editing.fnid : '');
      const [address, setAddress] = useState(editing && editing.address ? editing.address : '');
      const [token, setToken] = useState('');
      const [username, setUsername] = useState('');
      const [password, setPassword] = useState('');
      const [allowSelfSigned, setAllowSelfSigned] = useState(editing ? Boolean(editing.allowSelfSigned) : false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      const save = async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const body = {
            ...(editing ? { id: editing.id } : {}),
            name: name.trim(),
            mode,
            ...(mode === 'fnid' || mode === 'auto' ? { fnid: fnid.trim() } : {}),
            ...(mode === 'direct' || mode === 'auto' ? { address: address.trim() } : {}),
            ...(token.trim() !== '' ? { token: token.trim() } : {}),
            allowSelfSigned: mode === 'direct' || mode === 'auto' ? allowSelfSigned : false,
          };
          if (username.trim() !== '' || password !== '') {
            if (username.trim() === '' || password === '') throw Object.assign(new Error('account and password are required'), { code: 'bad_request' });
            await apiFetch('/devices/login', { method: 'POST', body: { ...body, username: username.trim(), password } });
          } else {
            if (!editing && token.trim() === '') throw Object.assign(new Error('token is required'), { code: 'bad_request' });
            await apiFetch('/devices', { method: 'POST', body });
          }
          setToken('');
          setPassword('');
          props.onSaved();
        } catch (caught) {
          setError(errorText(t, caught));
        } finally {
          setBusy(false);
        }
      };

      return h('form', { className: 'fnm-form', onSubmit: save },
        h('div', { className: 'fnm-form-title' }, editing ? t('edit') : t('addDevice')),
        h('label', { className: 'fnm-field' }, h('span', null, t('deviceName')),
          h('input', { value: name, onChange: (event) => setName(event.target.value), placeholder: 'My NAS' })),
        h('label', { className: 'fnm-field' }, h('span', null, t('mode')),
          h('select', { value: mode, onChange: (event) => setMode(event.target.value) },
            h('option', { value: 'direct' }, t('modeDirect')),
            h('option', { value: 'fnid' }, t('modeFnid')),
            h('option', { value: 'auto' }, t('modeAuto')),
          )),
        mode === 'fnid' || mode === 'auto'
          ? h('label', { className: 'fnm-field' }, h('span', null, t('fnid')),
            h('input', { value: fnid, onChange: (event) => setFnid(event.target.value), placeholder: 'mynas', autoCapitalize: 'none', spellCheck: false }),
            h('small', { className: 'fnm-help' }, mode === 'auto' ? t('modeAutoHint') : t('fnidHint')))
          : null,
        mode === 'direct' || mode === 'auto'
          ? h('label', { className: 'fnm-field' }, h('span', null, t('address')),
            h('input', { value: address, onChange: (event) => setAddress(event.target.value), placeholder: '192.168.1.10', autoCapitalize: 'none', spellCheck: false }),
            h('small', { className: 'fnm-help' }, t('addressHint')))
          : null,
        (mode === 'direct' || mode === 'auto') && address.trim() !== '' && !address.trim().startsWith('unix://') && !address.trim().startsWith('/')
          ? h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: allowSelfSigned, onChange: (event) => setAllowSelfSigned(event.target.checked) }),
            h('span', null, t('allowSelfSigned')),
            h('small', { className: 'fnm-help' }, t('allowSelfSignedHint')))
          : null,
        h('label', { className: 'fnm-field' }, h('span', null, t('token')),
          h('input', { type: 'password', value: token, onChange: (event) => setToken(event.target.value), placeholder: editing && editing.tokenSet ? t('tokenHint') : t('tokenPlaceholder'), autoComplete: 'off' }),
          editing && editing.tokenSet ? h('small', { className: 'fnm-help' }, t('tokenHint')) : null),
        h('div', { className: 'fnm-or' }, t('loginHint')),
        h('div', { className: 'fnm-form-grid' },
          h('label', { className: 'fnm-field' }, h('span', null, t('loginUser')),
            h('input', { value: username, onChange: (event) => setUsername(event.target.value), autoComplete: 'username' })),
          h('label', { className: 'fnm-field' }, h('span', null, t('loginPass')),
            h('input', { type: 'password', value: password, onChange: (event) => setPassword(event.target.value), autoComplete: 'current-password' })),
        ),
        error ? h('div', { className: 'fnm-inline-error' }, error) : null,
        h('div', { className: 'fnm-form-actions' },
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: props.onCancel, disabled: busy }, t('cancel')),
          h('button', { type: 'submit', className: 'fnm-btn fnm-btn-primary', disabled: busy }, busy ? t('loading') : t('save')),
        ),
      );
    }

    function SettingsTab(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const [form, setForm] = useState(null);
      const [draft, setDraft] = useState(snapshot.settings);
      const [logs, setLogs] = useState([]);
      const [busy, setBusy] = useState(false);
      const [saved, setSaved] = useState('');
      const autoOpened = useRef(false);
      useEffect(() => setDraft(snapshot.settings), [snapshot.settings]);
      useEffect(() => {
        if (snapshot.devices.length === 0 && form === null && !autoOpened.current) {
          autoOpened.current = true;
          setForm({ device: null });
        }
      }, [snapshot.devices.length, form]);

      const switchDevice = async (device) => {
        try {
          await apiFetch('/devices/switch', { method: 'POST', body: { id: device.id } });
          showToast(device.name, 'info');
        } catch (caught) {
          showError(t, caught);
        }
      };
      const probeDevice = async (device) => {
        try {
          await apiFetch('/devices/probe', { method: 'POST', body: { id: device.id } });
          await refreshState();
        } catch (caught) {
          showError(t, caught);
        }
      };
      const removeDevice = async (device) => {
        const ok = await props.confirm(format(t('confirmDeleteDevice'), { name: device.name }));
        if (!ok) return;
        try {
          await apiFetch('/devices/remove', { method: 'POST', body: { id: device.id } });
          if (form && form.device && form.device.id === device.id) setForm(null);
        } catch (caught) {
          showError(t, caught);
        }
      };
      const saveSettings = async () => {
        setBusy(true);
        setSaved('');
        try {
          await apiFetch('/settings', { method: 'POST', body: draft });
          setSaved(t('settingsSaved'));
          setTimeout(() => setSaved(''), 2500);
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };
      const clearCache = async () => {
        const ok = await props.confirm(t('confirmClearCache'));
        if (!ok) return;
        try {
          await apiFetch('/cache/clear', { method: 'POST' });
          showToast(t('clearCache'), 'info');
        } catch (caught) {
          showError(t, caught);
        }
      };
      const reset = async () => {
        const ok = await props.confirm(t('confirmReset'));
        if (!ok) return;
        try {
          await apiFetch('/reset', { method: 'POST' });
          setForm(null);
        } catch (caught) {
          showError(t, caught);
        }
      };
      const loadLogs = async () => {
        try {
          const data = await apiFetch('/logs?limit=80');
          setLogs(data.entries || []);
        } catch (caught) {
          showError(t, caught);
        }
      };
      const clearLogs = async () => {
        try {
          await apiFetch('/logs/clear', { method: 'POST' });
          setLogs([]);
        } catch (caught) {
          showError(t, caught);
        }
      };
      const openWeb = () => {
        const active = snapshot.devices.find((device) => device.id === snapshot.activeDeviceId);
        if (active && active.webUrl) window.open(active.webUrl, '_blank', 'noopener,noreferrer');
        else showToast(t('noWebUrl'), 'info');
      };

      const layers = snapshot.connection.layers;
      return h('div', { className: 'fnm-settings' },
        h('div', { className: 'fnm-settings-section' },
          h('div', { className: 'fnm-section-head' }, h('span', null, t('devices')), h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setForm({ device: null }) }, h(Icon, { name: 'plus', size: 14 }), t('addDevice'))),
          h('div', { className: 'fnm-layers', title: t('lastChecked') },
            ['gateway', 'device', 'service'].map((key) => {
              const layer = layers[key];
              const phase = layer.code === 'auth' ? 'auth' : layer.ok ? 'online' : 'offline';
              return h('span', { className: 'fnm-layer', key },
                h(StatusDot, { phase }),
                t(key),
                layer.latencyMs > 0 ? ` ${Math.round(layer.latencyMs)} ms` : '',
              );
            }),
          ),
          snapshot.devices.length === 0
            ? h('div', { className: 'fnm-empty fnm-empty-small' }, h(Icon, { name: 'device', size: 24 }), h('div', { className: 'fnm-empty-title' }, t('noDevice')), h('div', { className: 'fnm-muted' }, t('noDeviceHint')))
            : h('div', { className: 'fnm-device-list' }, snapshot.devices.map((device) => {
              const active = device.id === snapshot.activeDeviceId;
              const status = active ? snapshot.connection : device.last;
              return h('div', { key: device.id, className: `fnm-device${active ? ' is-active' : ''}` },
                h('div', { className: 'fnm-device-main' },
                  h('div', { className: 'fnm-device-title' }, device.name, active ? h('span', { className: 'fnm-pill' }, t('active')) : null),
                  h('div', { className: 'fnm-row-sub' }, `${modeLabel(t, device.transport)}${status && status.via ? ` · ${viaLabel(t, status.via)}` : ''}${device.accountName ? ` · ${device.accountName}` : ''}${device.tokenSet ? ` · ${t('tokenSet')}` : ''}`),
                  status ? h('div', { className: 'fnm-device-status' }, h(StatusDot, { phase: status.phase }), h('span', null, status.phase === 'online' ? t('online') : status.phase === 'auth' ? t('auth') : status.phase === 'service-missing' ? t('serviceMissing') : status.phase === 'probing' ? t('probing') : t('offline'))) : null,
                ),
                h('div', { className: 'fnm-device-actions' },
                  active ? null : h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void switchDevice(device) }, t('switch')),
                  h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void probeDevice(device) }, t('probe')),
                  h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => setForm({ device }) }, t('edit')),
                  h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-danger', title: t('removeDevice'), 'aria-label': t('removeDevice'), onClick: () => void removeDevice(device) }, h(Icon, { name: 'trash', size: 14 })),
                ),
              );
            })),
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: openWeb }, h(Icon, { name: 'wifi', size: 14 }), t('openWeb')),
          form ? h(DeviceForm, { key: form.device ? form.device.id : 'new-device', t, device: form.device, onSaved: () => setForm(null), onCancel: () => setForm(null) }) : null,
        ),
        h('div', { className: 'fnm-settings-section' },
          h('div', { className: 'fnm-section-head' }, h('span', null, t('settingsTitle'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.confirmHighRisk), onChange: (event) => setDraft({ ...draft, confirmHighRisk: event.target.checked }) }),
            h('span', null, t('confirmHighRisk')),
            h('small', { className: 'fnm-help' }, t('confirmHighRiskHint'))),
          h('div', { className: 'fnm-form-grid' },
            h('label', { className: 'fnm-field' }, h('span', null, t('cacheLimit')),
              h('input', { type: 'number', min: 0, max: 4096, value: draft.cacheLimitMb, onChange: (event) => setDraft({ ...draft, cacheLimitMb: Number(event.target.value) }) })),
            h('label', { className: 'fnm-field' }, h('span', null, t('probeInterval')),
              h('input', { type: 'number', min: 10, max: 300, value: draft.probeIntervalSec, onChange: (event) => setDraft({ ...draft, probeIntervalSec: Number(event.target.value) }) })),
          ),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.logsEnabled), onChange: (event) => setDraft({ ...draft, logsEnabled: event.target.checked }) }),
            h('span', null, t('logs'))),
          h('div', { className: 'fnm-section-label' }, t('compatBackend')),
          h('div', { className: 'fnm-help' }, snapshot.compat && snapshot.compat.backend === 'ffmpeg' ? t('compatFfmpeg') : t('compatMse')),
          h('small', { className: 'fnm-help' }, t('compatHint')),
          h('div', { className: 'fnm-section-label' }, t('playbackSettings')),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.floatingPlayer), onChange: (event) => setDraft({ ...draft, floatingPlayer: event.target.checked }) }),
            h('span', null, t('floatingPlayer')),
            h('small', { className: 'fnm-help' }, t('floatingPlayerHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.immersiveCover), onChange: (event) => setDraft({ ...draft, immersiveCover: event.target.checked }) }),
            h('span', null, t('immersiveCover')),
            h('small', { className: 'fnm-help' }, t('immersiveCoverHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.spectrum), onChange: (event) => setDraft({ ...draft, spectrum: event.target.checked }) }),
            h('span', null, t('spectrum')),
            h('small', { className: 'fnm-help' }, t('spectrumHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.shortcuts), onChange: (event) => setDraft({ ...draft, shortcuts: event.target.checked }) }),
            h('span', null, t('shortcuts')),
            h('small', { className: 'fnm-help' }, t('shortcutsHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.autoDj), onChange: (event) => setDraft({ ...draft, autoDj: event.target.checked }) }),
            h('span', null, t('autoDj')),
            h('small', { className: 'fnm-help' }, t('autoDjHint'))),
          h('div', { className: 'fnm-section-label' }, t('localData')),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.historyEnabled), onChange: (event) => setDraft({ ...draft, historyEnabled: event.target.checked }) }),
            h('span', null, t('historyEnabled')),
            h('small', { className: 'fnm-help' }, t('historyEnabledHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.voiceEnabled), onChange: (event) => setDraft({ ...draft, voiceEnabled: event.target.checked }) }),
            h('span', null, t('voice')),
            h('small', { className: 'fnm-help' }, t('voiceHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.agentWrites), onChange: (event) => setDraft({ ...draft, agentWrites: event.target.checked }) }),
            h('span', null, t('agentWrites')),
            h('small', { className: 'fnm-help' }, t('agentWritesHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.trafficStats), onChange: (event) => setDraft({ ...draft, trafficStats: event.target.checked }) }),
            h('span', null, t('trafficStats')),
            h('small', { className: 'fnm-help' }, t('trafficStatsHint'))),
          h('label', { className: 'fnm-check' },
            h('input', { type: 'checkbox', checked: Boolean(draft.backgroundProbe), onChange: (event) => setDraft({ ...draft, backgroundProbe: event.target.checked }) }),
            h('span', null, t('backgroundProbe')),
            h('small', { className: 'fnm-help' }, t('backgroundProbeHint'))),
          draft.backgroundProbe
            ? h('label', { className: 'fnm-field' }, h('span', null, t('backgroundProbeInterval')),
              h('input', { type: 'number', min: 60, max: 600, value: draft.backgroundProbeIntervalSec, onChange: (event) => setDraft({ ...draft, backgroundProbeIntervalSec: Number(event.target.value) }) }))
            : null,
          h('div', { className: 'fnm-form-actions' },
            h('span', { className: 'fnm-muted' }, saved),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', disabled: busy, onClick: () => void saveSettings() }, busy ? t('loading') : t('save')),
          ),
        ),
        h('div', { className: 'fnm-settings-section' },
          h('div', { className: 'fnm-section-head' }, h('span', null, t('clearCache')), h('span', { className: 'fnm-muted' }, format(t('cacheInfo'), { covers: snapshot.cache.covers, lyrics: snapshot.cache.lyrics, size: formatBytes(snapshot.cache.bytes) }))),
          h('div', { className: 'fnm-form-actions' },
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void clearCache() }, t('clearCache')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void loadLogs() }, t('logs')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void clearLogs() }, t('clearLogs')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-danger', onClick: () => void reset() }, t('reset')),
          ),
          h('small', { className: 'fnm-help' }, t('resetHint')),
          logs.length > 0
            ? h('div', { className: 'fnm-logs' }, logs.map((entry, index) => h('div', { className: 'fnm-log', key: `${entry.at}-${index}` },
              h('span', { className: 'fnm-log-time' }, new Date(entry.at).toLocaleTimeString()),
              h('span', { className: `fnm-log-kind fnm-log-${entry.kind}` }, entry.kind),
              h('span', { className: 'fnm-log-text' }, `${entry.method || ''} ${entry.path || ''} ${entry.status || ''} ${entry.title || entry.message || ''}`.trim()),
            )))
            : null,
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Confirm dialog
     * ------------------------------------------------------------------ */

    const ConfirmContext = createContext(null);
    function useConfirm() {
      return useContext(ConfirmContext);
    }

    function ConfirmProvider(props) {
      const t = props.t;
      const [request, setRequest] = useState(null);
      const resolver = useRef(null);
      const dialog = useRef(null);
      const confirm = useCallback((message, options) => new Promise((resolve) => {
        resolver.current = resolve;
        setRequest({ message, title: (options && options.title) || t('yes'), danger: Boolean(options && options.danger) });
      }), [t]);
      useEffect(() => {
        if (request && dialog.current) {
          try {
            dialog.current.showModal();
          } catch {
            // Older browsers without dialog support fall back to the inline buttons.
          }
        }
        if (!request && dialog.current && dialog.current.open) {
          try {
            dialog.current.close();
          } catch {
            // Nothing to close.
          }
        }
      }, [request]);
      const finish = (value) => {
        setRequest(null);
        const resolve = resolver.current;
        resolver.current = null;
        if (resolve) resolve(value);
      };
      return h(ConfirmContext.Provider, { value: confirm },
        props.children,
        h('dialog', {
          ref: dialog,
          className: 'fnm-dialog',
          'aria-labelledby': 'fnm-confirm-title',
          onCancel: (event) => {
            event.preventDefault();
            finish(false);
          },
          onClick: (event) => {
            if (event.target === dialog.current) finish(false);
          },
        }, request ? h('div', { className: 'fnm-dialog-body' },
          h('div', { className: 'fnm-dialog-title', id: 'fnm-confirm-title' }, request.title),
          h('div', { className: 'fnm-dialog-message' }, request.message),
          h('div', { className: 'fnm-dialog-actions' },
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => finish(false) }, t('no')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary fnm-btn-danger', onClick: () => finish(true) }, t('yes')),
          ),
        ) : null),
      );
    }

    /* ------------------------------------------------------------------ *
     * Panel shell
     * ------------------------------------------------------------------ */

    function PanelInner(props) {
      const t = props.t;
      const confirm = useConfirm();
      const snapshot = useStoreValue((value) => value.snapshot);
      const [tab, setTab] = useState('queue');
      const toast = useStoreValue((value) => value.toast);
      const loadError = useStoreValue((value) => value.loadError);

      useEffect(() => {
        if (snapshot && snapshot.devices.length === 0 && tab === 'queue') setTab('settings');
      }, [snapshot, tab]);

      if (!snapshot) {
        if (loadError) {
          return h('div', { className: 'fnm-panel fnm-loading-panel' },
            h(Icon, { name: 'warning', size: 30 }),
            h('div', { className: 'fnm-empty-title' }, t('errorGeneric')),
            h('div', { className: 'fnm-muted fnm-load-error' }, loadError),
            h('button', {
              type: 'button',
              className: 'fnm-btn fnm-btn-primary',
              onClick: () => {
                setStore({ loadError: '' });
                void refreshState();
              },
            }, t('retry')),
          );
        }
        return h('div', { className: 'fnm-panel fnm-loading-panel' }, h(Icon, { name: 'music', size: 32 }), h('div', null, t('loading')));
      }

      const active = snapshot.devices.find((device) => device.id === snapshot.activeDeviceId);
      const connection = snapshot.connection;
      const openWeb = () => {
        if (active && active.webUrl) window.open(active.webUrl, '_blank', 'noopener,noreferrer');
        else showToast(t('noWebUrl'), 'info');
      };

      return h('div', { className: 'fnm-panel' },
        h('header', { className: 'fnm-header' },
          h('div', { className: 'fnm-brand' },
            h('span', { className: 'fnm-brand-icon' }, h(Icon, { name: 'music', size: 18 })),
            h('div', null,
              h('div', { className: 'fnm-title' }, t('panel')),
              h('div', { className: 'fnm-subtitle' }, active ? `${active.name} · ${modeLabel(t, active.transport)}` : t('subtitle')),
            ),
          ),
          h('div', { className: 'fnm-header-actions' },
            h(ConnectionLabel, { t, connection }),
            active && active.webUrl ? h('button', { type: 'button', className: 'fnm-icon-btn', title: t('openWeb'), 'aria-label': t('openWeb'), onClick: openWeb }, h(Icon, { name: 'wifi', size: 16 })) : null,
            h('button', { type: 'button', className: 'fnm-icon-btn', title: t('refresh'), 'aria-label': t('refresh'), onClick: () => void refreshState() }, h(Icon, { name: 'refresh', size: 16 })),
          ),
        ),
        h(PlayerBar, {
          t,
          snapshot,
          onPlayPause: () => void togglePlay(),
          onSkip: (delta) => void skip(delta),
          onSeek: (positionMs) => void seekTo(positionMs),
          onLike: (track) => void toggleFavorite(track),
          onVolume: (volume) => void changeVolume(volume),
          onMute: () => void toggleMute(),
          onMode: () => void cycleMode(),
          onClaim: () => void claimDriver().then(() => syncAudio()),
        }),
        h('div', { className: 'fnm-tabs', role: 'tablist', 'aria-label': t('panel') },
          [['queue', 'queue'], ['search', 'search'], ['playlists', 'playlists'], ['settings', 'settings']].map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            role: 'tab',
            id: `fnm-tab-${id}`,
            'aria-selected': tab === id,
            'aria-controls': `fnm-panel-${id}`,
            className: `fnm-tab${tab === id ? ' is-active' : ''}`,
            onClick: () => setTab(id),
          }, h(Icon, { name: id === 'queue' ? 'queue' : id === 'search' ? 'search' : id === 'playlists' ? 'playlist' : 'settings', size: 15 }), t(label))),
        ),
        h('div', {
          className: 'fnm-content',
          role: 'tabpanel',
          id: `fnm-panel-${tab}`,
          'aria-labelledby': `fnm-tab-${tab}`,
        },
          tab === 'queue' ? h(QueueTab, {
            t,
            snapshot,
            confirm,
            onPlayTrack: (track) => void playTrackNow(track),
            onPlayQueueTrack: (track) => void playQueueTrack(track),
            onToggleLike: (track) => void toggleFavorite(track),
          }) : null,
          tab === 'search' ? h(SearchTab, {
            t,
            onPlayTrack: (track) => void openTrack(track),
            onToggleLike: (track) => void toggleFavorite(track),
          }) : null,
          tab === 'playlists' ? h(PlaylistsTab, {
            t,
            confirm,
            onPlayTrack: (track) => void openTrack(track),
            onToggleLike: (track) => void toggleFavorite(track),
          }) : null,
          tab === 'settings' ? h(SettingsTab, { t, snapshot, confirm }) : null,
        ),
        toast ? h('div', { className: `fnm-toast fnm-toast-${toast.kind}` }, toast.text) : null,
      );
    }

    /* ------------------------------------------------------------------ *
     * V3 original-web application shell
     * ------------------------------------------------------------------ */

    function useApiData(path, deps, t) {
      const [state, setState] = useState({ loading: true, data: null, error: '' });
      useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        setState((previous) => ({ loading: true, data: previous.data, error: '' }));
        apiFetch(path, { signal: controller.signal })
          .then((data) => {
            if (!cancelled) setState({ loading: false, data, error: '' });
          })
          .catch((caught) => {
            if (cancelled || (caught && caught.code === 'cancelled')) return;
            setState({ loading: false, data: null, error: errorText(t, caught) });
          });
        return () => {
          cancelled = true;
          controller.abort();
        };
      }, [path, ...(Array.isArray(deps) ? deps : [])]);
      return state;
    }

    function usePagedApi(path, params, t) {
      const key = JSON.stringify(params || {});
      const [state, setState] = useState({ items: [], total: 0, loading: true, loadingMore: false, error: '', hasMore: false });
      const offsetRef = useRef(0);
      const busyRef = useRef(false);
      const controllerRef = useRef(null);

      const load = useCallback(async (reset) => {
        if (busyRef.current) return;
        busyRef.current = true;
        const controller = new AbortController();
        controllerRef.current = controller;
        const offset = reset ? 0 : offsetRef.current;
        const query = new URLSearchParams({ offset: String(offset), limit: '50' });
        for (const [name, value] of Object.entries(params || {})) {
          if (value !== undefined && value !== null && String(value) !== '') query.set(name, String(value));
        }
        if (reset) setState((previous) => ({ ...previous, loading: true, error: '', items: [], hasMore: false }));
        else setState((previous) => ({ ...previous, loadingMore: true, error: '' }));
        try {
          const separator = path.includes('?') ? '&' : '?';
          const data = await apiFetch(`${path}${separator}${query.toString()}`, { signal: controller.signal });
          const items = Array.isArray(data.items) ? data.items : [];
          const total = Number(data.total) || 0;
          offsetRef.current = offset + items.length;
          const hasMore = data.hasMore === true || offset + items.length < total;
          setState((previous) => ({
            items: reset ? items : [...previous.items, ...items],
            total,
            loading: false,
            loadingMore: false,
            error: '',
            hasMore,
          }));
        } catch (caught) {
          if (caught && caught.code === 'cancelled') return;
          setState((previous) => ({ ...previous, loading: false, loadingMore: false, error: errorText(t, caught) }));
        } finally {
          busyRef.current = false;
          if (controllerRef.current === controller) controllerRef.current = null;
        }
      }, [path, key, t]);

      useEffect(() => {
        offsetRef.current = 0;
        setState({ items: [], total: 0, loading: true, loadingMore: false, error: '', hasMore: false });
        void load(true);
        return () => {
          controllerRef.current?.abort();
          busyRef.current = false;
        };
      }, [load]);

      return {
        ...state,
        loadMore: () => void load(false),
        refresh: () => void load(true),
      };
    }

    function useSelection() {
      const [selected, setSelected] = useState(() => new Set());
      const last = useRef({ index: -1, ids: [] });

      const toggle = useCallback((id, index, event, ids) => {
        const next = new Set(selected);
        const shift = Boolean(event && event.shiftKey);
        const meta = Boolean(event && (event.metaKey || event.ctrlKey));
        if (shift && last.current.index >= 0 && ids.length > 0) {
          const from = Math.min(last.current.index, index);
          const to = Math.max(last.current.index, index);
          for (let cursor = from; cursor <= to; cursor += 1) {
            if (ids[cursor] !== undefined) next.add(ids[cursor]);
          }
        } else if (meta || event?.target?.type === 'checkbox') {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        last.current = { index, ids };
        setSelected(next);
      }, [selected]);

      const selectAll = useCallback((ids) => {
        setSelected(new Set(ids));
      }, []);
      const clear = useCallback(() => setSelected(new Set()), []);
      return { selected, toggle, selectAll, clear, ids: [...selected] };
    }

    function historyToTrack(entry) {
      return {
        id: entry.trackId,
        title: entry.title,
        artist: entry.artist,
        album: entry.album,
        albumId: entry.albumId || '',
        year: 0,
        durationSec: entry.durationSec,
        coverId: entry.coverId || '',
        quality: entry.quality,
        bitrateKbps: 0,
        format: entry.format || '',
        codec: entry.codec || '',
        channels: Number(entry.channels) || 0,
        bitDepth: 0,
        sampleRate: 0,
        favorite: false,
        folder: '',
        fileName: '',
        genre: entry.genre,
        hasLyric: false,
      };
    }

    function durationText(seconds) {
      const value = Math.max(0, Math.round(Number(seconds) || 0));
      const hours = Math.floor(value / 3600);
      const minutes = Math.floor((value % 3600) / 60);
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    }

    function SongRow(props) {
      const t = props.t;
      const track = props.track;
      const active = Boolean(props.active);
      const selected = Boolean(props.selected);
      const onRow = () => props.onPlay(track);
      return h('div', {
        className: `fnm-song-row${active ? ' is-current' : ''}${selected ? ' is-selected' : ''}`,
        role: 'row',
        onClick: onRow,
        onContextMenu: (event) => {
          event.preventDefault();
          props.onContext(track, event);
        },
      },
        h('span', { className: 'fnm-song-index', role: 'cell' },
          props.selectable
            ? h('input', {
              type: 'checkbox',
              checked: selected,
              'aria-label': t('selectTrack'),
              onClick: (event) => event.stopPropagation(),
              onChange: (event) => props.onSelect(track.id, props.index, event.nativeEvent),
            })
            : null,
          active ? h('span', { className: 'fnm-song-playing', title: t('playing') }, '▮▮') : h('span', null, String(props.index + 1).padStart(2, '0')),
        ),
        h('span', { className: 'fnm-song-main', role: 'cell' },
          h('div', { className: 'fnm-song-cover' },
            h(Cover, { coverId: track.coverId, size: 38, alt: track.title }),
            h('span', { className: 'fnm-song-playglyph' }, h(Icon, { name: 'play', size: 13 })),
          ),
          h('span', { className: 'fnm-song-text' },
            h('span', { className: 'fnm-song-title' }, track.title || '—'),
            h('span', { className: 'fnm-song-artist' }, track.artist || t('unknownArtist')),
          ),
        ),
        h('span', { className: 'fnm-song-album fnm-muted', role: 'cell' }, track.album || ''),
        h('span', { className: 'fnm-song-quality', role: 'cell' }, h('span', { className: `fnm-quality fnm-quality-${track.quality}` }, qualityLabel(t, track.quality))),
        h('span', { className: 'fnm-song-duration fnm-muted', role: 'cell' }, formatTime(track.durationSec)),
        h('span', { className: 'fnm-song-actions', role: 'cell' },
          h('button', {
            type: 'button',
            className: `fnm-song-icon${track.favorite ? ' is-on' : ''}`,
            title: track.favorite ? t('unlike') : t('like'),
            'aria-label': track.favorite ? t('unlike') : t('like'),
            onClick: (event) => { event.stopPropagation(); props.onLike(track); },
          }, h(Icon, { name: track.favorite ? 'heart' : 'heartOutline', size: 15 })),
          h('button', {
            type: 'button',
            className: 'fnm-song-icon',
            title: t('more'),
            'aria-label': t('more'),
            onClick: (event) => { event.stopPropagation(); props.onContext(track, event); },
          }, h(Icon, { name: 'more', size: 16 })),
        ),
      );
    }

    function SongTable(props) {
      const t = props.t;
      const sentinel = useRef(null);
      const items = props.items || [];
      useEffect(() => {
        if (!props.hasMore || props.loadingMore || sentinel.current === null) return undefined;
        if (typeof IntersectionObserver !== 'function') return undefined;
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) props.onLoadMore();
        }, { rootMargin: '240px 0px' });
        observer.observe(sentinel.current);
        return () => observer.disconnect();
      }, [props.hasMore, props.loadingMore, props.onLoadMore]);
      const ids = items.map((track) => track.id);
      const allSelected = ids.length > 0 && ids.every((id) => props.selected && props.selected.has(id));
      return h('div', { className: 'fnm-song-table', role: 'table', 'aria-label': props.title || t('songs') },
        h('div', { className: 'fnm-song-head', role: 'row' },
          h('span', { className: 'fnm-song-index', role: 'columnheader' },
            props.selectable ? h('input', {
              type: 'checkbox',
              checked: allSelected,
              'aria-label': t('selectAll'),
              onChange: () => (allSelected ? props.onClearSelection() : props.onSelectAll(ids)),
            }) : '#'),
          h('span', { className: 'fnm-song-main', role: 'columnheader' }, t('title')),
          h('span', { className: 'fnm-song-album fnm-song-col-optional', role: 'columnheader' }, t('album')),
          h('span', { className: 'fnm-song-quality', role: 'columnheader' }, t('quality')),
          h('span', { className: 'fnm-song-duration', role: 'columnheader' }, t('duration')),
          h('span', { className: 'fnm-song-actions', role: 'columnheader' }, ''),
        ),
        items.length === 0
          ? h('div', { className: 'fnm-empty fnm-empty-small' }, h(Icon, { name: 'music', size: 24 }), h('div', { className: 'fnm-empty-title' }, props.emptyTitle || t('noResults')))
          : items.map((track, index) => h(SongRow, {
            key: `${track.id}-${index}`,
            t,
            track,
            index,
            active: Boolean(props.activeId && props.activeId === track.id),
            selected: Boolean(props.selected && props.selected.has(track.id)),
            selectable: Boolean(props.selectable),
            onSelect: props.onSelect,
            onPlay: props.onPlay,
            onLike: props.onLike,
            onContext: props.onContext,
          })),
        props.hasMore
          ? h('div', { className: 'fnm-load-more' },
            h('div', { ref: sentinel, className: 'fnm-load-sentinel', 'aria-hidden': true }),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: props.loadingMore, onClick: props.onLoadMore }, props.loadingMore ? t('loading') : t('loadMore')))
          : null,
      );
    }

    function MediaCard(props) {
      const t = props.t;
      const open = () => props.onOpen();
      return h('div', {
        className: `fnm-media-card${props.round ? ' is-round' : ''}`,
        role: 'button',
        tabIndex: 0,
        onClick: open,
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } },
      },
        h('div', { className: `fnm-media-cover${props.round ? ' is-round' : ''}` },
          h(Cover, { coverId: props.coverId, size: '100%', alt: props.title }),
          props.onPlay ? h('button', {
            type: 'button', className: 'fnm-media-play', title: t('play'), 'aria-label': t('play'),
            onClick: (event) => { event.stopPropagation(); props.onPlay(); },
          }, h(Icon, { name: 'play', size: 17 })) : null,
        ),
        h('div', { className: 'fnm-media-title' }, props.title || '—'),
        h('div', { className: 'fnm-media-sub' }, props.sub || ''),
      );
    }

    function SectionHead(props) {
      return h('div', { className: 'fnm-section-head fnm-v3-section-head' },
        h('h2', { className: 'fnm-v3-section-title' }, props.title),
        props.onAction ? h('button', { type: 'button', className: 'fnm-link', onClick: props.onAction }, props.actionLabel || props.t('viewAll'), h(Icon, { name: 'chevron', size: 13 })) : null,
      );
    }

    function TrackActionBar(props) {
      const t = props.t;
      const [picker, setPicker] = useState(false);
      const [busy, setBusy] = useState(false);
      const ids = props.selectedIds || [];
      if (ids.length === 0) return null;
      const queueSelected = async () => {
        setBusy(true);
        try {
          for (let index = 0; index < ids.length; index += 200) {
            await apiFetch('/queue', { method: 'POST', body: { action: 'add', trackIds: ids.slice(index, index + 200) } });
          }
          showToast(format(t('tracksAdded'), { count: ids.length }), 'info');
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };
      const favoriteSelected = async () => {
        setBusy(true);
        try {
          for (const id of ids) await apiFetch('/favorite', { method: 'POST', body: { action: 'add', trackId: id } });
          showToast(t('favoriteSelected'), 'info');
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };
      return h('div', { className: 'fnm-selection-bar' },
        h('span', { className: 'fnm-selection-count' }, format(t('selectedCount'), { count: ids.length })),
        h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', disabled: busy || !props.onPlaySelected, onClick: props.onPlaySelected }, h(Icon, { name: 'play', size: 14 }), t('playSelected')),
        h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: busy, onClick: () => void queueSelected() }, h(Icon, { name: 'queue', size: 14 }), t('addSelectedQueue')),
        h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: busy, onClick: () => setPicker(true) }, h(Icon, { name: 'playlist', size: 14 }), t('addSelectedPlaylist')),
        h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: busy, onClick: () => void favoriteSelected() }, h(Icon, { name: 'heartOutline', size: 14 }), t('favoriteSelected')),
        h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: props.onClear }, h(Icon, { name: 'close', size: 14 }), t('clearSelection')),
        picker ? h(PlaylistPicker, { t, trackIds: ids, onDone: () => { setPicker(false); props.onClear(); } }) : null,
      );
    }

    function HomeView(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const home = useApiData('/home', [snapshot.activeDeviceId, snapshot.listener ? snapshot.listener.id : ''], t);
      if (home.loading && home.data === null) return h('div', { className: 'fnm-view' }, h('div', { className: 'fnm-skeleton fnm-skeleton-hero' }), h('div', { className: 'fnm-skeleton-grid' }, ...Array.from({ length: 6 }, (_, index) => h('div', { key: index, className: 'fnm-skeleton fnm-skeleton-card' }))));
      if (home.error) return h('div', { className: 'fnm-view' }, h('div', { className: 'fnm-error-box' }, h(Icon, { name: 'warning', size: 22 }), h('p', null, home.error), h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', onClick: () => void refreshState() }, t('retry'))));
      const data = home.data || {};
      const recommended = Array.isArray(data.recommended) ? data.recommended : [];
      const recent = Array.isArray(data.recent) ? data.recent : [];
      const latestAlbums = Array.isArray(data.latestAlbums) ? data.latestAlbums : [];
      const artists = Array.isArray(data.artists) ? data.artists : [];
      const playlists = Array.isArray(data.playlists) ? data.playlists : [];
      const hero = data.current || recommended[0] || (recent[0] ? historyToTrack(recent[0]) : null);
      const playHero = () => { if (hero) void playTrackNow(hero); };
      return h('div', { className: 'fnm-view fnm-home-view' },
        hero ? h('section', { className: 'fnm-hero' },
          h('div', { className: 'fnm-hero-cover' }, h(Cover, { coverId: hero.coverId, size: '100%', alt: hero.title })),
          h('div', { className: 'fnm-hero-copy' },
            h('div', { className: 'fnm-eyebrow' }, data.current ? t('nowPlaying') : t('homeRecommended')),
            h('h1', { className: 'fnm-hero-title' }, hero.title || '—'),
            h('p', { className: 'fnm-hero-sub' }, `${hero.artist || t('unknownArtist')}${hero.album ? ` · ${hero.album}` : ''}`),
            h('div', { className: 'fnm-hero-actions' },
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', onClick: playHero }, h(Icon, { name: 'play', size: 15 }), t('play')),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => props.navigate({ name: 'now' }) }, h(Icon, { name: 'music', size: 15 }), t('nowPlaying')),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void toggleFavorite(hero) }, h(Icon, { name: hero.favorite ? 'heart' : 'heartOutline', size: 15 }), t('like')),
            ),
            h('div', { className: 'fnm-hero-stats' },
              h('span', null, `${t('songs')} ${data.counts ? data.counts.tracks : 0}`),
              h('span', null, `${t('albums')} ${data.counts ? data.counts.albums : 0}`),
              h('span', null, `${t('artists')} ${data.counts ? data.counts.artists : 0}`),
              h('span', null, `${t('listener')} ${data.listener ? data.listener.name : ''}`),
            ),
          ),
          h('div', { className: 'fnm-hero-glow', 'aria-hidden': 'true' }),
        ) : null,
        recent.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('homeRecent'), actionLabel: t('viewAll'), onAction: () => props.navigate({ name: 'recent' }) }),
          h('div', { className: 'fnm-recent-list' }, recent.slice(0, 6).map((entry) => h('button', {
            key: entry.id,
            type: 'button',
            className: 'fnm-recent-row',
            onClick: () => void openTrack(historyToTrack(entry)),
          },
            h(Cover, { coverId: entry.coverId, size: 38, alt: entry.title }),
            h('span', { className: 'fnm-recent-text' }, h('span', { className: 'fnm-recent-title' }, entry.title), h('span', { className: 'fnm-recent-sub' }, entry.artist)),
            h('span', { className: 'fnm-recent-time fnm-muted' }, formatTime(entry.durationSec)),
          ))),
        ) : null,
        h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('homeForYou'), actionLabel: t('viewAll'), onAction: () => props.navigate({ name: 'songs' }) }),
          recommended.length > 0 ? h('div', { className: 'fnm-media-grid' }, recommended.slice(0, 6).map((track) => h(MediaCard, {
            key: track.id, t, title: track.title, sub: track.artist, coverId: track.coverId,
            onOpen: () => void openTrack(track), onPlay: () => void playTrackNow(track),
          }))) : h('p', { className: 'fnm-muted' }, t('noResults')),
        ),
        latestAlbums.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('homeLatestAlbums'), actionLabel: t('viewAll'), onAction: () => props.navigate({ name: 'albums' }) }),
          h('div', { className: 'fnm-media-grid' }, latestAlbums.slice(0, 6).map((album) => h(MediaCard, {
            key: album.id, t, title: album.title, sub: album.artist, coverId: album.coverId,
            onOpen: () => props.navigate({ name: 'album', id: album.id }),
            onPlay: () => void playCollection('album', album.id),
          }))),
        ) : null,
        artists.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('homeArtists'), actionLabel: t('viewAll'), onAction: () => props.navigate({ name: 'artists' }) }),
          h('div', { className: 'fnm-media-grid fnm-media-grid-round' }, artists.slice(0, 6).map((artist) => h(MediaCard, {
            key: artist.id || artist.name, t, title: artist.name, sub: artist.trackCount ? `${artist.trackCount} ${t('tracks')}` : '', coverId: artist.coverId, round: true,
            onOpen: () => props.navigate({ name: 'artist', artistName: artist.name }),
            onPlay: () => void playCollection('artist', artist.name),
          }))),
        ) : null,
        playlists.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('homePlaylists'), actionLabel: t('viewAll'), onAction: () => props.navigate({ name: 'playlists' }) }),
          h('div', { className: 'fnm-media-grid' }, playlists.slice(0, 6).map((playlist) => h(MediaCard, {
            key: playlist.id, t, title: playlist.title, sub: playlist.trackCount ? `${playlist.trackCount} ${t('tracks')}` : '', coverId: playlist.coverId,
            onOpen: () => props.navigate({ name: 'playlists', openId: playlist.id }),
            onPlay: () => void playCollection('playlist', playlist.id),
          }))),
        ) : null,
      );
    }

    function SongsView(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const paged = usePagedApi('/search', { kind: 'track' }, t);
      const selection = useSelection();
      const activeId = snapshot.player.track ? snapshot.player.track.id : '';
      const playSelected = async () => {
        const tracks = paged.items.filter((track) => selection.selected.has(track.id));
        if (tracks.length === 0) return;
        try {
          await apiFetch('/queue', { method: 'POST', body: { action: 'clear' } });
          for (let index = 0; index < tracks.length; index += 200) {
            await apiFetch('/queue', { method: 'POST', body: { action: 'add', trackIds: tracks.slice(index, index + 200).map((track) => track.id) } });
          }
          await playTrackNow(tracks[0]);
          selection.clear();
        } catch (caught) {
          showError(t, caught);
        }
      };
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('songs')), h('div', { className: 'fnm-view-meta' }, `${paged.total} ${t('tracks')}`)),
        h(SongTable, {
          t, items: paged.items, title: t('songs'),
          selected: selection.selected, selectable: true,
          onSelect: (id, index, event) => selection.toggle(id, index, event, paged.items.map((track) => track.id)),
          onSelectAll: selection.selectAll, onClearSelection: selection.clear,
          activeId, onPlay: (track) => void openTrack(track), onLike: (track) => void toggleFavorite(track),
          onContext: props.onContext,
          hasMore: paged.hasMore, loadingMore: paged.loadingMore, onLoadMore: paged.loadMore,
          emptyTitle: t('libraryEmpty'),
        }),
        h(TrackActionBar, { t, selectedIds: selection.ids, onClear: selection.clear, onPlaySelected: () => void playSelected() }),
      );
    }

    function AlbumsView(props) {
      const t = props.t;
      const paged = usePagedApi('/search', { kind: 'album' }, t);
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('albums')), h('div', { className: 'fnm-view-meta' }, `${paged.total} ${t('albums')}`)),
        paged.items.length > 0 ? h('div', { className: 'fnm-media-grid' }, paged.items.map((album) => h(MediaCard, {
          key: album.id, t, title: album.title, sub: album.artist, coverId: album.coverId,
          onOpen: () => props.navigate({ name: 'album', id: album.id }),
          onPlay: () => void playCollection('album', album.id),
        }))) : h('div', { className: 'fnm-empty' }, h(Icon, { name: 'music', size: 26 }), h('div', { className: 'fnm-empty-title' }, paged.loading ? t('loading') : t('noResults'))),
        paged.hasMore ? h('div', { className: 'fnm-load-more' }, h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: paged.loadingMore, onClick: paged.loadMore }, paged.loadingMore ? t('loading') : t('loadMore'))) : null,
      );
    }

    function ArtistsView(props) {
      const t = props.t;
      const paged = usePagedApi('/search', { kind: 'artist' }, t);
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('artists')), h('div', { className: 'fnm-view-meta' }, `${paged.total} ${t('artists')}`)),
        paged.items.length > 0 ? h('div', { className: 'fnm-media-grid fnm-media-grid-round' }, paged.items.map((artist) => h(MediaCard, {
          key: artist.id || artist.name, t, title: artist.name, sub: artist.trackCount ? `${artist.trackCount} ${t('tracks')}` : '', coverId: artist.coverId, round: true,
          onOpen: () => props.navigate({ name: 'artist', artistName: artist.name }),
          onPlay: () => void playCollection('artist', artist.name),
        }))) : h('div', { className: 'fnm-empty' }, h(Icon, { name: 'music', size: 26 }), h('div', { className: 'fnm-empty-title' }, paged.loading ? t('loading') : t('noResults'))),
        paged.hasMore ? h('div', { className: 'fnm-load-more' }, h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: paged.loadingMore, onClick: paged.loadMore }, paged.loadingMore ? t('loading') : t('loadMore'))) : null,
      );
    }

    function FolderView(props) {
      const t = props.t;
      const [path, setPath] = useState('');
      const paged = usePagedApi('/search', { kind: 'folder', q: path }, t);
      const selection = useSelection();
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('folder')), h('div', { className: 'fnm-view-meta' }, t('folderHint'))),
        h('div', { className: 'fnm-folder-bar' },
          h(Icon, { name: 'folder', size: 16 }),
          h('input', {
            type: 'search', className: 'fnm-input', value: path, placeholder: t('folderPlaceholder'),
            onChange: (event) => setPath(event.target.value),
          }),
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: paged.refresh }, t('refresh')),
        ),
        path.trim() === '' ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'folder', size: 26 }), h('div', { className: 'fnm-empty-title' }, t('folderEmpty'))) : h(SongTable, {
          t, items: paged.items, activeId: props.snapshot.player.track ? props.snapshot.player.track.id : '',
          selected: selection.selected, selectable: true,
          onSelect: (id, index, event) => selection.toggle(id, index, event, paged.items.map((track) => track.id)),
          onSelectAll: selection.selectAll, onClearSelection: selection.clear,
          onPlay: (track) => void openTrack(track), onLike: (track) => void toggleFavorite(track), onContext: props.onContext,
          hasMore: paged.hasMore, loadingMore: paged.loadingMore, onLoadMore: paged.loadMore,
        }),
        h(TrackActionBar, { t, selectedIds: selection.ids, onClear: selection.clear }),
      );
    }

    function FavoritesView(props) {
      const t = props.t;
      const paged = usePagedApi('/favorites', {}, t);
      const selection = useSelection();
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('liked')), h('div', { className: 'fnm-view-meta' }, `${paged.total} ${t('tracks')}`)),
        h(SongTable, {
          t, items: paged.items, activeId: props.snapshot.player.track ? props.snapshot.player.track.id : '',
          selected: selection.selected, selectable: true,
          onSelect: (id, index, event) => selection.toggle(id, index, event, paged.items.map((track) => track.id)),
          onSelectAll: selection.selectAll, onClearSelection: selection.clear,
          onPlay: (track) => void openTrack(track), onLike: (track) => void toggleFavorite(track), onContext: props.onContext,
          hasMore: paged.hasMore, loadingMore: paged.loadingMore, onLoadMore: paged.loadMore,
          emptyTitle: t('likedEmpty'),
        }),
        h(TrackActionBar, { t, selectedIds: selection.ids, onClear: selection.clear }),
      );
    }

    function RecentView(props) {
      const t = props.t;
      const confirm = props.confirm;
      const paged = usePagedApi('/history', { range: '30d', unique: 1 }, t);
      const [clearing, setClearing] = useState(false);
      const clear = async () => {
        setClearing(true);
        try {
          await withConfirmToken(t, confirm, t('confirmClearHistory'), (args) => apiFetch('/history/clear', { method: 'POST', body: args }));
          paged.refresh();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setClearing(false);
        }
      };
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' },
          h('h1', { className: 'fnm-view-title' }, t('recent')),
          h('div', { className: 'fnm-view-actions' },
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => props.navigate({ name: 'stats' }) }, h(Icon, { name: 'stats', size: 14 }), t('stats')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-danger', disabled: clearing, onClick: () => void clear() }, h(Icon, { name: 'trash', size: 14 }), t('clearHistory')),
          ),
        ),
        paged.items.length === 0
          ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'music', size: 26 }), h('div', { className: 'fnm-empty-title' }, t('historyEmpty')))
          : h('div', { className: 'fnm-history-list' }, paged.items.map((entry) => h('button', {
            key: entry.id, type: 'button', className: 'fnm-history-row',
            onClick: () => void openTrack(historyToTrack(entry)),
          },
            h(Cover, { coverId: entry.coverId, size: 40, alt: entry.title }),
            h('span', { className: 'fnm-history-main' }, h('span', { className: 'fnm-history-title' }, entry.title), h('span', { className: 'fnm-history-sub' }, `${entry.artist}${entry.album ? ` · ${entry.album}` : ''}`)),
            h('span', { className: 'fnm-history-duration fnm-muted' }, entry.listenedMs ? `${Math.round(entry.listenedMs / 1000)}s` : '—'),
            h('span', { className: 'fnm-history-date fnm-muted' }, new Date(entry.at).toLocaleString()),
          ))),
        paged.hasMore ? h('div', { className: 'fnm-load-more' }, h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: paged.loadingMore, onClick: paged.loadMore }, paged.loadingMore ? t('loading') : t('loadMore'))) : null,
      );
    }

    function AlbumView(props) {
      const t = props.t;
      const album = useApiData(`/album?id=${encodeURIComponent(props.id)}`, [props.id], t);
      if (album.loading && album.data === null) return h('div', { className: 'fnm-view' }, h('div', { className: 'fnm-skeleton fnm-skeleton-hero' }));
      if (album.error) return h('div', { className: 'fnm-view' }, h('div', { className: 'fnm-error-box' }, h('p', null, album.error)));
      const data = album.data || {};
      const info = data.album || {};
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-detail-hero' },
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-back', onClick: () => props.navigate({ name: 'albums' }) }, h(Icon, { name: 'arrowLeft', size: 15 }), t('back')),
          h(Cover, { coverId: info.coverId, size: 168, alt: info.title || '' }),
          h('div', { className: 'fnm-detail-copy' },
            h('div', { className: 'fnm-eyebrow' }, t('album')),
            h('h1', { className: 'fnm-detail-title' }, info.title || '—'),
            h('p', { className: 'fnm-detail-sub' }, `${info.artist || ''}${info.year ? ` · ${info.year}` : ''}`),
            h('div', { className: 'fnm-detail-actions' },
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', onClick: () => void playCollection('album', props.id) }, h(Icon, { name: 'play', size: 15 }), t('playAll')),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void addAllToQueue(tracks) }, h(Icon, { name: 'queue', size: 15 }), t('addAllQueue')),
            ),
          ),
        ),
        h(SongTable, {
          t, items: tracks, activeId: props.snapshot.player.track ? props.snapshot.player.track.id : '',
          onPlay: (track) => void openTrack(track), onLike: (track) => void toggleFavorite(track), onContext: props.onContext,
          emptyTitle: t('albumEmpty'),
        }),
      );
    }

    function ArtistView(props) {
      const t = props.t;
      const artistName = props.artistName || '';
      const artist = useApiData(`/artist?name=${encodeURIComponent(artistName)}`, [artistName], t);
      if (artist.loading && artist.data === null) return h('div', { className: 'fnm-view' }, h('div', { className: 'fnm-skeleton fnm-skeleton-hero' }));
      if (artist.error) return h('div', { className: 'fnm-view' }, h('div', { className: 'fnm-error-box' }, h('p', null, artist.error)));
      const data = artist.data || {};
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      const albums = Array.isArray(data.albums) ? data.albums : [];
      const coverId = albums[0] ? albums[0].coverId : '';
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-detail-hero' },
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-back', onClick: () => props.navigate({ name: 'artists' }) }, h(Icon, { name: 'arrowLeft', size: 15 }), t('back')),
          h(Cover, { coverId, size: 168, alt: artistName }),
          h('div', { className: 'fnm-detail-copy' },
            h('div', { className: 'fnm-eyebrow' }, t('artist')),
            h('h1', { className: 'fnm-detail-title' }, artistName),
            h('p', { className: 'fnm-detail-sub' }, `${data.total || tracks.length} ${t('tracks')}`),
            h('div', { className: 'fnm-detail-actions' },
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', onClick: () => void playCollection('artist', artistName) }, h(Icon, { name: 'play', size: 15 }), t('playAll')),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => void addAllToQueue(tracks) }, h(Icon, { name: 'queue', size: 15 }), t('addAllQueue')),
            ),
          ),
        ),
        h(SongTable, {
          t, items: tracks, activeId: props.snapshot.player.track ? props.snapshot.player.track.id : '',
          onPlay: (track) => void openTrack(track), onLike: (track) => void toggleFavorite(track), onContext: props.onContext,
        }),
        albums.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('albums') }),
          h('div', { className: 'fnm-media-grid' }, albums.map((item) => h(MediaCard, {
            key: item.id, t, title: item.title, sub: item.artist, coverId: item.coverId,
            onOpen: () => props.navigate({ name: 'album', id: item.id }),
            onPlay: () => void playCollection('album', item.id),
          }))),
        ) : null,
      );
    }

    function SearchView(props) {
      const t = props.t;
      const q = props.q;
      const [data, setData] = useState({ loading: true, tracks: [], albums: [], artists: [], playlists: [], error: '' });
      const selection = useSelection();
      useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        const timer = setTimeout(() => {
          setData((previous) => ({ ...previous, loading: true, error: '' }));
          Promise.all([
            apiFetch(`/search?kind=track&q=${encodeURIComponent(q)}&limit=30`, { signal: controller.signal }),
            apiFetch(`/search?kind=album&q=${encodeURIComponent(q)}&limit=12`, { signal: controller.signal }),
            apiFetch(`/search?kind=artist&q=${encodeURIComponent(q)}&limit=12`, { signal: controller.signal }),
            apiFetch(`/search?kind=playlist&q=${encodeURIComponent(q)}&limit=12`, { signal: controller.signal }),
          ]).then(([tracks, albums, artists, playlists]) => {
            if (cancelled) return;
            setData({
              loading: false,
              error: '',
              tracks: Array.isArray(tracks.items) ? tracks.items : [],
              albums: Array.isArray(albums.items) ? albums.items : [],
              artists: Array.isArray(artists.items) ? artists.items : [],
              playlists: Array.isArray(playlists.items) ? playlists.items : [],
            });
          }).catch((caught) => {
            if (cancelled || (caught && caught.code === 'cancelled')) return;
            setData((previous) => ({ ...previous, loading: false, error: errorText(t, caught) }));
          });
        }, 280);
        return () => {
          cancelled = true;
          clearTimeout(timer);
          controller.abort();
        };
      }, [q, t]);
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, `${t('search')} · ${q}`), h('div', { className: 'fnm-view-meta' }, data.loading ? t('loading') : `${data.tracks.length + data.albums.length + data.artists.length + data.playlists.length} ${t('results')}`)),
        data.error ? h('div', { className: 'fnm-error-box' }, h('p', null, data.error)) : null,
        data.tracks.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('songs') }),
          h(SongTable, {
            t, items: data.tracks, activeId: props.snapshot.player.track ? props.snapshot.player.track.id : '',
            selected: selection.selected, selectable: true,
            onSelect: (id, index, event) => selection.toggle(id, index, event, data.tracks.map((track) => track.id)),
            onSelectAll: selection.selectAll, onClearSelection: selection.clear,
            onPlay: (track) => void openTrack(track), onLike: (track) => void toggleFavorite(track), onContext: props.onContext,
          }),
          h(TrackActionBar, { t, selectedIds: selection.ids, onClear: selection.clear }),
        ) : null,
        data.albums.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('albums') }),
          h('div', { className: 'fnm-media-grid' }, data.albums.map((album) => h(MediaCard, {
            key: album.id, t, title: album.title, sub: album.artist, coverId: album.coverId,
            onOpen: () => props.navigate({ name: 'album', id: album.id }),
            onPlay: () => void playCollection('album', album.id),
          }))),
        ) : null,
        data.artists.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('artists') }),
          h('div', { className: 'fnm-media-grid fnm-media-grid-round' }, data.artists.map((artist) => h(MediaCard, {
            key: artist.id || artist.name, t, title: artist.name, sub: '', coverId: artist.coverId, round: true,
            onOpen: () => props.navigate({ name: 'artist', artistName: artist.name }),
            onPlay: () => void playCollection('artist', artist.name),
          }))),
        ) : null,
        data.playlists.length > 0 ? h('section', { className: 'fnm-v3-section' },
          h(SectionHead, { t, title: t('playlists') }),
          h('div', { className: 'fnm-media-grid' }, data.playlists.map((playlist) => h(MediaCard, {
            key: playlist.id, t, title: playlist.title, sub: '', coverId: playlist.coverId,
            onOpen: () => props.navigate({ name: 'playlists', openId: playlist.id }),
            onPlay: () => void playCollection('playlist', playlist.id),
          }))),
        ) : null,
        !data.loading && !data.error && data.tracks.length === 0 && data.albums.length === 0 && data.artists.length === 0 && data.playlists.length === 0
          ? h('div', { className: 'fnm-empty' }, h(Icon, { name: 'search', size: 26 }), h('div', { className: 'fnm-empty-title' }, t('noResults')))
          : null,
      );
    }

    async function addAllToQueue(tracks) {
      if (!Array.isArray(tracks) || tracks.length === 0) return;
      try {
        for (let index = 0; index < tracks.length; index += 200) {
          await apiFetch('/queue', { method: 'POST', body: { action: 'add', trackIds: tracks.slice(index, index + 200).map((track) => track.id) } });
        }
        showToast(translate('addedToQueue'), 'info');
      } catch (caught) {
        showError(translate, caught);
      }
    }

    function NowPlayingView(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const player = snapshot.player;
      const track = player.track;
      const dj = useApiData('/dj', [snapshot.activeDeviceId], t);
      const scene = useApiData('/scene', [snapshot.activeDeviceId], t);
      if (!track) return h('div', { className: 'fnm-view fnm-empty-view' }, h(Icon, { name: 'music', size: 36 }), h('div', { className: 'fnm-empty-title' }, t('noTrack')), h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', onClick: () => props.navigate({ name: 'home' }) }, t('home')));
      const queue = player.queue || [];
      const index = player.currentIndex;
      const upcoming = index >= 0 ? queue.slice(index + 1, index + 7) : queue.slice(0, 6);
      return h('div', { className: 'fnm-view fnm-now-view' },
        h('div', { className: 'fnm-now-main-panel' },
          h('div', { className: 'fnm-now-art' }, h(Cover, { coverId: track.coverId, size: '100%', alt: track.title })),
          h('div', { className: 'fnm-now-copy' },
            h('div', { className: 'fnm-eyebrow' }, t('nowPlaying')),
            h('h1', { className: 'fnm-now-title' }, track.title),
            h('p', { className: 'fnm-now-sub' }, `${track.artist || t('unknownArtist')}${track.album ? ` · ${track.album}` : ''}`),
            h('div', { className: 'fnm-chip-row' },
              h('span', { className: `fnm-quality fnm-quality-${track.quality}` }, qualityLabel(t, track.quality)),
              track.genre ? h('span', { className: 'fnm-chip' }, track.genre) : null,
              track.year ? h('span', { className: 'fnm-chip' }, String(track.year)) : null,
              h('span', { className: 'fnm-chip' }, dj.data && dj.data.dj && dj.data.dj.enabled ? t('djOn') : t('djOff')),
              scene.data && scene.data.scene && scene.data.scene.active ? h('span', { className: 'fnm-chip fnm-chip-accent' }, scene.data.scene.scene) : null,
            ),
            h('div', { className: 'fnm-now-progress' },
              h(ProgressBar, { t, positionMs: player.positionMs, durationSec: track.durationSec, onSeek: props.onSeek }),
              h('div', { className: 'fnm-now-times' }, h('span', null, formatTime(player.positionMs / 1000)), h('span', null, formatTime(track.durationSec))),
            ),
            h('div', { className: 'fnm-now-controls' },
              h('button', { type: 'button', className: 'fnm-icon-btn', title: t('prev'), onClick: () => props.onSkip(-1) }, h(Icon, { name: 'prev', size: 20 })),
              h('button', { type: 'button', className: 'fnm-play-btn fnm-play-btn-lg', title: player.status === 'playing' ? t('pause') : t('play'), onClick: props.onPlayPause }, h(Icon, { name: player.status === 'playing' ? 'pause' : 'play', size: 24 })),
              h('button', { type: 'button', className: 'fnm-icon-btn', title: t('next'), onClick: () => props.onSkip(1) }, h(Icon, { name: 'next', size: 20 })),
              h('button', { type: 'button', className: `fnm-icon-btn${track.favorite ? ' is-on' : ''}`, title: track.favorite ? t('unlike') : t('like'), onClick: () => void toggleFavorite(track) }, h(Icon, { name: track.favorite ? 'heart' : 'heartOutline', size: 20 })),
              h('button', { type: 'button', className: 'fnm-icon-btn', title: t('openFloat'), onClick: () => void openFloatingPlayer(t) }, h(Icon, { name: 'float', size: 18 })),
            ),
            h('div', { className: 'fnm-now-extra' },
              h(VolumeControl, { t, volume: player.volume, muted: player.muted, onVolume: props.onVolume, onMute: props.onMute }),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: props.onMode }, h(Icon, { name: player.mode === 'one' ? 'repeatOne' : player.mode === 'shuffle' ? 'shuffle' : 'repeat', size: 15 }), player.mode === 'one' ? t('repeatOne') : player.mode === 'shuffle' ? t('shuffle') : t('repeatAll')),
            ),
          ),
        ),
        h('div', { className: 'fnm-now-side-panel' },
          h('section', { className: 'fnm-now-card' },
            h('div', { className: 'fnm-section-head' }, h('span', null, t('lyrics'))),
            h('div', { className: 'fnm-now-lyrics' }, h(LyricPanel, { t, track, positionMs: player.positionMs })),
          ),
          h('section', { className: 'fnm-now-card' },
            h('div', { className: 'fnm-section-head' }, h('span', null, t('upNext'))),
            upcoming.length === 0 ? h('p', { className: 'fnm-muted' }, t('queueEmpty')) : h('div', { className: 'fnm-upnext' }, upcoming.map((item) => h('button', {
              key: item.id, type: 'button', className: 'fnm-upnext-row',
              onClick: () => void playQueueTrack(item),
              onContextMenu: (event) => { event.preventDefault(); props.onContext(item, event); },
            },
              h(Cover, { coverId: item.coverId, size: 34, alt: item.title }),
              h('span', { className: 'fnm-upnext-text' }, h('span', null, item.title), h('span', { className: 'fnm-muted' }, item.artist)),
              h('span', { className: 'fnm-muted' }, formatTime(item.durationSec)),
            ))),
          ),
        ),
      );
    }

    function StatsView(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const confirm = props.confirm;
      const [range, setRange] = useState('7d');
      const stats = useApiData(`/stats?range=${range}`, [range, snapshot.activeDeviceId, snapshot.listener ? snapshot.listener.id : ''], t);
      const data = stats.data || {};
      const [clearing, setClearing] = useState(false);
      const daily = Array.isArray(data.daily) ? data.daily : [];
      const hourly = Array.isArray(data.hourly) ? data.hourly : Array.from({ length: 24 }, () => 0);
      const maxDay = Math.max(1, ...daily.map((day) => day.plays));
      const maxHour = Math.max(1, ...hourly);
      const clear = async () => {
        setClearing(true);
        try {
          await withConfirmToken(t, confirm, t('confirmClearHistory'), (args) => apiFetch('/history/clear', { method: 'POST', body: args }));
          stats.refresh();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setClearing(false);
        }
      };
      return h('div', { className: 'fnm-view fnm-stats-view' },
        h('div', { className: 'fnm-view-head' },
          h('h1', { className: 'fnm-view-title' }, t('stats')),
          h('div', { className: 'fnm-range-tabs' }, [['7d', t('range7')], ['30d', t('range30')], ['all', t('rangeAll')]].map(([id, label]) => h('button', {
            key: id, type: 'button', className: `fnm-range-tab${range === id ? ' is-active' : ''}`, onClick: () => setRange(id),
          }, label))),
        ),
        stats.loading && !stats.data ? h('div', { className: 'fnm-skeleton-grid' }, ...Array.from({ length: 4 }, (_, index) => h('div', { key: index, className: 'fnm-skeleton fnm-skeleton-card' }))) : null,
        stats.error ? h('div', { className: 'fnm-error-box' }, h('p', null, stats.error)) : null,
        data.ok === false ? null : h('div', { className: 'fnm-stats-content' },
          h('div', { className: 'fnm-stat-cards' },
            [['plays', data.plays || 0, t('statPlays')], ['listened', durationText(data.listenedSec || 0), t('statListened')], ['tracks', data.uniqueTracks || 0, t('statUnique')], ['days', data.activeDays || 0, t('statDays')]].map(([key, value, label]) => h('div', { key, className: 'fnm-stat-card' }, h('div', { className: 'fnm-stat-value' }, String(value)), h('div', { className: 'fnm-stat-label' }, label))),
          ),
          h('section', { className: 'fnm-stat-panel' },
            h('div', { className: 'fnm-section-head' }, h('span', null, t('statDaily')), h('span', { className: 'fnm-muted' }, `${data.from ? new Date(data.from).toLocaleDateString() : ''} – ${data.to ? new Date(data.to).toLocaleDateString() : ''}`)),
            daily.length === 0 ? h('p', { className: 'fnm-muted' }, t('statsEmpty')) : h('div', { className: 'fnm-bars' }, daily.map((day) => h('div', { key: day.date, className: 'fnm-bar-col', title: `${day.date} · ${day.plays}` },
              h('div', { className: 'fnm-bar-wrap' }, h('div', { className: 'fnm-bar', style: { height: `${Math.max(3, (day.plays / maxDay) * 100)}%` } })),
              h('span', { className: 'fnm-bar-label' }, day.date.slice(5)),
            ))),
          ),
          h('section', { className: 'fnm-stat-panel' },
            h('div', { className: 'fnm-section-head' }, h('span', null, t('statHourly'))),
            h('div', { className: 'fnm-hour-grid' }, hourly.map((plays, hour) => h('div', { key: hour, className: 'fnm-hour-cell', title: `${hour}:00 · ${plays}`, style: { opacity: 0.25 + (plays / maxHour) * 0.75 } }, h('span', null, String(hour).padStart(2, '0'))))),
          ),
          h('div', { className: 'fnm-stat-columns' },
            h(StatList, { t, title: t('topTracks'), items: data.topTracks, onPlay: (item) => void openTrack({ id: item.key, title: item.label, artist: item.sub || '', album: '', coverId: '', durationSec: 0, favorite: false, quality: 'standard', genre: '', year: 0, albumId: '', trackNo: 0, discNo: 0 }) }),
            h(StatList, { t, title: t('topArtists'), items: data.topArtists, onPlay: (item) => props.navigate({ name: 'artist', artistName: item.label }) }),
            h(StatList, { t, title: t('topAlbums'), items: data.topAlbums }),
            h(StatList, { t, title: t('topGenres'), items: data.topGenres }),
          ),
          h('div', { className: 'fnm-view-actions fnm-stats-actions' },
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-danger', disabled: clearing, onClick: () => void clear() }, h(Icon, { name: 'trash', size: 14 }), t('clearHistory')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => props.navigate({ name: 'recent' }) }, h(Icon, { name: 'recent', size: 14 }), t('recent')),
          ),
        ),
      );
    }

    function StatList(props) {
      const t = props.t;
      const items = Array.isArray(props.items) ? props.items : [];
      return h('section', { className: 'fnm-stat-list-panel' },
        h('div', { className: 'fnm-section-head' }, h('span', null, props.title)),
        items.length === 0 ? h('p', { className: 'fnm-muted' }, t('statsEmpty')) : h('div', { className: 'fnm-stat-rows' }, items.slice(0, 8).map((item, index) => h('button', {
          key: item.key, type: 'button', className: 'fnm-stat-row', onClick: props.onPlay ? () => props.onPlay(item) : undefined,
        },
          h('span', { className: 'fnm-stat-rank' }, String(index + 1).padStart(2, '0')),
          h('span', { className: 'fnm-stat-name' }, h('span', null, item.label), item.sub ? h('span', { className: 'fnm-muted' }, item.sub) : null),
          h('span', { className: 'fnm-stat-count' }, `${item.plays} · ${durationText(item.listenedSec)}`),
        ))),
      );
    }

    function ScenesView(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const scene = useApiData('/scene', [snapshot.activeDeviceId], t);
      const [busy, setBusy] = useState('');
      const current = scene.data && scene.data.scene ? scene.data.scene : { active: false, scene: null };
      const start = async (id) => {
        setBusy(id);
        try {
          await apiFetch('/scene', { method: 'POST', body: { action: 'start', scene: id, limit: 20 } });
          showToast(t('sceneStarted'), 'info');
          scene.refresh();
          await refreshState();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy('');
        }
      };
      const stop = async () => {
        setBusy('stop');
        try {
          await apiFetch('/scene', { method: 'POST', body: { action: 'stop' } });
          scene.refresh();
          await refreshState();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy('');
        }
      };
      const scenes = [
        ['auto', t('sceneAuto'), t('sceneAutoHint'), 'clock'],
        ['morning', t('sceneMorning'), t('sceneMorningHint'), 'sun'],
        ['focus', t('sceneFocus'), t('sceneFocusHint'), 'focus'],
        ['evening', t('sceneEvening'), t('sceneEveningHint'), 'sunset'],
        ['late', t('sceneLate'), t('sceneLateHint'), 'moon'],
        ['instrumental', t('sceneInstrumental'), t('sceneInstrumentalHint'), 'music'],
      ];
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('scenes')), h('div', { className: 'fnm-view-meta' }, t('scenePrivacy'))),
        current.active ? h('div', { className: 'fnm-scene-active' },
          h('div', null, h('div', { className: 'fnm-eyebrow' }, t('sceneActive')), h('div', { className: 'fnm-scene-active-title' }, t(`scene${current.scene ? current.scene.charAt(0).toUpperCase() + current.scene.slice(1) : 'Auto'}`))),
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: busy === 'stop', onClick: () => void stop() }, h(Icon, { name: 'close', size: 14 }), t('sceneStop')),
        ) : null,
        h('div', { className: 'fnm-scene-grid' }, scenes.map(([id, title, hint]) => h('button', {
          key: id, type: 'button', className: `fnm-scene-card${current.active && current.scene === id ? ' is-active' : ''}${busy === id ? ' is-busy' : ''}`,
          onClick: () => void start(id), disabled: busy !== '',
        },
          h('span', { className: 'fnm-scene-icon' }, h(Icon, { name: id === 'instrumental' ? 'music' : id === 'focus' ? 'focus' : id === 'morning' ? 'sun' : id === 'late' ? 'moon' : 'clock', size: 24 })),
          h('span', { className: 'fnm-scene-title' }, title),
          h('span', { className: 'fnm-scene-hint' }, hint),
          h('span', { className: 'fnm-scene-action' }, busy === id ? t('loading') : id === 'auto' ? t('sceneAutoStart') : t('sceneStart')),
        ))),
        h('p', { className: 'fnm-muted fnm-scene-note' }, t('sceneNote')),
      );
    }

    function SettingsView(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      return h('div', { className: 'fnm-view fnm-settings-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('settings')), h('div', { className: 'fnm-view-meta' }, t('settingsMeta'))),
        h(SettingsTab, { t, snapshot, confirm: props.confirm }),
        h(ListenersPanel, { t, snapshot, confirm: props.confirm }),
        h(AuditTrafficPanel, { t }),
      );
    }

    function ListenersPanel(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const list = useApiData('/listeners', [snapshot.listener ? snapshot.listener.id : ''], t);
      const [name, setName] = useState('');
      const [renameId, setRenameId] = useState('');
      const [renameName, setRenameName] = useState('');
      const [busy, setBusy] = useState(false);
      const reload = () => { list.refresh(); void refreshState(); };
      const create = async () => {
        if (!name.trim()) return;
        setBusy(true);
        try {
          await apiFetch('/listeners', { method: 'POST', body: { action: 'create', name: name.trim() } });
          setName('');
          reload();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };
      const switchTo = async (id) => {
        setBusy(true);
        try {
          await apiFetch('/listeners', { method: 'POST', body: { action: 'switch', listenerId: id } });
          reload();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };
      const rename = async (id) => {
        if (!renameName.trim()) return;
        setBusy(true);
        try {
          await apiFetch('/listeners', { method: 'POST', body: { action: 'rename', listenerId: id, name: renameName.trim() } });
          setRenameId('');
          setRenameName('');
          reload();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };
      const remove = async (id) => {
        setBusy(true);
        try {
          await withConfirmToken(t, props.confirm, t('confirmDeleteListener'), (args) => apiFetch('/listeners', { method: 'POST', body: { action: 'delete', listenerId: id, ...args } }));
          reload();
        } catch (caught) {
          showError(t, caught);
        } finally {
          setBusy(false);
        }
      };
      const listeners = list.data && Array.isArray(list.data.listeners) ? list.data.listeners : [];
      const activeId = list.data ? list.data.activeListenerId : '';
      return h('section', { className: 'fnm-settings-section fnm-local-section' },
        h('div', { className: 'fnm-section-head' }, h('span', null, t('listeners')), h('span', { className: 'fnm-muted' }, t('listenersHint'))),
        h('div', { className: 'fnm-listener-list' }, listeners.map((listener) => h('div', { key: listener.id, className: `fnm-listener-row${listener.id === activeId ? ' is-active' : ''}` },
          h('span', { className: 'fnm-avatar fnm-avatar-sm' }, (listener.name || '?').slice(0, 1)),
          renameId === listener.id
            ? h('input', { className: 'fnm-input fnm-input-sm', value: renameName, autoFocus: true, onChange: (event) => setRenameName(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') void rename(listener.id); } })
            : h('span', { className: 'fnm-listener-name' }, listener.name),
          listener.id === activeId ? h('span', { className: 'fnm-pill' }, t('listenerActive')) : null,
          h('span', { className: 'fnm-listener-actions' },
            listener.id === activeId ? null : h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: busy, onClick: () => void switchTo(listener.id) }, t('switch')),
            h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', onClick: () => { setRenameId(listener.id); setRenameName(listener.name); } }, t('rename')),
            renameId === listener.id ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', disabled: busy, onClick: () => void rename(listener.id) }, t('save')) : null,
            listeners.length > 1 ? h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet fnm-danger', disabled: busy || listener.id === activeId, onClick: () => void remove(listener.id) }, h(Icon, { name: 'trash', size: 13 })) : null,
          ),
        ))),
        h('div', { className: 'fnm-inline-form' },
          h('input', { className: 'fnm-input', value: name, placeholder: t('listenerNamePlaceholder'), onChange: (event) => setName(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') void create(); } }),
          h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', disabled: busy || !name.trim(), onClick: () => void create() }, h(Icon, { name: 'plus', size: 14 }), t('addListener')),
        ),
        h('p', { className: 'fnm-help fnm-listener-note' }, t('listenerSecurityNote')),
      );
    }

    function AuditTrafficPanel(props) {
      const t = props.t;
      const audit = useApiData('/audit?limit=40', [], t);
      const traffic = useApiData('/traffic', [], t);
      const [busy, setBusy] = useState('');
      const clearAudit = async () => {
        setBusy('audit');
        try { await apiFetch('/audit/clear', { method: 'POST' }); audit.refresh(); } catch (caught) { showError(t, caught); } finally { setBusy(''); }
      };
      const clearTraffic = async () => {
        setBusy('traffic');
        try { await apiFetch('/traffic/clear', { method: 'POST' }); traffic.refresh(); } catch (caught) { showError(t, caught); } finally { setBusy(''); }
      };
      const entries = audit.data && Array.isArray(audit.data.entries) ? audit.data.entries : [];
      const summary = traffic.data && traffic.data.traffic ? traffic.data.traffic : null;
      return h('section', { className: 'fnm-settings-section fnm-local-section' },
        h('div', { className: 'fnm-section-head' }, h('span', null, t('securityAudit')), h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: busy === 'audit', onClick: () => void clearAudit() }, t('clear'))),
        h('p', { className: 'fnm-help' }, t('auditHint')),
        entries.length === 0 ? h('p', { className: 'fnm-muted' }, t('auditEmpty')) : h('div', { className: 'fnm-audit-list' }, entries.slice(0, 12).map((entry, index) => h('div', { key: `${entry.at}-${index}`, className: 'fnm-audit-row' },
          h('span', { className: `fnm-audit-dot${entry.ok ? ' is-ok' : ' is-fail'}` }),
          h('span', { className: 'fnm-audit-tool' }, entry.tool),
          h('span', { className: 'fnm-muted' }, `${entry.action || ''}${entry.target ? ` · ${entry.target}` : ''}`),
          h('span', { className: `fnm-audit-result${entry.ok ? '' : ' fnm-danger'}` }, entry.ok ? t('auditOk') : (entry.code || t('auditFail'))),
          h('span', { className: 'fnm-muted' }, new Date(entry.at).toLocaleString()),
        ))),
        h('div', { className: 'fnm-section-head fnm-section-head-gap' }, h('span', null, t('traffic')), h('button', { type: 'button', className: 'fnm-btn fnm-btn-quiet', disabled: busy === 'traffic', onClick: () => void clearTraffic() }, t('clear'))),
        summary ? h('div', { className: 'fnm-traffic-summary' },
          h('div', null, `${t('requests')} ${summary.total.requests}`),
          h('div', null, `${t('errors')} ${summary.total.errors}`),
          h('div', null, `${t('bytes')} ${Math.round(summary.total.bytes / 1024)} KB`),
          h('div', null, `${t('avgLatency')} ${summary.total.requests ? Math.round(summary.total.ms / summary.total.requests) : 0} ms`),
        ) : null,
        summary && summary.byVia.length > 0 ? h('div', { className: 'fnm-traffic-via' }, summary.byVia.map((bucket) => h('span', { key: bucket.key, className: 'fnm-chip' }, `${bucket.key}: ${bucket.requests} · ${Math.round(bucket.bytes / 1024)} KB`))) : null,
      );
    }

    function ConnectView(props) {
      const t = props.t;
      return h('div', { className: 'fnm-connect' },
        h('div', { className: 'fnm-connect-hero' },
          h('span', { className: 'fnm-brand-icon fnm-brand-icon-lg' }, h(Icon, { name: 'music', size: 28 })),
          h('h1', null, t('connectTitle')),
          h('p', null, t('connectHint')),
        ),
        h(SettingsTab, { t, snapshot: props.snapshot, confirm: props.confirm }),
      );
    }

    function QueueView(props) {
      const t = props.t;
      return h('div', { className: 'fnm-view' },
        h('div', { className: 'fnm-view-head' }, h('h1', { className: 'fnm-view-title' }, t('queue')), h('div', { className: 'fnm-view-meta' }, `${props.snapshot.player.queueTotal} ${t('tracks')}`)),
        h(QueueTab, {
          t,
          snapshot: props.snapshot,
          confirm: props.confirm,
          onPlayTrack: (track) => void playTrackNow(track),
          onPlayQueueTrack: (track) => void playQueueTrack(track),
          onToggleLike: (track) => void toggleFavorite(track),
        }),
      );
    }

    function AsideQueue(props) {
      const t = props.t;
      const player = props.snapshot.player;
      const track = player.track;
      const queue = player.queue || [];
      const index = player.currentIndex;
      const upcoming = index >= 0 ? queue.slice(index + 1, index + 7) : queue.slice(0, 6);
      return h('aside', { className: 'fnm-aside' },
        h('div', { className: 'fnm-aside-head' }, h('span', null, t('nowPlaying')), h('button', { type: 'button', className: 'fnm-link', onClick: props.onOpenQueue }, t('queue'))),
        track ? h('div', { className: 'fnm-aside-current' },
          h(Cover, { coverId: track.coverId, size: 56, alt: track.title }),
          h('div', { className: 'fnm-aside-current-text' }, h('div', { className: 'fnm-aside-title' }, track.title), h('div', { className: 'fnm-aside-sub' }, track.artist)),
        ) : h('p', { className: 'fnm-muted' }, t('noTrack')),
        h('div', { className: 'fnm-aside-label' }, t('upNext')),
        upcoming.length === 0 ? h('p', { className: 'fnm-muted fnm-aside-empty' }, t('queueEmpty')) : h('div', { className: 'fnm-aside-list' }, upcoming.map((item, index) => h('button', {
          key: item.id, type: 'button', className: 'fnm-aside-row',
          onClick: () => void playQueueTrack(item),
          onContextMenu: (event) => { event.preventDefault(); props.onContext(item, event); },
        },
          h('span', { className: 'fnm-aside-index' }, String(index + 1).padStart(2, '0')),
          h('span', { className: 'fnm-aside-item-text' }, h('span', { className: 'fnm-aside-item-title' }, item.title), h('span', { className: 'fnm-aside-item-sub' }, item.artist)),
        ))),
      );
    }

    function TopBar(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const active = snapshot.devices.find((device) => device.id === snapshot.activeDeviceId);
      const listener = snapshot.listener || { name: '我' };
      const openWeb = () => {
        if (active && active.webUrl) window.open(active.webUrl, '_blank', 'noopener,noreferrer');
        else showToast(t('noWebUrl'), 'info');
      };
      return h('header', { className: 'fnm-top' },
        h('div', { className: 'fnm-top-left' },
          h('button', { type: 'button', className: 'fnm-top-icon', title: t('back'), 'aria-label': t('back'), disabled: !props.canBack, onClick: props.onBack }, h(Icon, { name: 'arrowLeft', size: 17 })),
          h('button', { type: 'button', className: 'fnm-top-icon fnm-top-forward', title: t('forward'), 'aria-label': t('forward'), disabled: !props.canForward, onClick: props.onForward }, h(Icon, { name: 'chevron', size: 17 })),
          h('div', { className: 'fnm-brand fnm-top-brand', onClick: () => props.navigate({ name: 'home' }) },
            h('span', { className: 'fnm-brand-icon' }, h(Icon, { name: 'music', size: 17 })),
            h('span', { className: 'fnm-top-brand-text' }, t('panel')),
          ),
        ),
        h('div', { className: 'fnm-top-search' },
          h(Icon, { name: 'search', size: 16 }),
          h('input', {
            ref: props.searchRef,
            type: 'search',
            value: props.query,
            placeholder: t('searchPlaceholder'),
            'aria-label': t('search'),
            onChange: (event) => props.onQuery(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Escape') props.onQuery(''); },
          }),
          props.query ? h('button', { type: 'button', className: 'fnm-top-icon', title: t('clear'), onClick: () => props.onQuery('') }, h(Icon, { name: 'close', size: 14 })) : null,
        ),
        h('div', { className: 'fnm-top-actions' },
          h('span', { className: 'fnm-top-connection' }, h(ConnectionLabel, { t, connection: snapshot.connection })),
          h('button', { type: 'button', className: 'fnm-device-capsule', title: t('settings'), onClick: props.onOpenSettings },
            h(Icon, { name: 'device', size: 14 }),
            h('span', null, active ? active.name : t('noDevice')),
          ),
          active && active.webUrl ? h('button', { type: 'button', className: 'fnm-top-icon', title: t('openWeb'), onClick: openWeb }, h(Icon, { name: 'wifi', size: 16 })) : null,
          h('button', { type: 'button', className: 'fnm-top-icon', title: t('refresh'), onClick: () => void refreshState() }, h(Icon, { name: 'refresh', size: 16 })),
          h('button', { type: 'button', className: 'fnm-top-icon', title: t('openFloat'), onClick: () => void openFloatingPlayer(t) }, h(Icon, { name: 'float', size: 16 })),
          props.voiceSupported && snapshot.settings.voiceEnabled ? h('button', {
            type: 'button', className: `fnm-top-icon${props.voiceListening ? ' is-on' : ''}`, title: t('voice'), 'aria-label': t('voice'),
            onClick: props.onVoice,
          }, h(Icon, { name: 'mic', size: 16 })) : null,
          h('button', { type: 'button', className: 'fnm-avatar', title: t('listeners'), onClick: props.onOpenListeners }, (listener.name || '我').slice(0, 1)),
        ),
      );
    }

    function NavRail(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const route = props.route;
      const groups = [
        [
          ['home', 'home', t('home')],
          ['now', 'music', t('nowPlaying')],
          ['recent', 'recent', t('recent')],
        ],
        [
          ['songs', 'music', t('songs')],
          ['albums', 'disc', t('albums')],
          ['artists', 'artist', t('artists')],
          ['playlists', 'playlist', t('playlists')],
          ['folder', 'folder', t('folder')],
          ['liked', 'heartOutline', t('liked')],
        ],
        [
          ['scenes', 'scene', t('scenes')],
          ['stats', 'stats', t('stats')],
          ['settings', 'settings', t('settings')],
        ],
      ];
      return h('nav', { className: 'fnm-nav', 'aria-label': t('panel') },
        ...groups.map((group, groupIndex) => h('div', { key: groupIndex, className: 'fnm-nav-group' },
          groupIndex === 1 ? h('div', { className: 'fnm-nav-label' }, t('library')) : null,
          groupIndex === 2 ? h('div', { className: 'fnm-nav-label' }, t('tools')) : null,
          group.map(([id, icon, label]) => h('button', {
            key: id,
            type: 'button',
            className: `fnm-nav-item${route.name === id || (id === 'playlists' && route.name === 'playlist-detail') ? ' is-active' : ''}`,
            title: label,
            onClick: () => props.navigate({ name: id }),
          }, h(Icon, { name: icon, size: 17 }), h('span', { className: 'fnm-nav-text' }, label))),
        )),
        h('div', { className: 'fnm-nav-bottom' },
          h('button', { type: 'button', className: 'fnm-nav-item', onClick: props.onOpenListeners }, h(Icon, { name: 'artist', size: 17 }), h('span', { className: 'fnm-nav-text' }, (snapshot.listener && snapshot.listener.name) || t('listener'))),
          h('div', { className: 'fnm-nav-meta' }, snapshot.connection && snapshot.connection.phase ? snapshot.connection.phase : ''),
        ),
      );
    }

    function ContextMenu(props) {
      const t = props.t;
      const menu = props.menu;
      useEffect(() => {
        if (!menu) return undefined;
        const close = () => props.onClose();
        const key = (event) => { if (event.key === 'Escape') props.onClose(); };
        window.addEventListener('click', close);
        window.addEventListener('scroll', close, true);
        window.addEventListener('keydown', key);
        return () => {
          window.removeEventListener('click', close);
          window.removeEventListener('scroll', close, true);
          window.removeEventListener('keydown', key);
        };
      }, [menu, props]);
      if (!menu) return null;
      const track = menu.track;
      const left = Math.min(menu.x, window.innerWidth - 230);
      const top = Math.min(menu.y, window.innerHeight - 260);
      const action = (run) => (event) => { event.stopPropagation(); props.onClose(); void run(); };
      return h('div', { className: 'fnm-context-menu', style: { left: `${left}px`, top: `${top}px` }, role: 'menu', onClick: (event) => event.stopPropagation() },
        h('div', { className: 'fnm-context-title' }, track.title),
        h('button', { type: 'button', role: 'menuitem', onClick: action(() => playTrackNow(track)) }, h(Icon, { name: 'play', size: 14 }), t('play')),
        h('button', { type: 'button', role: 'menuitem', onClick: action(async () => { await apiFetch('/player', { method: 'POST', body: { action: 'play', trackId: track.id, mode: 'next' } }); showToast(t('playNext'), 'info'); }) }, h(Icon, { name: 'next', size: 14 }), t('playNext')),
        h('button', { type: 'button', role: 'menuitem', onClick: action(async () => { await addToQueue(track); }) }, h(Icon, { name: 'queue', size: 14 }), t('addQueue')),
        h('button', { type: 'button', role: 'menuitem', onClick: action(() => props.onAddPlaylist([track.id])) }, h(Icon, { name: 'playlist', size: 14 }), t('addPlaylist')),
        h('button', { type: 'button', role: 'menuitem', onClick: action(async () => { await toggleFavorite(track); }) }, h(Icon, { name: track.favorite ? 'heart' : 'heartOutline', size: 14 }), track.favorite ? t('unlike') : t('like')),
        track.albumId ? h('button', { type: 'button', role: 'menuitem', onClick: action(() => props.navigate({ name: 'album', id: track.albumId })) }, h(Icon, { name: 'disc', size: 14 }), t('goAlbum')) : null,
        track.artist ? h('button', { type: 'button', role: 'menuitem', onClick: action(() => props.navigate({ name: 'artist', artistName: track.artist })) }, h(Icon, { name: 'artist', size: 14 }), t('goArtist')) : null,
      );
    }

    function ListenerMenu(props) {
      const t = props.t;
      const snapshot = props.snapshot;
      const list = useApiData('/listeners', [snapshot.listener ? snapshot.listener.id : ''], t);
      useEffect(() => {
        const close = () => props.onClose();
        const timer = setTimeout(() => window.addEventListener('click', close), 0);
        return () => { clearTimeout(timer); window.removeEventListener('click', close); };
      }, [props]);
      const listeners = list.data && Array.isArray(list.data.listeners) ? list.data.listeners : [];
      const switchTo = async (id) => {
        try {
          await apiFetch('/listeners', { method: 'POST', body: { action: 'switch', listenerId: id } });
          await refreshState();
          props.onClose();
        } catch (caught) {
          showError(t, caught);
        }
      };
      return h('div', { className: 'fnm-listener-menu', onClick: (event) => event.stopPropagation() },
        h('div', { className: 'fnm-context-title' }, t('listeners')),
        ...listeners.map((listener) => h('button', {
          key: listener.id, type: 'button', className: `fnm-listener-menu-row${listener.id === (list.data && list.data.activeListenerId) ? ' is-active' : ''}`,
          onClick: () => void switchTo(listener.id),
        }, h('span', { className: 'fnm-avatar fnm-avatar-sm' }, (listener.name || '?').slice(0, 1)), listener.name)),
        h('button', { type: 'button', className: 'fnm-listener-menu-manage', onClick: () => { props.onClose(); props.onManage(); } }, h(Icon, { name: 'settings', size: 13 }), t('manageListeners')),
      );
    }

    function Panel(props) {
      return h(ConfirmProvider, { t: props.t }, h(MusicApp, props));
    }

    function MusicApp(props) {
      const t = props.t;
      const confirm = useConfirm();
      const snapshot = useStoreValue((value) => value.snapshot);
      const loadError = useStoreValue((value) => value.loadError);
      const toast = useStoreValue((value) => value.toast);
      const [route, setRoute] = useState({ name: 'home' });
      const [backStack, setBackStack] = useState([]);
      const [forwardStack, setForwardStack] = useState([]);
      const [query, setQuery] = useState('');
      const [menu, setMenu] = useState(null);
      const [listenerOpen, setListenerOpen] = useState(false);
      const [pickerIds, setPickerIds] = useState(null);
      const [voiceListening, setVoiceListening] = useState(false);
      const contentRef = useRef(null);
      const searchRef = useRef(null);
      const previousDeviceRef = useRef(snapshot ? snapshot.activeDeviceId : null);
      const recognitionRef = useRef(null);

      const navigate = useCallback((next, options) => {
        setQuery('');
        setMenu(null);
        setListenerOpen(false);
        if (!options || options.push !== false) {
          setBackStack((previous) => [...previous, route].slice(-40));
          setForwardStack([]);
        }
        setRoute(next);
        requestAnimationFrame(() => {
          if (contentRef.current) contentRef.current.scrollTop = 0;
        });
      }, [route]);

      const goBack = useCallback(() => {
        if (query.trim() !== '') { setQuery(''); return; }
        if (backStack.length === 0) return;
        const target = backStack[backStack.length - 1];
        setBackStack((previous) => previous.slice(0, -1));
        setForwardStack((previous) => [...previous, route]);
        setRoute(target);
      }, [backStack, route, query]);

      const goForward = useCallback(() => {
        if (query.trim() !== '') return;
        if (forwardStack.length === 0) return;
        const target = forwardStack[forwardStack.length - 1];
        setForwardStack((previous) => previous.slice(0, -1));
        setBackStack((previous) => [...previous, route]);
        setRoute(target);
      }, [forwardStack, route, query]);

      useEffect(() => {
        if (!snapshot) return;
        if (previousDeviceRef.current !== snapshot.activeDeviceId) {
          previousDeviceRef.current = snapshot.activeDeviceId;
          setRoute({ name: 'home' });
          setBackStack([]);
          setForwardStack([]);
          setQuery('');
        }
      }, [snapshot]);

      useEffect(() => {
        const onKey = (event) => {
          const target = event.target;
          const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
          if (event.key === '/' && !typing) {
            event.preventDefault();
            searchRef.current?.focus();
          }
          if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); goBack(); }
          if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); goForward(); }
          if (event.key === 'Escape') { setMenu(null); setListenerOpen(false); setPickerIds(null); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [goBack, goForward]);

      useEffect(() => () => {
        try { recognitionRef.current?.abort?.(); } catch { /* noop */ }
      }, []);

      const openContext = useCallback((track, event) => {
        if (!track) return;
        setMenu({ track, x: event.clientX, y: event.clientY });
      }, []);

      const supportedRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
      const startVoice = () => {
        if (!snapshot || !snapshot.settings.voiceEnabled) { showToast(t('voiceDisabled'), 'info'); return; }
        if (!supportedRecognition) { showToast(t('voiceUnsupported'), 'info'); return; }
        try {
          const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          const recognition = new Recognition();
          recognition.lang = 'zh-CN';
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          recognitionRef.current = recognition;
          setVoiceListening(true);
          recognition.onresult = async (event) => {
            const text = event.results && event.results[0] && event.results[0][0] ? event.results[0][0].transcript : '';
            setVoiceListening(false);
            if (!text) return;
            try {
              const result = await apiFetch('/voice', { method: 'POST', body: { text } });
              if (!result.matched) { showToast(t('voiceNotMatched'), 'info'); return; }
              if (result.clientAction === 'openLyrics') navigate({ name: 'now' });
              else if (result.clientAction === 'openFloat') await openFloatingPlayer(t);
              else showToast(t('voiceDone'), 'info');
            } catch (caught) {
              showError(t, caught);
            }
          };
          recognition.onerror = () => { setVoiceListening(false); showToast(t('voiceUnsupported'), 'info'); };
          recognition.onend = () => { setVoiceListening(false); };
          recognition.start();
        } catch {
          setVoiceListening(false);
          showToast(t('voiceUnsupported'), 'info');
        }
      };

      if (!snapshot) {
        return h('div', { className: 'fnm-panel fnm-loading-panel' },
          loadError
            ? h('div', { className: 'fnm-error-box' },
              h(Icon, { name: 'warning', size: 28 }),
              h('div', { className: 'fnm-empty-title' }, t('errorGeneric')),
              h('p', { className: 'fnm-muted' }, loadError),
              h('button', { type: 'button', className: 'fnm-btn fnm-btn-primary', onClick: () => void refreshState() }, t('retry')))
            : h('div', { className: 'fnm-loading' }, h(Icon, { name: 'music', size: 32 }), h('span', null, t('loading'))),
        );
      }

      if (snapshot.devices.length === 0) {
        return h('div', { className: 'fnm-panel fnm-app fnm-app-connect' },
          h('TopBar', {
            t, snapshot, query, onQuery: setQuery, searchRef, canBack: false, canForward: false,
            onBack: goBack, onForward: goForward, navigate, onOpenSettings: () => {}, onOpenListeners: () => {},
            voiceSupported: false, voiceListening: false, onVoice: () => {},
          }),
          h('div', { className: 'fnm-connect-wrap' }, h(ConnectView, { t, snapshot, confirm })),
        );
      }

      const effective = query.trim() !== '' ? { name: 'search', q: query.trim() } : route;
      const renderView = () => {
        if (effective.name === 'home') return h(HomeView, { t, snapshot, navigate, onContext: openContext });
        if (effective.name === 'songs') return h(SongsView, { t, snapshot, navigate, onContext: openContext });
        if (effective.name === 'albums') return h(AlbumsView, { t, snapshot, navigate });
        if (effective.name === 'artists') return h(ArtistsView, { t, snapshot, navigate });
        if (effective.name === 'folder') return h(FolderView, { t, snapshot, navigate, onContext: openContext });
        if (effective.name === 'liked') return h(FavoritesView, { t, snapshot, navigate, onContext: openContext });
        if (effective.name === 'recent') return h(RecentView, { t, snapshot, navigate, confirm });
        if (effective.name === 'album') return h(AlbumView, { t, snapshot, navigate, id: effective.id, onContext: openContext });
        if (effective.name === 'artist') return h(ArtistView, { t, snapshot, navigate, artistName: effective.artistName, onContext: openContext });
        if (effective.name === 'search') return h(SearchView, { t, snapshot, navigate, q: effective.q, onContext: openContext });
        if (effective.name === 'now') return h(NowPlayingView, {
          t, snapshot, navigate, onContext: openContext,
          onPlayPause: () => void togglePlay(), onSkip: (delta) => void skip(delta), onSeek: (positionMs) => void seekTo(positionMs),
          onVolume: (volume) => void changeVolume(volume), onMute: () => void toggleMute(), onMode: () => void cycleMode(),
        });
        if (effective.name === 'stats') return h(StatsView, { t, snapshot, confirm, navigate });
        if (effective.name === 'scenes') return h(ScenesView, { t, snapshot, navigate });
        if (effective.name === 'settings') return h(SettingsView, { t, snapshot, confirm, navigate });
        if (effective.name === 'queue') return h(QueueView, { t, snapshot, confirm });
        if (effective.name === 'playlists') return h(PlaylistsTab, {
          t, confirm,
          initialPlaylistId: effective.openId || '',
          onPlayTrack: (track) => void openTrack(track),
          onToggleLike: (track) => void toggleFavorite(track),
        });
        return h(HomeView, { t, snapshot, navigate, onContext: openContext });
      };
      const showAside = !['now', 'settings', 'stats', 'scenes', 'queue'].includes(effective.name);
      return h('div', { className: 'fnm-panel fnm-app', 'data-route': effective.name },
        h(TopBar, {
          t, snapshot, query,
          onQuery: setQuery,
          searchRef,
          canBack: backStack.length > 0 || query.trim() !== '',
          canForward: forwardStack.length > 0 && query.trim() === '',
          onBack: goBack,
          onForward: goForward,
          navigate,
          onOpenSettings: () => navigate({ name: 'settings' }),
          onOpenListeners: () => setListenerOpen(true),
          voiceSupported: Boolean(supportedRecognition),
          voiceListening,
          onVoice: startVoice,
        }),
        h('div', { className: 'fnm-app-body' },
          h(NavRail, { t, snapshot, route: effective, navigate, onOpenListeners: () => setListenerOpen(true) }),
          h('main', { className: 'fnm-app-content', ref: contentRef, 'data-view': effective.name }, renderView()),
          showAside ? h(AsideQueue, { t, snapshot, onOpenQueue: () => navigate({ name: 'queue' }), onContext: openContext }) : null,
        ),
        h(PlayerBar, {
          t, snapshot,
          onPlayPause: () => void togglePlay(),
          onSkip: (delta) => void skip(delta),
          onSeek: (positionMs) => void seekTo(positionMs),
          onLike: (track) => void toggleFavorite(track),
          onVolume: (volume) => void changeVolume(volume),
          onMute: () => void toggleMute(),
          onMode: () => void cycleMode(),
          onClaim: () => void claimDriver().then(() => syncAudio()),
          onOpenQueue: () => navigate({ name: 'queue' }),
          onOpenNow: () => navigate({ name: 'now' }),
        }),
        h(ContextMenu, {
          t, menu, onClose: () => setMenu(null), navigate,
          onAddPlaylist: (ids) => setPickerIds(ids),
        }),
        listenerOpen ? h(ListenerMenu, { t, snapshot, onClose: () => setListenerOpen(false), onManage: () => navigate({ name: 'settings' }) }) : null,
        pickerIds ? h(PlaylistPicker, { t, trackIds: pickerIds, onDone: () => setPickerIds(null) }) : null,
        toast ? h('div', { className: `fnm-toast fnm-toast-${toast.kind}` }, toast.text) : null,
      );
    }

    /* ------------------------------------------------------------------ *
     * Sidebar footer + entry
     * ------------------------------------------------------------------ */

    function FooterAction(props) {
      const t = props.t;
      const snapshot = useStoreValue((value) => value.snapshot);
      const player = snapshot ? snapshot.player : null;
      const track = player ? player.track : null;
      const wide = props.wide !== false;
      const progress = player && track && track.durationSec > 0
        ? Math.min(100, Math.max(0, (player.positionMs / (track.durationSec * 1000)) * 100))
        : 0;
      const footerToast = useStoreValue((value) => value.toast);
      const footerAudioError = useStoreValue((value) => value.audioError);
      const notice = footerToast
        ? footerToast.text
        : footerAudioError
          ? (footerAudioError === 'autoplay' ? t('autoplayBlocked') : t('audioError'))
          : '';

      if (!wide) {
        return h('button', {
          type: 'button',
          className: 'fnm-foot-rail',
          title: track ? `${track.title} · ${track.artist}` : t('openPanel'),
          'aria-label': t('openPanel'),
          onClick: () => openPanel(),
        },
        h(Cover, { coverId: track ? track.coverId : '', size: 30, alt: '' }),
        h('span', { className: 'fnm-foot-rail-badge' }, h(Icon, { name: player && player.status === 'playing' ? 'pause' : 'play', size: 10 })),
        notice ? h('span', { className: 'fnm-foot-alert-dot', title: notice, 'aria-label': notice }) : null,
        );
      }

      if (!snapshot || !track) {
        return h('button', { type: 'button', className: 'fnm-foot fnm-foot-idle', onClick: () => openPanel() },
          h('span', { className: 'fnm-foot-icon' }, h(Icon, { name: 'music', size: 16 })),
          h('span', { className: 'fnm-foot-main' },
            h('span', { className: 'fnm-foot-title' }, snapshot && snapshot.devices.length === 0 ? t('noDevice') : t('noTrack')),
            h('span', { className: 'fnm-foot-sub' }, snapshot && snapshot.devices.length === 0 ? t('noDeviceHint') : t('openPanel')),
          ),
          h(Icon, { name: 'chevron', size: 14 }),
        );
      }

      return h('div', { className: 'fnm-foot', role: 'group', 'aria-label': t('currentTrack') },
        h('button', { type: 'button', className: 'fnm-foot-cover', title: t('openPanel'), 'aria-label': t('openPanel'), onClick: () => openPanel() },
          h(Cover, { coverId: track.coverId, size: 34, alt: '' }),
        ),
        h('div', { className: 'fnm-foot-main' },
          h('button', { type: 'button', className: 'fnm-foot-title fnm-foot-title-btn', title: track.title, onClick: () => openPanel() }, track.title),
          h('div', { className: 'fnm-foot-sub', title: track.artist }, track.artist),
          h('div', { className: 'fnm-foot-progress', 'aria-hidden': true }, h('span', { style: { width: `${progress}%` } })),
          notice ? h('div', { className: 'fnm-foot-alert', role: 'status', title: notice }, notice) : null,
        ),
        h('div', { className: 'fnm-foot-actions' },
          h('button', { type: 'button', className: 'fnm-icon-btn', title: t('prev'), 'aria-label': t('prev'), onClick: () => void skip(-1) }, h(Icon, { name: 'prev', size: 14 })),
          h('button', { type: 'button', className: 'fnm-icon-btn fnm-foot-play', title: player.status === 'playing' ? t('pause') : t('play'), 'aria-label': player.status === 'playing' ? t('pause') : t('play'), onClick: () => void togglePlay() }, h(Icon, { name: player.status === 'playing' ? 'pause' : 'play', size: 15 })),
          h('button', { type: 'button', className: 'fnm-icon-btn', title: t('next'), 'aria-label': t('next'), onClick: () => void skip(1) }, h(Icon, { name: 'next', size: 14 })),
          h('button', { type: 'button', className: `fnm-icon-btn${track.favorite ? ' is-on' : ''}`, title: track.favorite ? t('unlike') : t('like'), 'aria-label': track.favorite ? t('unlike') : t('like'), onClick: () => void toggleFavorite(track) }, h(Icon, { name: track.favorite ? 'heart' : 'heartOutline', size: 14 })),
        ),
      );
    }

    function SidebarIcon(props) {
      const t = props.t;
      const snapshot = useStoreValue((value) => value.snapshot);
      const player = snapshot ? snapshot.player : null;
      const track = player ? player.track : null;
      const size = Math.max(16, Math.round(props.size || 18));
      const progress = player && track && track.durationSec > 0
        ? Math.min(100, Math.max(0, (player.positionMs / (track.durationSec * 1000)) * 100))
        : 0;
      return h('span', {
        className: `fnm-entry${props.active ? ' is-active' : ''}`,
        style: { width: size, height: size },
        'aria-label': t('panel'),
        title: track ? `${track.title} · ${track.artist}` : t('panel'),
      },
      h(Cover, { coverId: track ? track.coverId : '', size, alt: '' }),
      track ? h('span', { className: 'fnm-entry-progress', 'aria-hidden': true }, h('span', { style: { width: `${progress}%` } })) : null,
      );
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * V2 floating player / lyrics / spectrum / media session
     * ------------------------------------------------------------------ */

    function useMediaSession(player, isDriver) {
      const track = player && player.track ? player.track : null;
      const trackId = track ? track.id : '';
      useEffect(() => {
        if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;
        const session = navigator.mediaSession;
        const actions = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'];
        const set = (name, handler) => {
          try {
            session.setActionHandler(name, handler);
          } catch {
            // Some actions are unsupported in a given Chromium build.
          }
        };
        const clear = () => {
          for (const name of actions) set(name, null);
        };
        if (!isDriver || !track) {
          try {
            session.metadata = null;
            session.playbackState = 'none';
          } catch {
            // Ignore unsupported media session.
          }
          clear();
          return undefined;
        }
        const currentPlayer = () => store.snapshot && store.snapshot.player;
        set('play', () => {
          const current = currentPlayer();
          if (current && current.status !== 'playing') void togglePlay();
        });
        set('pause', () => {
          const current = currentPlayer();
          if (current && current.status === 'playing') void togglePlay();
        });
        set('stop', () => {
          const current = currentPlayer();
          if (current && current.status === 'playing') void togglePlay();
        });
        set('previoustrack', () => void skip(-1));
        set('nexttrack', () => void skip(1));
        set('seekto', (details) => {
          if (details && typeof details.seekTime === 'number') void seekTo(details.seekTime * 1000);
        });
        set('seekbackward', (details) => {
          const current = currentPlayer();
          const offset = details && typeof details.seekOffset === 'number' ? details.seekOffset : 5;
          if (current) void seekTo(Math.max(0, current.positionMs - offset * 1000));
        });
        set('seekforward', (details) => {
          const current = currentPlayer();
          const offset = details && typeof details.seekOffset === 'number' ? details.seekOffset : 5;
          if (current) void seekTo(current.positionMs + offset * 1000);
        });
        const metadata = typeof MediaMetadata === 'function'
          ? new MediaMetadata({ title: track.title, artist: track.artist, album: track.album })
          : null;
        try {
          session.metadata = metadata;
        } catch {
          // Metadata may be unsupported.
        }
        let cancelled = false;
        let objectUrl = null;
        if (track.coverId && typeof MediaMetadata === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          fetch(coverUrl(track.coverId, 512), { credentials: 'same-origin' })
            .then((response) => (response.ok ? response.blob() : null))
            .then((blob) => {
              if (cancelled || !blob) return;
              objectUrl = URL.createObjectURL(blob);
              try {
                session.metadata = new MediaMetadata({
                  title: track.title,
                  artist: track.artist,
                  album: track.album,
                  artwork: [{ src: objectUrl, sizes: '512x512' }],
                });
              } catch {
                URL.revokeObjectURL(objectUrl);
                objectUrl = null;
              }
            })
            .catch(() => {});
        }
        return () => {
          cancelled = true;
          if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
          clear();
          try {
            session.metadata = null;
          } catch {
            // Ignore.
          }
        };
      }, [isDriver, trackId, track ? track.title : '', track ? track.artist : '', track ? track.album : '', track ? track.coverId : '']);

      useEffect(() => {
        if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
        try {
          navigator.mediaSession.playbackState = !isDriver || !track
            ? 'none'
            : player.status === 'playing'
              ? 'playing'
              : player.status === 'paused'
                ? 'paused'
                : 'none';
        } catch {
          // Ignore.
        }
      }, [isDriver, trackId, player ? player.status : '']);

      useEffect(() => {
        if (typeof navigator === 'undefined' || !navigator.mediaSession || typeof navigator.mediaSession.setPositionState !== 'function') return;
        if (!isDriver || !track || !player || !(track.durationSec > 0)) return;
        const duration = track.durationSec;
        const position = Math.max(0, Math.min(duration, (player.positionMs || 0) / 1000));
        try {
          navigator.mediaSession.setPositionState({ duration, position, playbackRate: 1 });
        } catch {
          // Position state is optional.
        }
      }, [isDriver, trackId, player ? player.positionMs : 0, player ? player.status : '', track ? track.durationSec : 0]);
    }

    function LyricPanel(props) {
      const t = props.t;
      const track = props.track;
      const positionMs = props.positionMs || 0;
      const [lines, setLines] = useState([]);
      const [timed, setTimed] = useState(false);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const lineRefs = useRef([]);
      const lastScroll = useRef(0);
      const autoScroll = useRef(false);

      useEffect(() => {
        if (!track) return undefined;
        const controller = new AbortController();
        let cancelled = false;
        setLoading(true);
        setError('');
        setLines([]);
        setTimed(false);
        lineRefs.current = [];
        apiFetch(`/lyrics?trackId=${encodeURIComponent(track.id)}`, { signal: controller.signal })
          .then((data) => {
            if (cancelled) return;
            setLines(Array.isArray(data.lines) ? data.lines : []);
            setTimed(Boolean(data.timed));
          })
          .catch((caught) => {
            if (cancelled) return;
            if (caught && caught.code === 'cancelled') return;
            setError(errorText(t, caught));
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return () => {
          cancelled = true;
          controller.abort();
        };
      }, [track ? track.id : '', t]);

      const active = useMemo(() => {
        if (!timed || lines.length === 0) return -1;
        let low = 0;
        let high = lines.length - 1;
        let found = -1;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (lines[mid].timeMs <= positionMs) {
            found = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        return found;
      }, [lines, timed, positionMs]);

      useEffect(() => {
        if (!timed || active < 0) return;
        if (Date.now() - lastScroll.current < 4000) return;
        const node = lineRefs.current[active];
        if (node && typeof node.scrollIntoView === 'function') {
          autoScroll.current = true;
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, [active, timed]);

      const onScroll = () => {
        if (autoScroll.current) {
          autoScroll.current = false;
          return;
        }
        lastScroll.current = Date.now();
      };

      if (loading) return h('div', { className: 'fnm-lyrics-empty' }, h(Icon, { name: 'lyrics', size: 24 }), t('lyricsLoading'));
      if (error) return h('div', { className: 'fnm-lyrics-empty fnm-errorline' }, error);
      if (lines.length === 0) return h('div', { className: 'fnm-lyrics-empty' }, h(Icon, { name: 'lyrics', size: 24 }), t('noLyrics'));
      if (!timed) {
        return h('div', { className: 'fnm-lyrics is-plain', onScroll, 'aria-label': t('lyrics') },
          lines.map((line, index) => h('div', { className: 'fnm-lyric-line', key: index }, line.text)),
        );
      }
      return h('div', { className: 'fnm-lyrics', onScroll, 'aria-label': t('lyrics'), title: t('lyricsHint') },
        lines.map((line, index) => {
          let activeWord = -1;
          if (index === active && Array.isArray(line.words)) {
            for (let i = 0; i < line.words.length; i += 1) {
              if (positionMs >= line.words[i].timeMs) activeWord = i;
              else break;
            }
          }
          return h('button', {
            type: 'button',
            key: `${line.timeMs}-${index}`,
            ref: (node) => { lineRefs.current[index] = node; },
            className: `fnm-lyric-line${index === active ? ' is-active' : ''}`,
            'aria-current': index === active ? 'true' : undefined,
            onClick: () => props.onSeek(line.timeMs),
          },
          Array.isArray(line.words) && line.words.length > 0
            ? h('span', { className: 'fnm-lyric-text' }, line.words.map((word, wordIndex) => h('span', {
              key: `${word.timeMs}-${wordIndex}`,
              className: `fnm-lyric-word${index === active && wordIndex === activeWord ? ' is-active' : ''}`,
            }, word.text)))
            : h('span', { className: 'fnm-lyric-text' }, line.text),
          line.translation ? h('span', { className: 'fnm-lyric-translation' }, line.translation) : null,
          );
        }),
      );
    }

    function Spectrum(props) {
      const t = props.t;
      const enabled = props.enabled;
      const canvasRef = useRef(null);
      const [unavailable, setUnavailable] = useState(false);
      useEffect(() => {
        if (!enabled) return undefined;
        const analyser = ensureAnalyser();
        if (!analyser) {
          setUnavailable(true);
          return undefined;
        }
        setUnavailable(false);
        const canvas = canvasRef.current;
        if (!canvas || typeof canvas.getContext !== 'function') return undefined;
        const context = canvas.getContext('2d');
        if (!context) {
          setUnavailable(true);
          return undefined;
        }
        let frame = null;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const resize = () => {
          const ratio = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
          const width = Math.max(120, canvas.clientWidth || 240);
          const height = Math.max(36, canvas.clientHeight || 56);
          canvas.width = Math.floor(width * ratio);
          canvas.height = Math.floor(height * ratio);
          context.setTransform(ratio, 0, 0, ratio, 0, 0);
        };
        resize();
        let observer = null;
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(resize);
          observer.observe(canvas);
        } else if (typeof window !== 'undefined') {
          window.addEventListener('resize', resize);
        }
        const style = typeof getComputedStyle === 'function' && typeof document !== 'undefined'
          ? getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-brand-primary').trim()
          : '';
        const color = style || 'rgba(120, 200, 220, 0.9)';
        const draw = () => {
          frame = requestAnimationFrame(draw);
          analyser.getByteFrequencyData(data);
          const width = canvas.clientWidth || 240;
          const height = canvas.clientHeight || 56;
          context.clearRect(0, 0, width, height);
          const bars = 40;
          const step = width / bars;
          for (let i = 0; i < bars; i += 1) {
            const value = data[Math.floor((i / bars) * data.length * 0.7)] / 255;
            const bar = Math.max(1, value * height * 0.9);
            context.fillStyle = color;
            context.globalAlpha = 0.35 + value * 0.65;
            context.fillRect(i * step + 1, height - bar, Math.max(1, step - 2), bar);
          }
          context.globalAlpha = 1;
        };
        draw();
        return () => {
          if (frame !== null) cancelAnimationFrame(frame);
          if (observer !== null) observer.disconnect();
          else if (typeof window !== 'undefined') window.removeEventListener('resize', resize);
        };
      }, [enabled]);

      if (!enabled) return null;
      return h('div', { className: 'fnm-spectrum-wrap' },
        unavailable ? h('div', { className: 'fnm-muted' }, t('spectrumUnavailable')) : h('canvas', { ref: canvasRef, className: 'fnm-spectrum', 'aria-hidden': true }),
      );
    }

    function defaultFloatPosition() {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('fnos-music:float-pos') : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return { x: parsed.x, y: parsed.y };
        }
      } catch {
        // Corrupt storage falls back to the bottom-right corner.
      }
      const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const height = typeof window !== 'undefined' ? window.innerHeight : 800;
      return { x: Math.max(12, width - 360), y: Math.max(12, height - 210) };
    }

    function clampFloatPosition(position) {
      const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const height = typeof window !== 'undefined' ? window.innerHeight : 800;
      const maxX = Math.max(8, width - 338);
      const maxY = Math.max(8, height - 170);
      let x = Math.min(Math.max(8, position.x), maxX);
      if (x < 18) x = 8;
      else if (x > maxX - 18) x = maxX;
      return { x, y: Math.min(Math.max(8, position.y), maxY) };
    }

    function FloatingPlayer(props) {
      const t = props.t;
      const snapshot = useStoreValue((value) => value.snapshot);
      const player = snapshot ? snapshot.player : null;
      const settings = snapshot ? snapshot.settings : null;
      const isDriver = useStoreValue((value) => value.isDriver);
      useMediaSession(player, isDriver);

      const [mode, setMode] = useState('mini');
      const [dismissed, setDismissed] = useState(false);
      const [pos, setPos] = useState(defaultFloatPosition);
      const [drag, setDrag] = useState(null);
      const posRef = useRef(pos);
      posRef.current = pos;

      useEffect(() => {
        if (settings && settings.floatingPlayer) setDismissed(false);
      }, [settings ? settings.floatingPlayer : false]);

      useEffect(() => {
        floatWindowToggle = () => setMode((current) => (current === 'mini' ? 'full' : 'mini'));
        floatWindowOpen = () => setMode('full');
        floatWindowClose = () => setMode('mini');
        return () => {
          floatWindowToggle = null;
          floatWindowOpen = null;
          floatWindowClose = null;
        };
      }, []);

      useEffect(() => {
        setPos((current) => clampFloatPosition(current));
        const onResize = () => setPos((current) => clampFloatPosition(current));
        if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
        return () => {
          if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
        };
      }, []);

      useEffect(() => {
        if (!drag) return undefined;
        const move = (event) => {
          const next = clampFloatPosition({ x: event.clientX - drag.dx, y: event.clientY - drag.dy });
          posRef.current = next;
          setPos(next);
        };
        const up = () => {
          setDrag(null);
          try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('fnos-music:float-pos', JSON.stringify(posRef.current));
          } catch {
            // Position is a convenience, not required.
          }
        };
        if (typeof window !== 'undefined') {
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', up);
        }
        return () => {
          if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
          }
        };
      }, [drag]);

      useEffect(() => {
        if (mode !== 'full') return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setMode('mini');
          }
        };
        if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
        return () => {
          if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
        };
      }, [mode]);

      if (!snapshot || !player || !player.track || !settings || !settings.floatingPlayer || dismissed) return null;

      const track = player.track;
      const closeFloating = async () => {
        setDismissed(true);
        try {
          await apiFetch('/settings', { method: 'POST', body: { floatingPlayer: false } });
        } catch (error) {
          setDismissed(false);
          showError(t, error);
        }
      };
      const beginDrag = (event) => {
        if (event.button !== 0) return;
        if (event.target && typeof event.target.closest === 'function' && event.target.closest('button')) return;
        setDrag({ dx: event.clientX - pos.x, dy: event.clientY - pos.y });
      };
      const progress = track.durationSec > 0 ? Math.min(100, Math.max(0, (player.positionMs / (track.durationSec * 1000)) * 100)) : 0;
      const modeIcon = player.mode === 'one' ? 'repeatOne' : player.mode === 'shuffle' ? 'shuffle' : 'repeat';
      const modeText = player.mode === 'one' ? t('repeatOne') : player.mode === 'shuffle' ? t('shuffle') : t('repeatAll');
      const upcoming = player.queue.slice(player.currentIndex + 1, player.currentIndex + 13);

      if (mode === 'full') {
        const cover = coverUrl(track.coverId, 600);
        return h('div', { className: 'fnm-float-layer' },
          h('div', { className: 'fnm-float-backdrop', onClick: () => setMode('mini') }),
          h('div', { className: 'fnm-float-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('fullPlayer') },
            settings.immersiveCover && cover ? h('div', { className: 'fnm-full-bg', style: { backgroundImage: `url(${cover})` }, 'aria-hidden': true }) : null,
            h('div', { className: 'fnm-full-head' },
              h('div', { className: 'fnm-full-heading' }, t('playing'), ' · ', track.title),
              h('div', { className: 'fnm-head-actions' },
                h('button', { type: 'button', className: 'fnm-icon-btn', title: t('minimize'), 'aria-label': t('minimize'), onClick: () => setMode('mini') }, h(Icon, { name: 'minimize', size: 16 })),
                h('button', { type: 'button', className: 'fnm-icon-btn', title: t('closeFloat'), 'aria-label': t('closeFloat'), onClick: () => void closeFloating() }, h(Icon, { name: 'close', size: 16 })),
              ),
            ),
            h('div', { className: 'fnm-full-body' },
              h('div', { className: 'fnm-full-left' },
                h(Cover, { coverId: track.coverId, size: 250, alt: track.title, className: 'fnm-full-cover' }),
                h('div', { className: 'fnm-full-title', title: track.title }, track.title),
                h('div', { className: 'fnm-full-artist' }, `${track.artist}${track.album ? ` · ${track.album}` : ''}`),
                h(ProgressBar, { t, positionMs: player.positionMs, durationSec: track.durationSec, onSeek: (value) => void seekTo(value) }),
                h('div', { className: 'fnm-full-controls' },
                  h('button', { type: 'button', className: 'fnm-icon-btn', title: t('prev'), 'aria-label': t('prev'), onClick: () => void skip(-1) }, h(Icon, { name: 'prev', size: 20 })),
                  h('button', { type: 'button', className: 'fnm-play-btn', title: player.status === 'playing' ? t('pause') : t('play'), 'aria-label': player.status === 'playing' ? t('pause') : t('play'), onClick: () => void togglePlay() }, h(Icon, { name: player.status === 'playing' ? 'pause' : 'play', size: 22 })),
                  h('button', { type: 'button', className: 'fnm-icon-btn', title: t('next'), 'aria-label': t('next'), onClick: () => void skip(1) }, h(Icon, { name: 'next', size: 20 })),
                  h('button', { type: 'button', className: `fnm-icon-btn${track.favorite ? ' is-on' : ''}`, title: track.favorite ? t('unlike') : t('like'), 'aria-label': track.favorite ? t('unlike') : t('like'), onClick: () => void toggleFavorite(track) }, h(Icon, { name: track.favorite ? 'heart' : 'heartOutline', size: 19 })),
                ),
                h('div', { className: 'fnm-full-side' },
                  h('button', { type: 'button', className: 'fnm-icon-btn', title: modeText, 'aria-label': modeText, onClick: () => void cycleMode() }, h(Icon, { name: modeIcon, size: 17 })),
                  h(VolumeControl, { t, volume: player.volume, muted: player.muted, onVolume: (value) => void changeVolume(value), onMute: () => void toggleMute() }),
                ),
                h(Spectrum, { t, enabled: Boolean(settings.spectrum) }),
              ),
              h('div', { className: 'fnm-full-right' },
                h(LyricPanel, { t, track, positionMs: player.positionMs, onSeek: (value) => void seekTo(value) }),
              ),
            ),
            h('div', { className: 'fnm-full-queue' },
              h('div', { className: 'fnm-section-label' }, t('queueNext')),
              upcoming.length === 0
                ? h('div', { className: 'fnm-muted' }, t('queueEmpty'))
                : h('div', { className: 'fnm-full-queue-list' }, upcoming.map((item, index) => h('button', {
                  type: 'button',
                  key: `${item.id}-${index}`,
                  className: 'fnm-full-queue-row',
                  onClick: () => void playQueueTrack(item),
                },
                h(Cover, { coverId: item.coverId, size: 26, alt: '' }),
                h('span', { className: 'fnm-full-queue-title', title: item.title }, item.title),
                h('span', { className: 'fnm-muted' }, item.artist),
                ))),
            ),
          ),
        );
      }

      return h('div', { className: 'fnm-float', style: { left: pos.x, top: pos.y }, role: 'complementary', 'aria-label': t('playingFloat') },
        h('div', { className: 'fnm-float-head', onPointerDown: beginDrag, title: t('floatHint') },
          h(Cover, { coverId: track.coverId, size: 34, alt: '' }),
          h('div', { className: 'fnm-float-meta' },
            h('div', { className: 'fnm-float-title', title: track.title }, track.title),
            h('div', { className: 'fnm-float-sub', title: track.artist }, track.artist),
          ),
          h('div', { className: 'fnm-float-head-actions' },
            h('button', { type: 'button', className: 'fnm-icon-btn', title: t('expand'), 'aria-label': t('expand'), onClick: () => setMode('full') }, h(Icon, { name: 'expand', size: 15 })),
            h('button', { type: 'button', className: 'fnm-icon-btn', title: t('closeFloat'), 'aria-label': t('closeFloat'), onClick: () => void closeFloating() }, h(Icon, { name: 'close', size: 14 })),
          ),
        ),
        h('div', { className: 'fnm-float-progress', 'aria-hidden': true }, h('span', { style: { width: `${progress}%` } })),
        h('div', { className: 'fnm-float-actions' },
          h('button', { type: 'button', className: 'fnm-icon-btn', title: t('prev'), 'aria-label': t('prev'), onClick: () => void skip(-1) }, h(Icon, { name: 'prev', size: 15 })),
          h('button', { type: 'button', className: 'fnm-play-btn fnm-float-play', title: player.status === 'playing' ? t('pause') : t('play'), 'aria-label': player.status === 'playing' ? t('pause') : t('play'), onClick: () => void togglePlay() }, h(Icon, { name: player.status === 'playing' ? 'pause' : 'play', size: 16 })),
          h('button', { type: 'button', className: 'fnm-icon-btn', title: t('next'), 'aria-label': t('next'), onClick: () => void skip(1) }, h(Icon, { name: 'next', size: 15 })),
          h('button', { type: 'button', className: `fnm-icon-btn${track.favorite ? ' is-on' : ''}`, title: track.favorite ? t('unlike') : t('like'), 'aria-label': track.favorite ? t('unlike') : t('like'), onClick: () => void toggleFavorite(track) }, h(Icon, { name: track.favorite ? 'heart' : 'heartOutline', size: 15 })),
          h('button', { type: 'button', className: 'fnm-icon-btn', title: t('lyrics'), 'aria-label': t('lyrics'), onClick: () => setMode('full') }, h(Icon, { name: 'lyrics', size: 15 })),
        ),
      );
    }

    const CSS = `
.fnm-panel, .fnm-panel * { box-sizing: border-box; }
.fnm-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; max-width: 920px; margin: 0 auto; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); container-type: inline-size; }
[data-platform='darwin'] .fnm-header { padding-top: calc(10px + var(--dsh-frame-top-clearance, 0px)); }
.fnm-panel button, .fnm-panel input, .fnm-panel select { font-family: inherit; }
.fnm-loading-panel { align-items: center; justify-content: center; gap: 10px; color: var(--dsw-alias-label-secondary); min-height: 200px; }
.fnm-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.fnm-brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
.fnm-brand-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); flex: none; }
.fnm-title { font-size: 14px; font-weight: 600; line-height: 1.2; }
.fnm-subtitle { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-header-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.fnm-player { padding: 12px 14px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.fnm-now { display: flex; align-items: center; gap: 12px; min-width: 0; }
.fnm-now-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.fnm-now-title { font-size: 14px; font-weight: 600; }
.fnm-now-artist { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.fnm-now .fnm-cover { flex: none; }
.fnm-transport { display: flex; align-items: center; gap: 4px; flex: none; }
.fnm-player-side { display: flex; align-items: center; gap: 8px; flex: none; }
.fnm-player-status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 5px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.fnm-icon { display: block; flex: none; }
.fnm-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.fnm-icon-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.fnm-icon-btn:focus-visible, .fnm-btn:focus-visible, .fnm-tab:focus-visible, .fnm-foot:focus-visible, .fnm-foot-rail:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.fnm-icon-btn:disabled { opacity: .4; cursor: default; }
.fnm-icon-btn.is-on { color: var(--dsw-alias-state-error-primary); }
.fnm-play-btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 0; border-radius: 50%; padding: 0; color: var(--dsw-alias-label-primary-inverted); background: var(--dsw-alias-button-primary-fill); cursor: pointer; }
.fnm-play-btn:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.fnm-play-btn:disabled { opacity: .45; cursor: default; }
.fnm-progress { display: flex; align-items: center; gap: 7px; min-width: 130px; width: 100%; }
.fnm-time { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; min-width: 32px; text-align: center; }
.fnm-range { flex: 1; min-width: 40px; height: 4px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.fnm-range-volume { width: 62px; flex: none; }
.fnm-volume { display: flex; align-items: center; gap: 2px; }
.fnm-conn { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.fnm-conn-mode { color: var(--dsw-alias-label-tertiary); }
.fnm-conn-latency { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.fnm-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); display: inline-block; flex: none; }
.fnm-dot-online { background: var(--dsw-alias-state-success-primary); }
.fnm-dot-degraded { background: var(--dsw-alias-state-warn-primary); }
.fnm-dot-auth, .fnm-dot-offline, .fnm-dot-service-missing { background: var(--dsw-alias-state-error-primary); }
.fnm-dot-probing { background: var(--dsw-alias-state-warn-primary); }
.fnm-warn { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-state-warn-label); }
.fnm-hintline { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.fnm-errorline { color: var(--dsw-alias-state-error-primary); }
.fnm-link { border: 0; background: transparent; color: var(--dsw-alias-brand-primary); cursor: pointer; padding: 0; font-size: inherit; text-decoration: underline; }
.fnm-tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none; }
.fnm-tab { display: inline-flex; align-items: center; gap: 5px; padding: 8px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; }
.fnm-tab:hover { color: var(--dsw-alias-label-primary); }
.fnm-tab.is-active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.fnm-content { flex: 1; min-height: 0; overflow: auto; padding: 10px 14px 18px; }
.fnm-list-wrap { display: flex; flex-direction: column; gap: 6px; max-width: 100%; }
.fnm-list-head, .fnm-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 2px 0 4px; }
.fnm-list { display: flex; flex-direction: column; gap: 1px; }
.fnm-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 7px; min-width: 0; }
.fnm-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-row.is-active { background: var(--dsw-alias-interactive-bg-active); }
.fnm-row-play { display: flex; align-items: center; gap: 7px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; min-width: 0; flex: none; }
.fnm-row-index { font-size: 10px; color: var(--dsw-alias-label-tertiary); min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
.fnm-row-main { flex: 1; min-width: 0; }
.fnm-row-title, .fnm-device-title { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-row-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.fnm-row-duration { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex: none; }
.fnm-row-actions { display: flex; align-items: center; gap: 0; flex: none; }
.fnm-badge { font-size: 9px; padding: 1px 4px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); flex: none; }
.fnm-badge-hires { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.fnm-badge-lossless { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.fnm-cover { display: block; object-fit: cover; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); flex: none; }
.fnm-cover-empty { display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
.fnm-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 34px 12px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.fnm-empty-small { padding: 18px 8px; }
.fnm-empty-title { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.fnm-muted { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.fnm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 11px; cursor: pointer; }
.fnm-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-btn:disabled { opacity: .5; cursor: default; }
.fnm-btn-quiet { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.fnm-btn-quiet:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.fnm-btn-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); }
.fnm-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.fnm-danger { color: var(--dsw-alias-state-error-primary); }
.fnm-btn-danger { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary-foreground); }
.fnm-load-more { align-self: center; margin-top: 6px; }
.fnm-inline-error { margin: 6px 0; padding: 6px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-error-primary); font-size: 11px; }
.fnm-load-error { max-width: 420px; text-align: center; word-break: break-word; }
.fnm-layers { display: flex; flex-wrap: wrap; gap: 12px; padding: 2px 0 4px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.fnm-layer { display: inline-flex; align-items: center; gap: 4px; }
.fnm-loading { padding: 12px; color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }
.fnm-search { display: flex; flex-direction: column; gap: 8px; }
.fnm-search-form { display: flex; gap: 8px; }
.fnm-search-input { flex: 1; display: flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); }
.fnm-search-input input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; padding: 7px 0; }
.fnm-search-input:focus-within { border-color: var(--dsw-alias-brand-primary); }
.fnm-row-play:focus-visible, .fnm-link:focus-visible, .fnm-range:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.fnm-select { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 11px; padding: 0 6px; }
.fnm-card-row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 7px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.fnm-card-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-card-main { flex: 1; min-width: 0; }
.fnm-section-label { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.fnm-detail-title { font-size: 13px; font-weight: 600; padding: 2px 0 6px; }
.fnm-favorites-card { margin-top: 4px; }
.fnm-favorites-icon { display: inline-flex; width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: 6px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); flex: none; }
.fnm-settings { display: flex; flex-direction: column; gap: 14px; }
.fnm-settings-section { display: flex; flex-direction: column; gap: 7px; padding-bottom: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.fnm-settings-section:last-child { border-bottom: 0; }
.fnm-device-list { display: flex; flex-direction: column; gap: 4px; }
.fnm-device { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; }
.fnm-device.is-active { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.fnm-device-main { min-width: 0; }
.fnm-device-title { display: flex; align-items: center; gap: 6px; }
.fnm-device-status { display: inline-flex; align-items: center; gap: 5px; margin-top: 3px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.fnm-device-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px; flex: none; }
.fnm-pill { font-size: 9px; padding: 1px 5px; border-radius: 999px; border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.fnm-form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); margin-top: 4px; }
.fnm-form-title { font-size: 12px; font-weight: 600; }
.fnm-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.fnm-field input, .fnm-field select { width: 100%; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; padding: 6px 7px; }
.fnm-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.fnm-check { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.fnm-check input { accent-color: var(--dsw-alias-brand-primary); }
.fnm-help { display: block; flex-basis: 100%; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.fnm-or { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.fnm-form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.fnm-logs { display: flex; flex-direction: column; gap: 1px; max-height: 220px; overflow: auto; font-size: 10px; }
.fnm-log { display: flex; gap: 6px; padding: 2px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.fnm-log-time { color: var(--dsw-alias-label-tertiary); flex: none; }
.fnm-log-kind { flex: none; color: var(--dsw-alias-brand-primary); }
.fnm-log-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: 80%; padding: 7px 11px; border-radius: 7px; background: var(--dsw-alias-toast-bg); color: var(--dsw-alias-label-primary); font-size: 11px; box-shadow: var(--dsw-shadow-lv2); z-index: 5; }
.fnm-toast-error { color: var(--dsw-alias-state-error-primary); }
.fnm-panel { position: relative; }
.fnm-marquee { overflow: hidden; white-space: nowrap; min-width: 0; }
.fnm-marquee-inner { display: inline-flex; min-width: 100%; }
.fnm-marquee-gap { padding-left: 32px; }
.fnm-marquee.is-overflow .fnm-marquee-inner { animation: fnm-marquee 14s linear infinite; }
@keyframes fnm-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.fnm-dialog { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 0; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); max-width: 360px; width: calc(100% - 32px); box-shadow: var(--dsw-shadow-lv3); }
.fnm-dialog::backdrop { background: var(--dsw-alias-bg-mask-2); }
.fnm-dialog-body { padding: 14px; display: flex; flex-direction: column; gap: 9px; }
.fnm-dialog-title { font-size: 13px; font-weight: 600; }
.fnm-dialog-message { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.fnm-dialog-actions { display: flex; justify-content: flex-end; gap: 6px; }
.fnm-entry { position: relative; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; overflow: hidden; }
.fnm-entry .fnm-cover { border-radius: 6px; }
.fnm-entry-progress { position: absolute; left: 2px; right: 2px; bottom: 1px; height: 2px; border-radius: 2px; background: var(--dsw-alias-bg-mask-2); overflow: hidden; }
.fnm-entry-progress span { display: block; height: 100%; background: var(--dsw-alias-brand-primary); }
.fnm-foot { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 7px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; min-width: 0; }
.fnm-foot:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-foot-idle { color: var(--dsw-alias-label-secondary); }
.fnm-foot-icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); flex: none; }
.fnm-foot-cover { display: inline-flex; padding: 0; border: 0; background: transparent; cursor: pointer; flex: none; }
.fnm-foot-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.fnm-foot-title { font-size: 11px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-foot-title-btn { border: 0; background: transparent; color: inherit; text-align: left; padding: 0; cursor: pointer; font: inherit; }
.fnm-foot-sub { font-size: 9px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-foot-progress { height: 2px; border-radius: 2px; background: var(--dsw-alias-bg-mask-2); overflow: hidden; margin-top: 2px; }
.fnm-foot-progress span { display: block; height: 100%; background: var(--dsw-alias-brand-primary); }
.fnm-foot-alert { font-size: 9px; color: var(--dsw-alias-state-error-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-foot-alert-dot { position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-error-primary); }
.fnm-foot-actions { display: flex; align-items: center; gap: 0; flex: none; }
.fnm-foot-actions .fnm-icon-btn { width: 24px; height: 24px; }
.fnm-foot-play { color: var(--dsw-alias-brand-primary); }
.fnm-foot-rail { position: relative; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 7px; }
.fnm-foot-rail:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-foot-rail-badge { position: absolute; right: -1px; bottom: -1px; display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; border-radius: 50%; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-brand-primary); border: 1px solid var(--dsw-alias-border-l1); }
.fnm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.fnm-row-check { width: 14px; height: 14px; flex: none; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.fnm-row.is-selected { background: var(--dsw-alias-interactive-bg-active); }
.fnm-hidden-input { display: none; }
.fnm-list-head-wrap { flex-wrap: wrap; align-items: flex-start; }
.fnm-head-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.fnm-select-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); }
.fnm-inline-form { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 6px 0; }
.fnm-inline-form input { flex: 1; min-width: 140px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 6px 7px; }
.fnm-playlist-row { padding: 0 6px 0 0; }
.fnm-card-open { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; padding: 6px 7px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; border-radius: 7px; }
.fnm-card-open:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-picker { max-width: 420px; }
.fnm-picker-list { display: flex; flex-direction: column; gap: 2px; max-height: 280px; overflow: auto; }
.fnm-picker-row { width: 100%; }
.fnm-picker-empty { padding: 12px 0; }
.fnm-lyrics { display: flex; flex-direction: column; gap: 2px; height: 100%; max-height: 360px; overflow: auto; padding: 8px 6px; scroll-behavior: smooth; }
.fnm-lyrics.is-plain { color: var(--dsw-alias-label-secondary); }
.fnm-lyrics-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 220px; color: var(--dsw-alias-label-tertiary); font-size: 11px; text-align: center; }
.fnm-lyric-line { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 1.5; text-align: center; cursor: pointer; transition: color .15s ease, background .15s ease; }
.fnm-lyric-line:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.fnm-lyric-line.is-active { color: var(--dsw-alias-label-primary); font-weight: 600; background: var(--dsw-alias-bg-layer-2); }
.fnm-lyric-text { display: block; }
.fnm-lyric-word { transition: color .1s linear; }
.fnm-lyric-word.is-active { color: var(--dsw-alias-brand-primary); }
.fnm-lyric-translation { display: block; font-size: 10px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.fnm-spectrum-wrap { width: 100%; min-height: 36px; margin-top: 4px; }
.fnm-spectrum { display: block; width: 100%; height: 56px; }
.fnm-float { position: fixed; z-index: 60; width: 330px; display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv3); pointer-events: auto; overflow: hidden; backdrop-filter: blur(10px); }
.fnm-float button { font-family: inherit; }
.fnm-float-head { display: flex; align-items: center; gap: 8px; padding: 8px 9px; cursor: grab; user-select: none; }
.fnm-float-head:active { cursor: grabbing; }
.fnm-float-meta { flex: 1; min-width: 0; }
.fnm-float-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-float-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-float-head-actions { display: flex; align-items: center; gap: 1px; flex: none; }
.fnm-float-progress { height: 3px; background: var(--dsw-alias-bg-mask-2); overflow: hidden; }
.fnm-float-progress span { display: block; height: 100%; background: var(--dsw-alias-brand-primary); }
.fnm-float-actions { display: flex; align-items: center; justify-content: space-between; padding: 4px 7px 6px; }
.fnm-float-play { width: 32px; height: 32px; }
.fnm-float-layer { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; pointer-events: none; }
.fnm-float-backdrop { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-2); pointer-events: auto; }
.fnm-float-full { position: relative; z-index: 1; width: min(880px, calc(100vw - 32px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv3); pointer-events: auto; overflow: hidden; }
.fnm-full-bg { position: absolute; inset: -20px; background-size: cover; background-position: center; filter: blur(36px) saturate(1.25); opacity: .28; transform: scale(1.08); pointer-events: none; z-index: 0; }
.fnm-full-head { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 82%, transparent); }
.fnm-full-heading { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-full-body { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(270px, 1fr) minmax(280px, 1.1fr); gap: 18px; padding: 16px; overflow: auto; }
.fnm-full-left { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; }
.fnm-full-cover { border-radius: 12px; box-shadow: var(--dsw-shadow-lv2); }
.fnm-full-title { font-size: 20px; font-weight: 650; line-height: 1.3; text-align: center; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-full-artist { font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: center; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-full-left .fnm-progress { margin-top: 2px; }
.fnm-full-controls { display: flex; align-items: center; justify-content: center; gap: 6px; }
.fnm-full-controls .fnm-play-btn { width: 44px; height: 44px; }
.fnm-full-side { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.fnm-full-right { min-width: 0; min-height: 300px; display: flex; flex-direction: column; justify-content: center; }
.fnm-full-queue { position: relative; z-index: 1; border-top: 1px solid var(--dsw-alias-border-l1); padding: 8px 14px 10px; background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 84%, transparent); max-height: 150px; overflow: auto; }
.fnm-full-queue-list { display: flex; flex-direction: column; gap: 1px; }
.fnm-full-queue-row { display: flex; align-items: center; gap: 8px; padding: 4px 5px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
.fnm-full-queue-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-full-queue-title { flex: 1; min-width: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnm-btn.is-on { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
@media (max-width: 720px) {
  .fnm-float { width: min(330px, calc(100vw - 16px)); }
  .fnm-float-full { width: calc(100vw - 16px); max-height: calc(100vh - 16px); }
  .fnm-full-body { grid-template-columns: 1fr; gap: 10px; padding: 12px; }
  .fnm-full-cover { width: 170px !important; height: 170px !important; }
  .fnm-full-right { min-height: 220px; }
  .fnm-lyrics { max-height: 240px; }
}
@container (max-width: 760px) {
  .fnm-player-side { display: none; }
  .fnm-header-actions .fnm-conn-latency { display: none; }
}
@media (max-width: 720px) {
  .fnm-player-side { display: none; }
  .fnm-now { gap: 8px; }
  .fnm-header-actions .fnm-conn { display: none; }
  .fnm-device { flex-direction: column; }
  .fnm-device-actions { justify-content: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .fnm-marquee.is-overflow .fnm-marquee-inner { animation: none; }
}

/* ---- V3 original-web app shell ---- */
.fnm-app.fnm-panel { max-width: none; margin: 0; height: 100%; background: var(--dsw-alias-bg-base); }
.fnm-app { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.fnm-top { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); flex: none; }
[data-platform='darwin'] .fnm-top { padding-top: calc(8px + var(--dsh-frame-top-clearance, 0px)); }
.fnm-top-left { display: flex; align-items: center; gap: 3px; min-width: 0; flex: none; }
.fnm-top-forward .fnm-icon { transform: rotate(0deg); }
.fnm-top-forward .fnm-icon { transform: scaleX(-1); }
.fnm-top-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; flex: none; }
.fnm-top-icon:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.fnm-top-icon:disabled { opacity: .35; cursor: default; }
.fnm-top-icon.is-on { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); }
.fnm-top-brand { cursor: pointer; padding: 0 4px; }
.fnm-top-brand-text { font-size: 13px; font-weight: 650; white-space: nowrap; }
.fnm-top-search { flex: 1; min-width: 120px; max-width: 540px; display: flex; align-items: center; gap: 7px; margin: 0 auto; padding: 0 10px; height: 32px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-tertiary); }
.fnm-top-search:focus-within { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
.fnm-top-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; }
.fnm-top-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
.fnm-top-actions { display: flex; align-items: center; gap: 5px; flex: none; }
.fnm-top-connection { margin-right: 2px; }
.fnm-device-capsule { display: inline-flex; align-items: center; gap: 6px; max-width: 160px; height: 28px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }
.fnm-device-capsule:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.fnm-device-capsule span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-avatar { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 600; cursor: pointer; flex: none; }
.fnm-avatar-sm { width: 22px; height: 22px; font-size: 10px; }
.fnm-app-body { flex: 1; min-height: 0; display: flex; }
.fnm-nav { width: 204px; flex: none; display: flex; flex-direction: column; gap: 10px; padding: 12px 8px 8px; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); overflow: auto; }
.fnm-nav-group { display: flex; flex-direction: column; gap: 1px; }
.fnm-nav-label { padding: 8px 10px 4px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.fnm-nav-item { display: flex; align-items: center; gap: 9px; width: 100%; height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: left; cursor: pointer; }
.fnm-nav-item:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.fnm-nav-item.is-active { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
.fnm-nav-item.is-active .fnm-icon { color: var(--dsw-alias-brand-primary); }
.fnm-nav-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-nav-bottom { margin-top: auto; display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.fnm-nav-meta { padding: 0 10px; font-size: 10px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-app-content { flex: 1; min-width: 0; overflow: auto; padding: 20px 24px 28px; }
.fnm-view { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.fnm-view-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.fnm-view-title { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 680; letter-spacing: -.02em; }
.fnm-view-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.fnm-view-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fnm-home-view { gap: 24px; }
.fnm-hero { position: relative; overflow: hidden; display: flex; align-items: stretch; gap: 22px; min-height: 210px; padding: 20px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 18px; background: linear-gradient(120deg, var(--dsw-alias-bg-layer-2), var(--dsw-alias-bg-base)); }
.fnm-hero-cover { width: 172px; height: 172px; flex: none; border-radius: 12px; overflow: hidden; box-shadow: 0 14px 40px color-mix(in srgb, var(--dsw-alias-bg-base) 40%, transparent); z-index: 1; }
.fnm-hero-cover .fnm-cover { width: 100%; height: 100%; }
.fnm-hero-copy { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 0; }
.fnm-eyebrow { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.fnm-hero-title { margin: 0; font-size: clamp(24px, 3.4vw, 40px); line-height: 1.08; letter-spacing: -.03em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-hero-sub { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-hero-actions, .fnm-detail-actions, .fnm-now-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fnm-hero-stats { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.fnm-hero-glow { position: absolute; inset: auto -20% -60% 35%; height: 300px; background: radial-gradient(circle, color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent), transparent 65%); pointer-events: none; }
.fnm-v3-section { display: flex; flex-direction: column; gap: 10px; }
.fnm-v3-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.fnm-v3-section-title { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.fnm-media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.fnm-media-grid-round { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.fnm-media-card { min-width: 0; padding: 8px; border-radius: 12px; cursor: pointer; border: 1px solid transparent; background: transparent; }
.fnm-media-card:hover { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); }
.fnm-media-cover { position: relative; aspect-ratio: 1; border-radius: 9px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); }
.fnm-media-cover.is-round { border-radius: 50%; }
.fnm-media-cover .fnm-cover { width: 100%; height: 100%; }
.fnm-media-play { position: absolute; right: 8px; bottom: 8px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 50%; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); box-shadow: 0 4px 14px rgba(0,0,0,.28); cursor: pointer; opacity: 0; transform: translateY(3px); transition: .15s ease; }
.fnm-media-card:hover .fnm-media-play { opacity: 1; transform: translateY(0); }
.fnm-media-title { margin-top: 7px; font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-media-sub { margin-top: 2px; font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-recent-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px; }
.fnm-recent-row { display: flex; align-items: center; gap: 9px; padding: 5px 7px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; min-width: 0; }
.fnm-recent-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-recent-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fnm-recent-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-recent-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-recent-time { font-size: 10px; flex: none; }
.fnm-aside { width: 274px; flex: none; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); padding: 14px 12px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.fnm-aside-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 600; }
.fnm-aside-current { display: flex; align-items: center; gap: 9px; padding: 9px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.fnm-aside-current-text { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.fnm-aside-title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-aside-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-aside-label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.fnm-aside-list { display: flex; flex-direction: column; gap: 1px; }
.fnm-aside-row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.fnm-aside-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-aside-index { width: 18px; font-size: 10px; color: var(--dsw-alias-label-tertiary); flex: none; }
.fnm-aside-item-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fnm-aside-item-title { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-aside-item-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-app > .fnm-player { border-top: 1px solid var(--dsw-alias-border-l1); border-bottom: 0; background: var(--dsw-alias-bg-layer-1); padding: 9px 14px 7px; flex: none; }
.fnm-song-table { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; overflow: hidden; background: var(--dsw-alias-bg-base); }
.fnm-song-head, .fnm-song-row { display: grid; grid-template-columns: 42px minmax(190px, 1.6fr) minmax(100px, .9fr) 70px 54px 64px; align-items: center; gap: 8px; padding: 0 10px; }
.fnm-song-head { height: 32px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.fnm-song-row { min-height: 48px; cursor: pointer; border-bottom: 1px solid transparent; content-visibility: auto; contain-intrinsic-size: 48px; }
.fnm-song-row:last-child { border-bottom: 0; }
.fnm-song-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-song-row.is-current { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); }
.fnm-song-row.is-selected { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.fnm-song-index { display: flex; align-items: center; gap: 7px; font-size: 10px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.fnm-song-index input { accent-color: var(--dsw-alias-brand-primary); }
.fnm-song-playing { font-size: 8px; letter-spacing: -1px; color: var(--dsw-alias-brand-primary); }
.fnm-song-main { display: flex; align-items: center; gap: 9px; min-width: 0; }
.fnm-song-cover { position: relative; width: 38px; height: 38px; flex: none; border-radius: 7px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); }
.fnm-song-cover .fnm-cover { width: 100%; height: 100%; }
.fnm-song-playglyph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.38); color: #fff; opacity: 0; }
.fnm-song-row:hover .fnm-song-playglyph { opacity: 1; }
.fnm-song-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fnm-song-title { font-size: 12px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-song-artist { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-song-album, .fnm-song-duration { font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-song-quality { display: flex; }
.fnm-quality { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l2); font-size: 9px; letter-spacing: .04em; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.fnm-quality-lossless, .fnm-quality-hires { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, transparent); }
.fnm-song-actions { display: flex; align-items: center; justify-content: flex-end; gap: 1px; }
.fnm-song-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.fnm-song-icon:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.fnm-song-icon.is-on { color: var(--dsw-alias-state-error-primary); }
.fnm-selection-bar { position: sticky; bottom: 8px; z-index: 4; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent); box-shadow: 0 8px 26px rgba(0,0,0,.18); backdrop-filter: blur(8px); }
.fnm-selection-count { font-size: 11px; font-weight: 600; margin-right: 4px; }
.fnm-load-more { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 4px 0 2px; }
.fnm-load-sentinel { width: 100%; height: 1px; }
.fnm-detail-hero { display: flex; align-items: flex-end; gap: 20px; flex-wrap: wrap; }
.fnm-detail-hero .fnm-back { align-self: flex-start; }
.fnm-detail-copy { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.fnm-detail-title { margin: 0; font-size: clamp(24px, 3.4vw, 38px); line-height: 1.08; letter-spacing: -.03em; }
.fnm-detail-sub { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.fnm-folder-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.fnm-folder-bar .fnm-input { flex: 1; }
.fnm-input { height: 32px; min-width: 0; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
.fnm-input:focus { border-color: var(--dsw-alias-brand-primary); }
.fnm-input-sm { height: 26px; font-size: 11px; }
.fnm-history-list { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; overflow: hidden; }
.fnm-history-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.fnm-history-row:last-child { border-bottom: 0; }
.fnm-history-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-history-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fnm-history-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-history-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-history-duration, .fnm-history-date { font-size: 10px; flex: none; }
.fnm-history-date { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-now-view { max-width: 1180px; }
.fnm-now-main-panel { display: flex; gap: 26px; align-items: stretch; flex-wrap: wrap; }
.fnm-now-art { width: min(340px, 36vw); aspect-ratio: 1; flex: none; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 54px rgba(0,0,0,.3); }
.fnm-now-art .fnm-cover { width: 100%; height: 100%; }
.fnm-now-copy { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 9px; justify-content: center; }
.fnm-now-title { margin: 0; font-size: clamp(26px, 4vw, 44px); line-height: 1.05; letter-spacing: -.035em; }
.fnm-now-sub { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.fnm-chip-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.fnm-chip { display: inline-flex; align-items: center; height: 21px; padding: 0 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.fnm-chip-accent { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent); }
.fnm-now-progress { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.fnm-now-times { display: flex; justify-content: space-between; font-size: 10px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.fnm-now-controls { margin-top: 2px; }
.fnm-play-btn-lg { width: 48px; height: 48px; }
.fnm-now-extra { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
.fnm-now-side-panel { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
.fnm-now-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 12px; background: var(--dsw-alias-bg-layer-1); }
.fnm-now-lyrics { height: 230px; overflow: auto; margin-top: 8px; }
.fnm-upnext { display: flex; flex-direction: column; gap: 1px; margin-top: 6px; }
.fnm-upnext-row { display: flex; align-items: center; gap: 8px; padding: 5px 4px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.fnm-upnext-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-upnext-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; font-size: 11px; }
.fnm-upnext-text .fnm-muted { font-size: 10px; }
.fnm-range-tabs { display: flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.fnm-range-tab { height: 26px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }
.fnm-range-tab.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.fnm-stats-content { display: flex; flex-direction: column; gap: 14px; }
.fnm-stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.fnm-stat-card { padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.fnm-stat-value { font-size: 22px; font-weight: 680; letter-spacing: -.02em; }
.fnm-stat-label { margin-top: 2px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.fnm-stat-panel { padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-base); }
.fnm-bars { display: flex; align-items: flex-end; gap: 4px; height: 150px; padding-top: 10px; overflow: hidden; }
.fnm-bar-col { flex: 1; min-width: 4px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
.fnm-bar-wrap { width: 100%; flex: 1; display: flex; align-items: flex-end; }
.fnm-bar { width: 100%; min-height: 2px; border-radius: 3px 3px 0 0; background: linear-gradient(var(--dsw-alias-brand-primary), color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent)); }
.fnm-bar-label { font-size: 8px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.fnm-hour-grid { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; margin-top: 10px; }
.fnm-hour-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 4px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); font-size: 7px; overflow: hidden; }
.fnm-stat-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.fnm-stat-list-panel { padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-base); }
.fnm-stat-rows { display: flex; flex-direction: column; margin-top: 6px; }
.fnm-stat-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 2px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.fnm-stat-row:last-child { border-bottom: 0; }
.fnm-stat-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-stat-rank { width: 18px; font-size: 9px; color: var(--dsw-alias-label-tertiary); }
.fnm-stat-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; font-size: 11px; overflow: hidden; }
.fnm-stat-name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-stat-name .fnm-muted { font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-stat-count { font-size: 9px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.fnm-stats-actions { justify-content: flex-end; }
.fnm-scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.fnm-scene-card { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 13px; background: var(--dsw-alias-bg-layer-1); color: inherit; text-align: left; cursor: pointer; }
.fnm-scene-card:hover { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l2)); background: var(--dsw-alias-bg-layer-2); }
.fnm-scene-card.is-active { border-color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1)); }
.fnm-scene-card:disabled { opacity: .65; cursor: default; }
.fnm-scene-icon { color: var(--dsw-alias-brand-primary); margin-bottom: 3px; }
.fnm-scene-title { font-size: 14px; font-weight: 650; }
.fnm-scene-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
.fnm-scene-action { margin-top: 4px; font-size: 10px; color: var(--dsw-alias-brand-primary); font-weight: 600; }
.fnm-scene-active { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid var(--dsw-alias-brand-primary); border-radius: 11px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); }
.fnm-scene-active-title { font-size: 16px; font-weight: 650; margin-top: 2px; }
.fnm-scene-note { font-size: 10px; }
.fnm-connect-wrap { flex: 1; min-height: 0; overflow: auto; display: flex; justify-content: center; padding: 24px 16px; }
.fnm-connect { width: min(640px, 100%); display: flex; flex-direction: column; gap: 16px; }
.fnm-connect-hero { text-align: center; padding: 28px 16px 4px; }
.fnm-connect-hero h1 { margin: 10px 0 4px; font-size: 25px; letter-spacing: -.03em; }
.fnm-connect-hero p { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.fnm-brand-icon-lg { width: 52px; height: 52px; border-radius: 14px; margin: 0 auto; }
.fnm-settings-view { max-width: 900px; }
.fnm-local-section { margin-top: 12px; }
.fnm-listener-list { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
.fnm-listener-row { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.fnm-listener-row.is-active { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l2)); }
.fnm-listener-name { flex: 1; font-size: 12px; font-weight: 600; }
.fnm-listener-actions { display: flex; align-items: center; gap: 3px; }
.fnm-inline-form { display: flex; gap: 6px; align-items: center; }
.fnm-inline-form .fnm-input { flex: 1; }
.fnm-listener-note { margin-top: 6px; }
.fnm-audit-list { display: flex; flex-direction: column; gap: 1px; margin-top: 6px; }
.fnm-audit-row { display: flex; align-items: center; gap: 7px; padding: 5px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 10px; }
.fnm-audit-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-error-primary); flex: none; }
.fnm-audit-dot.is-ok { background: var(--dsw-alias-state-success-primary); }
.fnm-audit-tool { font-weight: 600; }
.fnm-audit-result { margin-left: auto; }
.fnm-section-head-gap { margin-top: 14px; }
.fnm-traffic-summary { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.fnm-traffic-via { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.fnm-context-menu { position: fixed; z-index: 2000; min-width: 210px; padding: 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 16px 50px rgba(0,0,0,.3); }
.fnm-context-title { padding: 6px 8px; font-size: 10px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-context-menu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 11px; text-align: left; cursor: pointer; }
.fnm-context-menu button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-listener-menu { position: fixed; z-index: 2001; top: 52px; right: 16px; min-width: 220px; padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 16px 50px rgba(0,0,0,.3); }
.fnm-listener-menu-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.fnm-listener-menu-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fnm-listener-menu-row.is-active { background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
.fnm-listener-menu-manage { display: flex; align-items: center; gap: 7px; width: 100%; margin-top: 4px; padding: 7px 8px; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); border-radius: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: left; cursor: pointer; }
.fnm-empty-view { align-items: center; justify-content: center; min-height: 280px; text-align: center; color: var(--dsw-alias-label-secondary); }
.fnm-error-box { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px; text-align: center; }
.fnm-skeleton { border-radius: 9px; background: linear-gradient(90deg, var(--dsw-alias-bg-layer-1), var(--dsw-alias-bg-layer-2), var(--dsw-alias-bg-layer-1)); background-size: 200% 100%; animation: fnm-shimmer 1.4s ease-in-out infinite; }
.fnm-skeleton-hero { height: 210px; }
.fnm-skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.fnm-skeleton-card { height: 170px; }
@keyframes fnm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.fnm-selection-bar .fnm-btn { height: 27px; }
.fnm-selection-bar .fnm-btn .fnm-icon { width: 13px; height: 13px; }
@media (max-width: 1080px) {
  .fnm-aside { display: none; }
  .fnm-song-head, .fnm-song-row { grid-template-columns: 42px minmax(170px, 1.6fr) minmax(90px, .9fr) 70px 54px 58px; }
}
@container (max-width: 980px) {
  .fnm-aside { display: none; }
  .fnm-nav { width: 64px; padding: 10px 6px; }
  .fnm-nav-text, .fnm-nav-label, .fnm-nav-meta { display: none; }
  .fnm-nav-item { justify-content: center; padding: 0; }
  .fnm-nav-bottom .fnm-nav-item { justify-content: center; }
  .fnm-app-content { padding: 16px 16px 22px; }
  .fnm-song-album, .fnm-song-col-optional { display: none; }
  .fnm-song-head, .fnm-song-row { grid-template-columns: 34px minmax(160px, 1fr) 62px 50px 58px; }
  .fnm-top-brand-text { display: none; }
  .fnm-top-connection { display: none; }
  .fnm-now-art { width: 100%; max-width: 300px; }
}
@container (max-width: 720px) {
  .fnm-top-search { max-width: none; }
  .fnm-device-capsule span { display: none; }
  .fnm-hero { flex-direction: column; align-items: flex-start; }
  .fnm-hero-cover { width: 132px; height: 132px; }
  .fnm-media-grid { grid-template-columns: repeat(auto-fill, minmax(115px, 1fr)); gap: 8px; }
  .fnm-song-quality { display: none; }
  .fnm-song-head, .fnm-song-row { grid-template-columns: 32px minmax(140px, 1fr) 50px 54px; }
  .fnm-now-main-panel { flex-direction: column; }
  .fnm-now-art { width: 100%; max-width: 260px; }
  .fnm-view-title { font-size: 21px; }
  .fnm-history-date { display: none; }
  .fnm-selection-bar { position: static; }
}

`;

    /* ------------------------------------------------------------------ *
     * Panel opener + apply
     * ------------------------------------------------------------------ */

    let layoutService = null;
    let clientContext = null;
    function openPanel() {
      try {
        const layout = layoutService || (clientContext && typeof clientContext.get === 'function' ? clientContext.get('layout') : undefined);
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID);
      } catch {
        // A missing panel registration must not break the footer.
      }
    }

    function apply(ctx) {
      clientContext = ctx;
      const t = ctx.locale.bind(NS);
      translate = t;

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-fnos-music: locale');

      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-fnos-music';
        style.dataset.pluginCss = 'dsh-fnos-music/client.css';
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => {
          style.remove();
        };
      }, 'dsh-fnos-music: styles');

      ctx.effect(() => {
        const onKeyDown = (event) => {
          const settings = store.snapshot && store.snapshot.settings;
          if (!settings || settings.shortcuts === false) return;
          if (event.defaultPrevented || event.isComposing) return;
          if (event.ctrlKey || event.metaKey) return;
          const target = event.target;
          if (target && typeof target.closest === 'function'
            && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], button, a')) return;
          if (typeof document !== 'undefined' && typeof document.querySelector === 'function' && document.querySelector('dialog[open]')) return;
          const player = store.snapshot && store.snapshot.player;
          if (!player || !player.track) return;
          if (event.key === ' ' || event.code === 'Space') {
            if (event.repeat) return;
            event.preventDefault();
            void togglePlay();
            return;
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            if (event.altKey) return;
            event.preventDefault();
            if (event.shiftKey) {
              if (!event.repeat) void skip(event.key === 'ArrowRight' ? 1 : -1);
            } else {
              const delta = event.key === 'ArrowRight' ? 5000 : -5000;
              void seekTo(Math.max(0, Math.min(player.track.durationSec * 1000, player.positionMs + delta)));
            }
            return;
          }
          if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey) {
            event.preventDefault();
            void changeVolume(player.volume + (event.key === 'ArrowUp' ? 5 : -5));
            return;
          }
          if (event.key === 'm' || event.key === 'M') {
            if (!event.repeat) void toggleMute();
            return;
          }
          if (event.key === 'l' || event.key === 'L') {
            if (!event.repeat) void toggleFavorite(player.track);
            return;
          }
          if ((event.key === 'e' || event.key === 'E') && !event.repeat) {
            if (typeof floatWindowToggle === 'function') floatWindowToggle();
          }
        };
        const onPageHide = () => {
          try {
            const body = JSON.stringify({ clientId });
            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
              navigator.sendBeacon(`${API}/client/leave`, new Blob([body], { type: 'application/json' }));
            } else if (typeof fetch === 'function') {
              void fetch(`${API}/client/leave`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                keepalive: true,
              }).catch(() => {});
            }
          } catch {
            // A page teardown must never block the unload.
          }
        };
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('pagehide', onPageHide);
          window.addEventListener('keydown', onKeyDown);
        }
        startEvents();
        void refreshState();
        void heartbeat();
        heartbeatTimer = setInterval(() => {
          void heartbeat();
        }, 10000);
        return () => {
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('keydown', onKeyDown);
          }
          stopEvents();
          if (heartbeatTimer !== null) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          if (toastTimer !== null) {
            clearTimeout(toastTimer);
            toastTimer = null;
          }
          if (volumeTimer !== null) {
            clearTimeout(volumeTimer);
            volumeTimer = null;
          }
          stopAudio();
          closeAudioContext();
        };
      }, 'dsh-fnos-music: events/audio');

      ctx.inject(['layout'], (scope) => {
        layoutService = scope.layout;
      });

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: () => t('panel'),
        locale: NS,
      }, SidebarIcon));

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, Panel));

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: PANEL_ID,
        order: -10,
        label: () => t('panel'),
        locale: NS,
      }, FooterAction));

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'fnos-music-mini',
        order: 10,
        label: () => t('playingFloat'),
        locale: NS,
      }, FloatingPlayer));
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
