import { TAU, makeCanvas, mulberry32, hashSeed, range, rnd } from './util.js';

const PAD_GREENS = [
  ['#6aa452', '#2f6a33'],
  ['#5f9a4c', '#285f30'],
  ['#78ad5a', '#3a7438'],
  ['#58904a', '#24562b'],
];
const BLOOMS = [
  { weight: 3, tip: '#ec7fa5', base: '#fdf1f4', inner: '#f6b9cc' }, // pink lotus
  { weight: 1.2, tip: '#efe9df', base: '#fffdf8', inner: '#fbf5e8' }, // white lotus
  { weight: 0.8, tip: '#b78be0', base: '#f6effc', inner: '#d9c0f0' }, // violet water lily
];
// What floats across the surface depends on the viewer's month.
const SEASONS = {
  spring: { shape: 'petal', count: 9, colors: ['#f6c1d0', '#f9d6e0', '#f3aac0'] },
  summer: { shape: 'leaf', count: 3, colors: ['#7fb85a', '#94c46c'] },
  autumn: { shape: 'leaf', count: 7, colors: ['#e0782f', '#c9452c', '#e8b23a', '#b5562a'] },
  winter: { shape: 'leaf', count: 3, colors: ['#9a7a55', '#b89a72'] },
};

function seasonOf(month) {
  if (month < 2 || month === 11) return 'winter';
  if (month < 5) return 'spring';
  if (month < 8) return 'summer';
  return 'autumn';
}

function pickBloom(rng) {
  let r = rng() * BLOOMS.reduce((s, b) => s + b.weight, 0);
  for (const b of BLOOMS) {
    r -= b.weight;
    if (r <= 0) return b;
  }
  return BLOOMS[0];
}

function renderPad(rng, r, dpr, [light, dark]) {
  const R = r * dpr;
  const size = Math.ceil(R * 2 + 8);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  const notch = range(rng, 0.22, 0.42);
  const a0 = notch / 2;
  const a1 = TAU - notch / 2;
  const jitter = rng() * TAU;
  const outline = () => {
    g.beginPath();
    g.moveTo(0, 0);
    for (let k = 0; k <= 48; k++) {
      const a = a0 + ((a1 - a0) * k) / 48;
      const rr = R * (0.97 + 0.03 * Math.sin(a * 5 + jitter));
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
  };
  outline();
  const grad = g.createRadialGradient(-R * 0.2, -R * 0.25, R * 0.05, 0, 0, R);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  g.fillStyle = grad;
  g.fill();

  g.save();
  g.clip();
  g.strokeStyle = 'rgba(210,240,180,0.22)';
  g.lineWidth = Math.max(1, R * 0.025);
  g.beginPath();
  for (let k = 0; k < 13; k++) {
    const a = a0 + ((a1 - a0) * (k + 0.5)) / 13;
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  g.stroke();
  const blemishes = Math.floor(rng() * 4);
  for (let k = 0; k < blemishes; k++) {
    const a = rng() * TAU;
    const d = range(rng, 0.3, 0.9) * R;
    g.fillStyle = 'rgba(150,118,52,0.18)';
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, range(rng, 0.05, 0.14) * R, 0, TAU);
    g.fill();
  }
  outline();
  g.lineWidth = R * 0.12;
  g.strokeStyle = 'rgba(15,45,20,0.35)';
  g.stroke();
  g.restore();

  g.beginPath();
  g.arc(0, 0, R * 0.92, Math.PI * 1.05, Math.PI * 1.55);
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = R * 0.04;
  g.stroke();
  return c;
}

function renderBloom(rng, r, dpr, bloom) {
  const R = r * dpr;
  const size = Math.ceil(R * 2 + 6);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  const layer = (count, len, wid, offset, from, to) => {
    for (let k = 0; k < count; k++) {
      g.save();
      g.rotate(offset + (k / count) * TAU);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, from);
      grad.addColorStop(1, to);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.45, -wid, len, 0);
      g.quadraticCurveTo(len * 0.45, wid, 0, 0);
      g.fill();
      g.strokeStyle = 'rgba(120,40,70,0.12)';
      g.lineWidth = Math.max(0.5, R * 0.015);
      g.stroke();
      g.restore();
    }
  };
  // a soft shadow under the bloom lifts it off the pad
  const shade = g.createRadialGradient(R * 0.08, R * 0.1, 0, R * 0.08, R * 0.1, R);
  shade.addColorStop(0, 'rgba(10,30,15,0.35)');
  shade.addColorStop(1, 'rgba(10,30,15,0)');
  g.fillStyle = shade;
  g.fillRect(-R, -R, R * 2, R * 2);
  layer(9, R, R * 0.42, rng() * TAU, bloom.base, bloom.tip);
  layer(7, R * 0.72, R * 0.36, rng() * TAU, bloom.base, bloom.inner);
  layer(5, R * 0.45, R * 0.28, rng() * TAU, '#fffefb', bloom.base);
  g.fillStyle = '#f2c84b';
  g.beginPath();
  g.arc(0, 0, R * 0.16, 0, TAU);
  g.fill();
  g.fillStyle = '#d6992a';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    g.beginPath();
    g.arc(Math.cos(a) * R * 0.09, Math.sin(a) * R * 0.09, R * 0.025, 0, TAU);
    g.fill();
  }
  return c;
}

// Lily pads moored in clusters along the edges, plus whatever the season drops on the water.
export class Flora {
  constructor(seed) {
    this.seed = seed;
    const rng = mulberry32(hashSeed(seed, 11));
    this.pads = buildPads(rng);
    this.season = SEASONS[seasonOf(new Date().getMonth())];
    this.windAngle = rng() * TAU;
    this.drifters = [];
    this.wind = { x: 0, y: 0 };
  }

  layout(world) {
    const { w, h, unit, dpr } = world;
    for (const p of this.pads) {
      p.x = p.nx * w + p.dx * unit;
      p.y = p.ny * h + p.dy * unit;
      p.sprite = renderPad(mulberry32(p.seed), p.r * unit, dpr, PAD_GREENS[p.green]);
      if (p.bloom) p.bloom.sprite = renderBloom(mulberry32(p.bloom.seed), p.bloom.r * unit, dpr, p.bloom.palette);
    }
    if (!this.drifters.length) {
      for (let i = 0; i < this.season.count; i++) {
        this.drifters.push({
          x: rnd(0, w),
          y: rnd(0, h),
          rot: rnd(0, TAU),
          spin: rnd(-0.3, 0.3),
          size: rnd(0.8, 1.25),
          wobble: rnd(0, TAU),
          color: this.season.colors[Math.floor(Math.random() * this.season.colors.length)],
        });
      }
    }
  }

  rescale(sx, sy) {
    for (const d of this.drifters) {
      d.x *= sx;
      d.y *= sy;
    }
  }

  update(dt, world) {
    const { unit, time, w, h } = world;
    const wa = this.windAngle + 0.8 * Math.sin(time * 0.011);
    this.wind.x = Math.cos(wa) * 5 * unit;
    this.wind.y = Math.sin(wa) * 5 * unit;

    for (const p of this.pads) {
      // pads spring back to their mooring; koi passing just underneath nudge them
      for (const k of world.koi) {
        if (k.depth > 0.55) continue;
        const r = p.r * unit;
        if ((p.x + p.ox - k.px[0]) ** 2 + (p.y + p.oy - k.py[0]) ** 2 < r * r) {
          p.vx += Math.cos(k.heading) * k.speed * 0.15 * dt;
          p.vy += Math.sin(k.heading) * k.speed * 0.15 * dt;
        }
      }
      const damp = Math.exp(-dt * 1.5);
      p.vx = (p.vx - p.ox * 0.8 * dt) * damp;
      p.vy = (p.vy - p.oy * 0.8 * dt) * damp;
      p.ox += p.vx * dt;
      p.oy += p.vy * dt;
    }

    const m = 30 * unit;
    for (const d of this.drifters) {
      const sway = Math.sin(time * 0.5 + d.wobble) * 2 * unit;
      d.x += (this.wind.x - Math.sin(wa) * sway) * dt;
      d.y += (this.wind.y + Math.cos(wa) * sway) * dt;
      d.rot += d.spin * dt;
      if (d.x < -m) d.x = w + m;
      else if (d.x > w + m) d.x = -m;
      if (d.y < -m) d.y = h + m;
      else if (d.y > h + m) d.y = -m;
    }
  }

  draw(ctx, world) {
    const { dpr, time, palette } = world;
    const blit = (sprite, x, y, rot, scale) => {
      const s = (sprite.width / dpr) * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    };
    for (const p of this.pads) {
      blit(p.sprite, p.x + p.ox, p.y + p.oy, p.rot + 0.05 * Math.sin(time * 0.15 + p.phase), 1);
    }
    // blooms half-close at night
    const open = 1 - (palette?.fireflies ?? 0) * 0.2;
    for (const p of this.pads) {
      if (!p.bloom) continue;
      const b = p.bloom;
      blit(b.sprite, p.x + p.ox + b.dx * world.unit, p.y + p.oy + b.dy * world.unit, b.rot + 0.03 * Math.sin(time * 0.2 + p.phase), open);
    }
    this.drawDrifters(ctx, world.unit);
  }

  drawDrifters(ctx, unit) {
    const leaf = this.season.shape === 'leaf';
    for (const d of this.drifters) {
      const L = (leaf ? 8 : 5) * unit * d.size;
      const W = (leaf ? 3.4 : 3.2) * unit * d.size;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.beginPath();
      ctx.moveTo(-L, 0);
      if (leaf) {
        ctx.quadraticCurveTo(0, -W * 1.4, L, 0);
        ctx.quadraticCurveTo(0, W * 1.4, -L, 0);
      } else {
        ctx.quadraticCurveTo(-L * 0.2, -W * 1.2, L, -W * 0.35);
        ctx.lineTo(L * 0.72, 0);
        ctx.lineTo(L, W * 0.35);
        ctx.quadraticCurveTo(-L * 0.2, W * 1.2, -L, 0);
      }
      ctx.fillStyle = d.color;
      ctx.fill();
      if (leaf) {
        ctx.beginPath();
        ctx.moveTo(-L * 1.15, 0);
        ctx.lineTo(L * 0.85, 0);
        ctx.strokeStyle = 'rgba(60,30,10,0.35)';
        ctx.lineWidth = unit * 0.6;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawShadow(ctx, unit) {
    ctx.beginPath();
    for (const p of this.pads) {
      const r = p.r * unit * 0.96;
      ctx.moveTo(p.x + p.ox + r, p.y + p.oy);
      ctx.arc(p.x + p.ox, p.y + p.oy, r, 0, TAU);
    }
    for (const d of this.drifters) {
      const r = 4 * unit * d.size;
      ctx.moveTo(d.x + r, d.y);
      ctx.arc(d.x, d.y, r, 0, TAU);
    }
    ctx.fill();
  }
}

function buildPads(rng) {
  const corners = [[0.02, 0.05], [0.98, 0.06], [0.03, 0.95], [0.97, 0.94]];
  for (let i = corners.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [corners[i], corners[j]] = [corners[j], corners[i]];
  }
  const anchors = corners.slice(0, rng() < 0.4 ? 4 : 3);
  if (rng() < 0.6) {
    const along = range(rng, 0.35, 0.65);
    const side = rng() < 0.5 ? 0 : 1;
    anchors.push(rng() < 0.5 ? [along, side] : [side, along]);
  }
  const pads = [];
  for (const [ax, ay] of anchors) {
    const count = 3 + Math.floor(rng() * 4);
    const scale = range(rng, 0.8, 1.25);
    let blooms = 0;
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU;
      const d = Math.sqrt(rng()) * 95 * scale;
      const r = range(rng, 24, 50) * scale;
      const pad = {
        nx: ax,
        ny: ay,
        dx: Math.cos(a) * d,
        dy: Math.sin(a) * d,
        r,
        rot: rng() * TAU,
        green: Math.floor(rng() * PAD_GREENS.length),
        seed: Math.floor(rng() * 2 ** 31),
        phase: rng() * TAU,
        bloom: null,
        x: 0,
        y: 0,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
        sprite: null,
      };
      if (blooms < 2 && rng() < 0.42) {
        blooms++;
        pad.bloom = {
          palette: pickBloom(rng),
          r: r * range(rng, 0.5, 0.62),
          dx: range(rng, -0.2, 0.2) * r,
          dy: range(rng, -0.2, 0.2) * r,
          rot: rng() * TAU,
          seed: Math.floor(rng() * 2 ** 31),
          sprite: null,
        };
      }
      pads.push(pad);
    }
  }
  pads.sort((a, b) => a.r - b.r);
  return pads;
}
