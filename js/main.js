import { World, autoKoiCount } from './world.js';
import { Ambience } from './audio.js';
import { TIME_MODES, hourFor } from './sky.js';
import { clamp } from './util.js';

const STORAGE_KEY = 'hush-pond:settings';
const REPO_URL = 'https://github.com/jeiel85/hush-pond';
const MAX_KOI = 30;

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

let stored = readStored();
function persist(patch) {
  stored = { ...stored, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // storage unavailable (private mode, blocked site data): settings simply won't survive a reload
  }
}

const params = new URLSearchParams(location.search);
const fromUrl = {};
if (params.has('koi')) fromUrl.koi = clamp(parseInt(params.get('koi'), 10) || 0, 0, MAX_KOI);
if (TIME_MODES.includes(params.get('time'))) fromUrl.time = params.get('time');
if (params.has('rain')) fromUrl.rain = params.get('rain') === '1';
if (params.has('sound')) fromUrl.sound = params.get('sound') === '1';
if (/^\d+$/.test(params.get('seed') ?? '')) fromUrl.seed = Number(params.get('seed')) >>> 0;
const settings = { sound: false, rain: false, time: 'auto', koi: 0, fed: false, ...stored, ...fromUrl };
if (!Number.isInteger(settings.seed)) {
  settings.seed = (Math.random() * 2 ** 32) >>> 0;
  persist({ seed: settings.seed });
}
if (!TIME_MODES.includes(settings.time)) settings.time = 'auto';

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

let quality = 1; // lowered automatically if the device struggles
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

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 120);
});

// ---------- loop ----------

let last = performance.now();
let perfWindow = 0;
let perfFrames = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!world.ready) {
    requestAnimationFrame(frame);
    return;
  }
  world.update(dt, { hour: hourFor(settings.time), rain: settings.rain });
  world.render(ctx);
  audio.setNight(world.palette.fireflies);

  // adaptive resolution: if we sit below ~35 fps for a few seconds, render fewer pixels
  perfWindow += dt;
  perfFrames++;
  if (perfWindow > 3) {
    if (perfFrames / perfWindow < 35 && quality > 0.55 && world.time > 4) {
      quality = Math.max(0.55, quality * 0.8);
      resize();
    }
    perfWindow = 0;
    perfFrames = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame((now) => {
  last = now;
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

// Browsers only start audio from a user gesture, so a remembered "sound on" resumes on the first one.
function unlockAudio() {
  if (settings.sound && !audio.on) setSound(true);
}
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

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
