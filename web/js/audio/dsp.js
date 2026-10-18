// 纯 JS 的声音合成 DSP 工具库（浏览器 Worker 与 Node 通用，不依赖 Web Audio）。
// 所有声音都在这里"从物理出发"合成：模态共振（敲击/玻璃/木头）、气泡模型（水声）、
// 颗粒合成（碎裂/揉搓/雪地）、滤波噪声（绒毛/风/沙）等。

export const TAU = Math.PI * 2;
export const LN1000 = 6.907755278982137; // 衰减 60dB 对应的自然对数

// ---------- 可复现的随机数 ----------
export class Rng {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next() {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  gauss() {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  exp(mean) { return -Math.log(1 - this.next()) * mean; }
  // 对数均匀分布，适合频率/大小等"按比例"变化的参数
  logRange(a, b) { return Math.exp(this.range(Math.log(a), Math.log(b))); }
}

// ---------- 小工具 ----------
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-12, g));
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const t60ToRate = (t60) => LN1000 / Math.max(1e-4, t60); // exp(-rate * t)
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function alloc(sr, seconds) {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

// ---------- 双二阶滤波器（RBJ Audio EQ Cookbook，转置直接 II 型） ----------
export class Biquad {
  constructor(sr, type = 'lp', f = 1000, q = 0.7071, gainDb = 0) {
    this.sr = sr;
    this.z1 = 0;
    this.z2 = 0;
    this.set(type, f, q, gainDb);
  }
  set(type, f, q = 0.7071, gainDb = 0) {
    const sr = this.sr;
    const w0 = (TAU * clamp(f, 10, sr * 0.47)) / sr;
    const cs = Math.cos(w0);
    const sn = Math.sin(w0);
    const alpha = sn / (2 * Math.max(0.05, q));
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'hp':
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'bp': // 峰值增益 0dB
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1; b1 = -2 * cs; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
        break;
      case 'ls': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cs + s);
        b1 = 2 * A * ((A - 1) - (A + 1) * cs);
        b2 = A * ((A + 1) - (A - 1) * cs - s);
        a0 = (A + 1) + (A - 1) * cs + s;
        a1 = -2 * ((A - 1) + (A + 1) * cs);
        a2 = (A + 1) + (A - 1) * cs - s;
        break;
      }
      case 'hs': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cs + s);
        b1 = -2 * A * ((A - 1) + (A + 1) * cs);
        b2 = A * ((A + 1) + (A - 1) * cs - s);
        a0 = (A + 1) - (A - 1) * cs + s;
        a1 = 2 * ((A - 1) - (A + 1) * cs);
        a2 = (A + 1) - (A - 1) * cs - s;
        break;
      }
      case 'lp':
      default:
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = this.z2 = 0; return this; }
}

// 一阶低通/高通（用于平滑、去直流）
export class OnePole {
  constructor(sr, f) { this.sr = sr; this.y = 0; this.setF(f); }
  setF(f) { this.a = Math.exp((-TAU * f) / this.sr); return this; }
  lp(x) { this.y = x + this.a * (this.y - x); return this.y; }
}

// 在 buf 的 [i0, i1) 区间就地滤波
export function filterRange(buf, i0, i1, ...filters) {
  i0 = Math.max(0, i0 | 0);
  i1 = Math.min(buf.length, i1 | 0);
  for (let i = i0; i < i1; i++) {
    let x = buf[i];
    for (let k = 0; k < filters.length; k++) x = filters[k].process(x);
    buf[i] = x;
  }
  return buf;
}
export function filterAll(buf, ...filters) { return filterRange(buf, 0, buf.length, ...filters); }

// ---------- 噪声源 ----------
export class Noise {
  constructor(rng, color = 'white') {
    this.rng = rng;
    this.color = color;
    this.b = [0, 0, 0, 0, 0, 0, 0];
    this.last = 0;
  }
  next() {
    const w = this.rng.next() * 2 - 1;
    if (this.color === 'white') return w;
    if (this.color === 'pink') {
      // Paul Kellet 精确版粉红噪声
      const b = this.b;
      b[0] = 0.99886 * b[0] + w * 0.0555179;
      b[1] = 0.99332 * b[1] + w * 0.0750759;
      b[2] = 0.969 * b[2] + w * 0.153852;
      b[3] = 0.8665 * b[3] + w * 0.3104856;
      b[4] = 0.55 * b[4] + w * 0.5329522;
      b[5] = -0.7616 * b[5] - w * 0.016898;
      const p = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
      b[6] = w * 0.115926;
      return p * 0.11;
    }
    // brown
    this.last = (this.last + 0.02 * w) / 1.02;
    return this.last * 3.5;
  }
}

// ---------- 包络 ----------
// 先上升后指数衰减的包络：attack 秒内按 curve 上升，随后以 tau 指数衰减
export function envAD(t, attack, tau, curve = 2) {
  if (t < 0) return 0;
  if (t < attack) return Math.pow(t / attack, curve);
  return Math.exp(-(t - attack) / tau);
}
// 正弦半窗（hann），u ∈ [0,1]
export const hann = (u) => (u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(TAU * u));
// 平滑台阶
export const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// ---------- 振荡类合成 ----------
/**
 * 叠加一个带衰减的正弦分量（模态合成的基本单元）。
 * opts: f, amp, t60, attack, glide(每秒频率相对变化), glideTo(目标频率) / glideTime,
 *       vibRate, vibDepth(相对), vibDecay, phase, pan(不用)
 */
export function addSine(buf, sr, t0, opts) {
  const {
    f, amp = 1, t60 = 0.5, attack = 0.0005, glide = 0, glideTo = 0, glideTime = 0.05,
    vibRate = 0, vibDepth = 0, vibDecay = 0, phase = 0, shape = 'sine', amEnv = null,
  } = opts;
  const rate = t60ToRate(t60);
  const n = Math.min(buf.length, Math.ceil((t0 + t60 * 1.05 + attack) * sr));
  let ph = phase;
  const i0 = Math.max(0, Math.floor(t0 * sr));
  for (let i = i0; i < n; i++) {
    const t = i / sr - t0;
    if (t < 0) continue;
    let fr = f;
    if (glideTo) {
      const u = Math.min(1, t / glideTime);
      fr = f * Math.pow(glideTo / f, 1 - Math.pow(1 - u, 3));
    }
    if (glide) fr *= 1 + glide * t;
    if (vibDepth) fr *= 1 + vibDepth * Math.sin(TAU * vibRate * t) * (vibDecay ? Math.exp(-t / vibDecay) : 1);
    ph += (TAU * fr) / sr;
    const env = (t < attack ? smooth(t / attack) : 1) * Math.exp(-rate * t) * (amEnv ? amEnv(t) : 1);
    let s;
    if (shape === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
    else if (shape === 'softsaw') s = Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph);
    else s = Math.sin(ph);
    buf[i] += amp * env * s;
  }
  return buf;
}

/**
 * 模态（共振体）敲击：modes = [{r: 频率比, a: 幅度, t60}]，f0 基频。
 * hardness 越大高频越亮（模拟硬/软的敲击物）。detune 让每个模态成对出现，产生自然的"拍音"。
 */
export function addModal(buf, sr, t0, f0, modes, opts = {}) {
  const { amp = 1, hardness = 4000, detune = 0, rng = null, t60Scale = 1, attack = 0.0004 } = opts;
  for (const m of modes) {
    const f = f0 * m.r * (rng ? 1 + rng.gauss() * 0.004 : 1);
    if (f > sr * 0.45) continue;
    const bright = Math.exp(-f / hardness);
    const a = amp * m.a * bright;
    const phase = rng ? rng.range(0, 0.3) : 0;
    if (detune) {
      addSine(buf, sr, t0, { f: f * (1 - detune), amp: a * 0.55, t60: m.t60 * t60Scale, attack, phase });
      addSine(buf, sr, t0, { f: f * (1 + detune), amp: a * 0.45, t60: m.t60 * t60Scale * 0.92, attack, phase });
    } else {
      addSine(buf, sr, t0, { f, amp: a, t60: m.t60 * t60Scale, attack, phase });
    }
  }
  return buf;
}

// 常见共振体的模态比例（来自经典的模态合成文献与实测近似值）
export const MODES = {
  // 自由-自由两端的棒（木琴/玻璃棒/冰柱）
  bar: [
    { r: 1, a: 1, t60: 1 },
    { r: 2.756, a: 0.45, t60: 0.55 },
    { r: 5.404, a: 0.25, t60: 0.3 },
    { r: 8.933, a: 0.12, t60: 0.18 },
  ],
  // 木头（空心木块）：衰减快，模态偏低
  wood: [
    { r: 1, a: 1, t60: 0.14 },
    { r: 2.57, a: 0.55, t60: 0.07 },
    { r: 4.21, a: 0.32, t60: 0.045 },
    { r: 6.1, a: 0.16, t60: 0.03 },
  ],
  // 玻璃杯/铃（较多不协和泛音，余音长）
  glass: [
    { r: 1, a: 1, t60: 2.2 },
    { r: 2.32, a: 0.5, t60: 1.4 },
    { r: 4.25, a: 0.32, t60: 0.9 },
    { r: 6.63, a: 0.2, t60: 0.55 },
    { r: 9.38, a: 0.1, t60: 0.35 },
  ],
  // 小金属片（亮、短）
  metal: [
    { r: 1, a: 1, t60: 0.6 },
    { r: 2.92, a: 0.6, t60: 0.4 },
    { r: 4.86, a: 0.45, t60: 0.3 },
    { r: 7.2, a: 0.3, t60: 0.2 },
    { r: 10.3, a: 0.15, t60: 0.12 },
  ],
  // 石头/陶瓷
  stone: [
    { r: 1, a: 1, t60: 0.07 },
    { r: 1.83, a: 0.7, t60: 0.05 },
    { r: 3.1, a: 0.5, t60: 0.035 },
    { r: 4.6, a: 0.3, t60: 0.025 },
  ],
  // 卡林巴琴片：基频+较弱的高阶不协和泛音
  kalimba: [
    { r: 1, a: 1, t60: 1.6 },
    { r: 5.95, a: 0.18, t60: 0.22 },
    { r: 2.0, a: 0.05, t60: 0.6 },
  ],
  // 八音盒梳齿
  musicbox: [
    { r: 1, a: 1, t60: 1.8 },
    { r: 2.0, a: 0.12, t60: 0.7 },
    { r: 5.2, a: 0.1, t60: 0.18 },
    { r: 8.9, a: 0.04, t60: 0.08 },
  ],
  // 马林巴（调谐木条 1:4:10）
  marimba: [
    { r: 1, a: 1, t60: 0.9 },
    { r: 3.99, a: 0.28, t60: 0.22 },
    { r: 9.9, a: 0.08, t60: 0.06 },
  ],
};

// ---------- 噪声类合成 ----------
/**
 * 叠加一段经过（可随时间变化的）滤波的噪声。
 * env(t) 返回增益；filt(t) 返回 [{type,f,q,g}] 数组（每 16 个采样更新一次系数）。
 */
export function addNoise(buf, sr, rng, t0, dur, opts = {}) {
  const { amp = 1, color = 'white', env = null, filt = null, filters = null, update = 16 } = opts;
  const noise = new Noise(rng, color);
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const i1 = Math.min(buf.length, Math.ceil((t0 + dur) * sr));
  let fs = [];
  const spec0 = filt ? filt(0) : filters || [];
  fs = spec0.map((s) => new Biquad(sr, s.type, s.f, s.q ?? 0.7071, s.g ?? 0));
  for (let i = i0; i < i1; i++) {
    const t = i / sr - t0;
    if (filt && (i - i0) % update === 0) {
      const spec = filt(t / dur);
      for (let k = 0; k < fs.length; k++) fs[k].set(spec[k].type, spec[k].f, spec[k].q ?? 0.7071, spec[k].g ?? 0);
    }
    let x = noise.next();
    for (let k = 0; k < fs.length; k++) x = fs[k].process(x);
    const e = env ? env(t, t / dur) : 1;
    buf[i] += amp * e * x;
  }
  return buf;
}

// 极短的"咔嗒"：一个被滤波的冲激 + 少量噪声，用于接触瞬间
export function addClick(buf, sr, rng, t0, amp, opts = {}) {
  const { f = 3000, q = 1.2, dur = 0.004, type = 'bp', tau = 0.0012 } = opts;
  const bq = new Biquad(sr, type, f, q);
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.ceil(dur * sr);
  for (let k = 0; k < n && i0 + k < buf.length; k++) {
    const t = k / sr;
    const x = (k === 0 ? 1 : 0) * 0.6 + (rng.next() * 2 - 1) * Math.exp(-t / tau);
    buf[i0 + k] += amp * bq.process(x);
  }
  return buf;
}

// 共振"啪"粒：带通共振的短促点击（塑料纸、气泡膜、细碎声的基本颗粒）
export function addPing(buf, sr, t0, f, amp, t60 = 0.01, phase = 0) {
  return addSine(buf, sr, t0, { f, amp, t60, attack: 0.00015, phase });
}

/**
 * 颗粒云（泊松过程）：在 [t0, t0+dur) 内按 rate(u) 每秒产生颗粒，每个颗粒由 grain(t, u) 写入。
 */
export function scatter(rng, t0, dur, rate, grain, maxGrains = 4000) {
  let t = 0;
  let count = 0;
  while (t < dur && count < maxGrains) {
    const u = t / dur;
    const r = Math.max(0.5, rate(u));
    t += rng.exp(1 / r);
    if (t >= dur) break;
    grain(t0 + t, t / dur, count++);
  }
  return count;
}

// 细碎噪声颗粒（雪、落叶、饼干碎）
export function addNoiseGrain(buf, sr, rng, t0, amp, opts = {}) {
  const { f = 3000, q = 1.5, dur = 0.003, shape = 'exp' } = opts;
  const bq = new Biquad(sr, 'bp', f, q);
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.max(4, Math.ceil(dur * sr));
  // 滤波器有过渡响应，多留一点尾巴
  const tail = Math.ceil(0.002 * sr);
  for (let k = 0; k < n + tail && i0 + k < buf.length; k++) {
    const u = k / n;
    const w = k < n ? (shape === 'hann' ? hann(u) : Math.exp(-u * 5) * smooth(u * 20)) : 0;
    buf[i0 + k] += amp * bq.process((rng.next() * 2 - 1) * w);
  }
  return buf;
}

/**
 * 气泡共振（van den Doel 2005 液体声音物理模型）：
 * 半径 r 的气泡产生 Minnaert 频率 f0≈3/r 的衰减正弦，并随时间轻微上滑。
 * rMm 为半径（毫米）；xi 控制上滑程度（水滴"叮咚"感更强）。
 */
export function addBubble(buf, sr, t0, rMm, amp, opts = {}) {
  const { xi = 0.1, decayScale = 1, attack = 0.0004 } = opts;
  const r = rMm / 1000;
  const f0 = 3 / r;
  if (f0 > sr * 0.45) return buf;
  const d = (0.043 * f0 + 0.0014 * Math.pow(f0, 1.5)) / decayScale;
  const sigma = xi * d;
  const dur = LN1000 / d;
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.ceil(dur * sr);
  let ph = 0;
  for (let k = 0; k < n && i0 + k < buf.length; k++) {
    const t = k / sr;
    const f = f0 * (1 + sigma * t);
    ph += (TAU * f) / sr;
    const env = (t < attack ? smooth(t / attack) : 1) * Math.exp(-d * t);
    buf[i0 + k] += amp * env * Math.sin(ph);
  }
  return buf;
}

// 色散"啾"（冰面开裂、弹簧特有的激光般下滑音）
export function addChirp(buf, sr, t0, f1, f2, dur, amp, opts = {}) {
  const { tau = dur / 3, attack = 0.0005, curve = 2 } = opts;
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.ceil(dur * sr);
  let ph = 0;
  for (let k = 0; k < n && i0 + k < buf.length; k++) {
    const t = k / sr;
    const u = t / dur;
    const f = f2 + (f1 - f2) * Math.pow(1 - u, curve);
    ph += (TAU * f) / sr;
    const env = (t < attack ? smooth(t / attack) : 1) * Math.exp(-t / tau) * (1 - smooth((u - 0.85) / 0.15));
    buf[i0 + k] += amp * env * Math.sin(ph);
  }
  return buf;
}

// 柔和低频"噗"（小爪子按在软地面上的身体感）
export function addThump(buf, sr, rng, t0, amp, opts = {}) {
  const { f = 90, t60 = 0.09, noiseLp = 500, noiseAmt = 0.6, glideTo = 0 } = opts;
  addSine(buf, sr, t0, { f, amp, t60, attack: 0.002, glideTo: glideTo || f * 0.7, glideTime: t60 });
  addNoise(buf, sr, rng, t0, t60 * 0.8, {
    amp: amp * noiseAmt,
    color: 'pink',
    env: (t) => envAD(t, 0.002, t60 / 6),
    filters: [{ type: 'lp', f: noiseLp, q: 0.7 }],
  });
  return buf;
}

// ---------- 后处理 ----------
// 近似 K 加权（ITU BS.1770 的预滤波：高架 +4dB@1.7kHz 与高通 ~60Hz）
function kWeighted(buf, sr) {
  const out = new Float32Array(buf.length);
  const hs = new Biquad(sr, 'hs', 1700, 0.7071, 4);
  const hp = new Biquad(sr, 'hp', 60, 0.5);
  for (let i = 0; i < buf.length; i++) out[i] = hp.process(hs.process(buf[i]));
  return out;
}

/** 声音分析：峰值、短时最大响度（30ms 窗，K 加权 RMS）、有效时长等 */
export function analyze(buf, sr) {
  let peak = 0;
  let sum = 0;
  let nan = false;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) { nan = true; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v;
  }
  const kw = kWeighted(buf, sr);
  const win = Math.max(1, Math.floor(0.03 * sr));
  const hop = Math.max(1, Math.floor(win / 3));
  let maxMs = 0;
  let acc = 0;
  // 滑动窗口的平方和
  const sq = new Float64Array(kw.length + 1);
  for (let i = 0; i < kw.length; i++) sq[i + 1] = sq[i] + kw[i] * kw[i];
  for (let i = 0; i + win <= kw.length; i += hop) {
    const ms = (sq[i + win] - sq[i]) / win;
    if (ms > maxMs) maxMs = ms;
  }
  if (kw.length < win) maxMs = sq[kw.length] / Math.max(1, kw.length);
  acc = maxMs;
  // 有效时长：最后一个超过 (峰值-50dB) 的位置
  const thr = peak * dbToGain(-50);
  let last = 0;
  for (let i = buf.length - 1; i >= 0; i--) if (Math.abs(buf[i]) > thr) { last = i; break; }
  return {
    peakDb: gainToDb(peak),
    loudDb: 10 * Math.log10(Math.max(1e-14, acc)),
    dc: sum / buf.length,
    duration: last / sr,
    length: buf.length / sr,
    nan,
  };
}

/**
 * 最终处理：去直流、按响度目标归一化、限制峰值、淡入淡出、裁掉尾部静音。
 */
export function finalize(buf, sr, opts = {}) {
  const { loudDb = -22, peakCeilDb = -3, fadeIn = 0.0008, fadeOut = 0.012, trimDb = -66 } = opts;
  // 去直流（极低频高通）
  const hp = new Biquad(sr, 'hp', 18, 0.6);
  for (let i = 0; i < buf.length; i++) buf[i] = hp.process(buf[i]);
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) buf[i] = 0;
  const a = analyze(buf, sr);
  let g = dbToGain(loudDb - a.loudDb);
  const peakAfter = a.peakDb + gainToDb(g);
  if (peakAfter > peakCeilDb) g *= dbToGain(peakCeilDb - peakAfter);
  // 裁剪尾部
  const thr = Math.pow(10, a.peakDb / 20) * dbToGain(trimDb - 0);
  let end = buf.length;
  for (let i = buf.length - 1; i > 0; i--) if (Math.abs(buf[i]) > thr) { end = i + 1; break; }
  end = Math.min(buf.length, end + Math.ceil(0.01 * sr));
  const out = new Float32Array(end);
  const nIn = Math.ceil(fadeIn * sr);
  const nOut = Math.min(end, Math.ceil(fadeOut * sr));
  for (let i = 0; i < end; i++) {
    let v = buf[i] * g;
    if (i < nIn) v *= smooth(i / nIn);
    if (i >= end - nOut) v *= smooth((end - i) / nOut);
    out[i] = v;
  }
  return out;
}

// 软饱和（给极少数需要"温暖"的声音）
export function saturate(buf, drive = 1.5) {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / k;
  return buf;
}

// 两个缓冲交叉淡化成可无缝循环的环境底噪
export function makeLoop(buf, sr, xfade = 1.5) {
  const n = Math.floor(xfade * sr);
  const len = buf.length - n;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = buf[i];
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const a = Math.sqrt(u);
    const b = Math.sqrt(1 - u);
    out[i] = buf[i] * a + buf[len + i] * b;
  }
  return out;
}

// 编码为 16-bit PCM WAV（自检工具用）
export function encodeWav(channels, sr) {
  const nCh = channels.length;
  const len = channels[0].length;
  const data = new DataView(new ArrayBuffer(44 + len * nCh * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * nCh * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, nCh, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * nCh * 2, true); data.setUint16(32, nCh * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, len * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const v = clamp(channels[c][i], -1, 1);
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return data.buffer;
}
