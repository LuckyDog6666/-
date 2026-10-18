// 通用小工具：随机数、缓动、弹簧、事件。

export class Rng {
  constructor(seed = Date.now()) { this.s = (seed >>> 0) || 1; }
  next() {
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
  // 按权重挑选：items = [{weight}, ...]
  weighted(items, key = 'weight') {
    let total = 0;
    for (const it of items) total += it[key] ?? 1;
    let x = this.next() * total;
    for (const it of items) { x -= it[key] ?? 1; if (x <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function dampAngle(a, b, lambda, dt) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * (1 - Math.exp(-lambda * dt));
}

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

// 一维阻尼弹簧（耳朵、豆芽、果冻的 Q 弹次级运动）
export class Spring {
  constructor(k = 120, c = 9, x = 0) { this.k = k; this.c = c; this.x = x; this.v = 0; this.target = x; }
  update(dt) {
    // 半隐式欧拉，分步保证稳定
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v) { this.v += v; }
}

export class Emitter {
  constructor() { this.h = {}; }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.h[ev] = (this.h[ev] || []).filter((f) => f !== fn); }
  emit(ev, ...a) { for (const f of this.h[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } }
}

// 可等待的延时（游戏时间，受暂停影响），由 Game 的 update 驱动
export class Timers {
  constructor() { this.list = []; this.t = 0; }
  wait(sec) { return new Promise((res) => this.list.push({ at: this.t + sec, res })); }
  update(dt) {
    this.t += dt;
    if (!this.list.length) return;
    const due = this.list.filter((x) => x.at <= this.t);
    if (!due.length) return;
    this.list = this.list.filter((x) => x.at > this.t);
    for (const d of due) d.res();
  }
  clear() { this.list = []; }
}

export function escapeText(s, max = 14) {
  s = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  // 截断过长昵称（按字符）
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : s || '神秘老板';
}
