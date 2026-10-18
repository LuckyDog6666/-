// 游戏主控：关卡循环、糯糯的行动执行、踩踏反馈（声音/特效/标签）、礼物答谢舞蹈、镜头。
import * as THREE from 'three';
import { THEMES, themeById } from '../world/themes.js';
import { generateLevel } from '../world/levelGen.js';
import { World } from '../world/world.js';
import { MECH_SOUNDS, SHARED_SOUNDS, soundsForTheme } from '../world/itemMeta.js';
import { Brain } from '../ai/brain.js';
import { Pet } from '../pet/pet.js';
import { DANCES } from '../pet/dances.js';
import { GiftManager, TIERS } from './giftManager.js';
import { Rng, Timers, clamp, damp, rand, pick, TAU, escapeText } from '../core/util.js';

const THANK_LINES = ['谢谢老板～♥', '老板大气！', '比心心～', '爱你哟～', '啾咪～', '谢谢宝～', '老板万福！', '最喜欢你啦～'];
const DANCE_SUFFIX = ['糯糯给你跳支舞～', '糯糯开心到转圈圈～', '收到啦，比心心！', '老板发财，天天开心～'];

export class Game {
  constructor({ renderer, scene, camera, audio, hud, particles, petMats, cfg, onStatus }) {
    Object.assign(this, { renderer, scene, camera, audio, hud, particles, petMats, cfg });
    this.onStatus = onStatus || (() => {});
    this.timers = new Timers();
    this.gifts = new GiftManager(cfg.gifts || {});
    this.rng = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
    this.levelNo = Number(safeGet('nuonuo.level')) || 0;
    this.themeQueue = [];
    this.lastTheme = null;
    this.state = 'boot';
    this.dancing = false;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 8, 12);
    this.camMode = 'follow';
    this.recentDances = [];
    this.labelShown = new Map();
    this.lastLikeFx = 0;
    this.lastWave = -1e9;
    this.pendingWaves = [];
    this.crownUntil = 0;
    this.time = 0;
    this.levelsPlayed = 0;
    this.startedAt = performance.now();
  }

  wait(s) { return this.timers.wait(s); }

  async init() {
    this.pet = new Pet(this.petMats);
    this.scene.add(this.pet.root);
    this.scene.add(this.pet.shadow);
    this.pet.onDanceEvent = (ev, pet) => {
      const p = pet.root.position;
      if (ev.sound) this.sfx(ev.sound, p, { gain: ev.gain || 0 });
      if (ev.fx) this.particles.burst(ev.fx, p.x, p.y + 0.9, p.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#ffffff'] });
    };
    await this.audio.ensure([...MECH_SOUNDS, ...SHARED_SOUNDS]);
    this.loop();
  }

  // ---------------- 关卡循环（永不停止） ----------------
  async loop() {
    for (;;) {
      try {
        await this.loadLevel();
        await this.intro();
        await this.playLevel();
        await this.outro();
      } catch (err) {
        console.error('[game] 关卡出错，自动进入下一关', err);
        this.onStatus({ type: 'error', message: String(err && err.stack || err) });
        await sleepReal(1500);
      }
      this.levelsPlayed++;
      // 定期整页刷新，清理一切可能的内存碎片（在关卡之间进行，观众只看到一次转场）
      const hours = (performance.now() - this.startedAt) / 3.6e6;
      if (this.cfg.reloadHours > 0 && hours > this.cfg.reloadHours) { location.reload(); await sleepReal(10000); }
    }
  }

  _nextTheme() {
    const allowed = (this.cfg.themes && this.cfg.themes.length ? this.cfg.themes : THEMES.map((t) => t.id)).filter((id) => THEMES.some((t) => t.id === id));
    if (!this.themeQueue.length) {
      this.themeQueue = this.rng.shuffle(allowed.slice());
      if (this.themeQueue[0] === this.lastTheme && this.themeQueue.length > 1) this.themeQueue.push(this.themeQueue.shift());
    }
    const id = this.themeQueue.shift();
    this.lastTheme = id;
    return themeById(id);
  }

  async loadLevel() {
    this.state = 'loading';
    // 即使上一关因异常中断，也把状态恢复干净
    this.dancing = false;
    this.hud.hideThanks();
    this.hud.unsay();
    this.audio.stopMusic(0.1);
    this.pet.cancelAction();
    if (this.world) { this.world.dispose(); this.world = null; }
    this.particles.clear();
    this.levelNo++;
    safeSet('nuonuo.level', String(this.levelNo));
    const theme = this._nextTheme();
    this.theme = theme;
    const len = this.cfg.levelLength || [34, 46];
    const level = generateLevel(theme, { seed: this.rng.int(1, 1e9), length: len });
    this.level = level;
    this.world = new World(this.scene, theme, level, { shadowSize: this.cfg.shadowSize || 2048 }).build();
    this.brain = new Brain(level, new Rng(level.seed + 99), { budget: this.cfg.levelBudget || 170 });
    this.pet.setAccessory(theme.accessory);
    if (this.time > this.crownUntil) this.pet.setCrown(false);
    // 声音：本主题需要的 + 通用
    const ids = soundsForTheme(theme);
    await this.audio.ensure(ids);
    await this.audio.setScene(theme.audio);
    this.hud.setLevel({ n: this.levelNo, name: theme.name, stars: 0, needKey: level.keyId != null, hasKey: false });
    this.hud.setProgress(0);
    const start = this.world.standPoint(level.main[0]);
    this.pet.root.position.copy(start);
    this.pet.setGround(this.world.cellTop(level.main[0]));
    this.pet.face(Math.PI / 2 - 0.4);
    this.pet.root.scale.setScalar(1);
    this.pet.sinkTarget = 0;
    this.pet.sleepy = 0;
    this.camMode = 'intro';
    this.camTarget.copy(start);
    this.camPos.copy(start).add(new THREE.Vector3(-2, 11, 14));
    this.lastProgressT = this.time;
    this.onStatus({ type: 'level', level: this.levelNo, theme: theme.id });
  }

  async intro() {
    this.state = 'intro';
    await this.hud.irisTo(false, 1000);
    const p = this.pet.root.position;
    this.particles.burst('poof', p.x, p.y, p.z, { colors: ['#ffffff', '#ffe3f1'] });
    this.sfx('land', p);
    this.pet.sq.x = 0.6;
    const title = this.hud.showTitle(this.levelNo, this.theme.name, this.theme.subtitle, 3.0);
    await this.wait(0.6);
    this.camMode = 'follow';
    this.pet.expr('happy', 'open', 1.6);
    this.sfx('v_yay', p);
    await this.pet.idleAction('celebrate', 1.4);
    await title;
  }

  async outro() {
    this.state = 'outro';
    const w = this.world, pet = this.pet;
    const gp = w.portal.position.clone();
    w.openPortal();
    this.sfx('portal', gp);
    pet.expr('happy', 'open', 3);
    await this.wait(0.5);
    const into = new THREE.Vector3(gp.x, gp.y - 0.6, gp.z);
    const hop = pet.hop(into, { height: 0.9, dur: 0.7, spin: 1 });
    await hop;
    this.sfx('level_clear', gp);
    this.particles.burst('confetti', gp.x, gp.y, gp.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b', '#c9a0ff'], floor: w.cellTop(this.level.main[this.level.main.length - 1]) });
    // 糯糯被传送门吸进去
    for (let i = 0; i < 20; i++) { pet.root.scale.setScalar(Math.max(0.01, 1 - i / 20)); pet.facing += 0.4; pet.targetFacing = pet.facing; await this.wait(0.03); }
    pet.root.scale.setScalar(0.01);
    const stars = w.collectedStars.size;
    this.hud.toast(`第 ${this.levelNo} 关通关！收集到 ${stars} 颗星星 ⭐`, 'follow', 4000);
    await this.wait(1.2);
    await this.hud.irisTo(true, 900);
    pet.root.scale.setScalar(1);
  }

  // ---------------- 闯关 ----------------
  async playLevel() {
    this.state = 'play';
    const b = this.brain;
    let guard = 0;
    while (guard++ < 5000) {
      await this.serviceInterrupts();
      // 卡住保护：40 秒没有进展就"瞬移"到前方
      if (this.time - this.lastProgressT > 40) await this.unstick();
      // 超时保护：超过预算很多就直接完成
      if (b.elapsed > (this.cfg.levelBudget || 170) * 3.5) { console.warn('[game] 关卡超时，自动完成'); break; }
      const a = b.decide();
      if (a.type === 'finish') break;
      if (a.type === 'move') await this.doMove(a);
      else if (a.type === 'repeat') await this.doRepeat(a.times);
      else if (a.type === 'idle') await this.doIdle(a.kind, a.secs);
      else if (a.type === 'gateLocked') await this.doGateLocked();
      else if (a.type === 'openGate') await this.doOpenGate();
      this.hud.setProgress(b.progress());
      // 让出一帧，保证即使逻辑出错也不会锁死
      await this.wait(0);
    }
    this.hud.setProgress(1);
  }

  async unstick() {
    const b = this.brain, w = this.world;
    const idx = b._progressIdx();
    const next = this.level.main[Math.min(this.level.main.length - 1, idx + 1)];
    const target = this.level.cells[next].gap ? this.level.main[Math.min(this.level.main.length - 1, idx + 3)] : next;
    const p = this.pet.root.position;
    this.particles.burst('poof', p.x, p.y, p.z, { colors: ['#ffffff'] });
    this.pet.root.position.copy(w.standPoint(target));
    b.arrived(target);
    b.plan = [];
    if (this.level.gateId != null && b._progressIdx() >= this.level.cells[this.level.gateId].idx) { b.onGateOpened(); w.openGate(); }
    this.lastProgressT = this.time;
  }

  faceBlend() {
    // 移动时身体朝向"行进方向"和"镜头"之间，让观众能看到糯糯的小脸
    const pet = this.pet;
    const a = pet.targetFacing;
    const d = ((0 - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    pet.targetFacing = a + d * 0.32;
  }

  hopDur() {
    const e = this.brain ? this.brain.mood.energy : 1;
    const hurry = this.brain && this.brain.overBudget ? 0.85 : 1;
    return (0.5 - e * 0.06) * hurry;
  }

  async doMove(a) {
    const w = this.world, pet = this.pet, b = this.brain;
    const to = a.to;
    const target = w.standPoint(to);
    const e = a.edge || { jump: 0 };
    if (e.jump === 1) {
      this.sfx('jump', pet.root.position);
      const p = pet.hop(target, { height: 1.0, dur: 0.72, anticipation: 0.16 });
      this.faceBlend();
      await p;
      await this.landOn(to, { fromJump: true });
    } else if (e.jump >= 2) {
      w.bounceSpring(b.cur);
      this.sfx('spring_pad', pet.root.position, { gain: 2 });
      const p = pet.hop(target, { height: 2.3, dur: 1.15, anticipation: 0.1, flip: 1 });
      this.faceBlend();
      pet.expr('happy', 'open', 1.4);
      await p;
      await this.landOn(to, { fromJump: true });
    } else {
      const item = w.items.get(to);
      if (item && item.available && item.meta.react === 'slide') {
        // 冰面：落在边缘，然后"咻"地滑到中间
        const from = pet.root.position.clone();
        const dir = target.clone().sub(from).setY(0).normalize();
        const entry = target.clone().addScaledVector(dir, -0.45);
        const p = pet.hop(entry, { dur: this.hopDur() * 0.9 });
        this.faceBlend();
        await p;
        const r = item.step();
        this.sfx('step_ice', entry);
        this.sfx(r.sound, entry, { gain: -1 });
        this.particles.burst('sparkles', entry.x, entry.y, entry.z, { colors: r.fx.colors, count: 8 });
        this.label(item, entry);
        pet.expr('wide', 'o', 0.9);
        await pet.slide(target, 0.75);
        this.brain.heard(r.sound);
        await this.landOn(to, { quiet: true });
      } else {
        const p = pet.hop(target, { height: rand(0.26, 0.36), dur: this.hopDur() });
        this.faceBlend();
        await p;
        await this.landOn(to, {});
      }
    }
    b.arrived(to);
    this.lastProgressT = this.time;
  }

  label(item, pos) {
    const last = this.labelShown.get(item.type) || -1e9;
    if (this.time - last < (this.cfg.labelCooldown || 8)) return;
    this.labelShown.set(item.type, this.time);
    const s = this.toScreen(pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
    if (s.visible) this.hud.floatLabel(`${item.meta.label}～`, s.x, s.y);
  }

  /** 落地反馈：声音 + 特效 + 物件形变 + 糯糯的小反应 */
  async landOn(id, o = {}) {
    const w = this.world, pet = this.pet, cell = w.cell(id);
    const pos = pet.root.position.clone();
    pet.setGround(w.cellTop(id));
    w.pressTile(id, o.fromJump ? 1.8 : 1);
    pet.sinkTarget = 0;
    const item = w.items.get(id);
    if (w.springs && w.springs.has(id) && !o.repeat) { w.bounceSpring(id); this.sfx('spring_pad', pos, { gain: -8 }); }
    if (o.fromJump) this.sfx('land', pos, { gain: 2 });

    if (item && item.available && !o.quiet) {
      const r = item.step();
      const meta = item.meta;
      this.brain.heard(r.sound);
      this.sfx(r.sound, pos, { note: r.note });
      const fx = r.fx || {};
      if (fx.preset) this.particles.burst(fx.preset, pos.x, w.cellTop(id), pos.z, { colors: fx.colors, floor: w.cellTop(id) });
      if (!o.repeat) this.label(item, pos);
      switch (r.react) {
        case 'squish':
          pet.sinkTarget = meta.sink || 0.04;
          if (meta.sink > 0.09 && Math.random() < 0.3) pet.expr('happy', 'cat', 0.8);
          await this.wait(0.16);
          break;
        case 'bounce': {
          // Q 弹的东西会把糯糯再弹起来一次
          pet.expr('happy', 'open', 1.0);
          await this.wait(0.04);
          await pet.bounceInPlace(0.5, 0.44);
          item.step();
          this.sfx(r.sound, pet.root.position, { gain: -4, rate: 1.05 });
          if (Math.random() < 0.25) this.sfx('v_happy', pet.root.position, { gain: -3 });
          break;
        }
        case 'crunch':
          if (Math.random() < 0.15) { pet.expr('wide', 'o', 0.7); }
          await this.wait(0.14);
          break;
        case 'pop':
          this.particles.burst('ring', pos.x, w.cellTop(id), pos.z, { colors: ['#ffffff'] });
          pet.expr('wide', 'o', 0.6);
          await this.wait(0.1);
          break;
        case 'splash':
          this.particles.burst('ring', pos.x, w.cellTop(id), pos.z, { colors: ['#e8fbff'] });
          await this.wait(0.12);
          break;
        case 'chime':
          this.particles.burst('notes', pos.x, pos.y, pos.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff'], count: 1 });
          await this.wait(0.08);
          break;
        case 'crinkle':
        case 'fizz':
          await this.wait(0.22);
          break;
        case 'sticky':
          pet.expr('closed', 'o', 0.8);
          await pet.idleAction('wiggle', 0.6);
          break;
        case 'multipop': {
          // 气泡膜：踮着小脚噼里啪啦踩一串
          const n = 3 + Math.floor(Math.random() * 4);
          pet.expr('happy', 'open', n * 0.3);
          for (let k = 0; k < n; k++) {
            await pet.bounceInPlace(0.1, 0.17);
            if (!item.popDome()) break;
            this.sfx('bubble_wrap', pet.root.position, { gain: rand(-2, 1), force: true });
            this.particles.burst('sparkles', pos.x, w.cellTop(id), pos.z, { colors: ['#e6f6ff'], count: 3, scale: 0.6 });
            await this.wait(rand(0.02, 0.14));
          }
          break;
        }
        default:
          await this.wait(0.1);
      }
      // 物件被踩碎/踩破后，回落到砖面
      const sp = w.standPoint(id);
      if (pet.root.position.y - sp.y > 0.03) await pet.hop(sp, { height: 0.04, dur: 0.16, anticipation: 0 });
    } else if (!o.quiet) {
      const surf = this.theme.surfaces.find((s) => s.id === cell.surface) || this.theme.surfaces[0];
      this.sfx(surf.step, pos, { gain: o.fromJump ? 3 : 0 });
      await this.wait(0.04);
    }

    // 星星 / 钥匙
    if (cell.star && w.collectStar(id)) {
      const sp = w.starObjs.get(id).position;
      this.sfx('star_collect', sp);
      this.particles.burst('stars', sp.x, sp.y - 0.3, sp.z, { colors: ['#ffd84d', '#fff3a8', '#ffffff'] });
      this.hud.setLevel({ n: this.levelNo, name: this.theme.name, stars: w.collectedStars.size, needKey: this.level.keyId != null, hasKey: w.hasKey });
      pet.expr('happy', 'open', 1.2);
      if (Math.random() < 0.6) this.sfx('v_yay', pos, { gain: -2 });
      this.brain.cheer(0.25);
      await pet.idleAction('celebrate', 0.8);
    }
    if (cell.key && w.collectKey()) {
      this.sfx('key_get', pos);
      this.particles.burst('sparkles', pos.x, pos.y + 1, pos.z, { colors: ['#ffd23f', '#ffffff'] });
      this.hud.setLevel({ n: this.levelNo, name: this.theme.name, stars: w.collectedStars.size, needKey: true, hasKey: true });
      pet.expr('happy', 'open', 1.2);
      this.sfx('v_happy', pos);
      this.hud.say('拿到钥匙啦～');
      await pet.idleAction('celebrate', 1.0);
      this.hud.unsay();
    }
  }

  async doRepeat(times) {
    const id = this.brain.cur;
    for (let i = 0; i < times; i++) {
      if (this.gifts.ready.length) break;
      await this.wait(rand(0.12, 0.35));
      await this.pet.bounceInPlace(rand(0.18, 0.3), 0.36);
      await this.landOn(id, { repeat: true });
    }
  }

  async doIdle(kind, secs) {
    const pet = this.pet, p = pet.root.position;
    switch (kind) {
      case 'look': pet.expr('open', 'cat'); break;
      case 'sniff': if (Math.random() < 0.4) this.sfx('v_curious', p, { gain: -4 }); break;
      case 'wiggle': pet.expr('happy', 'open', secs); if (Math.random() < 0.5) this.sfx('v_happy', p, { gain: -3 }); break;
      case 'sit': pet.expr('half', 'cat', secs); if (this.brain.mood.energy < 0.45) this.particles.burst('zzz', p.x + 0.3, p.y + 1.0, p.z); break;
      case 'yawn': pet.expr('closed', 'open', secs); this.sfx('v_sleepy', p, { gain: -3 }); break;
      case 'tilt': this.particles.burst('emote', p.x, p.y + 1.35, p.z, { kind: 'question' }); this.sfx('v_curious', p, { gain: -4 }); break;
      default: break;
    }
    pet.face(Math.sin(this.time) * 0.4);
    await pet.idleAction(kind, secs);
  }

  async doGateLocked() {
    const pet = this.pet, p = pet.root.position;
    const g = this.world.gateObj.position;
    pet.faceTowards(g.x, g.z);
    this.particles.burst('emote', p.x, p.y + 1.35, p.z, { kind: 'question' });
    this.sfx('v_curious', p);
    this.hud.say('门锁住了…钥匙在哪里呢？');
    await pet.idleAction('tilt', 1.6);
    await pet.idleAction('look', 1.4);
    this.hud.unsay();
    this.brain.onGateLocked();
  }

  async doOpenGate() {
    const pet = this.pet, g = this.world.gateObj.position;
    pet.faceTowards(g.x, g.z);
    await pet.idleAction('wiggle', 0.6);
    this.world.openGate();
    this.sfx('gate_open', g);
    this.particles.burst('sparkles', g.x, g.y + 0.6, g.z, { colors: ['#ffd23f', '#ff8fb3', '#ffffff'], count: 18 });
    this.hud.setLevel({ n: this.levelNo, name: this.theme.name, stars: this.world.collectedStars.size, needKey: true, hasKey: false });
    await this.wait(1.0);
    this.brain.onGateOpened();
  }

  // ---------------- 直播互动 ----------------
  onLive(ev) {
    switch (ev.type) {
      case 'gift': {
        const info = this.gifts.add(ev);
        this.hud.toast(`${info.name} 送出 ${info.giftName} ×${info.count}`, 'gift');
        const p = this.pet.root.position;
        this.particles.burst('hearts', p.x, p.y + 0.8, p.z, { colors: ['#ff8fb3', '#ff6fa3'], count: 3 });
        break;
      }
      case 'like': {
        this.hud.addLikes(Number(ev.count) || 1);
        if (this.time - this.lastLikeFx > 1.4) {
          this.lastLikeFx = this.time;
          const p = this.pet.root.position;
          this.particles.burst('hearts', p.x, p.y + 0.9, p.z, { colors: ['#ff8fb3', '#ffb3d1', '#ff6fa3'], count: 2 + Math.min(4, Math.floor((ev.count || 1) / 5)) });
          this.sfx('heart_pop', p, { gain: -10 });
        }
        break;
      }
      case 'follow': {
        const name = escapeText(ev.user?.name, 12);
        this.hud.toast(`欢迎 ${name} 关注糯糯～`, 'follow');
        if (this.pendingWaves.length < 2) this.pendingWaves.push(name);
        break;
      }
      case 'enter': {
        if (this.cfg.showEnter === false) break;
        if (this.time - (this._lastEnter || -1e9) < (this.cfg.enterInterval || 10)) break;
        this._lastEnter = this.time;
        this.hud.toast(`欢迎 ${escapeText(ev.user?.name, 12)} 来看糯糯～`, 'enter', 4000);
        break;
      }
      default: break;
    }
  }

  async serviceInterrupts() {
    for (let k = 0; k < 30; k++) {
      const ev = this.gifts.next();
      if (!ev) break;
      await this.thankDance(ev);
    }
    if (this.pendingWaves.length && this.time - this.lastWave > 12 && !this.dancing) {
      const name = this.pendingWaves.shift();
      this.lastWave = this.time;
      this.pet.face(0);
      this.pet.expr('happy', 'open', 1.6);
      this.hud.say(`谢谢 ${name} 的关注～`);
      this.sfx('v_happy', this.pet.root.position);
      await this.pet.idleAction('wave', 1.6);
      this.hud.unsay();
    }
  }

  _pickDance(big) {
    if (this.__forceDance) { const f = DANCES.find((d) => d.id === this.__forceDance); if (f) return f; }
    let pool = DANCES.filter((d) => !this.recentDances.includes(d.id));
    if (!big) pool = pool.filter((d) => !d.big || Math.random() < 0.3);
    if (!pool.length) pool = DANCES;
    const d = big && Math.random() < 0.5 ? (pool.find((x) => x.big) || pick(pool)) : pick(pool);
    this.recentDances.push(d.id);
    if (this.recentDances.length > 5) this.recentDances.shift();
    return d;
  }

  // 跳舞特写时，选一个前面没有星星/钥匙/大物件挡住糯糯的镜头角度
  _clearDanceAngle() {
    const p = this.pet.root.position;
    const head = new THREE.Vector3(p.x, p.y + 0.75, p.z);
    const occ = [];
    if (this.world) {
      for (const g of this.world.starObjs.values()) if (g.visible) occ.push(g.position);
      if (this.world.keyObj && this.world.keyObj.visible) occ.push(this.world.keyObj.position);
      if (this.world.gateObj) occ.push(this.world.gateObj.position.clone().setY(this.world.gateObj.position.y + 0.6));
      if (this.world.portal) occ.push(this.world.portal.position);
      for (const it of this.world.items.values()) if (it.meta.h > 0.2 || it.built.float) occ.push(it.obj.position.clone().setY(it.obj.position.y + 0.3));
      for (const pr of this.level.props) if (pr.s > 0.75) occ.push(new THREE.Vector3(pr.x, 0.8 * pr.s, pr.z));
    }
    const seg = new THREE.Line3();
    const tmp = new THREE.Vector3();
    for (const az of [0, 0.45, -0.45, 0.85, -0.85]) {
      const cam = head.clone().add(new THREE.Vector3(0, 2.0, 5.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), az));
      seg.set(cam, head);
      let ok = true;
      for (const o of occ) {
        if (o.distanceTo(head) < 0.5) continue; // 就在脚下的物件不算
        seg.closestPointToPoint(o, true, tmp);
        if (tmp.distanceTo(o) < 0.75) { ok = false; break; }
      }
      if (ok) return az;
    }
    return 0;
  }

  async thankDance(ev) {
    const tier = TIERS[ev.tier] || TIERS[0];
    const pet = this.pet;
    this.dancing = true;
    this.gifts.danceStarted();
    const prevMode = this.camMode;
    this.camMode = 'dance';
    this.danceAz = this._clearDanceAngle();
    pet.face(this.danceAz);
    pet.sinkTarget = 0;
    const names = ev.users.length > 1 ? `${ev.users.slice(0, 3).join('、')}${ev.users.length > 3 ? ` 等${ev.users.length}位` : ''}` : ev.user;
    const boss = (n) => (/老板$/.test(n) ? n : `${n} 老板`);
    const line1 = ev.users.length > 1 ? `谢谢 ${names} 老板们！` : `谢谢 ${boss(names)}！`;
    const giftLine = ev.group ? `${ev.users.length} 位老板的礼物` : `${ev.gift} ×${ev.count}`;
    this.hud.showThanks(line1, `${giftLine} · ${pick(DANCE_SUFFIX)}`, !!tier.superBanner);
    this.hud.say(pick(THANK_LINES));
    const p = pet.root.position;
    this.sfx('gift_sparkle', p);
    this.sfx('v_thanks', p, { delay: 0.25 });
    this.particles.burst('hearts', p.x, p.y + 0.9, p.z, { colors: ['#ff6fa3', '#ff8fb3', '#ffb3d1'], count: 6 + ev.tier * 3 });
    if (tier.confetti) this.particles.burst('confetti', p.x, p.y + 1.2, p.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b', '#c9a0ff'], count: 50, floor: this.pet.groundY });
    if (tier.crown) { pet.setCrown(true); this.crownUntil = this.time + 90; }
    pet.expr('happy', 'open', 1.2);
    await pet.idleAction('celebrate', 0.7);
    for (let k = 0; k < tier.dances; k++) {
      const d = this._pickDance(ev.tier >= 2);
      this.hud.updateThanksSub(`${giftLine} · 糯糯跳「${d.name}」`);
      const bpm = Math.round(rand(104, 120));
      this.audio.startMusic({ bpm, seconds: tier.secs + 0.2, energy: 1 + ev.tier * 0.4 });
      await pet.dance(d, tier.secs, bpm);
      if (tier.confetti && k === tier.dances - 1) this.particles.burst('confetti', p.x, p.y + 1.2, p.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff'], count: 30, floor: this.pet.groundY });
    }
    this.audio.stopMusic(0.4);
    this.hud.say(ev.tier >= 2 ? '老板最棒啦！♥' : pick(THANK_LINES));
    await pet.idleAction('wave', 1.0);
    this.hud.hideThanks();
    this.hud.unsay();
    this.gifts.danceEnded();
    this.dancing = false;
    this.camMode = prevMode === 'dance' ? 'follow' : prevMode;
    this.lastProgressT = this.time;
  }

  // ---------------- 音效辅助 ----------------
  sfx(id, pos, o = {}) {
    if (!pos) return this.audio.play(id, o);
    const v = pos.clone().project(this.camera);
    const pan = clamp(v.x, -1, 1);
    const dist = clamp(pos.distanceTo(this.camera.position) / 22, 0, 1) * 0.7;
    return this.audio.play(id, { pan, dist, ...o });
  }

  toScreen(pos) {
    const v = pos.clone().project(this.camera);
    const el = this.renderer.domElement;
    return { x: (v.x + 1) / 2 * el.clientWidth, y: (1 - v.y) / 2 * el.clientHeight, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  // ---------------- 每帧 ----------------
  update(dt) {
    this.time += dt;
    this.timers.update(dt);
    this.gifts.update(dt);
    if (this.brain && this.state === 'play' && !this.dancing) this.brain.tick(dt);
    if (this.pet) this.pet.update(dt);
    if (this.crownUntil && this.time > this.crownUntil && !this.dancing) { this.pet.setCrown(false); this.crownUntil = 0; }
    this.updateCamera(dt);
    if (this.world) this.world.update(dt, this.pet.root.position, this.camera.position);
    if (this.theme) {
      const pt = this.theme.particles;
      if (pt) this.particles.ambient(pt.type, this.camTarget.x, this.camTarget.z, dt, { rate: pt.rate, colors: pt.colors });
    }
    this.particles.update(dt);
    this.audio.update();
    // 气泡跟随糯糯头顶
    if (this.pet) {
      const head = this.pet.root.position.clone().add(new THREE.Vector3(0, 1.45 + (this.pet.extraAccessory ? 0.25 : 0), 0));
      const s = this.toScreen(head);
      this.hud.placeBubble(s.x, s.y);
    }
  }

  updateCamera(dt) {
    const p = this.pet.root.position;
    const portrait = this.hud.portrait;
    const t = this.time;
    let off, look;
    if (this.__camOverride) {
      off = this.__camOverride.off.clone();
      look = new THREE.Vector3(p.x, p.y + this.__camOverride.lookY, p.z);
    } else if (this.camMode === 'dance') {
      off = (portrait ? new THREE.Vector3(0, 3.0, 6.0) : new THREE.Vector3(0, 2.7, 5.0)).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.danceAz || 0);
      look = new THREE.Vector3(p.x, p.y + 0.75, p.z);
    } else if (this.camMode === 'intro') {
      off = portrait ? new THREE.Vector3(-1, 8, 11) : new THREE.Vector3(-1.5, 6.5, 9.5);
      look = new THREE.Vector3(p.x + 1, p.y + 0.4, p.z);
    } else {
      off = portrait ? new THREE.Vector3(-0.6, 6.8, 8.8) : new THREE.Vector3(-0.7, 4.6, 7.0);
      look = new THREE.Vector3(p.x + (portrait ? 0.6 : 1.2), 0.5 + p.y * 0.3, p.z - 0.3);
    }
    // 缓慢的镜头呼吸感
    const sway = Math.sin(t * 0.05) * 0.14;
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), sway);
    off.y += Math.sin(t * 0.07) * 0.2;
    const lambda = this.camMode === 'intro' ? 1.2 : this.camMode === 'dance' ? 2.6 : 2.2;
    this.camTarget.x = damp(this.camTarget.x, look.x, lambda, dt);
    this.camTarget.y = damp(this.camTarget.y, look.y, lambda, dt);
    this.camTarget.z = damp(this.camTarget.z, look.z, lambda, dt);
    const want = look.clone().add(off);
    this.camPos.x = damp(this.camPos.x, want.x, lambda, dt);
    this.camPos.y = damp(this.camPos.y, want.y, lambda, dt);
    this.camPos.z = damp(this.camPos.z, want.z, lambda, dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  status() {
    return {
      state: this.state, level: this.levelNo, theme: this.theme?.id, dancing: this.dancing,
      queued: this.gifts.queued, stars: this.world ? this.world.collectedStars.size : 0, levelsPlayed: this.levelsPlayed,
    };
  }

  // 控制台指令
  command(c) {
    if (c.cmd === 'skip' && this.brain) this.brain.elapsed = 1e9;
    if (c.cmd === 'reload') location.reload();
    if (c.cmd === 'volume') this.audio.setVolumes(c.volumes || {});
    if (c.cmd === 'dance') this.gifts.ready.push({ users: ['测试老板'], user: '测试老板', gift: '小心心', count: 1, value: 1, tier: Number(c.tier) || 0, at: this.gifts.now });
  }
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
