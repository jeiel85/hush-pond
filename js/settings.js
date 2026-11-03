import { TIME_MODES } from './sky.js';
import { clamp } from './util.js';

export const MAX_KOI = 30;
export const DEFAULTS = { sound: false, rain: false, time: 'auto', koi: 0, fed: false };

/**
 * Keeps only well-formed settings. Anything missing, mistyped or unknown is dropped so the
 * default applies — stored data can be stale, hand-edited or corrupted.
 * koi: 0 means "pick a count for this screen size".
 */
export function sanitize(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of ['sound', 'rain', 'fed']) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  if (TIME_MODES.includes(src.time)) out.time = src.time;
  if (Number.isInteger(src.koi)) out.koi = clamp(src.koi, 0, MAX_KOI);
  if (Number.isInteger(src.seed) && src.seed >= 0 && src.seed <= 0xffffffff) out.seed = src.seed;
  return out;
}

/** Settings given in the address bar (?koi ?time ?rain ?sound ?seed), already sanitized. */
export function fromParams(params) {
  const raw = {};
  const int = (key) => (/^\d+$/.test(params.get(key) ?? '') ? Number(params.get(key)) : undefined);
  if (params.has('koi')) raw.koi = int('koi');
  if (params.has('time')) raw.time = params.get('time');
  if (params.has('rain')) raw.rain = params.get('rain') === '1';
  if (params.has('sound')) raw.sound = params.get('sound') === '1';
  if (params.has('seed')) raw.seed = int('seed');
  return sanitize(raw);
}

/** ?fps=N caps the frame rate (10–120) for wallpaper hosts and battery; 0 means uncapped. */
export function fpsCapFrom(params) {
  const n = Number(params.get('fps'));
  return Number.isInteger(n) && n >= 10 && n <= 120 ? n : 0;
}
