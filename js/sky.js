import { lerp, smoothstep } from './util.js';

// How the light over the pond looks at each phase of the day.
// tint: multiplied over the whole scene · caustic: sunlight net on the floor
// glare: soft sky reflection · shadow: strength of cast shadows · fireflies: 0..1
const PHASES = {
  night: { tint: [92, 118, 176], caustic: 0.025, glare: 0.08, glareColor: [150, 176, 255], shadow: 0.16, fireflies: 1 },
  dawn: { tint: [236, 208, 210], caustic: 0.06, glare: 0.1, glareColor: [255, 198, 172], shadow: 0.24, fireflies: 0.15 },
  day: { tint: [255, 255, 255], caustic: 0.1, glare: 0.12, glareColor: [255, 248, 222], shadow: 0.3, fireflies: 0 },
  dusk: { tint: [255, 182, 138], caustic: 0.05, glare: 0.15, glareColor: [255, 150, 92], shadow: 0.22, fireflies: 0.45 },
};

// Local-clock keyframes for "auto" mode.
const SCHEDULE = [
  [0, 'night'], [4.8, 'night'], [6.1, 'dawn'], [7.6, 'day'],
  [16.9, 'day'], [18.3, 'dusk'], [19.8, 'night'], [24, 'night'],
];

export const TIME_MODES = ['auto', 'dawn', 'day', 'dusk', 'night'];
const FIXED_HOUR = { dawn: 6.1, day: 12, dusk: 18.3, night: 23 };

export function hourFor(mode, date = new Date()) {
  if (mode in FIXED_HOUR) return FIXED_HOUR[mode];
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

function mix(a, b, t) {
  return {
    tint: a.tint.map((v, i) => lerp(v, b.tint[i], t)),
    caustic: lerp(a.caustic, b.caustic, t),
    glare: lerp(a.glare, b.glare, t),
    glareColor: a.glareColor.map((v, i) => lerp(v, b.glareColor[i], t)),
    shadow: lerp(a.shadow, b.shadow, t),
    fireflies: lerp(a.fireflies, b.fireflies, t),
  };
}

export function paletteAt(hour, rain) {
  let i = 0;
  while (i < SCHEDULE.length - 2 && hour >= SCHEDULE[i + 1][0]) i++;
  const [h0, p0] = SCHEDULE[i];
  const [h1, p1] = SCHEDULE[i + 1];
  const p = mix(PHASES[p0], PHASES[p1], smoothstep(h0, h1, hour));
  if (rain) {
    p.tint = [p.tint[0] * 0.8, p.tint[1] * 0.85, p.tint[2] * 0.9];
    p.caustic *= 0.3;
    p.glare *= 0.35;
    p.shadow *= 0.6;
    p.fireflies *= 0.3;
  }
  return p;
}

export const blendPalette = mix;
