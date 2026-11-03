// Generative ambience on the Web Audio API — nothing is downloaded, every sound is synthesised.
export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.rain = false;
    this.night = 0;
    this.timers = new Map();
    this.lastGulp = 0;
  }

  async enable() {
    if (!this.ctx) this.build();
    this.on = true;
    try {
      await this.ctx.resume();
    } catch (err) {
      this.on = false;
      throw err;
    }
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.55, t, 0.8);
    this.repeat('drip', () => this.drip(), 2.5, 8);
    this.repeat('cricket', () => this.cricket(), 0.9, 2.6);
  }

  disable() {
    this.on = false;
    for (const id of this.timers.values()) clearTimeout(id);
    this.timers.clear();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.25);
    setTimeout(() => {
      if (!this.on && this.ctx.state === 'running') this.ctx.suspend();
    }, 1500);
  }

  // Mobile browsers suspend or interrupt the context (calls, other apps, backgrounding).
  // Resuming may need a user gesture, so callers retry on the next one.
  resume() {
    if (!this.on || !this.ctx || this.ctx.state === 'running') return;
    this.ctx.resume().catch((err) => console.warn('hush pond: audio could not resume yet', err));
  }

  setRain(on) {
    this.rain = on;
    if (this.ctx) this.rainGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 1.2);
  }

  setNight(v) {
    this.night = v;
  }

  build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // water bed: brown noise through a breathing low-pass
    const bed = ctx.createBufferSource();
    bed.buffer = noiseBuffer(ctx, 6, 'brown');
    bed.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.5;
    bed.connect(lp).connect(bedGain).connect(this.master);
    lfo(ctx, 0.07, 0.16, bedGain.gain);
    lfo(ctx, 0.043, 160, lp.frequency);

    // rain hiss
    const rain = ctx.createBufferSource();
    rain.buffer = noiseBuffer(ctx, 5, 'white');
    rain.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.5;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = this.rain ? 0.12 : 0;
    rain.connect(bp).connect(this.rainGain).connect(this.master);

    bed.start();
    rain.start();
  }

  repeat(name, fn, min, max) {
    const tick = () => {
      if (!this.on) return;
      fn();
      this.timers.set(name, setTimeout(tick, (min + Math.random() * (max - min)) * 1000));
    };
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(tick, (min + Math.random() * (max - min)) * 1000));
  }

  // While the context is suspended its clock stands still, so anything scheduled then would
  // all fire at once on resume. Sounds are only made while it is actually running.
  get live() {
    return this.on && this.ctx?.state === 'running';
  }

  blip(from, to, peak, decay) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.55);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  // a single drop landing somewhere on the pond
  drip() {
    if (!this.live) return;
    const f = 650 + Math.random() * 700;
    this.blip(f, f * 1.9, 0.04, 0.12);
  }

  // food hitting the water
  plop() {
    if (!this.live) return;
    this.blip(260, 620, 0.13, 0.17);
  }

  // a koi taking a pellet
  gulp() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGulp < 0.08) return;
    this.lastGulp = now;
    const f = 380 + Math.random() * 160;
    this.blip(f, f * 1.6, 0.05, 0.09);
  }

  cricket() {
    if (!this.live || this.night < 0.4) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 4200 + Math.random() * 500;
    g.gain.value = 0;
    const peak = 0.012 * this.night * (this.rain ? 0.4 : 1);
    for (let k = 0; k < 3; k++) {
      const t = t0 + k * 0.055;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.008);
      g.gain.linearRampToValueAtTime(0, t + 0.035);
    }
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.2);
  }
}

function lfo(ctx, freq, depth, param) {
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start();
}

// Loopable noise: the head is cross-faded with the natural continuation of the tail so the loop has no click.
function noiseBuffer(ctx, seconds, color) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.floor(ctx.sampleRate * 0.25);
  const raw = new Float32Array(len + fade);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last * 3.5;
    } else raw[i] = white * 0.5;
  }
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const out = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    out[i] = i < fade ? raw[len + i] * (1 - i / fade) + raw[i] * (i / fade) : raw[i];
  }
  return buf;
}
