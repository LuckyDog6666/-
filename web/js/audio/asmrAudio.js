// 真实录音 ASMR 播放引擎（不再使用任何程序合成的声音）。
//  - 声音来自 web/sounds/manifest.json（打包好的 CC0/CC-BY 真实录音），以及用户放在 assets/sounds/ 的自定义录音
//  - 每种触发音多个录音变体随机轮换、不连续重复，轻微随机音高/音量，听感自然
//  - 同一时间只突出一个主触发音：新的主触发音会让上一个还没结束的主触发音柔和淡出（不杂乱）
//  - 持续型触发（压史莱姆、踩太空沙）用较长的录音片段，可随动作长短淡出
//  - 母线：低切 → 胶水压缩 → 补偿增益 → 限幅 → 软削波，整体响度稳定、绝不爆音

export class AsmrAudio {
  constructor(opts = {}) {
    this.opts = Object.assign({ master: 1.0, sfx: 0.85, ambience: 0.6, music: 0.5, spatial: 'stereo', maxVoices: 10 }, opts);
    this.defs = {};        // id -> { cat, gain, files:[{src,dur,gain}] }
    this.buffers = new Map(); // src -> AudioBuffer
    this.loading = new Map();
    this.last = new Map();    // id -> last variant index
    this.voices = [];
    this.mainVoice = null;
    this.ready = false;
    this.ambience = null;
    this.music = null;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ sampleRate: 48000, latencyHint: 'playback' });
    const ctx = this.ctx;
    this.masterIn = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 35; hp.Q.value = 0.6;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -22; glue.knee.value = 12; glue.ratio.value = 2; glue.attack.value = 0.015; glue.release.value = 0.3;
    const makeup = ctx.createGain(); makeup.gain.value = 1.12;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.15;
    const safety = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1, ax = Math.abs(x);
      curve[i] = ax < 0.8 ? x : Math.sign(x) * (0.8 + 0.18 * Math.tanh((ax - 0.8) / 0.18));
    }
    safety.curve = curve; safety.oversample = '4x';
    this.masterGain = ctx.createGain(); this.masterGain.gain.value = this.opts.master;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.masterIn.connect(hp); hp.connect(glue); glue.connect(makeup); makeup.connect(limiter); limiter.connect(this.masterGain);
    this.masterGain.connect(safety); safety.connect(ctx.destination); safety.connect(this.analyser);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.opts.sfx; this.sfxBus.connect(this.masterIn);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = this.opts.ambience; this.ambBus.connect(this.masterIn);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.opts.music; this.musicBus.connect(this.masterIn);
    // 很轻的空间感（小房间），让近距离录音不那么"干"
    this.room = ctx.createConvolver();
    this.room.buffer = this._roomIR(0.45);
    this.roomSend = ctx.createGain(); this.roomSend.gain.value = 0.06;
    this.sfxBus.connect(this.roomSend); this.roomSend.connect(this.room); this.room.connect(this.masterIn);

    await this._loadManifest();
    this.ready = true;
    this._keepAlive();
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  get state() { return this.ctx ? this.ctx.state : 'unavailable'; }

  _keepAlive() {
    const tryResume = () => { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
    setInterval(tryResume, 2000);
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, tryResume, { passive: true }));
    tryResume();
  }

  _roomIR(seconds) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * seconds);
    const b = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        lp += 0.35 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t * 9) * Math.min(1, t / 0.004);
      }
    }
    return b;
  }

  async _loadManifest() {
    try {
      const r = await fetch('sounds/manifest.json', { cache: 'no-store' });
      if (r.ok) { const m = await r.json(); this.defs = m.sounds || {}; this.manifest = m; }
    } catch (e) { console.warn('[audio] 没有找到声音清单', e); }
    // 用户自定义录音（assets/sounds/<id>/）覆盖内置
    try {
      const r = await fetch('/api/sounds', { cache: 'no-store' });
      if (r.ok) {
        const custom = await r.json();
        for (const [id, files] of Object.entries(custom)) {
          const base = this.defs[id] || { cat: 'trigger', gain: 0 };
          this.defs[id] = { ...base, custom: true, files: files.map((src) => ({ src, dur: 0, gain: 0, autoGain: true })) };
          console.log(`[audio] 使用自定义录音 ${id}（${files.length} 个）`);
        }
      }
    } catch {}
  }

  has(id) { return !!(this.defs[id] && this.defs[id].files && this.defs[id].files.length); }

  async _buffer(src) {
    if (this.buffers.has(src)) return this.buffers.get(src);
    if (this.loading.has(src)) return this.loading.get(src);
    const url = src.startsWith('/') ? src : `sounds/${src}`;
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.arrayBuffer(); })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => { this.buffers.set(src, buf); this.loading.delete(src); return buf; })
      .catch((e) => { this.loading.delete(src); console.warn('[audio] 加载失败', src, e.message); return null; });
    this.loading.set(src, p);
    return p;
  }

  // 预加载一组声音
  async ensure(ids) {
    if (!this.ctx) return;
    const jobs = [];
    for (const id of new Set(ids)) {
      const d = this.defs[id];
      if (!d || !d.files) continue;
      for (const f of d.files) jobs.push(this._buffer(f.src).then((buf) => { if (buf && f.autoGain && f._g == null) f._g = autoGain(buf, d.cat); }));
    }
    await Promise.all(jobs);
  }

  // 只保留需要的声音，释放其它（换场景时调用，长时间运行内存稳定）
  prune(keepIds) {
    const keep = new Set();
    for (const id of keepIds) for (const f of this.defs[id]?.files || []) keep.add(f.src);
    for (const src of [...this.buffers.keys()]) if (!keep.has(src)) this.buffers.delete(src);
  }

  _pick(id) {
    const d = this.defs[id];
    if (!d || !d.files || !d.files.length) return null;
    const ready = d.files.map((f, i) => [f, i]).filter(([f]) => this.buffers.get(f.src));
    if (!ready.length) { this.ensure([id]); return null; }
    let k = Math.floor(Math.random() * ready.length);
    if (ready.length > 1 && ready[k][1] === this.last.get(id)) k = (k + 1 + Math.floor(Math.random() * (ready.length - 1))) % ready.length;
    this.last.set(id, ready[k][1]);
    return { def: d, file: ready[k][0], buf: this.buffers.get(ready[k][0].src) };
  }

  /**
   * 播放一个触发音。
   * o: { pan(-1..1), gain(dB), rate, main(主触发音，默认 true), maxDur(秒，超出部分淡出), fadeIn, bus }
   */
  play(id, o = {}) {
    if (!this.ready) return null;
    const pk = this._pick(id);
    if (!pk) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const main = o.main !== false && (pk.def.cat === 'trigger' || pk.def.cat === 'sustain');
    // 同一时间只有一种焦点声音：换成另一种材质时，上一个还没结束的主触发音在 0.25 秒内柔和淡出；
    // 同一种材质连续踩（走路）允许尾音自然叠一点，但最多保留 2 个
    if (main && this.mainVoice && this.mainVoice.end > now + 0.05 && this.mainVoice.id !== id) this._fade(this.mainVoice, o.overlap ?? 0.25);
    if (main) {
      const same = this.voices.filter((v) => v.main && v.id === id && !v.fading && v.end > now);
      if (same.length >= 2) this._fade(same[0], 0.12);
    }
    if (this.voices.length >= this.opts.maxVoices) this._fade(this.voices[0], 0.05);

    const src = ctx.createBufferSource();
    src.buffer = pk.buf;
    src.playbackRate.value = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * (o.pitchVar ?? 0.025));
    const g = ctx.createGain();
    const fileGain = pk.file._g != null ? pk.file._g : Math.pow(10, (pk.file.gain || 0) / 20);
    const lin = fileGain * Math.pow(10, ((pk.def.gain || 0) + (o.gain || 0) + (Math.random() * 2 - 1) * 0.8) / 20);
    const fadeIn = o.fadeIn ?? 0.004;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(lin, now + fadeIn);
    const dur = pk.buf.duration / src.playbackRate.value;
    let end = now + dur;
    if (o.maxDur && o.maxDur < dur) {
      end = now + o.maxDur;
      g.gain.setValueAtTime(lin, end - Math.min(0.35, o.maxDur * 0.4));
      g.gain.linearRampToValueAtTime(0, end);
    }
    const pan = this._panNode(o.pan || 0);
    src.connect(g); g.connect(pan);
    pan.connect(o.bus === 'amb' ? this.ambBus : o.bus === 'music' ? this.musicBus : this.sfxBus);
    src.start(now + (o.delay || 0));
    src.stop(end + (o.delay || 0) + 0.05);
    const v = { src, g, pan, end, id, lin, main };
    this.voices.push(v);
    if (main) this.mainVoice = v;
    src.onended = () => this._release(v);
    return v;
  }

  _panNode(pan) {
    const ctx = this.ctx;
    if (this.opts.spatial === 'hrtf' && ctx.createPanner) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 0;
      const az = Math.max(-1, Math.min(1, pan)) * 0.8;
      if (p.positionX) { p.positionX.value = Math.sin(az); p.positionY.value = 0; p.positionZ.value = -Math.cos(az); } else p.setPosition(Math.sin(az), 0, -Math.cos(az));
      return p;
    }
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan)) * 0.5; // 真实立体声录音自带声场，只做轻微偏移
    return p;
  }

  _fade(v, t) {
    if (!v || v.fading) return;
    v.fading = true;
    const now = this.ctx.currentTime;
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(v.g.gain.value, now);
      v.g.gain.linearRampToValueAtTime(0, now + t);
      v.src.stop(now + t + 0.02);
    } catch {}
  }

  stop(v, fade = 0.3) { this._fade(v, fade); }

  _release(v) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    if (this.mainVoice === v) this.mainVoice = null;
    try { v.src.disconnect(); v.g.disconnect(); v.pan.disconnect(); } catch {}
  }

  // 环境底噪（很轻），循环播放，两个实例交叉淡化
  // 跳舞放音乐时，把环境声压低一些（不抢）
  duckAmbience(on, t = 0.8) {
    if (!this.ambience || !this.ctx) return;
    const a = this.ambience;
    a.g.gain.cancelScheduledValues(this.ctx.currentTime);
    a.g.gain.setTargetAtTime(on ? a.lin * 0.3 : a.lin, this.ctx.currentTime, t / 3);
  }

  async setAmbience(id, gainDb = -6) {
    if (!this.ready) return;
    if (this.ambience) { const old = this.ambience; this.ambience = null; this._fade(old, 2.5); }
    if (!id || !this.has(id)) return;
    await this.ensure([id]);
    const pk = this._pick(id);
    if (!pk) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = pk.buf; src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lin = Math.pow(10, ((pk.def.gain || 0) + gainDb) / 20) * (pk.file._g ?? 1);
    g.gain.setTargetAtTime(lin, ctx.currentTime, 1.5);
    const pan = ctx.createStereoPanner();
    src.connect(g); g.connect(pan); pan.connect(this.ambBus);
    src.start(ctx.currentTime, Math.random() * pk.buf.duration * 0.7);
    this.ambience = { src, g, pan, end: Infinity, id, lin };
  }

  // 答谢舞蹈音乐（Kevin MacLeod 等 CC-BY 可爱小曲），按时长淡入淡出。返回曲目信息（含 BPM，舞步对齐拍子）
  async startMusic(id, seconds) {
    if (!this.ready || !this.has(id)) return null;
    this.stopMusic(0.2);
    await this.ensure([id]);
    const pk = this._pick(id);
    if (!pk) return null;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = pk.buf; src.loop = true;
    const g = ctx.createGain();
    const lin = Math.pow(10, (pk.def.gain || 0) / 20) * (pk.file._g ?? Math.pow(10, (pk.file.gain || 0) / 20));
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(lin, now + 0.4);
    g.gain.setValueAtTime(lin, now + Math.max(0.5, seconds - 0.8));
    g.gain.linearRampToValueAtTime(0, now + seconds);
    const pan = ctx.createStereoPanner();
    src.connect(g); g.connect(pan); pan.connect(this.musicBus);
    src.start(now, 0);
    src.stop(now + seconds + 0.1);
    this.music = { src, g, pan, end: now + seconds, id };
    src.onended = () => { if (this.music && this.music.src === src) this.music = null; try { src.disconnect(); g.disconnect(); pan.disconnect(); } catch {} };
    return { bpm: pk.file.bpm || 112, beat0: pk.file.beat0 || 0, title: pk.file.title || '' };
  }

  stopMusic(fade = 0.4) { if (this.music) { const m = this.music; this.music = null; this._fade(m, fade); } }

  setVolumes(v = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (v.master != null) this.masterGain.gain.setTargetAtTime(v.master, t, 0.1);
    if (v.sfx != null) this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.1);
    if (v.ambience != null) this.ambBus.gain.setTargetAtTime(v.ambience, t, 0.1);
    if (v.music != null) this.musicBus.gain.setTargetAtTime(v.music, t, 0.1);
    if (v.spatial) this.opts.spatial = v.spatial;
  }

  level() {
    if (!this.analyser) return -100;
    const a = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(a);
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
    return 20 * Math.log10(Math.max(1e-6, m));
  }

  update() {}
}

// 自定义录音的自动音量：按 400ms 窗口的最大 RMS 对齐到同类声音
const TARGET = { trigger: -24, sustain: -25, soft: -27, step: -30, ambience: -30, music: -22 };
function autoGain(buf, cat) {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const win = Math.floor(0.4 * sr);
  let best = 0, acc = 0;
  for (let i = 0; i < d.length; i++) {
    acc += d[i] * d[i];
    if (i >= win) acc -= d[i - win] * d[i - win];
    if (i >= win - 1) best = Math.max(best, acc / win);
  }
  if (d.length < win) best = acc / Math.max(1, d.length);
  const db = 10 * Math.log10(Math.max(1e-12, best));
  return Math.min(6, Math.pow(10, ((TARGET[cat] ?? -20) - db) / 20));
}
