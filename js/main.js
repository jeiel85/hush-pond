import { World, autoKoiCount } from './world.js';
import { Ambience } from './audio.js';
import { TIME_MODES, hourFor } from './sky.js';
import { DEFAULTS, MAX_KOI, sanitize, fromParams, fpsCapFrom } from './settings.js';
import { clamp } from './util.js';

const STORAGE_KEY = 'hush-pond:settings';
const REPO_URL = 'https://github.com/jeiel85/hush-pond';
const MAX_STEP = 1 / 30; // largest simulation step that keeps steering stable
const MAX_CATCH_UP = 0.25; // after a stall (hidden tab), fast-forward at most this many seconds
const MIN_QUALITY = 0.55;

const STRINGS = {
  ko: {
    hint: '탭해서 먹이를 주세요 · 끌면 물결이 일어요',
    time: { auto: '자동', dawn: '새벽', day: '낮', dusk: '노을', night: '밤' },
    timeTitle: '시간대 바꾸기 (T)',
    rainOn: '비 그치게 하기 (R)',
    rainOff: '비 내리기 (R)',
    soundOn: '소리 끄기 (M)',
    soundOff: '소리 켜기 (M)',
    less: '잉어 줄이기 (−)',
    more: '잉어 늘리기 (+)',
    count: '잉어 수',
    full: '전체 화면 (F)',
    exitFull: '전체 화면 끝내기 (F)',
    about: '정보',
    canvas: '잉어가 헤엄치는 연못',
    aboutBody: '아무 생각 없이 바라보기 좋은 작은 잉어 연못이에요. 먹이를 주거나, 물을 휘저어 보거나, 그냥 틀어 두세요.',
    keys: [
      ['클릭 · 탭', '먹이 주기'],
      ['드래그', '물결 만들기'],
      ['Space', '아무 데나 먹이 주기'],
      ['T', '시간대 (자동은 내 시계를 따라가요)'],
      ['R', '비'],
      ['M', '소리'],
      ['+ / −', '잉어 수'],
      ['F', '전체 화면'],
      ['H', 'UI 숨기기'],
    ],
    wallpaper: '바탕화면으로 쓰려면 주소 끝에 <code>?ui=0</code>을 붙여 Lively Wallpaper(Windows)나 Plash(macOS)에 넣어 보세요.',
    source: 'GitHub에서 소스 보기',
    close: '닫기',
  },
  en: {
    hint: 'Tap to feed · drag to ripple the water',
    time: { auto: 'Auto', dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' },
    timeTitle: 'Change time of day (T)',
    rainOn: 'Stop the rain (R)',
    rainOff: 'Make it rain (R)',
    soundOn: 'Mute (M)',
    soundOff: 'Sound on (M)',
    less: 'Fewer koi (−)',
    more: 'More koi (+)',
    count: 'Koi',
    full: 'Fullscreen (F)',
    exitFull: 'Exit fullscreen (F)',
    about: 'About',
    canvas: 'A pond with koi swimming in it',
    aboutBody: 'A small koi pond to stare at while your mind wanders. Feed them, stir the water, or just leave it running.',
    keys: [
      ['Click · Tap', 'Feed'],
      ['Drag', 'Ripple the water'],
      ['Space', 'Feed somewhere'],
      ['T', 'Time of day (Auto follows your clock)'],
      ['R', 'Rain'],
      ['M', 'Sound'],
      ['+ / −', 'Number of koi'],
      ['F', 'Fullscreen'],
      ['H', 'Hide the UI'],
    ],
    wallpaper: 'For a live wallpaper, add <code>?ui=0</code> to the address and load it in Lively Wallpaper (Windows) or Plash (macOS).',
    source: 'Source on GitHub',
    close: 'Close',
  },
};
const LANG = (navigator.language || 'en').toLowerCase().startsWith('ko') ? 'ko' : 'en';
const T = STRINGS[LANG];
document.documentElement.lang = LANG;

const TIME_ICONS = { auto: 'i-clock', dawn: 'i-sunrise', day: 'i-sun', dusk: 'i-sunset', night: 'i-moon' };

// ---------- settings: stored ← URL overrides (URL values are not written back) ----------

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {}; // storage blocked or corrupted: start from defaults
  }
}

let stored = sanitize(readStored());
function persist(patch) {
  stored = { ...stored, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // storage unavailable (private mode, blocked site data): settings simply won't survive a reload
  }
}

const params = new URLSearchParams(location.search);
const fpsCap = fpsCapFrom(params);
const settings = { ...DEFAULTS, ...stored, ...fromParams(params) };
if (settings.seed === undefined) {
  settings.seed = (Math.random() * 2 ** 32) >>> 0;
  persist({ seed: settings.seed });
}

// ---------- world ----------

const canvas = document.getElementById('pond');
const ctx = canvas.getContext('2d', { alpha: false });
const audio = new Ambience();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const world = new World(settings.seed, {
  motion: reducedMotion ? 0.4 : 1,
  onPlop: () => audio.plop(),
  onGulp: () => audio.gulp(),
});

let quality = 1; // render-resolution scale, tuned by `perf` below
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  // the first real layout decides how many koi a screen this size gets
  if (world.resize(w, h, dpr) && !world.koi.length) {
    world.setKoiCount(settings.koi || autoKoiCount(w, h));
    sync();
  }
}

// Adaptive resolution: render fewer pixels while frames are slow, win them back when there is headroom.
const perf = {
  span: 0,
  frames: 0,
  fastWindows: 0,
  ceiling: 1, // set to the last good level when a step up proves too much, so quality doesn't seesaw
  lastRaise: -Infinity,
  beforeRaise: 1,
  reset() {
    this.span = 0;
    this.frames = 0;
  },
  sample(gap) {
    // a stall (hidden tab, throttled host, resize) says nothing about what a frame costs
    if (gap > MAX_CATCH_UP) {
      this.reset();
      return;
    }
    this.span += gap;
    this.frames++;
    if (this.span < 3) return;
    const fps = this.frames / this.span;
    const target = fpsCap || 60;
    this.reset();
    if (fps < Math.min(35, target * 0.75)) {
      this.fastWindows = 0;
      if (quality <= MIN_QUALITY) return;
      if (world.time - this.lastRaise < 20) {
        this.ceiling = this.beforeRaise;
        this.lastRaise = -Infinity;
      }
      setQuality(Math.max(MIN_QUALITY, quality * 0.8));
    } else if (fps >= target * 0.92) {
      this.fastWindows++;
      // after two smooth minutes, give a refused step another chance (conditions change)
      if (this.fastWindows >= 40) this.ceiling = 1;
      if (this.fastWindows >= 3 && quality < this.ceiling) {
        this.fastWindows = 0;
        this.beforeRaise = quality;
        this.lastRaise = world.time;
        setQuality(Math.min(this.ceiling, quality / 0.8));
      }
    } else {
      this.fastWindows = 0;
    }
  },
};

function setQuality(q) {
  quality = q;
  resize();
  perf.reset();
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resize();
    perf.reset();
  }, 120);
});

// ---------- loop ----------

let last = performance.now(); // last rendered frame
let lastTick = last; // last animation callback, rendered or skipped by the cap
function frame(now) {
  requestAnimationFrame(frame);
  // judge cost by the callback rate: it drops when frames get expensive, with or without a cap
  perf.sample((now - lastTick) / 1000);
  lastTick = now;
  const gap = (now - last) / 1000;
  if (fpsCap && gap < 1 / fpsCap - 0.002) return; // not this display refresh; wait for the next slot
  last = now;
  if (!world.ready) return;
  // Slow or throttled frames are split into small steps so the pond keeps real time instead of
  // slowing down; a long stall is capped so the koi don't teleport when the tab comes back.
  const elapsed = Math.min(gap, MAX_CATCH_UP);
  const steps = Math.max(1, Math.ceil(elapsed / MAX_STEP));
  const env = { hour: hourFor(settings.time), rain: settings.rain };
  for (let i = 0; i < steps; i++) world.update(elapsed / steps, env);
  world.render(ctx);
  audio.setNight(world.palette.fireflies);
}
requestAnimationFrame((now) => {
  last = now;
  lastTick = now;
  frame(now);
});

// ---------- UI ----------

const $ = (id) => document.getElementById(id);
const ui = {
  time: $('btn-time'),
  timeIcon: $('btn-time').querySelector('use'),
  timeLabel: $('time-label'),
  rain: $('btn-rain'),
  sound: $('btn-sound'),
  soundIcon: $('btn-sound').querySelector('use'),
  less: $('btn-less'),
  more: $('btn-more'),
  count: $('koi-count'),
  full: $('btn-full'),
  fullIcon: $('btn-full').querySelector('use'),
  about: $('btn-about'),
  dialog: $('about'),
  hint: $('hint'),
};
canvas.setAttribute('aria-label', T.canvas);
ui.count.title = T.count;
ui.less.title = T.less;
ui.less.setAttribute('aria-label', T.less);
ui.more.title = T.more;
ui.more.setAttribute('aria-label', T.more);
ui.about.title = T.about;
ui.about.setAttribute('aria-label', T.about);
ui.time.title = T.timeTitle;
ui.hint.textContent = T.hint;
if (!document.fullscreenEnabled) ui.full.hidden = true;

function label(el, text) {
  el.title = text;
  el.setAttribute('aria-label', text);
}

function sync() {
  ui.timeIcon.setAttribute('href', `#${TIME_ICONS[settings.time]}`);
  ui.timeLabel.textContent = T.time[settings.time];
  ui.time.setAttribute('aria-label', `${T.timeTitle}: ${T.time[settings.time]}`);
  ui.rain.setAttribute('aria-pressed', String(settings.rain));
  label(ui.rain, settings.rain ? T.rainOn : T.rainOff);
  ui.sound.setAttribute('aria-pressed', String(settings.sound));
  ui.soundIcon.setAttribute('href', settings.sound ? '#i-sound' : '#i-mute');
  label(ui.sound, settings.sound ? T.soundOn : T.soundOff);
  const n = world.activeKoi.length;
  ui.count.textContent = String(n);
  ui.less.disabled = n <= 1;
  ui.more.disabled = n >= MAX_KOI;
  const isFull = Boolean(document.fullscreenElement);
  ui.fullIcon.setAttribute('href', isFull ? '#i-shrink' : '#i-expand');
  label(ui.full, isFull ? T.exitFull : T.full);
}

function cycleTime() {
  settings.time = TIME_MODES[(TIME_MODES.indexOf(settings.time) + 1) % TIME_MODES.length];
  persist({ time: settings.time });
  sync();
}

function toggleRain() {
  settings.rain = !settings.rain;
  persist({ rain: settings.rain });
  audio.setRain(settings.rain);
  sync();
}

async function setSound(on) {
  settings.sound = on;
  persist({ sound: on });
  sync();
  if (!on) {
    audio.disable();
    return;
  }
  try {
    await audio.enable();
  } catch (err) {
    console.warn('hush pond: audio could not start', err);
    settings.sound = false;
    sync();
  }
}

function changeKoi(delta) {
  const n = clamp(world.activeKoi.length + delta, 1, MAX_KOI);
  world.setKoiCount(n);
  settings.koi = n;
  persist({ koi: n });
  sync();
}

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  const req = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  req.catch((err) => console.warn('hush pond: fullscreen request refused', err));
}

function openAbout() {
  const keys = T.keys.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('');
  ui.dialog.innerHTML = `
    <h2>hush pond</h2>
    <p>${T.aboutBody}</p>
    <dl class="keys">${keys}</dl>
    <p class="small">${T.wallpaper}</p>
    <footer>
      <a href="${REPO_URL}" target="_blank" rel="noopener">${T.source}</a>
      <form method="dialog"><button class="close" type="submit">${T.close}</button></form>
    </footer>`;
  ui.dialog.showModal();
}

ui.time.addEventListener('click', cycleTime);
ui.rain.addEventListener('click', toggleRain);
ui.sound.addEventListener('click', () => setSound(!settings.sound));
ui.less.addEventListener('click', () => changeKoi(-1));
ui.more.addEventListener('click', () => changeKoi(1));
ui.full.addEventListener('click', toggleFullscreen);
ui.about.addEventListener('click', openAbout);
document.addEventListener('fullscreenchange', sync);
audio.setRain(settings.rain);
sync();
resize();

// Browsers only start audio from a user gesture, so a remembered "sound on" starts on the first one.
// The same gesture also revives a context the OS interrupted (a call, another app taking audio).
function unlockAudio() {
  if (!settings.sound) return;
  if (audio.on) audio.resume();
  else setSound(true);
}
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) audio.resume();
});

// ---------- idle: the UI and cursor fade away so only the pond is left ----------

const body = document.body;
if (params.get('ui') === '0') body.classList.add('no-ui');
let idleTimer = 0;
let overDock = false;
function wake() {
  body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!overDock && !ui.dialog.open) body.classList.add('idle');
  }, 2600);
}
$('dock').addEventListener('pointerenter', () => (overDock = true));
$('dock').addEventListener('pointerleave', () => {
  overDock = false;
  wake();
});
ui.dialog.addEventListener('close', wake);
wake();

let hintTimer = 0;
function hideHint() {
  clearTimeout(hintTimer);
  ui.hint.classList.remove('show');
}
if (!settings.fed) {
  setTimeout(() => ui.hint.classList.add('show'), 1400);
  hintTimer = setTimeout(hideHint, 9000);
}

// ---------- pointer: tap to feed, drag to stir, flick fast to startle ----------

let drag = null;
let lastMove = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  wake();
  world.feed(e.clientX, e.clientY);
  if (!settings.fed) {
    settings.fed = true;
    persist({ fed: true });
    hideHint();
  }
  drag = { id: e.pointerId, dist: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  wake();
  const now = performance.now();
  if (lastMove) {
    const d = Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y);
    const dt = (now - lastMove.t) / 1000;
    const u = world.unit;
    if (dt > 0 && d / dt > 1600 * u) world.scare(e.clientX, e.clientY, 120 * u, clamp(d / dt / (4000 * u), 0.3, 1));
    if (drag && e.pointerId === drag.id) {
      drag.dist += d;
      if (drag.dist > 26 * u) {
        drag.dist = 0;
        world.stir(e.clientX, e.clientY);
      }
    }
  }
  lastMove = { x: e.clientX, y: e.clientY, t: now };
});
const endDrag = (e) => {
  if (drag && e.pointerId === drag.id) drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => (lastMove = null));

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || ui.dialog.open) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    world.feed(world.w * (0.3 + Math.random() * 0.4), world.h * (0.3 + Math.random() * 0.4));
  } else if (k === 't') cycleTime();
  else if (k === 'r') toggleRain();
  else if (k === 'm') setSound(!settings.sound);
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') body.classList.toggle('no-ui');
  else if (k === '+' || k === '=') changeKoi(1);
  else if (k === '-' || k === '_') changeKoi(-1);
  else return;
  wake();
});
