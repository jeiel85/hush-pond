import { TAU, makeCanvas, rnd } from './util.js';

export class Ripples {
  constructor() {
    this.list = [];
  }

  add(x, y, maxR, life = 1.8, strength = 1, delay = 0) {
    if (this.list.length > 240) this.list.shift();
    this.list.push({ x, y, maxR, life, strength, age: -delay });
  }

  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      l[i].age += dt;
      if (l[i].age >= l[i].life) l.splice(i, 1);
    }
  }

  draw(ctx, unit) {
    for (const r of this.list) {
      if (r.age < 0) continue;
      const t = r.age / r.life;
      const rad = Math.max(0.5, r.maxR * (1 - (1 - t) * (1 - t)));
      const a = r.strength * Math.pow(1 - t, 1.6);
      ctx.lineWidth = unit * (1.6 - t);
      ctx.strokeStyle = `rgba(225,248,242,${(a * 0.55).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, TAU);
      ctx.stroke();
      if (rad > 4 * unit) {
        ctx.strokeStyle = `rgba(4,34,38,${(a * 0.22).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(r.x, r.y, rad * 0.86, 0, TAU);
        ctx.stroke();
      }
    }
  }
}

// Floating food. Pellets fall for a beat, land with a ripple, then drift until eaten or dissolved.
export class Pellets {
  constructor() {
    this.list = [];
  }

  drop(x, y, unit) {
    const n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * 18 * unit;
      const s = rnd(2, 9) * unit;
      const fall = 0.2 + i * 0.04 + Math.random() * 0.06;
      this.list.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        fall,
        fallTime: fall,
        landed: false,
        landedAt: 0,
        eaten: false,
        size: rnd(0.85, 1.15),
        life: rnd(45, 60),
        first: i === 0,
      });
    }
    while (this.list.length > 160) this.list.shift().eaten = true;
  }

  rescale(sx, sy) {
    for (const p of this.list) {
      p.x *= sx;
      p.y *= sy;
    }
  }

  update(dt, world) {
    const l = this.list;
    const damp = Math.exp(-dt * 0.9);
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      if (p.eaten) {
        l.splice(i, 1);
        continue;
      }
      if (!p.landed) {
        p.fall -= dt;
        if (p.fall <= 0) {
          p.landed = true;
          p.landedAt = world.time;
          world.pelletLanded(p);
        }
        continue;
      }
      p.vx *= damp;
      p.vy *= damp;
      p.x += (p.vx + world.drift.x) * dt;
      p.y += (p.vy + world.drift.y) * dt;
      p.life -= dt;
      if (p.life <= 0 || p.size < 0.35) p.eaten = true;
    }
  }

  nearest(x, y, maxD) {
    let best = null;
    let bd = maxD * maxD;
    for (const p of this.list) {
      if (!p.landed || p.eaten) continue;
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = p;
      }
    }
    return best;
  }

  radius(p, unit) {
    return 2.3 * unit * p.size * Math.min(1, p.life / 4);
  }

  draw(ctx, unit) {
    ctx.beginPath();
    for (const p of this.list) {
      if (!p.landed) continue;
      const r = this.radius(p, unit);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fillStyle = '#a8662d';
    ctx.fill();
    ctx.beginPath();
    for (const p of this.list) {
      if (!p.landed) continue;
      const r = this.radius(p, unit) * 0.45;
      ctx.moveTo(p.x - r * 0.6 + r, p.y - r * 0.6);
      ctx.arc(p.x - r * 0.6, p.y - r * 0.6, r, 0, TAU);
    }
    ctx.fillStyle = '#deae75';
    ctx.fill();

    // still falling: closer to the eye, so a touch larger
    ctx.fillStyle = '#b8743a';
    for (const p of this.list) {
      if (p.landed) continue;
      const t = Math.max(0, p.fall / p.fallTime);
      ctx.globalAlpha = 1 - t * 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.3 * unit * p.size * (1 + t * 1.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawShadow(ctx, unit) {
    ctx.beginPath();
    for (const p of this.list) {
      if (!p.landed) continue;
      const r = this.radius(p, unit);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fill();
  }
}

function glowSprite() {
  const s = 64;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,252,200,1)');
  grad.addColorStop(0.12, 'rgba(232,255,150,0.85)');
  grad.addColorStop(0.4, 'rgba(190,240,110,0.18)');
  grad.addColorStop(1, 'rgba(160,220,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return c;
}

export class Fireflies {
  constructor(count) {
    this.sprite = glowSprite();
    this.list = Array.from({ length: count }, () => ({
      bx: Math.random(),
      by: Math.random(),
      p: Math.random() * TAU,
      f: rnd(0.12, 0.3),
      ax: rnd(20, 60),
      ay: rnd(20, 60),
      blink: rnd(0.4, 1.1),
      drift: rnd(-0.004, 0.004),
    }));
  }

  draw(ctx, world, amount) {
    if (amount < 0.02) return;
    const { w, h, unit, time } = world;
    const s = 26 * unit;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.list) {
      const bx = (((f.bx + time * f.drift) % 1) + 1) % 1;
      const x = bx * w + Math.sin(time * f.f + f.p) * f.ax * unit + Math.sin(time * f.f * 2.3 + f.p * 1.7) * f.ax * 0.3 * unit;
      const y = f.by * h + Math.cos(time * f.f * 0.8 + f.p) * f.ay * unit + Math.sin(time * f.f * 1.9 + f.p) * f.ay * 0.3 * unit;
      const pulse = Math.max(0, Math.sin(time * f.blink + f.p * 3));
      ctx.globalAlpha = amount * (0.12 + 0.88 * pulse * pulse);
      ctx.drawImage(this.sprite, x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
