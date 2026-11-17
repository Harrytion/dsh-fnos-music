export const API_PREFIX = '/music/api/v1';
/** FN Connect clusters. An FN ID is pinned to one of them by the NAS setting. */
export const RELAY_DOMAINS = ['fnos.net', '5ddd.com'];
/** The FN Connect gateway only passes API calls through when this is present. */
export const RELAY_COOKIE = 'mode=relay';
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
