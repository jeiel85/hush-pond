import { Koi } from './koi.js';
import { School, SCHOOL_KINDS } from './school.js';
import { Flora } from './flora.js';
import { Ripples, Pellets, Fireflies } from './effects.js';
import { renderFloor, renderVignette, Caustics } from './pond.js';
import { paletteAt, blendPalette } from './sky.js';
import { TAU, clamp, hashSeed, makeCanvas, mulberry32, rnd } from './util.js';

const SHADOW_SCALE = 0.25; // shadows are drawn small and scaled up, which blurs them for free

export function autoKoiCount(w, h) {
  return Math.round(clamp((w * h) / 150000, 5, 16));
}

export class World {
  constructor(seed, { motion = 1, onPlop, onGulp } = {}) {
    this.seed = seed;
    this.motion = motion;
    this.onPlop = onPlop;
    this.onGulp = onGulp;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.unit = 1;
    this.time = 0;
    this.koi = [];
    this.ripples = new Ripples();
    this.pellets = new Pellets();
    this.scares = [];
    this.flora = new Flora(seed);
    this.drift = this.flora.wind;
    this.fireflies = new Fireflies(28);
    this.caustics = new Caustics(seed);
    this.vignette = renderVignette();
    this.palette = null;
    this.rainAcc = 0;
    this.dripIn = rnd(3, 8);
    this.gather = { x: 0, y: 0, tx: 0, ty: 0, retarget: 0 };
    this.shadow = makeCanvas(1, 1);
    this.sctx = this.shadow.getContext('2d');

    const rng = mulberry32(hashSeed(seed, 7));
    const kinds = [...SCHOOL_KINDS].sort(() => rng() - 0.5);
    this.schools = [new School(rng, kinds[0], 16), new School(rng, kinds[1], 12)];
  }

  /** Lays the pond out for a viewport; ignored while the viewport has no size (e.g. a hidden frame). */
  resize(w, h, dpr) {
    if (w < 1 || h < 1) return false;
    const first = !this.w;
    const sx = first ? 1 : w / this.w;
    const sy = first ? 1 : h / this.h;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.unit = clamp(Math.sqrt(w * h) / 1100, 0.55, 2);
    this.floor = renderFloor(this.seed, w, h, dpr, this.unit);
    this.shadow.width = Math.ceil(w * SHADOW_SCALE);
    this.shadow.height = Math.ceil(h * SHADOW_SCALE);
    this.flora.layout(this);
    for (const k of this.koi) {
      k.setScale(this.unit);
      if (!first) k.rescale(sx, sy);
    }
    if (first) {
      for (const s of this.schools) s.spawn(this);
      this.gather.x = w / 2;
      this.gather.y = h / 2;
    } else {
      for (const s of this.schools) s.rescale(sx, sy);
      this.pellets.rescale(sx, sy);
      this.flora.rescale(sx, sy);
      this.gather.x *= sx;
      this.gather.y *= sy;
      this.gather.tx *= sx;
      this.gather.ty *= sy;
    }
    return true;
  }

  get ready() {
    return this.w > 0;
  }

  get activeKoi() {
    return this.koi.filter((k) => !k.leaving);
  }

  setKoiCount(n) {
    const active = this.activeKoi;
    const fresh = this.time < 0.5;
    for (let i = active.length; i < n; i++) {
      const k = new Koi(hashSeed(this.seed, 1000 + i), i);
      k.setScale(this.unit);
      if (fresh) {
        k.placeAt(rnd(0.1, 0.9) * this.w, rnd(0.1, 0.9) * this.h, rnd(0, TAU));
      } else {
        // swim in from just beyond a random edge
        const side = Math.floor(Math.random() * 4);
        const out = k.length * 1.2;
        const x = side === 0 ? -out : side === 1 ? this.w + out : rnd(0.2, 0.8) * this.w;
        const y = side === 2 ? -out : side === 3 ? this.h + out : rnd(0.2, 0.8) * this.h;
        k.placeAt(x, y, Math.atan2(this.h / 2 - y, this.w / 2 - x));
      }
      // fully visible from the first frame: throttled pages (background tabs, wallpaper hosts) may run few frames
      k.alpha = 1;
      this.koi.push(k);
    }
    if (active.length > n) {
      active
        .sort((a, b) => b.index - a.index)
        .slice(0, active.length - n)
        .forEach((k) => k.leave(this));
    }
  }

  feed(x, y) {
    this.pellets.drop(x, y, this.unit);
  }

  // a finger trailing through the water
  stir(x, y) {
    this.ripples.add(x, y, rnd(14, 22) * this.unit, 1.3, 0.8);
    this.scare(x, y, 70 * this.unit, 0.6);
  }

  scare(x, y, radius, strength) {
    for (const k of this.koi) k.startle(x, y, radius, strength);
    this.scares.push({ x, y, radius, strength, ttl: 0.35 });
  }

  pelletLanded(p) {
    this.ripples.add(p.x, p.y, rnd(9, 15) * this.unit, 1.4, 0.8);
    if (p.first) this.onPlop?.();
  }

  eat(p, koi) {
    p.eaten = true;
    koi.hunger = Math.max(0, koi.hunger - 0.13);
    koi.food = null;
    this.ripples.add(p.x, p.y, 13 * this.unit, 1.1, 0.9);
    this.ripples.add(p.x, p.y, 20 * this.unit, 1.5, 0.45, 0.18);
    this.onGulp?.();
  }

  nibble(p, dt) {
    p.size -= 0.12 * dt;
    if (p.size < 0.35) p.eaten = true;
  }

  update(dt, { hour, rain }) {
    this.time += dt;
    const target = paletteAt(hour, rain);
    this.palette = this.palette ? blendPalette(this.palette, target, 1 - Math.exp(-dt * 1.5)) : target;

    const g = this.gather;
    g.retarget -= dt;
    if (g.retarget <= 0) {
      g.tx = rnd(0.2, 0.8) * this.w;
      g.ty = rnd(0.2, 0.8) * this.h;
      g.retarget = rnd(20, 45);
    }
    g.x += (g.tx - g.x) * Math.min(1, dt * 0.05);
    g.y += (g.ty - g.y) * Math.min(1, dt * 0.05);

    for (const k of this.koi) k.update(dt, this);
    for (let i = this.koi.length - 1; i >= 0; i--) {
      if (this.koi[i].leaving && this.koi[i].alpha <= 0) this.koi.splice(i, 1);
    }
    for (const s of this.schools) s.update(dt, this);
    this.pellets.update(dt, this);
    this.flora.update(dt, this);

    if (rain) {
      this.rainAcc += dt * Math.min(40, (16 * this.w * this.h) / 2073600);
      while (this.rainAcc >= 1) {
        this.rainAcc -= 1;
        this.ripples.add(rnd(0, this.w), rnd(0, this.h), rnd(6, 18) * this.unit, rnd(0.8, 1.3), 0.95);
      }
    }
    this.dripIn -= dt;
    if (this.dripIn <= 0) {
      // a bubble from the floor, or a drop from somewhere above
      this.dripIn = rnd(4, 12);
      this.ripples.add(rnd(0.1, 0.9) * this.w, rnd(0.1, 0.9) * this.h, rnd(16, 26) * this.unit, 2.2, 0.7);
    }
    this.ripples.update(dt);
    for (let i = this.scares.length - 1; i >= 0; i--) {
      this.scares[i].ttl -= dt;
      if (this.scares[i].ttl <= 0) this.scares.splice(i, 1);
    }
  }

  render(ctx) {
    const { w, h, dpr, unit, palette: pal } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.floor, 0, 0, w, h);
    this.caustics.draw(ctx, w, h, unit, this.time, pal.caustic, this.motion);
    this.renderShadows(ctx, pal.shadow);

    for (const s of this.schools) s.draw(ctx, unit);
    this.koi.sort((a, b) => b.depth - a.depth);
    for (const k of this.koi) k.draw(ctx, this.time);
    this.pellets.draw(ctx, unit);
    this.ripples.draw(ctx, unit);
    this.flora.draw(ctx, this);

    const [r, g, b] = pal.tint;
    if (r + g + b < 762) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (pal.glare > 0.005) {
      const [gr, gg, gb] = pal.glareColor.map((v) => v | 0);
      const glare = ctx.createRadialGradient(w * 0.22, h * 0.18, 0, w * 0.22, h * 0.18, Math.max(w, h) * 0.75);
      glare.addColorStop(0, `rgba(${gr},${gg},${gb},${pal.glare.toFixed(3)})`);
      glare.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glare;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.vignette, 0, 0, w, h);
    this.fireflies.draw(ctx, this, pal.fireflies);
  }

  renderShadows(ctx, alpha) {
    const s = this.sctx;
    const S = SHADOW_SCALE;
    const u = this.unit;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    s.clearRect(0, 0, this.shadow.width, this.shadow.height);
    s.fillStyle = '#000';
    // light falls from the upper left; the higher something floats, the further its shadow lands
    const offset = (d) => s.setTransform(S, 0, 0, S, d * 0.55 * S, d * 0.85 * S);
    offset(9 * u);
    s.globalAlpha = 0.8;
    for (const school of this.schools) school.drawShadow(s, u);
    for (const k of this.koi) {
      offset((5 + (1 - k.depth) * 13) * u);
      k.drawShadow(s);
    }
    s.globalAlpha = 1;
    offset(15 * u);
    this.pellets.drawShadow(s, u);
    this.flora.drawShadow(s, u);

    ctx.globalAlpha = alpha;
    ctx.drawImage(this.shadow, 0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
  }
}
