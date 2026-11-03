import { TAU, angleDiff, range, rnd } from './util.js';

const KINDS = {
  silver: { body: '#d5e6ea', back: 'rgba(44,86,106,0.7)', tail: 'rgba(214,232,236,0.65)' },
  ember: { body: '#ef8d3d', back: 'rgba(140,48,18,0.5)', tail: 'rgba(248,168,98,0.65)' },
  ink: { body: '#37434f', back: 'rgba(10,16,22,0.65)', tail: 'rgba(86,104,120,0.6)' },
};
export const SCHOOL_KINDS = Object.keys(KINDS);

// A shoal of small fish (boids) milling around a slowly wandering anchor.
export class School {
  constructor(rng, kind, count) {
    this.colors = KINDS[kind];
    this.fish = [];
    for (let i = 0; i < count; i++) {
      this.fish.push({ x: 0, y: 0, vx: 0, vy: 0, a: 0, phase: rng() * TAU, size: range(rng, 0.8, 1.2) });
    }
    this.ax = 0;
    this.ay = 0;
    this.tx = 0;
    this.ty = 0;
    this.retarget = 0;
    this.swirl = (rng() < 0.5 ? -1 : 1) * range(rng, 0.5, 1);
    this.swirlPhase = rng() * TAU;
  }

  spawn(world) {
    const { w, h, unit } = world;
    this.ax = rnd(0.2, 0.8) * w;
    this.ay = rnd(0.2, 0.8) * h;
    this.pickTarget(world);
    for (const f of this.fish) {
      f.x = this.ax + rnd(-40, 40) * unit;
      f.y = this.ay + rnd(-40, 40) * unit;
      f.a = rnd(0, TAU);
      f.vx = Math.cos(f.a) * 30 * unit;
      f.vy = Math.sin(f.a) * 30 * unit;
    }
  }

  rescale(sx, sy) {
    this.ax *= sx;
    this.ay *= sy;
    this.tx *= sx;
    this.ty *= sy;
    for (const f of this.fish) {
      f.x *= sx;
      f.y *= sy;
    }
  }

  pickTarget({ w, h }) {
    const m = Math.min(w, h) * 0.12;
    this.tx = rnd(m, w - m);
    this.ty = rnd(m, h - m);
    this.retarget = rnd(12, 30);
  }

  update(dt, world) {
    const u = world.unit;
    this.retarget -= dt;
    const dx = this.tx - this.ax;
    const dy = this.ty - this.ay;
    const dist = Math.hypot(dx, dy);
    if (this.retarget <= 0 || dist < 30 * u) this.pickTarget(world);
    else {
      const step = (16 * u * dt) / dist;
      this.ax += dx * step;
      this.ay += dy * step;
    }

    // sometimes the shoal circles in place, sometimes it just travels
    const swirl = this.swirl * (0.35 + 0.65 * Math.max(0, Math.sin(world.time * 0.045 + this.swirlPhase)));
    const near = 34 * u;
    const gap = 9 * u;
    const fish = this.fish;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      let cx = 0;
      let cy = 0;
      let vx = 0;
      let vy = 0;
      let n = 0;
      let ax = 0;
      let ay = 0;
      for (let j = 0; j < fish.length; j++) {
        if (j === i) continue;
        const o = fish[j];
        const ex = f.x - o.x;
        const ey = f.y - o.y;
        const d2 = ex * ex + ey * ey;
        if (d2 > near * near) continue;
        n++;
        cx += o.x;
        cy += o.y;
        vx += o.vx;
        vy += o.vy;
        if (d2 < gap * gap && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const k = (((gap - d) / gap) * 260 * u) / d;
          ax += ex * k;
          ay += ey * k;
        }
      }
      if (n) {
        ax += (cx / n - f.x) * 0.9 + (vx / n - f.vx) * 1.4;
        ay += (cy / n - f.y) * 0.9 + (vy / n - f.vy) * 1.4;
      }
      const ox = this.ax - f.x;
      const oy = this.ay - f.y;
      ax += ox * 0.32 - oy * swirl * 0.8;
      ay += oy * 0.32 + ox * swirl * 0.8;

      let fright = 0;
      const p = world.pellets.nearest(f.x, f.y, 150 * u);
      if (p) {
        const ex = p.x - f.x;
        const ey = p.y - f.y;
        const d = Math.hypot(ex, ey) || 1;
        ax += (ex / d) * 240 * u;
        ay += (ey / d) * 240 * u;
        if (d < 5 * u) world.nibble(p, dt);
      }
      for (const k of world.koi) {
        const ex = f.x - k.px[0];
        const ey = f.y - k.py[0];
        const r = k.length * 0.5;
        const d2 = ex * ex + ey * ey;
        if (d2 < r * r && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const s = ((1 - d / r) * 700 * u) / d;
          ax += ex * s;
          ay += ey * s;
          fright = Math.max(fright, 1 - d / r);
        }
      }
      for (const s of world.scares) {
        const ex = f.x - s.x;
        const ey = f.y - s.y;
        const d2 = ex * ex + ey * ey;
        if (d2 < s.radius * s.radius && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const k = ((1 - d / s.radius) * 1600 * u * s.strength) / d;
          ax += ex * k;
          ay += ey * k;
          fright = 1;
        }
      }

      f.vx += ax * dt;
      f.vy += ay * dt;
      const sp = Math.hypot(f.vx, f.vy);
      const lo = 14 * u;
      const hi = (60 + 110 * fright) * u;
      if (sp > hi) {
        f.vx *= hi / sp;
        f.vy *= hi / sp;
      } else if (sp < lo && sp > 1e-4) {
        f.vx *= lo / sp;
        f.vy *= lo / sp;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.a += angleDiff(f.a, Math.atan2(f.vy, f.vx)) * Math.min(1, dt * 10);
      f.phase += dt * (7 + (Math.min(sp, hi) / u) * 0.12);
    }
  }

  traceBodies(ctx, unit) {
    for (const f of this.fish) {
      const L = 10.5 * unit * f.size;
      ctx.moveTo(f.x + Math.cos(f.a) * L * 0.45, f.y + Math.sin(f.a) * L * 0.45);
      ctx.ellipse(f.x, f.y, L * 0.45, L * 0.15, f.a, 0, TAU);
    }
  }

  draw(ctx, unit) {
    const { body, back, tail } = this.colors;
    ctx.beginPath();
    for (const f of this.fish) {
      const L = 10.5 * unit * f.size;
      const c = Math.cos(f.a);
      const s = Math.sin(f.a);
      const rx = f.x - c * L * 0.38;
      const ry = f.y - s * L * 0.38;
      const ta = f.a + Math.PI + Math.sin(f.phase) * 0.45;
      const tl = L * 0.34;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + Math.cos(ta + 0.42) * tl, ry + Math.sin(ta + 0.42) * tl);
      ctx.lineTo(rx + Math.cos(ta - 0.42) * tl, ry + Math.sin(ta - 0.42) * tl);
      ctx.closePath();
    }
    ctx.fillStyle = tail;
    ctx.fill();

    ctx.beginPath();
    this.traceBodies(ctx, unit);
    ctx.fillStyle = body;
    ctx.fill();

    ctx.beginPath();
    for (const f of this.fish) {
      const L = 10.5 * unit * f.size;
      const c = Math.cos(f.a) * L * 0.28;
      const s = Math.sin(f.a) * L * 0.28;
      ctx.moveTo(f.x + c, f.y + s);
      ctx.lineTo(f.x - c, f.y - s);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = unit * 0.95;
    ctx.strokeStyle = back;
    ctx.stroke();
  }

  drawShadow(ctx, unit) {
    ctx.beginPath();
    this.traceBodies(ctx, unit);
    ctx.fill();
  }
}
