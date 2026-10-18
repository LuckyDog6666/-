// Web Audio 播放引擎：
//  - 每个声音多变体 round-robin + 随机微调音高/音量（避免机械重复）
//  - 双耳 HRTF 空间定位（或普通立体声），声音跟随糯糯在画面中的位置
//  - 每个场景独立的程序化混响（洞穴回声长、雪地很干、海底闷闷的）
//  - 母线：低切 → 轻微暖声/空气感 EQ → 胶水压缩 → 砖墙限幅，保证直播音量稳定不爆音
//  - 环境底噪循环 + 实时随机环境事件（鸟鸣、水滴…永不重复）
//  - 舞蹈伴奏音序器（五声音阶随机旋律，每次都不一样）
//  - 支持用真实录音覆盖：把音频放进 assets/sounds/<声音ID>/ 即可

import { analyze } from './dsp.js';
import { LOUDNESS } from './recipes.js';

const now = () => performance.now() / 1000;

export class AudioEngine {
  constructor(opts = {}) {
    this.opts = Object.assign({
      spatial: 'hrtf', // 'hrtf' | 'stereo'
      master: 0.9,
      sfx: 1.0,
      ambience: 0.8,
      music: 0.7,
      maxVoices: 28,
    }, opts);
    this.sounds = new Map(); // id -> {buffers: AudioBuffer[], pitched, last, cat, custom}
    this.voices = [];
    this.lastPlay = new Map();
    this.pending = new Map();
    this.reqSeq = 1;
    this.ambSource = null;
    this.ambEvents = [];
    this.ambTimers = [];
    this.music = null;
    this.customList = null;
    this.ready = false;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ sampleRate: 48000, latencyHint: 'playback' });
    const ctx = this.ctx;
    this.sr = ctx.sampleRate;
    this.worker = new Worker(new URL('./synthWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._onWorker(e.data);
    this.worker.onerror = (e) => console.error('[audio] worker error', e.message);

    // ---- 母线 ----
    this.masterIn = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.6;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 140; warm.gain.value = 1.2;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9500; air.gain.value = 1.5;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 10; glue.ratio.value = 2.2; glue.attack.value = 0.012; glue.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.12;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.opts.master;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.masterIn.connect(hp); hp.connect(warm); warm.connect(air); air.connect(glue); glue.connect(limiter);
    limiter.connect(this.masterGain); this.masterGain.connect(ctx.destination); this.masterGain.connect(this.analyser);

    // ---- 子母线 ----
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.opts.sfx;
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = this.opts.ambience;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.opts.music;
    this.sfxBus.connect(this.masterIn);
    this.ambBus.connect(this.masterIn);
    this.musicBus.connect(this.masterIn);

    // 混响（并联发送）
    this.reverb = ctx.createConvolver();
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.15;
    this.reverbReturn = ctx.createGain(); this.reverbReturn.gain.value = 1;
    this.reverbTone = ctx.createBiquadFilter(); this.reverbTone.type = 'lowpass'; this.reverbTone.frequency.value = 8000;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.reverbTone); this.reverbTone.connect(this.reverbReturn); this.reverbReturn.connect(this.masterIn);
    this.sfxBus.connect(this.reverbSend);
    const musicSend = ctx.createGain(); musicSend.gain.value = 0.5;
    this.musicBus.connect(musicSend); musicSend.connect(this.reverbSend);

    // 场景整体音色（海底会更闷一些）
    this.sceneTone = ctx.createBiquadFilter(); this.sceneTone.type = 'lowpass'; this.sceneTone.frequency.value = 20000; this.sceneTone.Q.value = 0.5;
    this.sfxBus.disconnect(this.masterIn);
    this.sfxBus.connect(this.sceneTone); this.sceneTone.connect(this.masterIn);

    if (ctx.listener.positionX) {
      ctx.listener.positionX.value = 0; ctx.listener.positionY.value = 0; ctx.listener.positionZ.value = 0;
      ctx.listener.forwardX.value = 0; ctx.listener.forwardY.value = 0; ctx.listener.forwardZ.value = -1;
      ctx.listener.upX.value = 0; ctx.listener.upY.value = 1; ctx.listener.upZ.value = 0;
    }

    await this._loadCustomList();
    this.ready = true;
    this._keepAlive();
  }

  // 浏览器可能因自动播放策略暂停音频；启动参数里已关闭限制，这里再做一次兜底
  _keepAlive() {
    const tryResume = () => { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
    setInterval(tryResume, 2000);
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, tryResume, { passive: true }));
    tryResume();
  }

  get running() { return this.ctx && this.ctx.state === 'running'; }

  _onWorker(m) {
    const p = this.pending.get(m.reqId);
    if (m.type === 'sound') {
      const custom = this.sounds.get(m.id);
      if (custom && custom.custom) return; // 已被真实录音覆盖
      const buffers = m.buffers.map((arr) => {
        const b = this.ctx.createBuffer(1, arr.length, this.sr);
        b.copyToChannel(arr, 0);
        return b;
      });
      this.sounds.set(m.id, { buffers, pitched: m.pitched, cat: m.cat, last: -1, custom: false });
    } else if (m.type === 'ambience' || m.type === 'ir') {
      if (p) {
        const b = this.ctx.createBuffer(2, m.chans[0].length, this.sr);
        b.copyToChannel(m.chans[0], 0);
        b.copyToChannel(m.chans[1], 1);
        p.resolve(b);
        this.pending.delete(m.reqId);
      }
    } else if (m.type === 'done') {
      if (p) { p.resolve(); this.pending.delete(m.reqId); }
    } else if (m.type === 'error') {
      console.error('[audio] synth error', m.message);
      if (p) { p.resolve(); this.pending.delete(m.reqId); }
    }
  }

  _request(msg) {
    const reqId = this.reqSeq++;
    return new Promise((resolve) => {
      this.pending.set(reqId, { resolve });
      this.worker.postMessage(Object.assign({ reqId, sr: this.sr }, msg));
    });
  }

  // 预先生成一批声音（只生成还没有的）
  async ensure(ids) {
    const need = [...new Set(ids)].filter((id) => !this.sounds.has(id));
    if (!need.length) return;
    await this._loadCustom(need);
    const still = need.filter((id) => !this.sounds.has(id));
    if (still.length) await this._request({ type: 'render', ids: still, seed: 1 });
  }

  // ---------- 真实录音覆盖 ----------
  async _loadCustomList() {
    try {
      const res = await fetch('/api/sounds', { cache: 'no-store' });
      if (res.ok) this.customList = await res.json();
    } catch { this.customList = null; }
  }

  async _loadCustom(ids) {
    if (!this.customList) return;
    for (const id of ids) {
      const files = this.customList[id];
      if (!files || !files.length) continue;
      const buffers = [];
      for (const f of files) {
        try {
          const res = await fetch(f);
          const ab = await res.arrayBuffer();
          const buf = await this.ctx.decodeAudioData(ab);
          // 按同类别的响度目标自动对齐音量
          const data = buf.getChannelData(0);
          const a = analyze(data, buf.sampleRate);
          buffers.push({ buf, gain: Math.pow(10, ((LOUDNESS.item) - a.loudDb) / 20) });
        } catch (e) { console.warn('[audio] 自定义音频加载失败', f, e); }
      }
      if (buffers.length) {
        const out = buffers.map((x) => x.buf);
        this.sounds.set(id, { buffers: out, gains: buffers.map((x) => Math.min(4, x.gain)), pitched: false, cat: 'item', last: -1, custom: true });
        console.log(`[audio] 使用真实录音覆盖 ${id}（${out.length} 个文件）`);
      }
    }
  }

  // ---------- 播放 ----------
  /**
   * play(id, { pan:-1..1, dist:0..1, gain(dB 偏移), note(音阶序号), rate, delay, reverb(发送量倍数) })
   */
  play(id, o = {}) {
    if (!this.ready) return null;
    const s = this.sounds.get(id);
    if (!s) return null;
    const ctx = this.ctx;
    const t = now();
    const minGap = o.minGap ?? 0.035;
    if ((this.lastPlay.get(id) || 0) + minGap > t && !o.force) return null;
    this.lastPlay.set(id, t);

    // 选择变体：旋律类按音符；其它随机但不与上一次相同
    let idx;
    if (s.pitched && o.note != null) idx = ((o.note % s.buffers.length) + s.buffers.length) % s.buffers.length;
    else {
      idx = Math.floor(Math.random() * s.buffers.length);
      if (s.buffers.length > 1 && idx === s.last) idx = (idx + 1 + Math.floor(Math.random() * (s.buffers.length - 1))) % s.buffers.length;
    }
    s.last = idx;
    const buffer = s.buffers[idx];

    if (this.voices.length >= this.opts.maxVoices) this._steal();

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const pitchVar = s.pitched ? 0 : (o.pitchVar ?? 0.035);
    src.playbackRate.value = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * pitchVar);
    const g = ctx.createGain();
    const gainDb = (o.gain || 0) + (Math.random() * 2 - 1) * (o.gainVar ?? 1.2);
    let lin = Math.pow(10, gainDb / 20) * (s.gains ? s.gains[idx] : 1);
    const dist = Math.max(0, Math.min(1, o.dist ?? 0.2));
    lin *= 1 - dist * 0.55;
    g.gain.value = lin;

    let pannerNode;
    const pan = Math.max(-1, Math.min(1, o.pan || 0));
    if (this.opts.spatial === 'hrtf' && ctx.createPanner) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1; p.maxDistance = 50; p.rolloffFactor = 0;
      // 只放在前半球：方位角 ±55°，距离 1~2.2
      const az = pan * 0.96;
      const r = 1 + dist * 1.2;
      const x = Math.sin(az) * r;
      const z = -Math.cos(az) * r;
      if (p.positionX) { p.positionX.value = x; p.positionY.value = -0.15; p.positionZ.value = z; }
      else p.setPosition(x, -0.15, z);
      pannerNode = p;
    } else {
      const p = ctx.createStereoPanner();
      p.pan.value = pan * 0.75;
      pannerNode = p;
    }
    src.connect(g); g.connect(pannerNode);
    const bus = o.bus === 'music' ? this.musicBus : o.bus === 'amb' ? this.ambBus : this.sfxBus;
    pannerNode.connect(bus);
    let send = null;
    if (o.reverb && bus !== this.sfxBus) {
      send = ctx.createGain(); send.gain.value = o.reverb; pannerNode.connect(send); send.connect(this.reverbSend);
    }
    const when = ctx.currentTime + (o.delay || 0);
    src.start(when);
    const voice = { src, g, pannerNode, send, end: when + buffer.duration / src.playbackRate.value, id };
    this.voices.push(voice);
    src.onended = () => this._release(voice);
    return voice;
  }

  _release(v) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try { v.src.disconnect(); v.g.disconnect(); v.pannerNode.disconnect(); if (v.send) v.send.disconnect(); } catch {}
  }

  _steal() {
    // 淡出最早开始的声音
    const v = this.voices.shift();
    if (!v) return;
    const t = this.ctx.currentTime;
    try {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0, t + 0.04);
      v.src.stop(t + 0.05);
    } catch {}
  }

  // ---------- 场景 ----------
  /**
   * 切换场景声学：混响、整体音色、环境底噪、环境事件
   * audio = { reverb:{decay,predelay,damp,wet}, tone, ambience, events:[{id, every:[a,b], gain, reverb}] }
   */
  async setScene(audio) {
    const ctx = this.ctx;
    const rv = audio.reverb || {};
    const ir = await this._request({ type: 'ir', opts: { decay: rv.decay || 1, predelay: rv.predelay || 0.012, damp: rv.damp || 7000, early: rv.early ?? 0.5, seed: (rv.decay || 1) * 100 | 0 } });
    if (ir) {
      // 交叉切换混响：先把发送量拉低再替换冲激响应
      const t = ctx.currentTime;
      this.reverbSend.gain.cancelScheduledValues(t);
      this.reverbSend.gain.setTargetAtTime(0, t, 0.08);
      await new Promise((r) => setTimeout(r, 350));
      this.reverb.buffer = ir;
      this.reverbSend.gain.setTargetAtTime(rv.wet ?? 0.15, ctx.currentTime, 0.3);
    }
    this.sceneTone.frequency.setTargetAtTime(audio.tone || 20000, ctx.currentTime, 0.5);

    // 环境底噪
    if (audio.ambience) {
      const amb = await this._request({ type: 'ambience', id: audio.ambience, seconds: 26, seed: Math.floor(Math.random() * 1000) });
      this._swapAmbience(amb, audio.ambienceGain ?? 0);
    }
    this.ambEvents = (audio.events || []).map((e) => ({ ...e, next: now() + rand(e.every[0], e.every[1]) * 0.5 }));
    await this.ensure(this.ambEvents.map((e) => e.id));
  }

  _swapAmbience(buffer, gainDb) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.ambSource) {
      const old = this.ambSource;
      old.g.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => { try { old.src.stop(); old.src.disconnect(); old.g.disconnect(); } catch {} }, 4000);
    }
    if (!buffer) { this.ambSource = null; return; }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(Math.pow(10, gainDb / 20), t, 1.2);
    src.connect(g); g.connect(this.ambBus);
    src.start(t, Math.random() * buffer.duration * 0.8);
    this.ambSource = { src, g };
  }

  // 每帧调用：调度环境事件
  update() {
    if (!this.ready || !this.ambEvents.length) return;
    const t = now();
    for (const e of this.ambEvents) {
      if (t >= e.next) {
        e.next = t + rand(e.every[0], e.every[1]);
        const s = this.sounds.get(e.id);
        this.play(e.id, {
          pan: rand(-0.9, 0.9), dist: rand(0.5, 1), gain: (e.gain || 0) + rand(-3, 0), bus: 'amb', reverb: e.reverb ?? 0.6,
          note: s && s.pitched ? Math.floor(Math.random() * s.buffers.length) : undefined,
        });
      }
    }
  }

  // ---------- 舞蹈伴奏 ----------
  startMusic({ bpm = 112, seconds = 8, seed = Math.random() * 1e9, energy = 1 } = {}) {
    this.stopMusic(0.05);
    if (!this.ready) return;
    const ctx = this.ctx;
    const spb = 60 / bpm;
    const start = ctx.currentTime + 0.08;
    const end = start + seconds;
    let rs = seed >>> 0 || 1;
    const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
    const prog = [0, 4, 1, 3]; // C - A - D - G（低音在五声音阶中的序号）
    const rhythmBank = [
      [0, 1, 1.5, 2, 3], [0, 0.5, 1, 2, 2.5, 3], [0, 1, 2, 2.5, 3.5], [0, 0.75, 1.5, 2, 3, 3.5],
    ];
    let mel = 5 + Math.floor(rnd() * 3);
    const events = [];
    const bars = Math.ceil(seconds / (spb * 4));
    for (let bar = 0; bar < bars; bar++) {
      const t0 = start + bar * spb * 4;
      const root = prog[bar % 4];
      events.push({ t: t0, id: 'm_bass', note: root, gain: -1 });
      events.push({ t: t0 + spb * 2.5, id: 'm_bass', note: root + (rnd() < 0.5 ? 0 : 5), gain: -4 });
      for (let b = 0; b < 4; b++) {
        if (b % 2 === 0) events.push({ t: t0 + b * spb, id: 'm_kick', gain: -2 });
        else events.push({ t: t0 + b * spb, id: 'm_clap', gain: -5 });
        events.push({ t: t0 + b * spb + spb * 0.5, id: 'm_shaker', gain: -8 + rnd() * 2 });
        if (energy > 1.3) events.push({ t: t0 + b * spb + spb * 0.25, id: 'm_shaker', gain: -12 });
      }
      const rh = rhythmBank[Math.floor(rnd() * rhythmBank.length)];
      for (const beat of rh) {
        mel += Math.floor(rnd() * 5) - 2;
        mel = Math.max(2, Math.min(11, mel));
        events.push({ t: t0 + beat * spb, id: 'm_kalimba', note: mel, gain: -2 - rnd() * 3 });
        if (rnd() < 0.25) events.push({ t: t0 + beat * spb, id: 'm_kalimba', note: Math.max(0, mel - 2), gain: -9 });
      }
    }
    const filtered = events.filter((e) => e.t < end - 0.05);
    this.music = { events: filtered, idx: 0, end, timer: null, gain: ctx.createGain() };
    const mg = this.music.gain;
    mg.gain.value = 0;
    mg.gain.setTargetAtTime(1, start, 0.15);
    mg.gain.setTargetAtTime(0, end - 0.6, 0.25);
    mg.connect(this.musicBus);
    const tick = () => {
      if (!this.music) return;
      const horizon = ctx.currentTime + 0.25;
      const m = this.music;
      while (m.idx < m.events.length && m.events[m.idx].t < horizon) {
        const e = m.events[m.idx++];
        this._playAt(e.id, e.t, e.note, e.gain, mg);
      }
      if (m.idx >= m.events.length && ctx.currentTime > m.end) this.stopMusic(0);
    };
    this.music.timer = setInterval(tick, 60);
    tick();
  }

  _playAt(id, when, note, gainDb, dest) {
    const s = this.sounds.get(id);
    if (!s) return;
    const idx = s.pitched && note != null ? Math.max(0, Math.min(s.buffers.length - 1, note)) : Math.floor(Math.random() * s.buffers.length);
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffers[idx];
    const g = this.ctx.createGain();
    g.gain.value = Math.pow(10, (gainDb || 0) / 20);
    src.connect(g); g.connect(dest);
    src.start(Math.max(this.ctx.currentTime, when));
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch {} };
  }

  stopMusic(fade = 0.3) {
    if (!this.music) return;
    const m = this.music;
    this.music = null;
    clearInterval(m.timer);
    try {
      const t = this.ctx.currentTime;
      m.gain.gain.cancelScheduledValues(t);
      m.gain.gain.setTargetAtTime(0, t, Math.max(0.01, fade / 3));
      setTimeout(() => { try { m.gain.disconnect(); } catch {} }, (fade + 1.5) * 1000);
    } catch {}
  }

  setVolumes(v = {}) {
    const t = this.ctx ? this.ctx.currentTime : 0;
    if (v.master != null) { this.opts.master = v.master; this.masterGain && this.masterGain.gain.setTargetAtTime(v.master, t, 0.1); }
    if (v.sfx != null) { this.opts.sfx = v.sfx; this.sfxBus && this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.1); }
    if (v.ambience != null) { this.opts.ambience = v.ambience; this.ambBus && this.ambBus.gain.setTargetAtTime(v.ambience, t, 0.1); }
    if (v.music != null) { this.opts.music = v.music; this.musicBus && this.musicBus.gain.setTargetAtTime(v.music, t, 0.1); }
    if (v.spatial) this.opts.spatial = v.spatial;
  }

  // 当前输出电平（dBFS，给控制台显示）
  level() {
    if (!this.analyser) return -100;
    const a = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(a);
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
    return 20 * Math.log10(Math.max(1e-6, m));
  }

  // 释放不再使用的声音（场景切换时保留通用声音）
  prune(keepIds) {
    const keep = new Set(keepIds);
    for (const id of [...this.sounds.keys()]) if (!keep.has(id)) this.sounds.delete(id);
  }
}

function rand(a, b) { return a + Math.random() * (b - a); }
