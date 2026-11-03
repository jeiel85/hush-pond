import { TAU, HALF_PI, clamp, lerp, angleDiff, mulberry32, range, rnd } from './util.js';

const N = 16; // spine joints, nose → tail root
const MAX_BEND = 0.26; // max angle between neighbouring spine segments (rad)
const WAVE_K = 5.4; // radians of swim wave along the body

// Half-width along the spine (0 = nose, 1 = tail root), normalised so the widest point is 1.
const PROFILE = new Float32Array(N);
{
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const u = Math.max(i / (N - 1), 0.035);
    PROFILE[i] = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.85) * (1 - 0.62 * u);
    peak = Math.max(peak, PROFILE[i]);
  }
  for (let i = 0; i < N; i++) PROFILE[i] /= peak;
}

const HI = '#c92f1e';
const SUMI = '#1c1b21';
const SHIRO = '#f3efe6';

// Colour varieties. `marks` are generated per fish, `sheen` makes metallic scales glint.
const VARIETIES = [
  { id: 'kohaku', weight: 3, base: SHIRO, fin: '250,247,240', marks: ['hi'] },
  { id: 'sanke', weight: 2, base: SHIRO, fin: '250,247,240', marks: ['hi', 'sumi'] },
  { id: 'showa', weight: 1.3, base: SUMI, fin: '228,224,218', marks: ['hi', 'shiro'] },
  { id: 'tancho', weight: 0.6, base: SHIRO, fin: '250,247,240', marks: ['crown'] },
  { id: 'ogon', weight: 1, base: '#e6ad3f', fin: '246,206,122', sheen: 0.32 },
  { id: 'platinum', weight: 0.7, base: '#e2e7e9', fin: '238,243,245', sheen: 0.3 },
  { id: 'orenji', weight: 0.6, base: '#e7742a', fin: '246,170,108', sheen: 0.24 },
  { id: 'chagoi', weight: 0.7, base: '#8b6944', fin: '172,138,98' },
  { id: 'asagi', weight: 0.8, base: '#6b87a0', fin: '214,150,118', marks: ['net', 'flank'] },
  { id: 'kigoi', weight: 0.5, base: '#efc03a', fin: '250,222,140' },
];

function weightedPick(rng, items) {
  let total = 0;
  for (const it of items) total += it.weight;
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Marks live in body space: u along the spine, v across it (-1..1 of the local half-width),
// r in units of the fish's widest half-width. They bend with the body when drawn.
function makeMarks(rng, variety) {
  const spots = [];
  const rings = [];
  const patch = (color, u, v, len, size) => {
    let pu = u;
    let pv = v;
    do {
      spots.push({ u: pu, v: pv, r: size * range(rng, 0.78, 1.18), color });
      pu += range(rng, 0.035, 0.06);
      pv = clamp(pv + range(rng, -0.22, 0.22), -0.55, 0.55);
    } while (pu < u + len && pu < 0.9);
  };
  for (const mark of variety.marks ?? []) {
    if (mark === 'hi') {
      let u = range(rng, 0.03, 0.14);
      const count = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < count && u < 0.78; i++) {
        const len = range(rng, 0.08, 0.3);
        patch(HI, u, range(rng, -0.3, 0.3), len, range(rng, 0.72, 1.02));
        u += len + range(rng, 0.07, 0.18);
      }
    } else if (mark === 'sumi') {
      const count = 3 + Math.floor(rng() * 5);
      for (let i = 0; i < count; i++) {
        spots.push({ u: range(rng, 0.22, 0.82), v: range(rng, -0.75, 0.75), r: range(rng, 0.16, 0.38), color: SUMI });
      }
    } else if (mark === 'shiro') {
      const count = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        patch(SHIRO, range(rng, 0.25, 0.75), range(rng, -0.5, 0.5), range(rng, 0.04, 0.14), range(rng, 0.5, 0.8));
      }
    } else if (mark === 'crown') {
      spots.push({ u: range(rng, 0.08, 0.11), v: 0, r: range(rng, 0.45, 0.58), color: HI });
    } else if (mark === 'net') {
      for (let row = 0, u = 0.16; u < 0.84; row++, u += 0.055) {
        for (let v = -0.6; v <= 0.61; v += 0.3) rings.push({ u, v: v + (row % 2 ? 0.15 : 0), r: 0.17 });
      }
    } else if (mark === 'flank') {
      for (let u = 0.16; u < 0.66; u += 0.06) {
        spots.push({ u, v: 0.98, r: range(rng, 0.26, 0.36), color: '#c4512d' });
        spots.push({ u, v: -0.98, r: range(rng, 0.26, 0.36), color: '#c4512d' });
      }
    }
  }
  return { spots, rings };
}

// Smooth closed curve through the midpoints of a polygon.
function smoothClosed(ctx, xs, ys, n) {
  ctx.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2);
  }
  ctx.closePath();
}

function petal(ctx, x, y, a, len, wid) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const mx = x + c * len * 0.62;
  const my = y + s * len * 0.62;
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx - s * wid, my + c * wid, x + c * len, y + s * len);
  ctx.quadraticCurveTo(mx + s * wid, my - c * wid, x, y);
}

function polarQuad(ctx, ox, oy, a1, d1, a2, d2) {
  ctx.quadraticCurveTo(ox + Math.cos(a1) * d1, oy + Math.sin(a1) * d1, ox + Math.cos(a2) * d2, oy + Math.sin(a2) * d2);
}

export class Koi {
  constructor(seed, index) {
    const rng = mulberry32(seed);
    this.index = index;
    this.variety = weightedPick(rng, VARIETIES);
    this.sizeFactor = range(rng, 0.7, 1.15);
    const { spots, rings } = makeMarks(rng, this.variety);
    this.spots = spots;
    this.rings = rings;
    this.finFill = `rgba(${this.variety.fin},0.48)`;
    this.finEdge = `rgba(${this.variety.fin},0.7)`;
    this.cruise = range(rng, 0.26, 0.38); // body lengths per second
    this.depthRate = range(rng, 0.025, 0.07);
    this.meander = rng() * TAU;
    this.reaction = range(rng, 0.25, 1.4); // seconds before noticing food

    this.px = new Float32Array(N); // spine (follow-the-leader chain)
    this.py = new Float32Array(N);
    this.cx = new Float32Array(N); // spine + swim wave, as drawn
    this.cy = new Float32Array(N);
    this.nx = new Float32Array(N);
    this.ny = new Float32Array(N);
    this.ang = new Float32Array(N);
    this.hw = new Float32Array(N);
    this.ox = new Float32Array(2 * N + 1);
    this.oy = new Float32Array(2 * N + 1);
    this.bx = 0;
    this.by = 0;

    this.heading = 0;
    this.speed = 0;
    this.phase = rng() * TAU;
    this.finPhase = rng() * TAU;
    this.waveAmp = 0;
    this.depth = rng(); // 0 = at the surface, 1 = near the floor
    this.depthPhase = rng() * TAU;
    this.hunger = range(rng, 0.45, 0.9);
    this.fear = 0;
    this.fleeAngle = 0;
    this.tx = 0;
    this.ty = 0;
    this.retarget = 0;
    this.food = null;
    this.pace = 1;
    this.paceTarget = 1;
    this.paceIn = 0;
    this.alpha = 0;
    this.leaving = false;
  }

  setScale(unit) {
    this.length = 112 * unit * this.sizeFactor;
    this.halfWidth = this.length * 0.12;
    this.seg = this.length / (N - 1);
  }

  placeAt(x, y, heading) {
    this.heading = heading;
    for (let i = 0; i < N; i++) {
      this.px[i] = x - Math.cos(heading) * this.seg * i;
      this.py[i] = y - Math.sin(heading) * this.seg * i;
    }
    this.tx = x;
    this.ty = y;
    this.retarget = 0;
    this.shape();
  }

  rescale(sx, sy) {
    for (let i = 0; i < N; i++) {
      this.px[i] *= sx;
      this.py[i] *= sy;
    }
    this.tx *= sx;
    this.ty *= sy;
    this.follow();
    this.shape();
  }

  leave(world) {
    this.leaving = true;
    this.food = null;
    const x = this.px[0];
    const y = this.py[0];
    const out = this.length * 2;
    const gaps = [x, world.w - x, y, world.h - y];
    const side = gaps.indexOf(Math.min(...gaps));
    this.tx = side === 0 ? -out : side === 1 ? world.w + out : x;
    this.ty = side === 2 ? -out : side === 3 ? world.h + out : y;
  }

  startle(x, y, radius, strength) {
    const m = N >> 1;
    const ex = this.px[0] - x;
    const ey = this.py[0] - y;
    const d = Math.min(Math.hypot(ex, ey), Math.hypot(this.px[m] - x, this.py[m] - y));
    if (d > radius) return;
    const f = strength * (1 - d / radius);
    if (f > this.fear) {
      this.fear = f;
      this.fleeAngle = Math.atan2(ey, ex) + rnd(-0.5, 0.5);
    }
  }

  update(dt, world) {
    const hx = this.px[0];
    const hy = this.py[0];
    const L = this.length;
    const cruise = L * this.cruise;

    this.alpha = this.leaving ? Math.max(0, this.alpha - dt * 0.3) : Math.min(1, this.alpha + dt * 0.7);
    this.hunger = Math.min(1, this.hunger + dt / 90);
    this.fear = Math.max(0, this.fear - dt * 0.45);

    this.paceIn -= dt;
    if (this.paceIn <= 0) {
      // now and then a koi just hangs in the water for a while
      this.paceTarget = Math.random() < 0.22 ? rnd(0.3, 0.5) : rnd(0.75, 1.15);
      this.paceIn = rnd(4, 12);
    }
    this.pace += (this.paceTarget - this.pace) * Math.min(1, dt * 0.5);

    this.depthPhase += dt * this.depthRate * TAU;
    let depthGoal = 0.5 + 0.45 * Math.sin(this.depthPhase);
    let tx;
    let ty;
    let goalSpeed;
    let turn = 1.1;
    let accel = 0.9;

    const food = this.leaving ? null : this.pickFood(world, hx, hy);
    if (this.fear > 0.04) {
      tx = hx + Math.cos(this.fleeAngle) * L * 3;
      ty = hy + Math.sin(this.fleeAngle) * L * 3;
      goalSpeed = cruise * (1.4 + 4 * this.fear);
      turn = 4.5;
      accel = 5;
      depthGoal = 1;
    } else if (food) {
      tx = food.x;
      ty = food.y;
      goalSpeed = cruise * clamp(Math.hypot(tx - hx, ty - hy) / (L * 0.7), 0.55, 2.4);
      turn = 2.6;
      accel = 1.8;
      depthGoal = 0;
    } else {
      if (!this.leaving) {
        this.retarget -= dt;
        if (this.retarget <= 0 || Math.hypot(this.tx - hx, this.ty - hy) < L * 0.7) this.pickWander(world);
      }
      tx = this.tx;
      ty = this.ty;
      goalSpeed = cruise * this.pace;
    }

    let dx = tx - hx;
    let dy = ty - hy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;

    // a little personal space — unless dinner is on the table
    const sep = food ? 0.45 : 1.1;
    for (const o of world.koi) {
      if (o === this) continue;
      const ex = hx - o.px[0];
      const ey = hy - o.py[0];
      const r = (L + o.length) * 0.3;
      const d2 = ex * ex + ey * ey;
      if (d2 > r * r || d2 < 1e-6 || Math.abs(o.depth - this.depth) > 0.35) continue;
      const d = Math.sqrt(d2);
      const w = (1 - d / r) * sep;
      dx += (ex / d) * w;
      dy += (ey / d) * w;
    }
    if (!this.leaving) {
      const b = L;
      dx += clamp((b * 0.2 - hx) / b, 0, 1.5) - clamp((hx - (world.w - b * 0.2)) / b, 0, 1.5);
      dy += clamp((b * 0.2 - hy) / b, 0, 1.5) - clamp((hy - (world.h - b * 0.2)) / b, 0, 1.5);
    }

    const diff = angleDiff(this.heading, Math.atan2(dy, dx));
    this.heading += clamp(diff, -turn * dt, turn * dt) + Math.sin(world.time * 0.37 + this.meander) * 0.1 * dt;
    goalSpeed *= 1 - 0.35 * Math.min(1, Math.abs(diff) / Math.PI);
    this.speed += (goalSpeed - this.speed) * Math.min(1, dt * accel);

    this.px[0] += Math.cos(this.heading) * this.speed * dt;
    this.py[0] += Math.sin(this.heading) * this.speed * dt;
    this.depth += (depthGoal - this.depth) * Math.min(1, dt * 0.5);
    this.phase += dt * (1.4 + (7 * this.speed) / L);
    this.finPhase += dt * (2 + (2 * this.speed) / L);
    this.waveAmp = this.halfWidth * (0.25 + Math.min(1.1, (this.speed / cruise) * 0.4));
    this.follow();
    this.shape();

    if (food) {
      const mx = this.px[0] + Math.cos(this.heading) * this.seg * 0.5;
      const my = this.py[0] + Math.sin(this.heading) * this.seg * 0.5;
      if (Math.hypot(food.x - mx, food.y - my) < this.halfWidth * 1.3) world.eat(food, this);
    }
  }

  pickFood(world, hx, hy) {
    if (this.hunger < 0.12) return (this.food = null);
    const sense = Math.max(world.w, world.h) * 0.5;
    let best = this.food && !this.food.eaten ? this.food : null;
    // stick with the current pellet unless another is clearly closer
    let bestD = best ? Math.hypot(best.x - hx, best.y - hy) * 0.7 : Infinity;
    for (const p of world.pellets.list) {
      if (p.eaten || !p.landed || p === this.food) continue;
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d > sense || d >= bestD) continue;
      if (world.time - p.landedAt < this.reaction + d / (world.unit * 900)) continue;
      best = p;
      bestD = d;
    }
    return (this.food = best);
  }

  pickWander(world) {
    const { w, h, gather } = world;
    const m = Math.min(w, h) * 0.08;
    if (Math.random() < 0.55) {
      // drift loosely with the others
      const s = Math.min(w, h) * 0.25;
      this.tx = clamp(gather.x + rnd(-s, s), m, w - m);
      this.ty = clamp(gather.y + rnd(-s, s), m, h - m);
    } else {
      this.tx = rnd(m, w - m);
      this.ty = rnd(m, h - m);
    }
    this.retarget = rnd(8, 22);
  }

  follow() {
    const { px, py, seg } = this;
    let prev = this.heading;
    for (let i = 1; i < N; i++) {
      let a = Math.atan2(py[i - 1] - py[i], px[i - 1] - px[i]);
      const d = angleDiff(prev, a);
      if (d > MAX_BEND) a = prev + MAX_BEND;
      else if (d < -MAX_BEND) a = prev - MAX_BEND;
      px[i] = px[i - 1] - Math.cos(a) * seg;
      py[i] = py[i - 1] - Math.sin(a) * seg;
      prev = a;
    }
  }

  // Lays the travelling swim wave over the spine and derives the drawn outline frame.
  shape() {
    const { px, py, cx, cy, nx, ny, ang, hw } = this;
    for (let i = 0; i < N; i++) {
      const a = i === 0 ? this.heading : Math.atan2(py[i - 1] - py[i], px[i - 1] - px[i]);
      const t = i / (N - 1);
      const wave = Math.sin(this.phase - t * WAVE_K) * this.waveAmp * t * t;
      cx[i] = px[i] - Math.sin(a) * wave;
      cy[i] = py[i] + Math.cos(a) * wave;
    }
    for (let i = 0; i < N; i++) {
      const a = i === 0 ? this.heading : Math.atan2(cy[i - 1] - cy[i], cx[i - 1] - cx[i]);
      ang[i] = a;
      nx[i] = -Math.sin(a);
      ny[i] = Math.cos(a);
      hw[i] = PROFILE[i] * this.halfWidth;
    }
  }

  traceBody(ctx) {
    const { cx, cy, nx, ny, hw, ox, oy } = this;
    let k = 0;
    ox[k] = cx[0] + Math.cos(this.heading) * this.seg * 0.55;
    oy[k++] = cy[0] + Math.sin(this.heading) * this.seg * 0.55;
    for (let i = 0; i < N; i++) {
      ox[k] = cx[i] + nx[i] * hw[i];
      oy[k++] = cy[i] + ny[i] * hw[i];
    }
    for (let i = N - 1; i >= 0; i--) {
      ox[k] = cx[i] - nx[i] * hw[i];
      oy[k++] = cy[i] - ny[i] * hw[i];
    }
    smoothClosed(ctx, ox, oy, k);
  }

  traceFinPair(ctx, i, len, wid, spread) {
    const back = this.ang[i] + Math.PI;
    const ex = this.nx[i] * this.hw[i] * 0.7;
    const ey = this.ny[i] * this.hw[i] * 0.7;
    petal(ctx, this.cx[i] + ex, this.cy[i] + ey, back - spread, len, wid);
    petal(ctx, this.cx[i] - ex, this.cy[i] - ey, back + spread, len, wid);
  }

  traceTail(ctx) {
    const r = N - 2;
    const rx = this.cx[r];
    const ry = this.cy[r];
    const sway = Math.sin(this.phase - WAVE_K - 0.9) * (0.2 + (this.waveAmp / this.halfWidth) * 0.25);
    const back = this.ang[N - 1] + Math.PI + sway;
    const F = this.length * 0.3;
    const spread = 0.48 + Math.sin(this.finPhase * 0.7) * 0.05;
    const lag = -sway * 0.4; // fin tips trail behind the root
    const root = this.halfWidth * 0.18;
    ctx.moveTo(rx + Math.cos(back + HALF_PI) * root, ry + Math.sin(back + HALF_PI) * root);
    polarQuad(ctx, rx, ry, back + spread * 0.55, F * 0.6, back + spread + lag, F);
    polarQuad(ctx, rx, ry, back + spread * 0.3 + lag, F * 0.8, back + lag, F * 0.6);
    polarQuad(ctx, rx, ry, back - spread * 0.3 + lag, F * 0.8, back - spread + lag, F);
    polarQuad(ctx, rx, ry, back - spread * 0.55, F * 0.6, back - HALF_PI, root);
    ctx.closePath();
  }

  bodyPoint(u, v) {
    const f = u * (N - 1);
    const i = Math.min(N - 2, f | 0);
    const t = f - i;
    const h = lerp(this.hw[i], this.hw[i + 1], t) * v;
    this.bx = lerp(this.cx[i], this.cx[i + 1], t) + lerp(this.nx[i], this.nx[i + 1], t) * h;
    this.by = lerp(this.cy[i], this.cy[i + 1], t) + lerp(this.ny[i], this.ny[i + 1], t) * h;
  }

  drawMarks(ctx) {
    const W = this.halfWidth;
    let color = null;
    for (const s of this.spots) {
      if (s.color !== color) {
        if (color) ctx.fill();
        ctx.beginPath();
        color = s.color;
        ctx.fillStyle = color;
      }
      this.bodyPoint(s.u, s.v);
      const r = s.r * W;
      ctx.moveTo(this.bx + r, this.by);
      ctx.arc(this.bx, this.by, r, 0, TAU);
    }
    if (color) ctx.fill();
    if (this.rings.length) {
      ctx.beginPath();
      for (const s of this.rings) {
        this.bodyPoint(s.u, s.v);
        const r = s.r * W;
        ctx.moveTo(this.bx + r, this.by);
        ctx.arc(this.bx, this.by, r, 0, TAU);
      }
      ctx.lineWidth = W * 0.07;
      ctx.strokeStyle = 'rgba(190,212,226,0.55)';
      ctx.stroke();
    }
  }

  draw(ctx, time) {
    if (this.alpha < 0.01) return;
    const { cx, cy, nx, ny, hw } = this;
    const W = this.halfWidth;
    ctx.globalAlpha = this.alpha;

    ctx.beginPath();
    this.traceFinPair(ctx, 3, this.length * 0.17, this.length * 0.065, 1 + Math.sin(this.finPhase) * 0.3);
    this.traceFinPair(ctx, 8, this.length * 0.085, this.length * 0.035, 0.7 + Math.sin(this.finPhase + 1) * 0.15);
    this.traceTail(ctx);
    ctx.fillStyle = this.finFill;
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, W * 0.06);
    ctx.strokeStyle = this.finEdge;
    ctx.stroke();

    ctx.beginPath();
    this.traceBody(ctx);
    ctx.fillStyle = this.variety.base;
    ctx.fill();
    ctx.save();
    ctx.clip();
    this.drawMarks(ctx);

    // roundness: shaded flanks and a soft light along the back
    ctx.beginPath();
    this.traceBody(ctx);
    ctx.lineWidth = W * 0.75;
    ctx.strokeStyle = 'rgba(6,26,32,0.22)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx[1], cy[1]);
    for (let i = 2; i < N - 4; i++) ctx.lineTo(cx[i], cy[i]);
    const sheen = this.variety.sheen ? this.variety.sheen * (0.6 + 0.4 * Math.sin(this.heading * 2 + time * 0.6)) : 0.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = W * 0.5;
    ctx.strokeStyle = `rgba(255,253,240,${sheen.toFixed(3)})`;
    ctx.stroke();

    const er = W * 0.09;
    ctx.beginPath();
    for (const s of [1, -1]) {
      const x = cx[1] + nx[1] * hw[1] * 0.72 * s;
      const y = cy[1] + ny[1] * hw[1] * 0.72 * s;
      ctx.moveTo(x + er, y);
      ctx.arc(x, y, er, 0, TAU);
    }
    ctx.fillStyle = 'rgba(16,16,20,0.85)';
    ctx.fill();

    // the water above a deeper koi mutes its colours
    if (this.depth > 0.02) {
      const m = N >> 1;
      const r = this.length * 0.75;
      ctx.fillStyle = `rgba(22,96,94,${(this.depth * 0.42).toFixed(3)})`;
      ctx.fillRect(cx[m] - r, cy[m] - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawShadow(ctx) {
    if (this.alpha < 0.01) return;
    ctx.globalAlpha = this.alpha;
    ctx.beginPath();
    this.traceBody(ctx);
    this.traceTail(ctx);
    ctx.fill();
  }
}
