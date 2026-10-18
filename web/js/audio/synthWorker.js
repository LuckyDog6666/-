// 声音合成 Worker：在后台线程里生成声音，避免主线程（3D 渲染）卡顿。
import { renderRecipe, renderAmbience } from './recipes.js';
import { Rng, Biquad, alloc } from './dsp.js';

// 程序化生成混响冲激响应：早期反射 + 分频段衰减的扩散尾巴
function makeIR(sr, { decay = 1.2, predelay = 0.01, damp = 6000, early = 0.5, seed = 7 }) {
  const r = new Rng(seed);
  const len = Math.ceil(sr * (decay * 1.2 + predelay + 0.05));
  const chans = [alloc(sr, len / sr), alloc(sr, len / sr)];
  chans.forEach((ch, ci) => {
    const lpLo = new Biquad(sr, 'lp', 700, 0.7);
    const bpMid = new Biquad(sr, 'bp', 2000, 0.5);
    const hpHi = new Biquad(sr, 'hp', Math.min(damp, 9000), 0.7);
    const p0 = Math.floor(predelay * sr);
    // 不同频段不同的衰减时间（高频衰减更快，像真实房间）
    const kLo = 6.9 / (decay * 1.15);
    const kMid = 6.9 / decay;
    const kHi = 6.9 / (decay * Math.min(0.7, damp / 12000));
    for (let i = p0; i < len; i++) {
      const t = (i - p0) / sr;
      const n = r.next() * 2 - 1;
      const fade = Math.min(1, t / 0.012);
      ch[i] = fade * (lpLo.process(n) * Math.exp(-kLo * t) * 0.9 + bpMid.process(n) * Math.exp(-kMid * t) * 1.1 + hpHi.process(n) * Math.exp(-kHi * t) * 0.5);
    }
    // 早期反射
    for (let k = 0; k < 9; k++) {
      const t = predelay + r.range(0.004, 0.06);
      const i = Math.floor(t * sr);
      if (i < len) ch[i] += early * r.range(0.2, 0.7) * (r.next() < 0.5 ? -1 : 1) * Math.exp(-t * 8) * (ci ? 0.9 : 1);
    }
  });
  // 能量归一
  let e = 0;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) e += ch[i] * ch[i];
  const g = 1 / Math.sqrt(Math.max(1e-9, e / 2));
  for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] *= g * 0.6;
  return chans;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'render') {
      for (const id of msg.ids) {
        const { buffers, pitched, cat } = renderRecipe(id, msg.sr, msg.seed || 1);
        self.postMessage({ type: 'sound', reqId: msg.reqId, id, pitched, cat, buffers }, buffers.map((b) => b.buffer));
      }
      self.postMessage({ type: 'done', reqId: msg.reqId });
    } else if (msg.type === 'ambience') {
      const chans = renderAmbience(msg.id, msg.sr, msg.seconds || 24, msg.seed || 1);
      self.postMessage({ type: 'ambience', reqId: msg.reqId, id: msg.id, chans }, chans.map((c) => c.buffer));
    } else if (msg.type === 'ir') {
      const chans = makeIR(msg.sr, msg.opts || {});
      self.postMessage({ type: 'ir', reqId: msg.reqId, chans }, chans.map((c) => c.buffer));
    }
  } catch (err) {
    self.postMessage({ type: 'error', reqId: msg.reqId, message: String(err && err.stack || err) });
  }
};
