// ASMR 声音配方库：每一种可以"踩"到的东西都对应一个物理启发的合成配方。
// 每个配方生成若干个随机变体（游戏音频的 round-robin 做法），播放时随机挑选并微调音高，
// 这样长时间直播也不会听到机械重复的同一个声音。
//
// 字段：
//   cat      响度类别（见 LOUDNESS），决定归一化目标
//   variants 生成变体数量
//   notes    （可选）旋律类配方按音阶逐音生成，替代 variants
//   len      最长时长（秒），配方内实际声音会更短，尾部静音会被自动裁掉
//   gen(r, sr, buf, note) 往 buf 里写入声音

import {
  Rng, alloc, finalize, addSine, addModal, addNoise, addClick, addPing, addNoiseGrain, addBubble,
  addChirp, addThump, scatter, envAD, smooth, hann, MODES, Biquad, filterAll, midiToHz, makeLoop, Noise, TAU,
} from './dsp.js';

// 不同类别的目标短时响度（dB，K 加权 30ms 窗 RMS 最大值）。脚步最轻，主触发音最突出。
export const LOUDNESS = {
  step: -31,
  soft: -27,
  item: -21.5,
  pop: -22,
  chime: -24,
  music: -25,
  voice: -25,
  fx: -23,
  amb: -36,
  ambEvt: -33,
};

// C 大调五声音阶（多个八度），旋律类物件只会出现和谐的音
const PENTA = [0, 2, 4, 7, 9];
export function pentaNotes(baseMidi, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(baseMidi + PENTA[i % 5] + 12 * Math.floor(i / 5));
  return out;
}

// ========== 通用小积木 ==========
// 爪垫接触：非常柔软的"噗"
function pawContact(buf, sr, r, t0, amp, soft = 1) {
  addThump(buf, sr, r, t0, amp, { f: r.range(70, 110), t60: 0.07 * soft, noiseLp: 380 * soft + 150, noiseAmt: 0.8 });
}

// 雪/沙/碎屑类：一次"压下去"的颗粒云
function crunchCloud(buf, sr, r, t0, o) {
  const { dur, rate, fLo, fHi, qLo = 0.8, qHi = 3, amp = 1, gDur = [0.0006, 0.004], shape = (u) => Math.sin(Math.PI * Math.pow(u, 0.6)) } = o;
  scatter(r, t0, dur, (u) => rate * (0.15 + shape(u)), (t, u) => {
    const big = r.chance(0.08) ? r.range(1.8, 3) : 1;
    const a = amp * shape(u) * Math.pow(r.next(), 1.6) * big;
    addNoiseGrain(buf, sr, r, t, a, { f: r.logRange(fLo, fHi), q: r.range(qLo, qHi), dur: r.range(gDur[0], gDur[1]) });
  });
}

// 一组气泡（溅水、黏液里的小气孔）
function bubbleCloud(buf, sr, r, t0, dur, count, rLo, rHi, amp, xi = 0.12) {
  for (let i = 0; i < count; i++) {
    const t = t0 + Math.pow(r.next(), 1.7) * dur;
    const rad = r.logRange(rLo, rHi);
    addBubble(buf, sr, t, rad, amp * r.range(0.3, 1) * Math.pow(rad / rHi, 0.4), { xi: r.range(xi * 0.6, xi * 1.6) });
  }
}

// 塑料/糖纸的揉搓：高 Q 的明亮"咔哒"颗粒成簇出现
function crinkleBursts(buf, sr, r, t0, total, bursts, density, fLo, fHi, amp) {
  for (let b = 0; b < bursts; b++) {
    const bt = t0 + (b / bursts) * total + r.range(0, total / bursts) * 0.5;
    const bd = r.range(0.04, 0.12);
    const ba = amp * r.range(0.5, 1);
    scatter(r, bt, bd, (u) => density * Math.sin(Math.PI * u) + 20, (t) => {
      const a = ba * Math.pow(r.next(), 2.2);
      if (r.chance(0.6)) addPing(buf, sr, t, r.logRange(fLo, fHi), a, r.range(0.002, 0.008), r.range(0, 6));
      else addNoiseGrain(buf, sr, r, t, a * 1.3, { f: r.logRange(fLo, fHi), q: r.range(4, 12), dur: r.range(0.0005, 0.002) });
    });
  }
}

// 软软的"噗呲"挤压（棉花糖、奶油、云朵）
function softPress(buf, sr, r, t0, dur, lp, amp, color = 'pink') {
  addNoise(buf, sr, r, t0, dur, {
    amp,
    color,
    env: (t, u) => Math.sin(Math.PI * Math.pow(u, 0.45)) * (1 - u * 0.3),
    filt: (u) => [
      { type: 'lp', f: lp * (1.15 - 0.55 * u), q: 0.9 },
      { type: 'hp', f: 90, q: 0.6 },
    ],
  });
}

// 湿润黏稠的挤压（史莱姆、泥巴、蜂蜜）
function wetSquish(buf, sr, r, t0, dur, amp, o = {}) {
  const { fLo = 280, fHi = 1600, q = 5, bubbles = 14, rLo = 0.25, rHi = 1.2 } = o;
  const wob = r.range(9, 16);
  const ph = r.range(0, TAU);
  addNoise(buf, sr, r, t0, dur, {
    amp,
    color: 'pink',
    env: (t, u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.8) * (0.7 + 0.3 * Math.sin(TAU * wob * t + ph)),
    filt: (u) => [
      { type: 'bp', f: fLo + (fHi - fLo) * (0.5 + 0.5 * Math.sin(Math.PI * u * 1.3 + ph * 0.2)) * (1 - 0.35 * u), q },
      { type: 'lp', f: 5000, q: 0.7 },
    ],
  });
  bubbleCloud(buf, sr, r, t0 + dur * 0.25, dur * 0.85, bubbles, rLo, rHi, amp * 0.5, 0.18);
}

// 果冻/蘑菇的"啵嘤"
function boing(buf, sr, r, t0, f0, amp, o = {}) {
  const { t60 = 0.55, vib = 0.07, vibRate = r.range(9, 13), harm = 0.25, drop = 1.6 } = o;
  addSine(buf, sr, t0, { f: f0 * drop, glideTo: f0, glideTime: 0.06, amp, t60, attack: 0.003, vibRate, vibDepth: vib, vibDecay: 0.25, shape: 'sine' });
  addSine(buf, sr, t0, { f: f0 * drop * 2, glideTo: f0 * 2, glideTime: 0.06, amp: amp * harm, t60: t60 * 0.5, attack: 0.003, vibRate, vibDepth: vib, vibDecay: 0.2 });
  addThump(buf, sr, r, t0, amp * 0.5, { f: f0 * 0.4, t60: 0.08, noiseLp: 700 });
}

// ========== 配方 ==========
export const RECIPES = {
  // ---------------- 地面脚步（轻柔、短） ----------------
  step_grass: {
    cat: 'step', variants: 6, len: 0.35,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.5);
      addNoise(b, sr, r, 0.005, r.range(0.12, 0.2), {
        amp: 0.6,
        env: (t, u) => Math.sin(Math.PI * Math.pow(u, 0.5)) * (1 - u),
        filt: (u) => [{ type: 'bp', f: 2200 + 2600 * u, q: 0.9 }],
      });
      crunchCloud(b, sr, r, 0.01, { dur: 0.12, rate: 140, fLo: 2500, fHi: 7000, amp: 0.35 });
    },
  },
  step_moss: {
    cat: 'step', variants: 5, len: 0.3,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.7, 0.8);
      softPress(b, sr, r, 0, 0.16, 900, 0.5);
    },
  },
  step_sand: {
    cat: 'step', variants: 6, len: 0.4,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.45);
      crunchCloud(b, sr, r, 0, { dur: r.range(0.16, 0.24), rate: 900, fLo: 1500, fHi: 6500, qLo: 0.6, qHi: 1.5, amp: 0.22, gDur: [0.0008, 0.003] });
      addNoise(b, sr, r, 0, 0.2, { amp: 0.18, env: (t, u) => Math.sin(Math.PI * u) * (1 - u), filters: [{ type: 'bp', f: 3500, q: 0.6 }] });
    },
  },
  step_snow: {
    cat: 'step', variants: 6, len: 0.45,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.4);
      crunchCloud(b, sr, r, 0, { dur: r.range(0.18, 0.28), rate: 700, fLo: 900, fHi: 5500, qLo: 1, qHi: 3.5, amp: 0.5 });
      // 冷雪特有的"吱"
      if (r.chance(0.6)) for (let i = 0; i < r.int(2, 5); i++) addSine(b, sr, r.range(0.02, 0.15), { f: r.range(700, 1400), amp: 0.06, t60: 0.03 });
    },
  },
  step_wood: {
    cat: 'step', variants: 6, len: 0.35,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.5);
      addModal(b, sr, 0.001, r.range(180, 320), MODES.wood, { amp: 0.5, hardness: 1500, rng: r, t60Scale: 0.8 });
      addClick(b, sr, r, 0, 0.12, { f: 1800, q: 0.8 });
    },
  },
  step_stone: {
    cat: 'step', variants: 6, len: 0.3,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.45);
      addModal(b, sr, 0.001, r.range(700, 1100), MODES.stone, { amp: 0.3, hardness: 2500, rng: r });
      crunchCloud(b, sr, r, 0.004, { dur: 0.05, rate: 300, fLo: 3000, fHi: 8000, amp: 0.12 });
    },
  },
  step_candy: { // 光滑的糖面：轻轻的"嗒"带一点玻璃感
    cat: 'step', variants: 6, len: 0.3,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.45);
      addModal(b, sr, 0.001, r.range(900, 1400), MODES.stone, { amp: 0.25, hardness: 3000, rng: r, t60Scale: 1.6 });
    },
  },
  step_cloud: {
    cat: 'step', variants: 5, len: 0.4,
    gen(r, sr, b) {
      softPress(b, sr, r, 0, r.range(0.2, 0.28), 700, 0.7);
      addNoise(b, sr, r, 0.02, 0.18, { amp: 0.12, env: (t, u) => Math.sin(Math.PI * u), filters: [{ type: 'hp', f: 4000, q: 0.5 }] });
    },
  },
  step_water: {
    cat: 'step', variants: 6, len: 0.4,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 0.06, { amp: 0.35, env: (t) => envAD(t, 0.002, 0.015), filters: [{ type: 'lp', f: 2500, q: 0.7 }] });
      bubbleCloud(b, sr, r, 0.005, 0.2, r.int(4, 8), 0.8, 3.5, 0.45);
    },
  },
  step_plush: { // 地毯/毛绒
    cat: 'step', variants: 5, len: 0.25,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.7, 0.7);
      addNoise(b, sr, r, 0, 0.1, { amp: 0.15, env: (t, u) => Math.sin(Math.PI * u), filters: [{ type: 'bp', f: 1800, q: 0.7 }] });
    },
  },
  step_cookie: {
    cat: 'step', variants: 6, len: 0.3,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.4);
      crunchCloud(b, sr, r, 0, { dur: 0.09, rate: 400, fLo: 1200, fHi: 5000, amp: 0.4 });
    },
  },
  step_crystal: {
    cat: 'step', variants: 6, len: 0.6,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.35);
      addModal(b, sr, 0.001, r.range(2400, 3600), MODES.bar, { amp: 0.12, hardness: 9000, rng: r, t60Scale: 0.35, detune: 0.002 });
    },
  },
  step_ice: {
    cat: 'step', variants: 6, len: 0.35,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.35);
      addModal(b, sr, 0.001, r.range(1500, 2400), MODES.stone, { amp: 0.25, hardness: 6000, rng: r, t60Scale: 1.4 });
    },
  },

  // ---------------- 糖果世界 ----------------
  marshmallow: { // 棉花糖：软绵绵的压缩 + 轻微的"吱"
    cat: 'soft', variants: 6, len: 0.6,
    gen(r, sr, b) {
      softPress(b, sr, r, 0, r.range(0.28, 0.4), r.range(900, 1300), 0.9);
      addThump(b, sr, r, 0, 0.35, { f: r.range(60, 85), t60: 0.12, noiseLp: 300 });
      if (r.chance(0.7)) addSine(b, sr, r.range(0.08, 0.16), { f: r.range(1300, 1900), glideTo: r.range(1700, 2300), glideTime: 0.06, amp: 0.05, t60: 0.08, attack: 0.01 });
    },
  },
  jelly: { // 果冻：Q 弹的"啵嘤"
    cat: 'item', variants: 6, len: 0.9,
    gen(r, sr, b) {
      boing(b, sr, r, 0, r.range(240, 380), 0.6, { t60: r.range(0.45, 0.65) });
      wetSquish(b, sr, r, 0, 0.18, 0.25, { fLo: 300, fHi: 900, bubbles: 4 });
    },
  },
  candy_wrapper: { // 糖纸：细腻的塑料揉搓
    cat: 'item', variants: 6, len: 0.8,
    gen(r, sr, b) {
      crinkleBursts(b, sr, r, 0, r.range(0.35, 0.55), r.int(3, 5), 900, 2500, 11000, 0.7);
      addNoise(b, sr, r, 0, 0.5, { amp: 0.05, env: (t, u) => Math.sin(Math.PI * u), filters: [{ type: 'hp', f: 5000, q: 0.5 }] });
    },
  },
  chocolate: { // 巧克力板：清脆的"咔"
    cat: 'item', variants: 6, len: 0.4,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.9, { f: 3500, q: 0.7, dur: 0.003 });
      addModal(b, sr, 0.0005, r.range(1400, 2000), [
        { r: 1, a: 1, t60: 0.06 }, { r: 2.4, a: 0.6, t60: 0.04 }, { r: 3.7, a: 0.4, t60: 0.03 },
      ], { amp: 0.4, hardness: 8000, rng: r });
      if (r.chance(0.6)) addClick(b, sr, r, r.range(0.015, 0.03), 0.4, { f: 4200, q: 1 });
      crunchCloud(b, sr, r, 0.01, { dur: 0.08, rate: 250, fLo: 2500, fHi: 8000, amp: 0.2 });
      // 碎屑轻轻落下
      crunchCloud(b, sr, r, r.range(0.06, 0.09), { dur: 0.1, rate: 120, fLo: 3000, fHi: 9000, amp: 0.12, shape: (u) => Math.exp(-u * 2) });
    },
  },
  popping_candy: { // 跳跳糖：密集的噼里啪啦
    cat: 'item', variants: 5, len: 1.3,
    gen(r, sr, b) {
      scatter(r, 0, r.range(0.8, 1.1), (u) => 450 * Math.exp(-u * 2.5) + 30, (t, u) => {
        addPing(b, sr, t, r.logRange(3000, 12000), 0.5 * Math.pow(r.next(), 2) * (1 - u * 0.7), r.range(0.0015, 0.004), r.range(0, 6));
      });
      addNoise(b, sr, r, 0, 0.9, { amp: 0.04, env: (t, u) => Math.exp(-u * 3), filters: [{ type: 'hp', f: 6000, q: 0.5 }] });
    },
  },
  gummy: { // 小熊软糖：橡胶感的小"啾"
    cat: 'item', variants: 6, len: 0.5,
    gen(r, sr, b) {
      const f = r.range(600, 900);
      addSine(b, sr, 0, { f, glideTo: f * 1.35, glideTime: 0.12, amp: 0.25, t60: 0.2, attack: 0.012, vibRate: 30, vibDepth: 0.02, shape: 'softsaw' });
      softPress(b, sr, r, 0, 0.15, 1400, 0.35);
    },
  },
  cotton_candy: { // 棉花糖云：几乎听不见的蓬松"嘶"
    cat: 'soft', variants: 5, len: 0.6,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, r.range(0.3, 0.42), { amp: 0.6, env: (t, u) => Math.sin(Math.PI * Math.pow(u, 0.6)), filt: (u) => [{ type: 'bp', f: 2500 + 3000 * u, q: 0.6 }] });
      softPress(b, sr, r, 0, 0.2, 600, 0.4);
    },
  },

  // ---------------- 海底世界 ----------------
  bubble_pop: { // 泡泡：可爱的"啵"
    cat: 'pop', variants: 8, len: 0.3,
    gen(r, sr, b) {
      const f = r.range(500, 900);
      addSine(b, sr, 0, { f: f * 1.9, glideTo: f, glideTime: 0.025, amp: 0.7, t60: 0.06, attack: 0.0015 });
      addClick(b, sr, r, 0, 0.25, { f: 5000, q: 0.8, dur: 0.002 });
      bubbleCloud(b, sr, r, 0.01, 0.08, 3, 0.4, 1.0, 0.2);
    },
  },
  seashell: { // 贝壳：小而亮的"咔哒"两下
    cat: 'item', variants: 6, len: 0.35,
    gen(r, sr, b) {
      const f = r.range(2400, 3600);
      addModal(b, sr, 0, f, MODES.stone, { amp: 0.6, hardness: 12000, rng: r, t60Scale: 0.9 });
      addClick(b, sr, r, 0, 0.3, { f: 6000, q: 1 });
      const t2 = r.range(0.04, 0.08);
      addModal(b, sr, t2, f * r.range(0.9, 1.1), MODES.stone, { amp: 0.35, hardness: 12000, rng: r, t60Scale: 0.8 });
    },
  },
  pearl: { // 珍珠：玻璃般的"叮"
    cat: 'chime', variants: 6, len: 1.2,
    gen(r, sr, b) {
      addModal(b, sr, 0, r.range(3000, 4200), MODES.glass, { amp: 0.5, hardness: 15000, rng: r, t60Scale: 0.35, detune: 0.0015 });
      addClick(b, sr, r, 0, 0.15, { f: 7000, q: 1.5 });
    },
  },
  seaweed: { // 海草：水下的"唰"
    cat: 'soft', variants: 5, len: 0.8,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, r.range(0.45, 0.6), {
        amp: 0.7, color: 'pink',
        env: (t, u) => Math.sin(Math.PI * Math.pow(u, 0.7)),
        filt: (u) => [{ type: 'bp', f: 350 + 900 * Math.sin(Math.PI * u), q: 1.2 }],
      });
      bubbleCloud(b, sr, r, 0.1, 0.4, 5, 1, 3, 0.25);
    },
  },
  starfish: { // 海星：湿润的软"吧唧"
    cat: 'item', variants: 6, len: 0.5,
    gen(r, sr, b) {
      wetSquish(b, sr, r, 0, r.range(0.18, 0.26), 0.7, { fLo: 250, fHi: 1200, q: 4, bubbles: 10 });
      addThump(b, sr, r, 0, 0.3, { f: 110, t60: 0.06 });
    },
  },
  jellyfish: { // 水母：水下 Q 弹 + 气泡
    cat: 'item', variants: 6, len: 1.0,
    gen(r, sr, b) {
      boing(b, sr, r, 0, r.range(180, 260), 0.55, { t60: 0.7, vib: 0.05, drop: 1.3 });
      bubbleCloud(b, sr, r, 0.05, 0.5, 10, 1, 4, 0.3);
    },
  },
  sea_splash: {
    cat: 'item', variants: 6, len: 0.8,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 0.12, { amp: 0.6, env: (t) => envAD(t, 0.002, 0.03), filters: [{ type: 'lp', f: 3000, q: 0.7 }] });
      bubbleCloud(b, sr, r, 0.005, 0.35, r.int(14, 24), 0.7, 5, 0.55);
      addNoise(b, sr, r, 0.01, 0.25, { amp: 0.12, env: (t, u) => Math.exp(-u * 4), filters: [{ type: 'hp', f: 4500, q: 0.6 }] });
    },
  },

  // ---------------- 冰雪世界 ----------------
  snow_pile: { // 厚雪堆：扎实的"咯吱咯吱"
    cat: 'item', variants: 6, len: 0.7,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.5);
      crunchCloud(b, sr, r, 0, { dur: r.range(0.32, 0.45), rate: 1100, fLo: 700, fHi: 5000, qLo: 1, qHi: 4, amp: 0.7 });
      for (let i = 0; i < r.int(3, 7); i++) addSine(b, sr, r.range(0.03, 0.3), { f: r.range(600, 1300), amp: 0.08, t60: 0.04, attack: 0.002 });
    },
  },
  ice_crack: { // 冰面：清脆开裂 + 冰层特有的"啾～"色散音
    cat: 'item', variants: 6, len: 0.9,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.9, { f: 4000, q: 0.6, dur: 0.004 });
      addChirp(b, sr, 0.002, r.range(3500, 5000), r.range(500, 900), r.range(0.12, 0.2), 0.35, { tau: 0.06, curve: 3 });
      if (r.chance(0.7)) addChirp(b, sr, r.range(0.04, 0.12), r.range(3000, 4500), r.range(600, 1000), 0.12, 0.2, { tau: 0.04, curve: 3 });
      crunchCloud(b, sr, r, 0.003, { dur: 0.1, rate: 300, fLo: 2500, fHi: 9000, amp: 0.25 });
    },
  },
  icicle: { // 冰棱：清冷的风铃
    cat: 'chime', notes: pentaNotes(84, 8), len: 2.5,
    gen(r, sr, b, f) {
      addModal(b, sr, 0, f, MODES.bar, { amp: 0.5, hardness: 14000, rng: r, t60Scale: 2.0, detune: 0.0012 });
      addClick(b, sr, r, 0, 0.06, { f: 8000, q: 2 });
    },
  },
  ice_slide: { // 在冰上滑行：持续的"咻——"
    cat: 'soft', variants: 4, len: 1.0,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, r.range(0.6, 0.8), {
        amp: 0.5,
        env: (t, u) => smooth(u * 6) * (1 - smooth((u - 0.6) / 0.4)),
        filt: (u) => [{ type: 'bp', f: 3000 + 1500 * u, q: 1.4 }],
      });
      for (let i = 0; i < 3; i++) addSine(b, sr, r.range(0.05, 0.5), { f: r.range(1800, 2600), amp: 0.03, t60: 0.15, attack: 0.02 });
    },
  },
  snowman: { // 雪人：软乎乎的"噗"
    cat: 'soft', variants: 5, len: 0.6,
    gen(r, sr, b) {
      softPress(b, sr, r, 0, 0.3, 700, 0.8);
      crunchCloud(b, sr, r, 0.02, { dur: 0.2, rate: 300, fLo: 800, fHi: 3000, amp: 0.25 });
    },
  },
  frost_flower: { // 冰晶花：亮晶晶的一串
    cat: 'chime', variants: 6, len: 1.6,
    gen(r, sr, b) {
      const base = midiToHz(r.pick([88, 91, 93, 96]));
      for (let i = 0; i < 3; i++) addModal(b, sr, i * r.range(0.05, 0.08), base * [1, 1.25, 1.5][i], MODES.bar, { amp: 0.35 - i * 0.07, hardness: 16000, rng: r, t60Scale: 1.2, detune: 0.002 });
    },
  },

  // ---------------- 蘑菇森林 ----------------
  mushroom: { // 蘑菇：橡胶般的弹跳 + 一小团孢子"噗"
    cat: 'item', variants: 6, len: 0.9,
    gen(r, sr, b) {
      boing(b, sr, r, 0, r.range(150, 230), 0.6, { t60: 0.5, vib: 0.05, drop: 1.45, harm: 0.15 });
      addNoise(b, sr, r, 0.03, 0.2, { amp: 0.2, env: (t, u) => Math.sin(Math.PI * u), filters: [{ type: 'bp', f: 1500, q: 0.7 }] });
    },
  },
  leaf_pile: { // 落叶堆：干燥的沙沙脆响
    cat: 'item', variants: 7, len: 0.9,
    gen(r, sr, b) {
      pawContact(b, sr, r, 0, 0.35);
      const d = r.range(0.4, 0.6);
      crunchCloud(b, sr, r, 0, { dur: d, rate: 1200, fLo: 1800, fHi: 10000, qLo: 1.5, qHi: 6, amp: 0.6, shape: (u) => Math.pow(Math.sin(Math.PI * u), 0.6) * (0.6 + 0.4 * Math.sin(u * 23)) });
      addNoise(b, sr, r, 0, d, { amp: 0.12, env: (t, u) => Math.sin(Math.PI * u), filters: [{ type: 'hp', f: 3000, q: 0.5 }] });
    },
  },
  twig: { // 小树枝："咔嚓"
    cat: 'item', variants: 6, len: 0.4,
    gen(r, sr, b) {
      const n = r.int(2, 3);
      for (let i = 0; i < n; i++) {
        const t = i === 0 ? 0 : r.range(0.008, 0.035) * i;
        addClick(b, sr, r, t, 0.9 / (i + 1), { f: r.range(2000, 3500), q: 0.8 });
        addModal(b, sr, t, r.range(800, 1300), MODES.wood, { amp: 0.4 / (i + 1), hardness: 6000, rng: r, t60Scale: 0.5 });
      }
      crunchCloud(b, sr, r, 0.01, { dur: 0.06, rate: 300, fLo: 2000, fHi: 7000, amp: 0.25 });
      // 断开的枝条再轻轻落地
      addModal(b, sr, r.range(0.09, 0.13), r.range(600, 900), MODES.wood, { amp: 0.12, hardness: 4000, rng: r, t60Scale: 0.6 });
    },
  },
  puddle: { // 水洼："啪嗒"溅水
    cat: 'item', variants: 7, len: 0.8,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 0.1, { amp: 0.6, env: (t) => envAD(t, 0.002, 0.025), filters: [{ type: 'lp', f: 3500, q: 0.7 }] });
      bubbleCloud(b, sr, r, 0.003, 0.3, r.int(10, 18), 0.8, 4.5, 0.6);
      addNoise(b, sr, r, 0.01, 0.2, { amp: 0.12, env: (t, u) => Math.exp(-u * 4), filters: [{ type: 'hp', f: 4000, q: 0.6 }] });
    },
  },
  acorn: { // 橡果："嗒"的空心小木声
    cat: 'item', variants: 6, len: 0.4,
    gen(r, sr, b) {
      addModal(b, sr, 0, r.range(900, 1400), MODES.wood, { amp: 0.7, hardness: 6000, rng: r, t60Scale: 1.2 });
      addClick(b, sr, r, 0, 0.25, { f: 3000, q: 1 });
      if (r.chance(0.5)) addModal(b, sr, r.range(0.07, 0.12), r.range(900, 1400), MODES.wood, { amp: 0.25, hardness: 5000, rng: r });
    },
  },
  log: { // 空心木桩：温暖的"咚"
    cat: 'item', variants: 6, len: 0.6,
    gen(r, sr, b) {
      addModal(b, sr, 0, r.range(140, 220), MODES.wood, { amp: 0.8, hardness: 1800, rng: r, t60Scale: 1.8 });
      addSine(b, sr, 0, { f: r.range(85, 110), amp: 0.3, t60: 0.2, attack: 0.002 });
      addClick(b, sr, r, 0, 0.15, { f: 1500, q: 0.8 });
    },
  },
  lily_pad: { // 荷叶：水面上轻轻一压
    cat: 'item', variants: 6, len: 0.7,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 0.25, { amp: 0.35, color: 'pink', env: (t, u) => Math.sin(Math.PI * u), filt: (u) => [{ type: 'lp', f: 900 - 400 * u, q: 1.2 }] });
      bubbleCloud(b, sr, r, 0.05, 0.3, 5, 1.5, 5, 0.35, 0.2);
      addBubble(b, sr, 0.02, r.range(3, 5), 0.3, { xi: 0.4, decayScale: 2 });
    },
  },
  flower_bell: { // 风铃草：叮铃
    cat: 'chime', notes: pentaNotes(79, 8), len: 2.2,
    gen(r, sr, b, f) {
      addModal(b, sr, 0, f, MODES.glass, { amp: 0.45, hardness: 9000, rng: r, t60Scale: 0.65, detune: 0.0018 });
    },
  },

  // ---------------- 甜品烘焙屋 ----------------
  macaron: { // 马卡龙：先是酥脆的外壳，再是软心
    cat: 'item', variants: 6, len: 0.6,
    gen(r, sr, b) {
      crunchCloud(b, sr, r, 0, { dur: 0.08, rate: 900, fLo: 2500, fHi: 9000, amp: 0.7, shape: (u) => Math.exp(-u * 3) });
      addClick(b, sr, r, 0, 0.4, { f: 4500, q: 0.8 });
      softPress(b, sr, r, 0.04, 0.22, 1100, 0.5);
    },
  },
  biscuit: { // 饼干：酥脆的"咔嚓咔嚓"
    cat: 'item', variants: 7, len: 0.6,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.8, { f: 2500, q: 0.6 });
      crunchCloud(b, sr, r, 0, { dur: r.range(0.2, 0.32), rate: 1400, fLo: 900, fHi: 7000, qLo: 0.8, qHi: 3, amp: 0.8, shape: (u) => Math.exp(-u * 2.2) * smooth(u * 15) });
    },
  },
  cream_puff: { // 奶油泡芙：绵密的"噗叽"
    cat: 'item', variants: 6, len: 0.6,
    gen(r, sr, b) {
      wetSquish(b, sr, r, 0, r.range(0.25, 0.35), 0.55, { fLo: 600, fHi: 2500, q: 2.5, bubbles: 18, rLo: 0.2, rHi: 0.7 });
      softPress(b, sr, r, 0, 0.2, 800, 0.3);
    },
  },
  pudding: { // 布丁：低沉的 Q 弹晃动
    cat: 'item', variants: 6, len: 0.9,
    gen(r, sr, b) {
      const f = r.range(110, 160);
      addSine(b, sr, 0, { f: f * 1.3, glideTo: f, glideTime: 0.08, amp: 0.6, t60: 0.6, attack: 0.006, vibRate: r.range(6, 8), vibDepth: 0.1, vibDecay: 0.4,
        amEnv: (t) => 0.6 + 0.4 * Math.cos(TAU * 7 * t) });
      wetSquish(b, sr, r, 0, 0.2, 0.3, { fLo: 200, fHi: 700, q: 3, bubbles: 5 });
    },
  },
  sugar_cube: { // 方糖：细碎的晶体碎裂
    cat: 'item', variants: 6, len: 0.5,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.6, { f: 5000, q: 0.8 });
      crunchCloud(b, sr, r, 0, { dur: 0.18, rate: 1500, fLo: 3000, fHi: 12000, qLo: 2, qHi: 6, amp: 0.55, shape: (u) => Math.exp(-u * 3) });
      for (let i = 0; i < 4; i++) addPing(b, sr, r.range(0.005, 0.1), r.range(4000, 8000), 0.12, 0.03);
    },
  },
  honey: { // 蜂蜜：黏黏的拉丝"啵"
    cat: 'item', variants: 6, len: 0.8,
    gen(r, sr, b) {
      const d = r.range(0.3, 0.42);
      // 黏连被拉开时越来越密的"嗞嗞"
      scatter(r, 0.05, d, (u) => 30 + 500 * u * u, (t, u) => {
        addNoiseGrain(b, sr, r, t, 0.35 * Math.pow(r.next(), 1.5) * (0.4 + u), { f: r.range(1200, 4000), q: r.range(1.5, 4), dur: 0.0015 });
      });
      wetSquish(b, sr, r, 0, 0.2, 0.35, { fLo: 250, fHi: 700, q: 4, bubbles: 3 });
      addBubble(b, sr, 0.05 + d, r.range(4, 7), 0.45, { xi: 0.25, decayScale: 1.5 }); // 最后"啵"一下脱离
    },
  },
  donut: { // 甜甜圈：软软弹弹
    cat: 'soft', variants: 6, len: 0.6,
    gen(r, sr, b) {
      softPress(b, sr, r, 0, 0.25, 1000, 0.7);
      addSine(b, sr, 0.01, { f: r.range(200, 260), glideTo: r.range(150, 180), glideTime: 0.1, amp: 0.25, t60: 0.25, attack: 0.008 });
    },
  },
  sprinkles: { // 彩色糖针：沙沙的细碎
    cat: 'item', variants: 6, len: 0.6,
    gen(r, sr, b) {
      scatter(r, 0, r.range(0.3, 0.4), (u) => 600 * Math.sin(Math.PI * u) + 50, (t) => {
        addPing(b, sr, t, r.logRange(2500, 9000), 0.35 * Math.pow(r.next(), 2), r.range(0.004, 0.012), r.range(0, 6));
      });
    },
  },

  // ---------------- 云朵天空 ----------------
  cloud_puff: { // 云朵：软乎乎陷下去
    cat: 'soft', variants: 6, len: 0.8,
    gen(r, sr, b) {
      softPress(b, sr, r, 0, r.range(0.35, 0.5), 650, 0.9);
      addNoise(b, sr, r, 0.05, 0.3, { amp: 0.15, env: (t, u) => Math.sin(Math.PI * u), filters: [{ type: 'hp', f: 5000, q: 0.5 }] });
    },
  },
  star_tile: { // 星星砖：闪闪发光的八音盒音
    cat: 'chime', notes: pentaNotes(84, 10), len: 2.2,
    gen(r, sr, b, f) {
      addModal(b, sr, 0, f, MODES.musicbox, { amp: 0.6, hardness: 12000, rng: r, t60Scale: 1 });
      addNoise(b, sr, r, 0, 0.4, { amp: 0.03, env: (t, u) => Math.exp(-u * 5), filters: [{ type: 'hp', f: 9000, q: 0.5 }] });
    },
  },
  rainbow: { // 彩虹桥：马林巴，一步一个音
    cat: 'chime', notes: pentaNotes(72, 10), len: 1.6,
    gen(r, sr, b, f) {
      addModal(b, sr, 0, f, MODES.marimba, { amp: 0.7, hardness: 6000, rng: r });
      addThump(b, sr, r, 0, 0.12, { f: f * 0.5, t60: 0.03, noiseLp: 1500 });
    },
  },
  wind_chime: { // 风铃：三四根管子先后响起
    cat: 'chime', variants: 6, len: 3.0,
    gen(r, sr, b) {
      const pool = [86, 88, 91, 93, 96, 98];
      const n = r.int(3, 4);
      for (let i = 0; i < n; i++) addModal(b, sr, i * r.range(0.08, 0.22), midiToHz(r.pick(pool)), MODES.glass, { amp: 0.4 * r.range(0.6, 1), hardness: 12000, rng: r, t60Scale: 0.9, detune: 0.0015 });
    },
  },
  feather: { // 羽毛：空气般轻的"嘶"
    cat: 'soft', variants: 5, len: 0.7,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, r.range(0.35, 0.5), { amp: 0.5, env: (t, u) => Math.pow(Math.sin(Math.PI * u), 1.5), filt: (u) => [{ type: 'bp', f: 4000 + 3000 * Math.sin(Math.PI * u), q: 0.8 }] });
    },
  },
  sky_bounce: { // 弹力云：软"啵嘤"
    cat: 'item', variants: 6, len: 0.9,
    gen(r, sr, b) {
      boing(b, sr, r, 0, r.range(300, 420), 0.5, { t60: 0.5, vib: 0.06, harm: 0.1, drop: 1.4 });
      softPress(b, sr, r, 0, 0.25, 800, 0.4);
    },
  },

  // ---------------- 玩具房 ----------------
  bubble_wrap: { // 气泡膜：一个一个"啪"
    cat: 'pop', variants: 8, len: 0.25,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 1, { f: r.range(2200, 3200), q: 1.2, dur: 0.003, tau: 0.0008 });
      addModal(b, sr, 0.0003, r.range(1800, 2800), [{ r: 1, a: 1, t60: 0.03 }, { r: 1.7, a: 0.5, t60: 0.02 }], { amp: 0.4, hardness: 9000, rng: r });
      addNoise(b, sr, r, 0.001, 0.04, { amp: 0.25, env: (t, u) => Math.exp(-u * 6), filters: [{ type: 'hp', f: 3500, q: 0.6 }] });
    },
  },
  keycap: { // 机械键盘轴："咔哒"两段
    cat: 'item', variants: 7, len: 0.3,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.5, { f: 3500, q: 1.2 });
      addModal(b, sr, 0.0005, r.range(600, 900), MODES.stone, { amp: 0.35, hardness: 5000, rng: r });
      const t2 = r.range(0.012, 0.02); // 触底
      addClick(b, sr, r, t2, 0.7, { f: 2200, q: 0.9 });
      addModal(b, sr, t2, r.range(350, 500), MODES.wood, { amp: 0.4, hardness: 3000, rng: r, t60Scale: 0.6 });
      addSine(b, sr, t2 + 0.002, { f: r.range(5500, 7000), amp: 0.02, t60: 0.05 }); // 弹簧轻鸣
    },
  },
  wood_block: { // 积木："嗒、嗒"
    cat: 'item', variants: 6, len: 0.4,
    gen(r, sr, b) {
      const f = r.range(650, 1050);
      addModal(b, sr, 0, f, MODES.wood, { amp: 0.8, hardness: 7000, rng: r, t60Scale: 1.1 });
      addClick(b, sr, r, 0, 0.3, { f: 3500, q: 1 });
      if (r.chance(0.6)) addModal(b, sr, r.range(0.06, 0.1), f * r.range(1.1, 1.3), MODES.wood, { amp: 0.35, hardness: 7000, rng: r });
    },
  },
  plush: { // 毛绒玩具：带"吱"的捏捏
    cat: 'item', variants: 6, len: 0.6,
    gen(r, sr, b) {
      const f = r.range(800, 1100);
      const d = r.range(0.18, 0.28);
      // 吱吱声：带共振峰的柔和锯齿
      const tmp = alloc(sr, d + 0.05);
      addSine(tmp, sr, 0, { f, glideTo: f * 1.45, glideTime: d * 0.7, amp: 0.5, t60: d * 3, attack: 0.02, vibRate: 22, vibDepth: 0.015, shape: 'softsaw',
        amEnv: (t) => 1 - smooth((t - d * 0.7) / (d * 0.3)) });
      filterAll(tmp, new Biquad(sr, 'peak', 1600, 2, 6), new Biquad(sr, 'lp', 4000, 0.7));
      for (let i = 0; i < tmp.length && i < b.length; i++) b[i] += tmp[i];
      addNoise(b, sr, r, 0, d, { amp: 0.08, env: (t, u) => Math.sin(Math.PI * u), filters: [{ type: 'bp', f: 3000, q: 1 }] });
      pawContact(b, sr, r, 0, 0.4, 0.7);
    },
  },
  slime: { // 史莱姆：经典 ASMR 黏液"咕叽"
    cat: 'item', variants: 7, len: 0.9,
    gen(r, sr, b) {
      wetSquish(b, sr, r, 0, r.range(0.35, 0.5), 0.75, { fLo: 250, fHi: 1800, q: 5.5, bubbles: r.int(16, 26), rLo: 0.25, rHi: 1.4 });
      addThump(b, sr, r, 0, 0.25, { f: 90, t60: 0.1, noiseLp: 400 });
    },
  },
  piano_key: { // 玩具钢琴：清脆的八音盒/钢片琴
    cat: 'chime', notes: pentaNotes(72, 10), len: 2.0,
    gen(r, sr, b, f) {
      addModal(b, sr, 0, f, MODES.kalimba, { amp: 0.7, hardness: 7000, rng: r });
      addThump(b, sr, r, 0, 0.1, { f: 160, t60: 0.03, noiseLp: 1200 });
    },
  },
  kinetic_sand: { // 太空沙：被切开的"沙——"
    cat: 'item', variants: 6, len: 0.7,
    gen(r, sr, b) {
      crunchCloud(b, sr, r, 0, { dur: r.range(0.3, 0.42), rate: 2500, fLo: 900, fHi: 5000, qLo: 0.7, qHi: 2, amp: 0.32, gDur: [0.001, 0.004], shape: (u) => smooth(u * 4) * (1 - smooth((u - 0.7) / 0.3)) });
      addThump(b, sr, r, 0.25, 0.25, { f: 80, t60: 0.1, noiseLp: 500 });
    },
  },
  soap: { // 肥皂块：脆生生的"嚓"
    cat: 'item', variants: 6, len: 0.6,
    gen(r, sr, b) {
      const d = r.range(0.18, 0.26);
      crunchCloud(b, sr, r, 0, { dur: d, rate: 3000, fLo: 2500, fHi: 9000, qLo: 1.5, qHi: 4, amp: 0.5, shape: (u) => smooth(u * 6) * (1 - u * 0.6) });
      crunchCloud(b, sr, r, d * 0.9, { dur: 0.1, rate: 300, fLo: 1500, fHi: 5000, amp: 0.4, shape: (u) => Math.exp(-u * 4) });
    },
  },

  // ---------------- 水晶洞 ----------------
  crystal: { // 水晶簇：空灵的长余音
    cat: 'chime', notes: pentaNotes(81, 10), len: 3.2,
    gen(r, sr, b, f) {
      addModal(b, sr, 0, f, MODES.glass, { amp: 0.5, hardness: 16000, rng: r, t60Scale: 1.1, detune: 0.0025 });
      addClick(b, sr, r, 0, 0.05, { f: 9000, q: 2 });
    },
  },
  cave_drip: { // 洞穴水滴："叮咚"，再跟一颗更小的回弹水珠
    cat: 'item', variants: 7, len: 0.6,
    gen(r, sr, b) {
      addBubble(b, sr, 0, r.range(1.8, 3.2), 0.9, { xi: r.range(0.35, 0.6), decayScale: r.range(2.8, 3.6) });
      addClick(b, sr, r, 0, 0.1, { f: 3000, q: 1 });
      addBubble(b, sr, r.range(0.07, 0.12), r.range(1.0, 1.6), 0.35, { xi: 0.5, decayScale: 3 });
    },
  },
  gem: { // 宝石："叮"的清脆碰撞
    cat: 'chime', variants: 6, len: 1.2,
    gen(r, sr, b) {
      const f = r.range(2600, 3800);
      addModal(b, sr, 0, f, MODES.metal, { amp: 0.5, hardness: 14000, rng: r, t60Scale: 0.9, detune: 0.002 });
      addModal(b, sr, r.range(0.05, 0.09), f * r.range(1.08, 1.2), MODES.metal, { amp: 0.25, hardness: 14000, rng: r, t60Scale: 0.6 });
    },
  },
  rock_sugar: { // 冰糖晶体地面：晶莹的"咔嚓"
    cat: 'item', variants: 6, len: 0.7,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.6, { f: 4500, q: 0.8 });
      crunchCloud(b, sr, r, 0, { dur: 0.15, rate: 900, fLo: 2000, fHi: 9000, qLo: 2, qHi: 6, amp: 0.5, shape: (u) => Math.exp(-u * 3) });
      for (let i = 0; i < 3; i++) addModal(b, sr, r.range(0, 0.06), r.range(3000, 5000), MODES.bar, { amp: 0.1, hardness: 16000, rng: r, t60Scale: 0.3 });
    },
  },
  glow_mushroom: { // 荧光蘑菇：带空灵泛音的软弹
    cat: 'item', variants: 6, len: 1.2,
    gen(r, sr, b) {
      boing(b, sr, r, 0, r.range(200, 280), 0.45, { t60: 0.5, vib: 0.04, drop: 1.3 });
      addModal(b, sr, 0.02, midiToHz(r.pick([84, 86, 88, 91])), MODES.musicbox, { amp: 0.2, hardness: 12000, rng: r, t60Scale: 0.8 });
    },
  },
  stalagmite: { // 石笋："笃"
    cat: 'item', variants: 6, len: 0.4,
    gen(r, sr, b) {
      addModal(b, sr, 0, r.range(500, 800), MODES.stone, { amp: 0.8, hardness: 4000, rng: r, t60Scale: 1.6 });
      addClick(b, sr, r, 0, 0.2, { f: 2500, q: 1 });
    },
  },

  // ---------------- 闯关元素 ----------------
  star_collect: { // 收集星星：上行的三音闪光
    cat: 'fx', variants: 4, len: 2.0,
    gen(r, sr, b) {
      const seq = r.pick([[84, 88, 91, 96], [86, 91, 93, 98], [84, 86, 91, 96]]);
      seq.forEach((m, i) => addModal(b, sr, i * 0.07, midiToHz(m), MODES.musicbox, { amp: 0.45, hardness: 14000, rng: r }));
      addNoise(b, sr, r, 0, 0.8, { amp: 0.05, env: (t, u) => Math.sin(Math.PI * u) * Math.exp(-u * 2), filters: [{ type: 'hp', f: 8000, q: 0.5 }] });
    },
  },
  key_get: {
    cat: 'fx', variants: 3, len: 1.8,
    gen(r, sr, b) {
      [79, 84, 88, 91].forEach((m, i) => addModal(b, sr, i * 0.09, midiToHz(m), MODES.metal, { amp: 0.3, hardness: 10000, rng: r, t60Scale: 1.2 }));
    },
  },
  gate_open: {
    cat: 'fx', variants: 2, len: 2.0,
    gen(r, sr, b) {
      addModal(b, sr, 0, 160, MODES.wood, { amp: 0.6, hardness: 2000, rng: r, t60Scale: 2 });
      [72, 76, 79, 84, 88].forEach((m, i) => addModal(b, sr, 0.15 + i * 0.08, midiToHz(m), MODES.marimba, { amp: 0.35, hardness: 7000, rng: r }));
    },
  },
  switch_press: {
    cat: 'fx', variants: 3, len: 0.6,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.6, { f: 2000, q: 1 });
      addModal(b, sr, 0, 420, MODES.wood, { amp: 0.5, hardness: 4000, rng: r });
      addSine(b, sr, 0.05, { f: 660, glideTo: 990, glideTime: 0.1, amp: 0.2, t60: 0.3, attack: 0.005 });
    },
  },
  bridge_rise: {
    cat: 'fx', variants: 2, len: 1.6,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 0.9, { amp: 0.3, color: 'pink', env: (t, u) => Math.sin(Math.PI * u), filt: (u) => [{ type: 'bp', f: 300 + 900 * u, q: 1.5 }] });
      [72, 74, 76, 79, 81].forEach((m, i) => addModal(b, sr, 0.1 + i * 0.13, midiToHz(m), MODES.kalimba, { amp: 0.3, hardness: 6000, rng: r }));
    },
  },
  spring_pad: { // 弹簧垫："嘣～"
    cat: 'item', variants: 5, len: 0.9,
    gen(r, sr, b) {
      const f = r.range(260, 340);
      addSine(b, sr, 0, { f: f * 0.8, glideTo: f * 1.6, glideTime: 0.12, amp: 0.45, t60: 0.6, attack: 0.002, vibRate: 28, vibDepth: 0.04, vibDecay: 0.3 });
      addChirp(b, sr, 0, 3200, 900, 0.25, 0.08, { tau: 0.08 });
      addThump(b, sr, r, 0, 0.4, { f: 90, t60: 0.08 });
    },
  },
  jump: { // 起跳的小风声
    cat: 'step', variants: 5, len: 0.4,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 0.25, { amp: 0.5, env: (t, u) => Math.sin(Math.PI * u), filt: (u) => [{ type: 'bp', f: 800 + 2200 * u, q: 0.9 }] });
    },
  },
  land: {
    cat: 'step', variants: 5, len: 0.3,
    gen(r, sr, b) {
      addThump(b, sr, r, 0, 0.8, { f: r.range(65, 85), t60: 0.12, noiseLp: 600 });
    },
  },
  level_clear: { // 过关：温柔的上行琶音
    cat: 'music', variants: 2, len: 3.5,
    gen(r, sr, b) {
      const seq = [72, 76, 79, 84, 88, 91, 96];
      seq.forEach((m, i) => addModal(b, sr, i * 0.11, midiToHz(m), MODES.kalimba, { amp: 0.4, hardness: 8000, rng: r, t60Scale: 1.3 }));
      [60, 67, 72].forEach((m) => addModal(b, sr, 0.8, midiToHz(m), MODES.marimba, { amp: 0.25, hardness: 3000, rng: r, t60Scale: 2 }));
    },
  },
  portal: {
    cat: 'fx', variants: 2, len: 2.4,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 1.6, { amp: 0.25, env: (t, u) => Math.sin(Math.PI * u), filt: (u) => [{ type: 'bp', f: 500 + 3000 * u * u, q: 2 }] });
      for (let i = 0; i < 8; i++) addModal(b, sr, 0.2 + i * 0.14, midiToHz(84 + PENTA[i % 5] + 12 * Math.floor(i / 5)), MODES.musicbox, { amp: 0.2, hardness: 12000, rng: r });
    },
  },

  // ---------------- 礼物/互动 ----------------
  gift_sparkle: { // 收到礼物：闪亮的"叮铃铃"
    cat: 'fx', variants: 4, len: 2.0,
    gen(r, sr, b) {
      for (let i = 0; i < 6; i++) addModal(b, sr, i * 0.05, midiToHz(r.pick([91, 93, 96, 98, 100, 103])), MODES.musicbox, { amp: 0.3 * (1 - i * 0.08), hardness: 14000, rng: r });
      addNoise(b, sr, r, 0, 1.2, { amp: 0.06, env: (t, u) => Math.sin(Math.PI * Math.pow(u, 0.3)) * Math.exp(-u * 2), filters: [{ type: 'hp', f: 7000, q: 0.5 }] });
    },
  },
  heart_pop: {
    cat: 'pop', variants: 5, len: 0.3,
    gen(r, sr, b) {
      const f = r.range(900, 1300);
      addSine(b, sr, 0, { f, glideTo: f * 1.5, glideTime: 0.04, amp: 0.5, t60: 0.12, attack: 0.002 });
    },
  },

  // ---------------- 舞蹈伴奏乐器（音序器使用） ----------------
  m_kalimba: {
    cat: 'music', notes: pentaNotes(60, 12), len: 1.8,
    gen(r, sr, b, f) {
      addModal(b, sr, 0, f, MODES.kalimba, { amp: 0.7, hardness: 6000, rng: r });
      addThump(b, sr, r, 0, 0.08, { f: 200, t60: 0.02, noiseLp: 1500 });
    },
  },
  m_bass: {
    cat: 'music', notes: pentaNotes(36, 7), len: 1.0,
    gen(r, sr, b, f) {
      addSine(b, sr, 0, { f, amp: 0.8, t60: 0.7, attack: 0.004 });
      addSine(b, sr, 0, { f: f * 2, amp: 0.25, t60: 0.3, attack: 0.004 });
    },
  },
  m_kick: {
    cat: 'music', variants: 2, len: 0.4,
    gen(r, sr, b) {
      addSine(b, sr, 0, { f: 140, glideTo: 52, glideTime: 0.06, amp: 0.9, t60: 0.25, attack: 0.001 });
    },
  },
  m_shaker: {
    cat: 'music', variants: 4, len: 0.15,
    gen(r, sr, b) {
      addNoise(b, sr, r, 0, 0.07, { amp: 0.6, env: (t, u) => Math.sin(Math.PI * Math.pow(u, 0.4)) * Math.exp(-u * 2), filters: [{ type: 'bp', f: 7000, q: 0.9 }] });
    },
  },
  m_clap: {
    cat: 'music', variants: 3, len: 0.3,
    gen(r, sr, b) {
      for (let i = 0; i < 3; i++) addNoise(b, sr, r, i * 0.008, 0.03, { amp: 0.5, env: (t) => Math.exp(-t / 0.006), filters: [{ type: 'bp', f: 1400, q: 1.2 }] });
      addNoise(b, sr, r, 0.024, 0.12, { amp: 0.4, env: (t) => Math.exp(-t / 0.03), filters: [{ type: 'bp', f: 1300, q: 1 }] });
    },
  },
  m_tap: { // 踢踏舞小脚步
    cat: 'music', variants: 4, len: 0.2,
    gen(r, sr, b) {
      addClick(b, sr, r, 0, 0.7, { f: 2500, q: 1.2 });
      addModal(b, sr, 0, r.range(900, 1200), MODES.wood, { amp: 0.4, hardness: 7000, rng: r });
    },
  },

  // ---------------- 小宠物的声音（简单的共振峰合成，萌萌的"啾") ----------------
  v_happy: {
    cat: 'voice', variants: 5, len: 0.6,
    gen(r, sr, b) { creatureVoice(b, sr, r, [[0, r.range(700, 850)], [0.12, r.range(1050, 1250)], [0.22, r.range(950, 1100)]], 0.3, 'u'); },
  },
  v_surprise: {
    cat: 'voice', variants: 4, len: 0.4,
    gen(r, sr, b) { creatureVoice(b, sr, r, [[0, r.range(900, 1000)], [0.08, r.range(1400, 1600)]], 0.14, 'i'); },
  },
  v_yay: {
    cat: 'voice', variants: 4, len: 0.8,
    gen(r, sr, b) {
      creatureVoice(b, sr, r, [[0, 800], [0.1, 1000]], 0.16, 'a');
      creatureVoice(b, sr, r, [[0, 1000], [0.12, 1350], [0.25, 1250]], 0.3, 'i', 0.2);
    },
  },
  v_curious: {
    cat: 'voice', variants: 4, len: 0.5,
    gen(r, sr, b) { creatureVoice(b, sr, r, [[0, r.range(650, 750)], [0.2, r.range(950, 1100)]], 0.26, 'u'); },
  },
  v_sleepy: {
    cat: 'voice', variants: 3, len: 1.2,
    gen(r, sr, b) { creatureVoice(b, sr, r, [[0, 700], [0.3, 820], [0.8, 520]], 0.9, 'a', 0, 0.5); },
  },
  v_thanks: { // 三个音节的"谢-谢-你"语调
    cat: 'voice', variants: 4, len: 1.2,
    gen(r, sr, b) {
      const base = r.range(800, 900);
      creatureVoice(b, sr, r, [[0, base * 1.2], [0.12, base * 0.95]], 0.15, 'i', 0);
      creatureVoice(b, sr, r, [[0, base * 1.1], [0.12, base * 0.9]], 0.15, 'i', 0.2);
      creatureVoice(b, sr, r, [[0, base], [0.12, base * 1.35], [0.3, base * 1.25]], 0.34, 'u', 0.42);
    },
  },
};

// 萌系小动物"嗓音"：带颤音的柔和锯齿 → 两个共振峰（元音） → 低通
const VOWELS = { a: [800, 1250], i: [350, 2300], u: [380, 950], o: [500, 900] };
function creatureVoice(buf, sr, r, contour, dur, vowel, t0 = 0, breath = 0.15) {
  const tmp = alloc(sr, dur + 0.05);
  const n = Math.ceil(dur * sr);
  let ph = 0;
  const vib = r.range(6, 9);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // 分段对数插值的音高轮廓
    let f = contour[contour.length - 1][1];
    for (let k = 0; k < contour.length - 1; k++) {
      const [ta, fa] = contour[k];
      const [tb, fb] = contour[k + 1];
      if (t >= ta && t < tb) {
        const u = smooth((t - ta) / (tb - ta));
        f = fa * Math.pow(fb / fa, u);
        break;
      }
    }
    f *= 1 + 0.025 * Math.sin(TAU * vib * t) * smooth(t / 0.08);
    ph += (TAU * f) / sr;
    const env = smooth(t / 0.025) * (1 - smooth((t - (dur - 0.06)) / 0.06));
    const s = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph) + 0.12 * Math.sin(4 * ph);
    tmp[i] = env * (s * 0.5 + breath * (r.next() * 2 - 1) * 0.3);
  }
  const [f1, f2] = VOWELS[vowel] || VOWELS.u;
  const out = alloc(sr, dur + 0.05);
  const p1 = new Biquad(sr, 'bp', f1 * 1.6, 2.5);
  const p2 = new Biquad(sr, 'bp', f2 * 1.4, 3);
  const lp = new Biquad(sr, 'lp', 5000, 0.7);
  for (let i = 0; i < tmp.length; i++) {
    const x = tmp[i];
    out[i] = lp.process(x * 0.35 + p1.process(x) * 1.2 + p2.process(x) * 0.8);
  }
  const i0 = Math.floor(t0 * sr);
  for (let i = 0; i < out.length && i0 + i < buf.length; i++) buf[i0 + i] += out[i];
}

// ========== 环境声 ==========
// 底噪床（循环），每个场景一个；以及零星的环境事件
export const AMBIENCE = {
  breeze: { // 温柔的微风
    gen(r, sr, L, R) {
      for (const [ch, seedOff] of [[L, 1], [R, 2]]) {
        const rr = new Rng(r.int(1, 1e9) + seedOff);
        const ph = rr.range(0, TAU);
        addNoise(ch, sr, rr, 0, ch.length / sr, {
          amp: 0.5, color: 'pink',
          env: (t) => 0.55 + 0.25 * Math.sin(TAU * 0.07 * t + ph) + 0.2 * Math.sin(TAU * 0.023 * t + ph * 2),
          filt: (u) => [{ type: 'bp', f: 500 + 250 * Math.sin(TAU * u * 3 + ph), q: 0.5 }, { type: 'lp', f: 2500, q: 0.7 }],
          update: 64,
        });
      }
    },
  },
  underwater: {
    gen(r, sr, L, R) {
      for (const ch of [L, R]) {
        const rr = new Rng(r.int(1, 1e9));
        addNoise(ch, sr, rr, 0, ch.length / sr, {
          amp: 0.9, color: 'brown',
          env: (t) => 0.7 + 0.3 * Math.sin(TAU * 0.11 * t + rr.range(0, 1)),
          filters: [{ type: 'lp', f: 420, q: 0.9 }, { type: 'hp', f: 40, q: 0.7 }],
          update: 64,
        });
        // 远处偶尔的气泡串
        for (let k = 0; k < (ch.length / sr) * 1.2; k++) bubbleCloud(ch, sr, rr, rr.range(0, ch.length / sr - 0.5), 0.4, rr.int(2, 6), 1, 4, 0.05);
      }
    },
  },
  winter: { // 冬日的风
    gen(r, sr, L, R) {
      for (const ch of [L, R]) {
        const rr = new Rng(r.int(1, 1e9));
        const ph = rr.range(0, TAU);
        addNoise(ch, sr, rr, 0, ch.length / sr, {
          amp: 0.45, color: 'pink',
          env: (t) => 0.4 + 0.35 * Math.pow(0.5 + 0.5 * Math.sin(TAU * 0.05 * t + ph), 2),
          filt: (u) => [{ type: 'bp', f: 900 + 600 * Math.sin(TAU * u * 2 + ph), q: 1.8 }],
          update: 64,
        });
      }
    },
  },
  forest: { // 林间：溪流+树叶
    gen(r, sr, L, R) {
      for (const ch of [L, R]) {
        const rr = new Rng(r.int(1, 1e9));
        addNoise(ch, sr, rr, 0, ch.length / sr, {
          amp: 0.25, color: 'pink',
          env: (t) => 0.8 + 0.2 * Math.sin(TAU * 0.3 * t),
          filters: [{ type: 'bp', f: 1800, q: 0.5 }],
          update: 64,
        });
        // 远处溪水：密集小气泡
        const secs = ch.length / sr;
        scatter(rr, 0, secs, () => 45, (t) => addBubble(ch, sr, t, rr.logRange(1, 4), 0.03, { xi: 0.15 }), 100000);
      }
    },
  },
  cozy: { // 暖炉小屋：柴火噼啪 + 室内底噪
    gen(r, sr, L, R) {
      for (const ch of [L, R]) {
        const rr = new Rng(r.int(1, 1e9));
        addNoise(ch, sr, rr, 0, ch.length / sr, { amp: 0.3, color: 'brown', filters: [{ type: 'lp', f: 300, q: 0.7 }], update: 64 });
        const secs = ch.length / sr;
        scatter(rr, 0, secs, () => 5, (t) => {
          addClick(ch, sr, rr, t, 0.08 * Math.pow(rr.next(), 2), { f: rr.range(1500, 5000), q: 1.2 });
          if (rr.chance(0.2)) crunchCloud(ch, sr, rr, t, { dur: 0.08, rate: 200, fLo: 1500, fHi: 6000, amp: 0.03 });
        }, 100000);
      }
    },
  },
  airy: { // 高空：更薄更亮的风
    gen(r, sr, L, R) {
      for (const ch of [L, R]) {
        const rr = new Rng(r.int(1, 1e9));
        const ph = rr.range(0, TAU);
        addNoise(ch, sr, rr, 0, ch.length / sr, {
          amp: 0.35, color: 'pink',
          env: (t) => 0.5 + 0.3 * Math.sin(TAU * 0.06 * t + ph),
          filt: (u) => [{ type: 'bp', f: 1600 + 900 * Math.sin(TAU * u * 2 + ph), q: 0.8 }],
          update: 64,
        });
      }
    },
  },
  room: { // 安静的玩具房
    gen(r, sr, L, R) {
      for (const ch of [L, R]) {
        const rr = new Rng(r.int(1, 1e9));
        addNoise(ch, sr, rr, 0, ch.length / sr, { amp: 0.22, color: 'pink', filters: [{ type: 'lp', f: 1200, q: 0.7 }, { type: 'hp', f: 80, q: 0.7 }], update: 64 });
      }
    },
  },
  cave: { // 洞穴：低沉空间感
    gen(r, sr, L, R) {
      for (const ch of [L, R]) {
        const rr = new Rng(r.int(1, 1e9));
        addNoise(ch, sr, rr, 0, ch.length / sr, {
          amp: 0.7, color: 'brown',
          env: (t) => 0.75 + 0.25 * Math.sin(TAU * 0.04 * t + rr.range(0, 3)),
          filters: [{ type: 'lp', f: 250, q: 1.2 }, { type: 'hp', f: 35, q: 0.7 }],
          update: 64,
        });
      }
    },
  },
};

// 零星的环境事件（实时随机调度，绝不重复）
export const AMB_EVENTS = {
  bird: {
    cat: 'ambEvt', variants: 6, len: 1.2,
    gen(r, sr, b) {
      const base = r.range(2500, 4200);
      const n = r.int(2, 5);
      let t = 0;
      for (let i = 0; i < n; i++) {
        const d = r.range(0.05, 0.12);
        addSine(b, sr, t, { f: base * r.range(0.9, 1.1), glideTo: base * r.range(1.15, 1.5), glideTime: d, amp: 0.4, t60: d * 2.5, attack: 0.006, vibRate: r.range(30, 60), vibDepth: 0.03 });
        t += d + r.range(0.04, 0.12);
      }
    },
  },
  drip: { cat: 'ambEvt', variants: 6, len: 0.5, gen(r, sr, b) { addBubble(b, sr, 0, r.range(1.5, 3), 0.8, { xi: r.range(0.4, 0.6), decayScale: 2.4 }); } },
  twinkle: { cat: 'ambEvt', notes: pentaNotes(88, 6), len: 2.0, gen(r, sr, b, f) { addModal(b, sr, 0, f, MODES.musicbox, { amp: 0.5, hardness: 14000, rng: r }); } },
  far_chime: { cat: 'ambEvt', notes: pentaNotes(81, 6), len: 2.6, gen(r, sr, b, f) { addModal(b, sr, 0, f, MODES.glass, { amp: 0.4, hardness: 12000, rng: r, detune: 0.0015 }); } },
  bubbles: { cat: 'ambEvt', variants: 5, len: 1.0, gen(r, sr, b) { bubbleCloud(b, sr, r, 0, 0.7, r.int(5, 10), 0.8, 3, 0.6); } },
  ember: {
    cat: 'ambEvt', variants: 5, len: 0.5,
    gen(r, sr, b) {
      const n = r.int(2, 4);
      for (let i = 0; i < n; i++) {
        const t = i === 0 ? 0 : r.range(0.03, 0.3);
        addClick(b, sr, r, t, 0.6 * r.range(0.5, 1), { f: r.range(2000, 4500), q: 1 });
        addModal(b, sr, t, r.range(900, 1500), MODES.wood, { amp: 0.15, hardness: 5000, rng: r, t60Scale: 0.4 });
      }
      crunchCloud(b, sr, r, 0.005, { dur: 0.1, rate: 200, fLo: 1500, fHi: 6000, amp: 0.2 });
    },
  },
  leaves: { cat: 'ambEvt', variants: 5, len: 1.4, gen(r, sr, b) { addNoise(b, sr, r, 0, r.range(0.8, 1.2), { amp: 0.4, env: (t, u) => Math.sin(Math.PI * u), filt: (u) => [{ type: 'bp', f: 3000 + 2000 * Math.sin(u * 9), q: 0.8 }] }); } },
  music_box_far: { cat: 'ambEvt', notes: pentaNotes(79, 8), len: 2.0, gen(r, sr, b, f) { addModal(b, sr, 0, f, MODES.musicbox, { amp: 0.5, hardness: 9000, rng: r }); } },
};

// ========== 渲染入口 ==========
// 生成某个配方的全部变体（返回 Float32Array 数组）
export function renderRecipe(id, sr, seed = 1) {
  const rec = RECIPES[id] || AMB_EVENTS[id];
  if (!rec) throw new Error('未知声音配方: ' + id);
  const target = LOUDNESS[rec.cat] ?? -22;
  const out = [];
  const list = rec.notes ? rec.notes.map((m) => midiToHz(m)) : new Array(rec.variants || 4).fill(0);
  list.forEach((note, i) => {
    const r = new Rng(hashStr(id) * 31 + seed * 977 + i * 7919);
    const buf = alloc(sr, rec.len || 1);
    rec.gen(r, sr, buf, note);
    out.push(finalize(buf, sr, { loudDb: target }));
  });
  return { buffers: out, pitched: !!rec.notes, cat: rec.cat };
}

// 生成可循环的立体声环境底噪
export function renderAmbience(id, sr, seconds = 24, seed = 1) {
  const rec = AMBIENCE[id];
  if (!rec) throw new Error('未知环境声: ' + id);
  const r = new Rng(hashStr(id) + seed * 131);
  const L = alloc(sr, seconds + 2);
  const R = alloc(sr, seconds + 2);
  rec.gen(r, sr, L, R);
  // 两声道部分混合，让声场自然
  for (let i = 0; i < L.length; i++) {
    const l = L[i], rr = R[i];
    L[i] = l * 0.85 + rr * 0.15;
    R[i] = rr * 0.85 + l * 0.15;
  }
  const hp = [new Biquad(sr, 'hp', 30, 0.7), new Biquad(sr, 'hp', 30, 0.7)];
  filterAll(L, hp[0]);
  filterAll(R, hp[1]);
  const lo = makeLoop(L, sr, 2);
  const ro = makeLoop(R, sr, 2);
  // 统一响度
  let ms = 0;
  for (let i = 0; i < lo.length; i++) ms += lo[i] * lo[i] + ro[i] * ro[i];
  const rms = Math.sqrt(ms / (2 * lo.length));
  const g = Math.pow(10, LOUDNESS.amb / 20) / Math.max(1e-9, rms);
  for (let i = 0; i < lo.length; i++) { lo[i] *= g; ro[i] *= g; }
  return [lo, ro];
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000003;
}

export const ALL_SOUND_IDS = [...Object.keys(RECIPES), ...Object.keys(AMB_EVENTS)];
