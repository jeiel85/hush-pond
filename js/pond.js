import { TAU, makeCanvas, mulberry32, hashSeed, range } from './util.js';

// The static pond floor: mottled sediment, pebbles and low weeds. Rendered once per resize.
export function renderFloor(seed, w, h, dpr, unit) {
  const c = makeCanvas(w * dpr, h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rng = mulberry32(hashSeed(seed, 3));

  const base = g.createRadialGradient(w * 0.45, h * 0.42, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62);
  base.addColorStop(0, '#2a7f73');
  base.addColorStop(0.55, '#1c6763');
  base.addColorStop(1, '#0f4448');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  for (let i = 0; i < 26; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = range(rng, 0.08, 0.28) * Math.max(w, h);
    const light = rng() < 0.5;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, light ? 'rgba(84,152,126,0.16)' : 'rgba(6,40,46,0.24)');
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const specks = Math.round((w * h) / 700);
  for (let i = 0; i < specks; i++) {
    const s = range(rng, 0.4, 1.4) * unit;
    g.fillStyle = rng() < 0.5 ? `rgba(200,235,220,${range(rng, 0.03, 0.09).toFixed(3)})` : `rgba(4,30,34,${range(rng, 0.05, 0.14).toFixed(3)})`;
    g.fillRect(rng() * w, rng() * h, s, s);
  }

  const stones = ['#3e5f57', '#4b6d62', '#5a7a6c', '#34524c'];
  const clusters = Math.round(range(rng, 6, 11) * Math.min(2, (w * h) / 2e6 + 0.5));
  for (let k = 0; k < clusters; k++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const count = 4 + Math.floor(rng() * 9);
    for (let i = 0; i < count; i++) {
      const x = cx + (rng() + rng() - 1) * 40 * unit;
      const y = cy + (rng() + rng() - 1) * 40 * unit;
      const rx = range(rng, 3, 9) * unit;
      const ry = rx * range(rng, 0.6, 0.9);
      const rot = rng() * TAU;
      g.globalAlpha = 0.55;
      g.fillStyle = stones[Math.floor(rng() * stones.length)];
      g.beginPath();
      g.ellipse(x, y, rx, ry, rot, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.beginPath();
      g.ellipse(x - rx * 0.2, y - ry * 0.25, rx * 0.55, ry * 0.5, rot, 0, TAU);
      g.fill();
    }
  }

  const weeds = Math.round((w * h) / 70000);
  g.lineCap = 'round';
  for (let k = 0; k < weeds; k++) {
    const x = rng() * w;
    const y = rng() * h;
    const blades = 5 + Math.floor(rng() * 5);
    g.strokeStyle = rng() < 0.5 ? 'rgba(46,107,58,0.5)' : 'rgba(63,125,60,0.42)';
    g.lineWidth = range(rng, 1.1, 1.8) * unit;
    g.beginPath();
    for (let i = 0; i < blades; i++) {
      const a = rng() * TAU;
      const len = range(rng, 6, 16) * unit;
      const bend = range(rng, -0.6, 0.6);
      g.moveTo(x, y);
      g.quadraticCurveTo(
        x + Math.cos(a + bend) * len * 0.6,
        y + Math.sin(a + bend) * len * 0.6,
        x + Math.cos(a) * len,
        y + Math.sin(a) * len,
      );
    }
    g.stroke();
  }
  return c;
}

// Tileable cellular texture: bright where two Voronoi cells meet, like sunlight focused by ripples.
// The lookup is domain-warped so cell edges come out as wavy threads rather than straight polygons.
function causticTexture(size, seed) {
  const rng = mulberry32(hashSeed(seed, 5));
  const pts = Array.from({ length: 22 }, () => [rng() * size, rng() * size]);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const half = size / 2;
  const amp = size * 0.035;
  const p1 = rng() * TAU;
  const p2 = rng() * TAU;
  const warpX = new Float32Array(size); // shift in x, varies with y (whole periods keep it tileable)
  const warpY = new Float32Array(size); // shift in y, varies with x
  for (let i = 0; i < size; i++) {
    const t = (i / size) * TAU;
    warpX[i] = amp * (Math.sin(t * 2 + p1) + 0.5 * Math.sin(t * 5 + p2));
    warpY[i] = amp * (Math.sin(t * 3 + p2) + 0.5 * Math.sin(t * 4 + p1));
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x + warpX[y];
      const sy = y + warpY[x];
      let f1 = Infinity;
      let f2 = Infinity;
      for (const [px, py] of pts) {
        let dx = Math.abs(sx - px) % size;
        let dy = Math.abs(sy - py) % size;
        if (dx > half) dx = size - dx;
        if (dy > half) dy = size - dy;
        const dd = dx * dx + dy * dy;
        if (dd < f1) {
          f2 = f1;
          f1 = dd;
        } else if (dd < f2) f2 = dd;
      }
      const v = Math.max(0, 1 - (Math.sqrt(f2) - Math.sqrt(f1)) / 6);
      const i = (y * size + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 240;
      d[i + 3] = Math.pow(v, 2.2) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export class Caustics {
  constructor(seed) {
    this.texture = causticTexture(512, seed);
    this.pattern = null;
  }

  draw(ctx, w, h, unit, time, alpha, motion) {
    if (alpha < 0.005) return;
    if (!this.pattern) this.pattern = ctx.createPattern(this.texture, 'repeat');
    const p = this.pattern;
    const s = unit * 1.15;
    const t = time * motion;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = p;
    p.setTransform(new DOMMatrix().translateSelf(t * 9 * unit, t * 5 * unit).scaleSelf(s));
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, w, h);
    p.setTransform(new DOMMatrix().translateSelf(-t * 7 * unit, t * 8 * unit).rotateSelf(37).scaleSelf(s * 1.31));
    ctx.globalAlpha = alpha * 0.75;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

export function renderVignette() {
  const s = 256;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.72);
  grad.addColorStop(0, 'rgba(0,10,14,0)');
  grad.addColorStop(1, 'rgba(0,10,14,0.5)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return c;
}
