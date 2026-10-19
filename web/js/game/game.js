// 游戏主控：解压世界循环、糯糯在每个解压站上的玩法执行、真实录音 ASMR 反馈、礼物答谢舞蹈与礼物特效、弹幕互动、镜头。
import * as THREE from 'three';
import { STAGES, stageById, soundsForStage } from '../course/stages.js';
import { Course, PATH_Y } from '../course/course.js';
import { Director } from '../ai/director.js';
import { Pet } from '../pet/pet.js';
import { DANCES } from '../pet/dances.js';
import { GiftManager, TIERS } from './giftManager.js';
import { Rng, Timers, clamp, damp, rand, pick, escapeText } from '../core/util.js';
import { textPoints } from './textPoints.js';

const THANK_LINES = ['谢谢老板～♥', '老板大气！', '比心心～', '爱你哟～', '啾咪～', '谢谢宝～', '老板万福！', '最喜欢你啦～'];
const DANCE_SUFFIX = ['糯糯给你跳支舞～', '糯糯开心到转圈圈～', '收到啦，比心心！', '老板发财，天天开心～'];
const COMMON_SOUNDS = ['land_soft', 'path_step', 'purr', 'music_dance'];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Game {
  constructor({ renderer, scene, camera, audio, hud, particles, petMats, cfg, onStatus }) {
    Object.assign(this, { renderer, scene, camera, audio, hud, particles, petMats, cfg });
    this.onStatus = onStatus || (() => {});
    this.timers = new Timers();
    this.gifts = new GiftManager(cfg.gifts || {});
    this.rng = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
    this.director = new Director(this.rng, { stageSeconds: cfg.stageSeconds || 210 });
    this.stageNo = Number(safeGet('nuonuo.stage')) || 0;
    this.totalSteps = Number(safeGet('nuonuo.steps')) || 0;
    this.stageQueue = [];
    this.lastStage = null;
    this.state = 'boot';
    this.dancing = false;
    this.camTarget = V(0, 0.4, 0);
    this.camPos = V(0, 4, 8);
    this.camMode = 'wide';
    this.recentDances = [];
    this.pendingWaves = [];
    this.lastWave = -1e9;
    this.lastLikeFx = 0;
    this.crownUntil = 0;
    this.giantUntil = 0;
    this.time = 0;
    this.stagesPlayed = 0;
    this.stageSteps = 0;
    this.startedAt = performance.now();
    this.lastProgressT = 0;
    this.focus = null; // 镜头关注的站点
  }

  wait(s) { return this.timers.wait(s); }

  async init() {
    this.pet = new Pet(this.petMats);
    this.scene.add(this.pet.root);
    this.scene.add(this.pet.shadow);
    this.pet.onDanceEvent = (ev, pet) => {
      const p = pet.root.position;
      if (ev.sound === 'land') this.sfx('land_soft', p, { gain: -4 });
      if (ev.fx) this.particles.burst(ev.fx, p.x, p.y + 0.9, p.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#ffffff'] });
    };
    this.hud.setSteps(this.totalSteps);
    this.hud.setAttribution(this.audio.attribution);
    await this.audio.ensure(COMMON_SOUNDS.filter((id) => id !== 'music_dance'));
    this.loop();
  }

  // ---------------- 世界循环（永不停止） ----------------
  async loop() {
    for (;;) {
      try {
        await this.loadStage();
        await this.intro();
        await this.playCourse();
        await this.outro();
      } catch (err) {
        console.error('[game] 本关出错，自动进入下一关', err);
        this.onStatus({ type: 'error', message: String(err && err.stack || err) });
        await sleepReal(1500);
      }
      this.stagesPlayed++;
      const hours = (performance.now() - this.startedAt) / 3.6e6;
      if (this.cfg.reloadHours > 0 && hours > this.cfg.reloadHours) {
        // 刷新前先把已经收到、还没答谢的礼物谢完（刷新后服务器不会重发它们）。
        // 通关时画面已经合上，先打开，让观众看到答谢
        if (this.gifts.queued > 0) await this.hud.irisTo(false, 600);
        for (let k = 0; k < 90 && this.gifts.queued > 0; k++) { await this.serviceInterrupts(null); await this.wait(1); }
        location.reload(); await sleepReal(10000);
      }
    }
  }

  _allowedStages() {
    const ids = this.cfg.stages && this.cfg.stages.length ? this.cfg.stages : STAGES.map((s) => s.id);
    const list = STAGES.filter((s) => ids.includes(s.id));
    return list.length ? list : STAGES;
  }

  async loadStage() {
    this.state = 'loading';
    this.dancing = false;
    this.hud.hideThanks();
    this.hud.unsay();
    this.audio.stopMusic(0.1);
    this.pet.cancelAction();
    this.pet.root.scale.setScalar(1);
    this.giantUntil = 0;
    this.skipRequested = false;
    if (this.course) { this.course.dispose(); this.course = null; }
    this.particles.clear();
    this.stageNo++;
    safeSet('nuonuo.stage', String(this.stageNo));
    const allowed = this._allowedStages();
    const pickNext = this.director.nextStage(allowed, this.lastStage, this.stageQueue);
    const stage = stageById(pickNext.id);
    this.voted = pickNext.votes;
    this.lastStage = stage.id;
    this.stage = stage;
    this.course = new Course(this.scene, stage, { seed: this.rng.int(1, 1e9), shadowSize: this.cfg.shadowSize || 2048 }).build();
    this.renderer.toneMappingExposure = stage.exposure ?? 1.0;
    this.director.beginStage(stage, this.course.stations);
    const ids = [...soundsForStage(stage), ...COMMON_SOUNDS];
    this.audio.prune(ids);
    await this.audio.ensure(ids.filter((id) => id !== 'music_dance'));
    this.audio.setAmbience(stage.ambience, stage.ambienceGain || 0);
    this.pet.setAccessory(stage.accessory);
    if (this.time > this.crownUntil) this.pet.setCrown(false);
    this.stageSteps = 0;
    this.hud.setStage({ n: this.stageNo, name: stage.name, stations: this.course.stations.map((s) => s.def.label) });
    this.hud.setMeter(0);
    this.hud.setVotes(null);
    const p = this.course.start;
    this.pet.root.position.copy(p);
    this.pet.setGround(PATH_Y);
    this.pet.face(Math.PI / 2);
    this.pet.sinkTarget = 0;
    this.camMode = 'wide';
    this.wideT = 0;
    this.camTarget.set(this.course.length * 0.35, 0.3, 0);
    this.camPos.copy(this.camTarget).add(V(-3, 7, 12));
    this.lastProgressT = this.time;
    this.onStatus({ type: 'level', level: this.stageNo, theme: stage.id });
  }

  async intro() {
    this.state = 'intro';
    await this.hud.irisTo(false, 1000);
    const title = this.hud.showTitle(this.stageNo, this.stage.name, this.voted ? `观众投票选出的世界（${this.voted} 票）～ ${this.stage.subtitle}` : this.stage.subtitle, 3.4);
    // 远景：先看看整条赛道
    this.camMode = 'wide';
    await this.wait(2.6);
    const p = this.pet.root.position;
    this.particles.burst('poof', p.x, p.y, p.z, { colors: ['#ffffff', '#ffe3f1'] });
    this.sfx('land_soft', p, { gain: -2 });
    this.pet.sq.x = 0.6;
    this.camMode = 'follow';
    this.pet.expr('happy', 'open', 1.6);
    await this.pet.idleAction('celebrate', 1.2);
    await title;
  }

  async outro() {
    this.state = 'outro';
    const pet = this.pet;
    this.camMode = 'follow';
    await this.walkTo(this.course.end, { stepDur: 0.42, stride: 0.3 });
    pet.face(0.2);
    pet.expr('happy', 'open', 3);
    this.camMode = 'face';
    this.hud.setMeter(1);
    const p = pet.root.position;
    this.particles.burst('confetti', p.x, p.y + 1.2, p.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b', '#c9a0ff'], count: 40, floor: PATH_Y });
    this.hud.toast(`「${this.stage.name}」通关！本关踩了 ${this.stageSteps} 脚，解压度 100% ✨`, 'follow', 5000);
    await pet.idleAction('celebrate', 1.4);
    await pet.idleAction('wave', 1.2);
    // 下一关投票提示
    const next = this._allowedStages().filter((s) => s.id !== this.stage.id);
    this.hud.setVotes(null);
    if (next.length) this.hud.say('下一关想去哪里？弹幕告诉糯糯～');
    await this.wait(1.6);
    this.hud.unsay();
    await this.hud.irisTo(true, 900);
  }

  // ---------------- 一条赛道 ----------------
  async playCourse() {
    this.state = 'play';
    const n = this.course.stations.length;
    for (let i = 0; i < n; i++) {
      const s = this.course.stations[i];
      // 在两站之间的软垫上处理礼物（传入刚完成的那一站，不会提前"用掉"下一站）
      await this.serviceInterrupts(i > 0 ? this.course.stations[i - 1] : null);
      if (this.skipRequested) break;
      this.hud.setStation(i, s.def.label);
      this.focus = s;
      try {
        if (s.finale) await this.runFinale(s);
        else await this.runStation(s, i);
      } catch (err) {
        console.error('[game] 站点出错，跳过', err);
        this.onStatus({ type: 'error', message: String(err && err.stack || err) });
      }
      s.done = true;
      this.hud.setMeter(this.course.progress());
      this.lastProgressT = this.time;
    }
    await this.serviceInterrupts(null);
    this.focus = null;
  }

  // 这个站还值得继续玩吗（被跳过、被礼物连锁清空、泡泡全按完了、名字刚印上去）
  stationOver(s) {
    return this.skipRequested || s.exhausted || s.nameStamped || (s.remaining && s.remaining().length === 0);
  }

  async runStation(s, idx) {
    const pet = this.pet, d = this.director;
    const plan = d.planStation(s, idx);
    if (s.blocks || s.items) return this.runHopStation(s, plan);
    // 走到站点入口（软垫小路）
    this.camMode = 'follow';
    await this.walkTo(V(s.x0 - 0.32, 0, plan.lanes[0]), { stepDur: 0.42, stride: 0.3 });
    this.camMode = 'macro';
    if (plan.peek) {
      // 期待感：先低头看一看这块新材质
      pet.expr('wide', 'o', 1.2);
      await pet.idleAction('peek', 0.9);
    }
    this.hud.floatStation(s.def.label);
    const pad = 0.24;
    for (let k = 0; k < plan.lanes.length; k++) {
      // 车道按糯糯当前的大小收窄（巨人模式下两只脚也都踩在托盘里）
      const zMax = s.width / 2 - 0.19 * pet.root.scale.x - 0.08;
      const z = clamp(plan.lanes[k], -zMax, zMax);
      const fwd = k % 2 === 0;
      const xa = fwd ? s.x0 + pad : s.x1 - pad, xb = fwd ? s.x1 - pad : s.x0 + pad;
      // 换到这一趟的起点（第一趟是迈进站点，之后是在一头横着挪到下一条车道）
      await this.walkTo(V(xa, 0, z), { gait: plan.gait, stepDur: plan.stepDur * 0.9, stride: plan.stride, power: plan.power * 0.8, station: s });
      await this.walkTo(V(xb, 0, z), { gait: plan.gait, stepDur: plan.stepDur, stride: plan.stride, power: plan.power, station: s });
      if (plan.special && k === plan.specialAfter) await this.doSpecial(s, plan.special, plan);
      if (plan.knead && k === plan.kneadAfter) await this.doKnead(s, plan);
      const req = d.takeRequest();
      if (req) await this.doRequest(s, req);
      await this.serviceInterrupts(s);
      if (this.stationOver(s)) break;
      if (this.time - this.lastProgressT > 120) break; // 保险：一个站最多玩两分钟
    }
    if (plan.lookback) {
      // 回头看看自己留下的一串脚印
      this.camMode = 'trail';
      pet.expr('happy', 'cat', 1.6);
      await pet.idleAction('lookback', 1.6);
      pet.face(Math.PI / 2);
    }
    this.celebrateStation(s);
    // 走出站点
    this.camMode = 'follow';
    const exitX = Math.min(s.x1 + 0.34, this.course.end.x);
    await this.walkTo(V(exitX, 0, 0), { stepDur: 0.45, stride: 0.3 });
  }

  // 一块一块的解压物（果冻、慢回弹捏捏）：跳上去踩，而不是走过去
  async runHopStation(s, plan) {
    const pet = this.pet;
    const objs = (s.blocks || s.items).slice().sort((a, b) => a.x - b.x);
    this.camMode = 'follow';
    await this.walkTo(V(s.x0 - 0.32, 0, 0), { stepDur: 0.42, stride: 0.3 });
    this.camMode = 'macro';
    if (plan.peek) { pet.expr('wide', 'o', 1.2); await pet.idleAction('peek', 0.9); }
    this.hud.floatStation(s.def.label);
    const jelly = !!s.blocks;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      const z = rand(-0.08, 0.08);
      await this.hopLocal(s, o.x - 0.05, z, { height: 0.32, dur: 0.5 });
      this.onFootLanded(s, plan.power);
      await this.wait(jelly ? 0.35 : 0.9);
      if (jelly) {
        // 在果冻上再弹两下
        for (let k = 0; k < 2; k++) {
          await this.hopLocal(s, o.x - 0.05 + rand(-0.06, 0.06), z, { height: 0.22 + k * 0.06, dur: 0.42 });
          this.onFootLanded(s, plan.power);
          await this.wait(0.3);
        }
      } else {
        // 慢回弹：踩一下、等它慢慢鼓回来，再踩一下
        await this.walkTo(this.course.world(s, o.x + 0.12, z + 0.1), { stepDur: 1.1, stride: 0.2, power: 0.6, station: s });
        await this.wait(0.8);
      }
      if (plan.special && i === Math.min(objs.length - 1, plan.specialAfter)) await this.doSpecial(s, plan.special, plan);
      if (plan.knead && i === objs.length - 1) await this.doKnead(s, plan);
      const req = this.director.takeRequest();
      if (req) await this.doRequest(s, req);
      await this.serviceInterrupts(s);
      if (this.stationOver(s)) break;
    }
    this.celebrateStation(s);
    this.camMode = 'follow';
    const exit = Math.min(s.x1 + 0.34, this.course.end.x);
    const to = V(exit, PATH_Y, 0);
    await pet.hop(to, { height: 0.3, dur: 0.5 });
    pet.setGround(PATH_Y);
    this.sfx('land_soft', to, { gain: -6, main: false });
  }

  // 终点：巨型解压物，玩得更久、更尽兴
  async runFinale(s) {
    const pet = this.pet;
    this.camMode = 'follow';
    await this.walkTo(V(s.x0 - 0.4, 0, 0), { stepDur: 0.42, stride: 0.3 });
    this.camMode = 'finale';
    pet.expr('wide', 'open', 1.5);
    this.hud.say(`哇！是${s.def.label}！`);
    if (this.cfg.chatCommands !== false) this.hud.toast('这关快结束啦～弹幕打「雪 / 落叶 / 史莱姆 / 水洼 / 沙滩 / 键盘」投票下一关', 'enter', 7000);
    await pet.idleAction('peek', 1.0);
    this.hud.unsay();
    await this.serviceInterrupts(s);
    if (this.skipRequested) return;
    const cx = s.length / 2;
    const type = s.def.type;
    if (type === 'soft' || type === 'squishy') {
      // 跳上去 → 踩奶 → 弹一弹 → 一屁股坐下去
      await this.hopLocal(s, cx - 0.2, 0, { height: 0.55, dur: 0.6 });
      this.onFootLanded(s, 1);
      await this.doKnead(s, { count: 6 });
      for (let k = 0; k < 3; k++) {
        await this.hopLocal(s, cx + (k - 1) * 0.25, rand(-0.15, 0.15), { height: 0.35 + k * 0.06, dur: 0.5 });
        this.onFootLanded(s, 1);
        await this.wait(0.25);
      }
      await this.serviceInterrupts(s);
      await this.doSpecial(s, 'sit', { bliss: true });
      await this.hopLocal(s, s.length - 0.25, 0, { height: 0.5, dur: 0.6 });
    } else if (type === 'crunch') {
      await this.walkTo(this.course.world(s, s.length * 0.35, 0), { gait: 'stomp', stepDur: 0.62, stride: 0.3, power: 0.9, station: s });
      await this.doSpecial(s, 'stomp', {});
      await this.serviceInterrupts(s);
      await this.doSpecial(s, 'sit', { bliss: true });
      await this.walkTo(this.course.world(s, s.length - 0.25, 0.2), { gait: 'stomp', stepDur: 0.62, stride: 0.3, power: 0.9, station: s });
    } else if (type === 'water') {
      for (const z of [-0.45, 0.45]) {
        await this.walkTo(this.course.world(s, 0.3, z), { gait: 'stomp', stepDur: 0.75, stride: 0.3, power: 0.9, station: s });
        await this.walkTo(this.course.world(s, s.length - 0.3, z), { gait: 'stomp', stepDur: 0.75, stride: 0.3, power: 0.9, station: s });
        await this.serviceInterrupts(s);
      }
      await this.doSpecial(s, 'stomp', {});
    } else if (type === 'popit' || type === 'bubblewrap') {
      await this.walkTo(this.course.world(s, 0.3, 0), { gait: 'tiptoe', stepDur: 0.5, stride: 0.22, power: 0.4, station: s });
      await this.doSpecial(s, 'tapdance', {});
      await this.serviceInterrupts(s);
      // 连锁反应：剩下的泡泡一波全按下去
      this.hud.say('最后来个连环啵啵啵～');
      if (s.chain) await s.chain(this.stationApi(s));
      this.hud.unsay();
      await this.walkTo(this.course.world(s, s.length - 0.25, 0), { gait: 'tiptoe', stepDur: 0.5, stride: 0.22, power: 0.4, station: s });
    } else {
      await this.walkTo(this.course.world(s, s.length - 0.25, 0), { gait: 'stomp', stepDur: 0.7, stride: 0.3, power: 0.9, station: s });
    }
    this.celebrateStation(s, true);
    this.camMode = 'follow';
  }

  celebrateStation(s, big = false) {
    // 完成一个站：画面上的小闪光（没有任何"叮"声，不打断 ASMR）
    const c = this.course.world(s, s.length / 2, 0, 0.25);
    this.particles.burst('sparkles', c.x, c.y, c.z, { colors: ['#ffffff', '#fff2a8', '#ffd6e8'], count: big ? 40 : 18 });
    this.hud.stationDone(s.index);
    this.director.cheer(0.08);
  }

  // ---------------- 走路与脚步 ----------------
  walkTo(target, o = {}) {
    const pet = this.pet;
    const from = pet.root.position;
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    if (dist < 0.03) return Promise.resolve();
    const giant = this.time < this.giantUntil;
    const stride = (o.stride || 0.26) * (giant ? 1.6 : 1);
    const steps = Math.max(1, Math.round(dist / stride));
    const stepDur = (o.stepDur || 0.55) * (giant ? 1.25 : 1);
    const gait = giant ? 'stomp' : o.gait || 'normal';
    const to = V(target.x, this.course.yAt(target.x, target.z), target.z);
    return pet.walk(to, {
      steps, stepDur, gait,
      lift: gait === 'stomp' ? 0.13 : gait === 'tiptoe' ? 0.05 : 0.08,
      heavy: gait === 'stomp' ? 1 : 0,
      yAt: (x, z) => this.course.yAt(x, z),
      onStep: (side, wp) => this.onFoot(side, wp, { power: giant ? 1 : o.power ?? 0.5, gait }),
    });
  }

  // 一只脚落地：如果踩在解压站上，就让它留下痕迹并播放对应的真实录音
  onFoot(side, wp, o = {}) {
    const s = this.course.stationAt(wp.x, wp.z, 0.02);
    this.pet.setGround(this.course.yAt(this.pet.root.position.x, this.pet.root.position.z));
    if (!s) {
      this.pet.sinkTarget = 0;
      // 软垫小路：轻轻的脚步声（很小声，只是让节奏连贯）
      if (this.stage.pathSound) this.sfx(this.stage.pathSound, wp, { gain: (this.stage.pathGain || 0) - 2, main: false, maxDur: 0.5 });
      return;
    }
    const lx = clamp(wp.x - s.x0, 0.02, s.length - 0.02), lz = clamp(wp.z, -s.width / 2 + 0.02, s.width / 2 - 0.02);
    const power = clamp((o.power ?? 0.5) + rand(-0.08, 0.08), 0, 1);
    const rot = this.pet.root.rotation.y;
    const fb = s.footstep(lx, lz, side, power, [Math.sin(rot), Math.cos(rot)]) || {};
    this.feedback(s, fb, wp, { gain: o.gait === 'stomp' ? 1.5 : o.gait === 'tiptoe' ? -2 : 0 });
  }

  feedback(s, fb, wp, o = {}) {
    if (fb.sound) {
      // 音量起伏控制在小范围内：有轻重变化，但不会忽然很响
      const gain = clamp((fb.gain || 0) + (o.gain || 0), -5, 2);
      this.sfx(fb.sound, wp, { gain, maxDur: fb.maxDur, rate: fb.rate });
      // 一脚踩破好几个泡泡/踩出好几道裂纹：紧接着再响 1~2 声，像真的"噼里啪啦"一串
      const extra = Math.min(2, Math.max(0, (fb.cluster || 1) - 1));
      for (let k = 0; k < extra; k++) this.sfx(fb.sound, wp, { gain: gain - 3 - k * 2, maxDur: fb.maxDur, main: false, delay: 0.05 + k * 0.07 + Math.random() * 0.04 });
      this.countStep();
    }
    for (const f of fb.fx || []) {
      const p = this.course.world(s, f.x, f.z, f.y);
      this.particles.burst(f.preset, p.x, p.y, p.z, { colors: f.colors, count: f.count, scale: f.scale, floor: p.y - 0.02 });
    }
    this.pet.sinkTarget = fb.sink || 0;
  }

  onFootLanded(s, power = 1) {
    // 跳下来时双脚一起踩
    for (const side of [1, -1]) {
      const wp = this.pet.footWorld(side);
      const lx = clamp(wp.x - s.x0, 0.02, s.length - 0.02), lz = clamp(wp.z, -s.width / 2 + 0.02, s.width / 2 - 0.02);
      const fb = s.footstep(lx, lz, side, power) || {};
      if (side === 1) this.feedback(s, fb, wp, { gain: 1.5 }); else this.pet.sinkTarget = fb.sink || 0;
    }
  }

  countStep() {
    this.totalSteps++;
    this.stageSteps++;
    if (this.totalSteps % 10 === 0) safeSet('nuonuo.steps', String(this.totalSteps));
    this.hud.setSteps(this.totalSteps);
    this.hud.setMeter(this.course.progress());
  }

  // ---------------- 特别动作 ----------------
  stationApi(s) {
    const self = this, pet = this.pet;
    return {
      pet,
      localPos: () => ({ x: pet.root.position.x - s.x0, z: pet.root.position.z }),
      pose: (name, secs) => pet.idleAction({ sit: 'sitdown', reach: 'reach', stretch: 'stretch', bliss: 'bliss' }[name] || name, secs),
      sink: (v) => { pet.sinkTarget = v; },
      sfx: (id, o = {}) => { self.sfx(id, pet.root.position, o); if (o.main !== false) self.countStep(); },
      burst: (preset, x, y, z, o = {}) => { const p = self.course.world(s, x, z, y); self.particles.burst(preset, p.x, p.y, p.z, { floor: p.y - 0.02, ...o }); },
      wait: (t) => self.wait(t),
      hopLocal: (x, z, o) => self.hopLocal(s, x, z, o),
      tapAt: (x, z) => {
        // 让最后落下的那只脚正好踩在目标上：按糯糯当前的朝向和大小算脚的位置；离得远就多走几小步
        const sc = pet.root.scale.x, rot = pet.root.rotation.y, first = pet._nextFoot || 1;
        const foot = (side) => new THREE.Vector3(0.19 * side * sc, 0, 0.14 * sc).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        let steps = 1, off = foot(first);
        for (let it = 0; it < 2; it++) {
          const dist = Math.hypot(s.x0 + x - off.x - pet.root.position.x, z - off.z - pet.root.position.z);
          steps = Math.max(1, Math.round(dist / 0.2));
          off = foot(((steps - 1) % 2 === 0 ? 1 : -1) * first);
        }
        const tx = s.x0 + x - off.x, tz = z - off.z;
        return pet.walk(V(tx, self.course.yAt(tx, tz), tz), { steps, stepDur: steps > 1 ? 0.3 : 0.36, lift: 0.06, gait: 'tiptoe', keepFacing: true, yAt: (a, b) => self.course.yAt(a, b) });
      },
      say: (t) => self.hud.say(t),
      // 糯糯面朝 +x 还是 -x；turn 让它转过身
      dir: () => (Math.sin(pet.facing) >= 0 ? 1 : -1),
      turn: (d) => { pet.face(d > 0 ? Math.PI / 2 : -Math.PI / 2); },
    };
  }

  async hopLocal(s, lx, lz, o = {}) {
    const to = this.course.world(s, lx, lz);
    to.y = this.course.yAt(to.x, to.z);
    await this.pet.hop(to, { height: o.height ?? 0.35, dur: o.dur ?? 0.5, anticipation: 0.12 });
    this.pet.setGround(to.y);
  }

  async doSpecial(s, name, plan = {}) {
    const pet = this.pet;
    if (name === 'knead') return this.doKnead(s, plan);
    this.camMode = name === 'sit' ? 'face' : 'macro';
    if (name === 'sit') pet.face(0.35);
    try { await s.perform(name, this.stationApi(s)); } catch (e) { console.error('[special]', e); }
    if (plan.bliss) await this.bliss(1.6);
    pet.face(Math.PI / 2);
    pet.sinkTarget = 0;
    this.camMode = 'macro';
  }

  // 踩奶：左右小脚轮流按，眯着眼睛，轻轻的呼噜声
  async doKnead(s, plan = {}) {
    const pet = this.pet;
    this.camMode = 'macro';
    pet.face(0.5);
    pet.expr('closed', 'cat', 6);
    const purr = this.sfx('purr', pet.root.position, { gain: -6, main: false });
    this.hud.say(pick(['踩奶奶～', '踩踩踩，好舒服～', '软软的…', '咕噜咕噜～']));
    const count = plan.count || (5 + Math.floor(Math.random() * 3));
    await pet.knead({
      count, pressDur: 0.8,
      onPress: (side, wp) => {
        const lx = clamp(wp.x - s.x0, 0.05, s.length - 0.05), lz = clamp(wp.z, -s.width / 2 + 0.05, s.width / 2 - 0.05);
        const rot = pet.root.rotation.y, hd = [Math.sin(rot), Math.cos(rot)];
        const fb = (s.knead ? s.knead(lx, lz, 0.5, hd) : s.footstep(lx, lz, side, 0.4, hd)) || {};
        this.feedback(s, fb, wp, { gain: -1 });
      },
    });
    this.hud.unsay();
    if (purr) this.audio.stop(purr, 1.2);
    pet.face(Math.PI / 2);
    this.director.cheer(0.05);
  }

  async bliss(secs) {
    const pet = this.pet, p = pet.root.position;
    this.camMode = 'face';
    pet.face(0.25);
    pet.expr('closed', 'cat', secs + 0.3);
    this.particles.burst('hearts', p.x, p.y + 1.0, p.z, { colors: ['#ff8fb3', '#ffb3d1'], count: 2 });
    const purr = this.sfx('purr', p, { gain: -9, main: false, maxDur: secs + 0.6 });
    await pet.idleAction('bliss', secs);
    if (purr) this.audio.stop(purr, 0.8);
    if (Math.random() < 0.5) await pet.idleAction('shiver', 0.5);
  }

  // 弹幕点播
  async doRequest(s, req) {
    const pet = this.pet;
    this.hud.say(req.say);
    switch (req.act) {
      case 'knead': if (s.def.kneadable) await this.doKnead(s, {}); else await this.doSpecial(s, (s.def.specials || ['stomp'])[0], {}); break;
      case 'sit': await this.doSpecial(s, (s.def.specials || []).includes('sit') ? 'sit' : (s.def.specials || ['stomp'])[0], { bliss: true }); break;
      case 'bounce': {
        const lp = this.stationApi(s).localPos();
        for (let k = 0; k < 2; k++) { await this.hopLocal(s, clamp(lp.x + 0.15 * (k + 1), 0.25, s.length - 0.25), lp.z, { height: 0.4, dur: 0.5 }); this.onFootLanded(s, 0.9); await this.wait(0.2); }
        break;
      }
      case 'stomp': {
        const sp = (s.def.specials || []).find((x) => x === 'stomp' || x === 'tapdance' || x === 'bounce');
        if (sp || s.hf || s.pieces) await this.doSpecial(s, sp || 'stomp', {});
        else { const lp = this.stationApi(s).localPos(); await this.hopLocal(s, clamp(lp.x, 0.3, s.length - 0.3), lp.z, { height: 0.42, dur: 0.55 }); this.onFootLanded(s, 1); await this.wait(0.6); }
        break;
      }
      case 'spin': pet.expr('happy', 'open', 1.5); await pet.dance(DANCES.find((x) => x.id === 'spin') || DANCES[0], 2.2, 112); break;
      case 'love': this.camMode = 'face'; pet.face(0.1); pet.expr('happy', 'open', 2); this.particles.burst('hearts', pet.root.position.x, pet.root.position.y + 1, pet.root.position.z, { colors: ['#ff6fa3', '#ff8fb3'], count: 5 }); await pet.idleAction('wiggle', 1.4); break;
      default: break;
    }
    this.hud.unsay();
    pet.face(Math.PI / 2);
    this.camMode = 'macro';
  }

  // ---------------- 直播互动 ----------------
  onLive(ev) {
    switch (ev.type) {
      case 'gift': {
        const info = this.gifts.add(ev);
        this.hud.toast(`${info.name} 送出 ${info.giftName} ×${info.count}`, 'gift');
        const p = this.pet.root.position;
        this.particles.burst('hearts', p.x, p.y + 0.8, p.z, { colors: ['#ff8fb3', '#ff6fa3'], count: 3 });
        this.director.cheer(0.15);
        break;
      }
      case 'like': {
        this.hud.addLikes(Number(ev.count) || 1);
        this.director.cheer(0.01);
        if (this.time - this.lastLikeFx > 1.6) {
          this.lastLikeFx = this.time;
          const p = this.pet.root.position;
          this.particles.burst('hearts', p.x, p.y + 0.9, p.z, { colors: ['#ff8fb3', '#ffb3d1', '#ff6fa3'], count: 2 + Math.min(4, Math.floor((ev.count || 1) / 5)) });
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
      case 'chat': {
        if (this.cfg.chatCommands === false) break;
        const r = this.director.onChat(ev.text, this._allowedStages());
        if (!r) break;
        const name = escapeText(ev.user?.name, 10);
        if (r.kind === 'vote') { this.hud.setVotes(this.director.votes, STAGES); if (this.time - (this._lastVoteToast || -1e9) > 4) { this._lastVoteToast = this.time; this.hud.toast(`${name} 投票：下一关去「${r.stage.name}」`, 'enter', 3500); } }
        else if (r.kind === 'here') { if (this.time - (this._lastVoteToast || -1e9) > 4) { this._lastVoteToast = this.time; this.hud.toast(`${name}：现在就在「${r.stage.name}」啦～`, 'enter', 3000); } }
        else if (r.kind === 'action') this.hud.toast(`${name}：${ev.text.slice(0, 12)} → 糯糯收到！`, 'enter', 3500);
        else if (r.kind === 'pace') this.hud.toast(`${name}：${r.say}`, 'enter', 3000);
        break;
      }
      default: break;
    }
  }

  async serviceInterrupts(s) {
    for (let k = 0; k < 30; k++) {
      const ev = this.gifts.next();
      if (!ev) break;
      await this.thankDance(ev, s);
    }
    if (this.pendingWaves.length && this.time - this.lastWave > 12 && !this.dancing) {
      const name = this.pendingWaves.shift();
      this.lastWave = this.time;
      const prev = this.camMode;
      this.camMode = 'face';
      this.pet.face(0);
      this.pet.expr('happy', 'open', 1.6);
      this.hud.say(`谢谢 ${name} 的关注～`);
      await this.pet.idleAction('wave', 1.6);
      this.hud.unsay();
      this.pet.face(Math.PI / 2);
      this.camMode = prev;
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

  async thankDance(ev, s) {
    const tier = TIERS[ev.tier] || TIERS[0];
    const pet = this.pet;
    this.dancing = true;
    this.gifts.current = ev;
    this.gifts.danceStarted();
    const prevMode = this.camMode;
    this.camMode = 'dance';
    pet.face(0);
    pet.sinkTarget = 0;
    // 集体答谢最多写 2 个名字（每个最多 6 个字），横幅不会超出屏幕
    const short = (n) => (Array.from(n).length > 6 ? Array.from(n).slice(0, 6).join('') + '…' : n);
    const names = ev.users.length > 1 ? `${ev.users.slice(0, 2).map(short).join('、')}${ev.users.length > 2 ? ` 等${ev.users.length}位` : ''}` : ev.user;
    const boss = (n) => (/老板$/.test(n) ? n : `${n} 老板`);
    const line1 = ev.users.length > 1 ? `谢谢 ${names} 老板们！` : `谢谢 ${boss(names)}！`;
    const giftLine = ev.group ? `${ev.users.length} 位老板的礼物` : `${ev.gift} ×${ev.count}`;
    this.hud.showThanks(line1, `${giftLine} · ${pick(DANCE_SUFFIX)}`, !!tier.superBanner);
    this.hud.say(pick(THANK_LINES));
    const p = pet.root.position;
    this.particles.burst('hearts', p.x, p.y + 0.9, p.z, { colors: ['#ff6fa3', '#ff8fb3', '#ffb3d1'], count: 6 + ev.tier * 3 });
    if (tier.confetti) this.particles.burst('confetti', p.x, p.y + 1.2, p.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b', '#c9a0ff'], count: 50, floor: pet.groundY });
    if (tier.crown) { pet.setCrown(true); this.crownUntil = this.time + 90; }
    pet.expr('happy', 'open', 1.2);
    await pet.idleAction('celebrate', 0.7);
    // 真实的可爱舞曲 + 舞步对齐音乐拍子
    const total = tier.dances * tier.secs + 0.6;
    this.audio.duckAmbience(true);
    const music = await this.audio.startMusic('music_dance', total + 0.4);
    const bpm = music ? music.bpm : 112;
    if (music && music.title) this.hud.showMusic(`♪ ${music.title} — ${music.credit || 'Kevin MacLeod (incompetech.com) · CC BY 4.0'}`);
    for (let k = 0; k < tier.dances; k++) {
      const d = this._pickDance(ev.tier >= 2);
      this.hud.updateThanksSub(`${giftLine} · 糯糯跳「${d.name}」`);
      // 当前音乐位置 → 舞步相位；每支舞的时长取整到整拍，连跳几支也不会错拍
      const spb = 60 / bpm;
      const secs = Math.max(spb * 4, Math.round(tier.secs / spb) * spb);
      const off = music ? this.audio.musicTime() - (music.beat0 || 0) : 0;
      await pet.dance(d, secs, bpm, off);
      if (tier.confetti && k === tier.dances - 1) this.particles.burst('confetti', p.x, p.y + 1.2, p.z, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff'], count: 30, floor: pet.groundY });
    }
    this.audio.stopMusic(0.6);
    this.audio.duckAmbience(false);
    this.hud.showMusic('');
    this.hud.say(ev.tier >= 2 ? '老板最棒啦！♥' : pick(THANK_LINES));
    await pet.idleAction('wave', 1.0);
    this.hud.hideThanks();
    this.hud.unsay();
    // 礼物特效（越大的礼物越壮观）
    try {
      const on = s && this.course.stationAt(pet.root.position.x, pet.root.position.z) === s ? s : null;
      if (ev.tier >= 3 && on) await this.giftChain(on, names);
      else if (ev.tier >= 3) await this.startGiant(names);
      else if (ev.tier >= 2) await this.startGiant(names);
      else if (ev.tier >= 1 && s) await this.giftName(s, ev.users.length > 1 ? '老板们' : ev.user);
    } catch (e) { console.error('[gift fx]', e); }
    this.gifts.danceEnded();
    this.gifts.current = null;
    this.dancing = false;
    pet.face(Math.PI / 2);
    this.camMode = prevMode === 'dance' ? 'macro' : prevMode;
    this.lastProgressT = this.time;
  }

  // 中礼物：把老板的名字压进软软的材质里（这一关一直留着）
  async giftName(s, name) {
    // 优先印在刚踩完的软材料上（在身后，不会再被踩乱）；没有的话就印在脚下这一块，印完就离开这一站
    const done = this.course.stations.filter((q) => q.stampText && q.done && !q.nameStamped);
    const here = s && s.stampText && !s.done && this.course.stationAt(this.pet.root.position.x, this.pet.root.position.z) === s ? s : null;
    const target = done.length ? done[done.length - 1] : here;
    if (!target) { await this.startGiantMini(name); return; }
    const text = escapeText(name, 6);
    const pts = textPoints(text, target.length - 0.4, Math.min(0.7, target.width - 0.3));
    if (!pts.length) return;
    const prev = this.camMode;
    this.focus = target;
    this.camMode = 'stamp';
    this.hud.say(`把 ${text} 的名字踩在${target.def.label}上～`);
    const chunk = Math.max(1, Math.ceil(pts.length / 24));
    for (let i = 0; i < pts.length; i += chunk) {
      target.stampText(pts.slice(i, i + chunk).map(([x, z]) => [x + 0.2, z]));
      if (i % (chunk * 4) === 0) this.sfx(target.def.sound.step, this.course.world(target, pts[i][0] + 0.2, pts[i][1]), { gain: -6, maxDur: 0.6, main: false });
      await this.wait(0.06);
    }
    target.nameStamped = true;
    await this.wait(1.4);
    this.hud.unsay();
    this.focus = s;
    this.camMode = prev;
  }

  // 没有可以印名字的软材料时：头顶冒一圈爱心 + 念出名字（不让中礼物的特效落空）
  async startGiantMini(name) {
    const p = this.pet.root.position;
    this.hud.say(`${escapeText(name, 8)} 老板，糯糯爱你～`);
    this.particles.burst('hearts', p.x, p.y + 1.1, p.z, { colors: ['#ff6fa3', '#ff8fb3', '#ffd166'], count: 14 });
    await this.pet.idleAction('celebrate', 1.2);
    this.hud.unsay();
  }

  // 大礼物：巨人模式——糯糯变大 1.8 倍，接下来 30 秒每一脚都超级重
  async startGiant(names) {
    const pet = this.pet, p = pet.root.position;
    if (pet.root.scale.x > 1.1) { this.giantUntil = this.time + 30; return; } // 已经是巨人：延长时间
    this.hud.say('巨人糯糯出动！');
    this.particles.burst('poof', p.x, p.y + 0.4, p.z, { colors: ['#ffffff', '#ffe3f1'], count: 30 });
    for (let i = 0; i <= 20; i++) { pet.root.scale.setScalar(1 + 0.8 * (i / 20) ** 2); await this.wait(0.03); }
    this.giantUntil = this.time + 30;
    this.hud.unsay();
    void names;
  }

  async endGiant() {
    const pet = this.pet;
    this.giantUntil = 0;
    for (let i = 20; i >= 0; i--) { pet.root.scale.setScalar(1 + 0.8 * (i / 20) ** 2); await this.wait(0.03); }
    pet.root.scale.setScalar(1);
  }

  // 超大礼物：连锁反应——当前站点剩下的全部一波压完，再加巨人模式
  async giftChain(s, names) {
    this.hud.say(`${escapeText(names, 8)} 的超级连锁解压！`);
    if (s.chain) await s.chain(this.stationApi(s));
    else if (s.stampText) {
      const pts = [];
      for (let x = 0.2; x < s.length - 0.1; x += 0.22) for (let z = -s.width / 2 + 0.2; z < s.width / 2 - 0.1; z += 0.22) pts.push([x, z]);
      for (let i = 0; i < pts.length; i += 3) { s.stampText(pts.slice(i, i + 3)); if (i % 9 === 0) this.sfx(s.def.sound.step, this.course.world(s, pts[i][0], pts[i][1]), { gain: -4, maxDur: 0.7, main: false }); await this.wait(0.05); }
    } else if (s.pieces) {
      for (let i = 0; i < s.pieces.length; i += 6) { const q = s.pieces[i]; s.footstep(q.x, q.z, 1, 1); if (i % 18 === 0) this.sfx(s.def.sound.step, this.course.world(s, q.x, q.z), { gain: -3, maxDur: 0.8, main: false }); await this.wait(0.04); }
    }
    this.hud.unsay();
    await this.startGiant(names);
  }

  // ---------------- 音效辅助 ----------------
  sfx(id, pos, o = {}) {
    if (!pos) return this.audio.play(id, o);
    const v = pos.clone().project(this.camera);
    const pan = clamp(v.x, -1, 1);
    return this.audio.play(id, { pan, ...o });
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
    if (this.state === 'play' && !this.dancing) this.director.tick(dt);
    if (this.pet) {
      this.pet.update(dt);
      // 站着不动（踩奶、坐下、享受、跳舞）时，身体跟着脚下的材质一起沉下去、慢慢鼓回来
      const k = this.pet.action ? this.pet.action.kind : null;
      if (this.course && (!k || k === 'idle' || k === 'knead' || k === 'dance')) {
        const p = this.pet.root.position;
        const gy = this.course.yAt(p.x, p.z);
        p.y = damp(p.y, gy, 8, dt);
        this.pet.setGround(gy);
      }
    }
    if (this.crownUntil && this.time > this.crownUntil && !this.dancing) { this.pet.setCrown(false); this.crownUntil = 0; }
    if (this.giantUntil && this.time > this.giantUntil && !this.dancing && !this._shrinking) { this._shrinking = true; this.endGiant().finally(() => { this._shrinking = false; }); }
    this.updateCamera(dt);
    if (this.course) this.course.update(dt, this.pet.root.position, this.camera.position);
    if (this.stage) {
      const pt = this.stage.particles;
      if (pt) this.particles.ambient(pt.type, this.camTarget.x, this.camTarget.z, dt, { rate: pt.rate, colors: pt.colors });
    }
    this.particles.update(dt);
    this.audio.update();
    if (this.pet) {
      const head = this.pet.root.position.clone().add(V(0, (1.3 + (this.pet.extraAccessory ? 0.25 : 0)) * this.pet.root.scale.y, 0));
      const s = this.toScreen(head);
      this.hud.placeBubble(s.x, s.y);
    }
  }

  updateCamera(dt) {
    const pet = this.pet, p = pet.root.position;
    const portrait = this.hud.portrait;
    const t = this.time;
    const g = pet.groundY;
    const sc = pet.root.scale.x;
    let off, look, lambda = 1.8;
    const mode = this.__camOverride ? 'override' : this.camMode;
    // 糯糯朝哪个方向走（+x / -x），镜头总在它前方侧面：既看得到小脸，也看得到身后留下的脚印
    this.camDir = damp(this.camDir ?? 1, Math.sin(pet.facing) >= 0 ? 1 : -1, 0.8, dt);
    const dir = this.camDir;
    switch (mode) {
      case 'override':
        off = this.__camOverride.off.clone();
        look = V(p.x, p.y + this.__camOverride.lookY, p.z);
        break;
      case 'wide': {
        // 开场远景：从赛道前段慢慢推到糯糯
        this.wideT = Math.min(1, (this.wideT || 0) + dt / 4);
        const L = this.course ? this.course.length : 20;
        const x = L * 0.45 + (p.x - L * 0.45) * this.wideT;
        look = V(x, 0.3, 0);
        off = portrait ? V(-2.5, 7.5, 12.5) : V(-3.5, 5.2, 10);
        lambda = 1.0;
        break;
      }
      case 'macro': // 低机位侧前方特写：小脚踩进材质、身后一串脚印都在画面里（ASMR 的核心镜头）
        look = V(p.x - 0.32 * dir * sc, g + 0.3 * sc, p.z * 0.6);
        off = (portrait ? V(1.05 * dir, 1.3, 3.5) : V(1.4 * dir, 1.0, 3.15)).multiplyScalar(sc > 1.1 ? 1.75 : 1);
        off.applyAxisAngle(V(0, 1, 0), Math.sin(t * 0.07) * 0.1);
        lambda = 1.5;
        break;
      case 'face': // 小脸特写：享受、眯眼
        look = V(p.x, p.y + 0.5 * sc, p.z);
        off = (portrait ? V(0.5 * dir, 0.9, 2.7) : V(0.6 * dir, 0.75, 2.3)).multiplyScalar(sc);
        lambda = 1.4;
        break;
      case 'trail': { // 回头看脚印：镜头抬高，看清整块被踩过的材质
        const s = this.focus;
        look = s ? this.course.world(s, s.length / 2, 0, 0.1) : V(p.x - 0.9 * dir, g + 0.1, p.z * 0.5);
        off = portrait ? V(0.6 * dir, 2.9, 3.2) : V(0.8 * dir, 2.2, 2.9);
        lambda = 1.2;
        break;
      }
      case 'stamp': { // 看名字被压进材质
        const s = this.focus;
        look = s ? this.course.world(s, s.length / 2, 0, 0.1) : V(p.x, g, p.z);
        off = portrait ? V(0, 2.9, 2.6) : V(0, 2.3, 2.2);
        lambda = 1.5;
        break;
      }
      case 'finale': {
        const s = this.focus;
        const c = s ? this.course.world(s, s.length / 2, 0, 0.35) : V(p.x, g + 0.3, p.z);
        look = V(c.x * 0.5 + p.x * 0.5, Math.max(c.y, g + 0.3), p.z * 0.5);
        off = (portrait ? V(-0.8, 1.9, 4.2) : V(-1.4, 1.5, 3.6)).applyAxisAngle(V(0, 1, 0), Math.sin(t * 0.1) * 0.35);
        lambda = 1.4;
        break;
      }
      case 'dance':
        look = V(p.x, p.y + 0.75 * sc, p.z);
        off = (portrait ? V(0, 2.4, 5.2) : V(0, 2.0, 4.4)).multiplyScalar(sc > 1.1 ? 1.6 : 1);
        lambda = 2.2;
        break;
      default: // follow：中景，看清前方要去的下一站
        look = V(p.x + 0.7 * dir * sc, g + 0.3, p.z * 0.4);
        off = (portrait ? V(0.9 * dir, 2.4, 4.8) : V(1.1 * dir, 1.8, 4.1)).multiplyScalar(sc > 1.1 ? 1.6 : 1);
        lambda = 1.4;
    }
    // 极轻的"呼吸感"
    off.y += Math.sin(t * 0.09) * 0.04;
    this.camTarget.x = damp(this.camTarget.x, look.x, lambda, dt);
    this.camTarget.y = damp(this.camTarget.y, look.y, lambda, dt);
    this.camTarget.z = damp(this.camTarget.z, look.z, lambda, dt);
    const want = look.clone().add(off);
    this.camPos.x = damp(this.camPos.x, want.x, lambda, dt);
    this.camPos.y = damp(this.camPos.y, Math.max(want.y, g + 0.35), lambda, dt);
    this.camPos.z = damp(this.camPos.z, want.z, lambda, dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  status() {
    return {
      state: this.state, level: this.stageNo, theme: this.stage?.id, dancing: this.dancing,
      queued: this.gifts.queued, steps: this.totalSteps, stageSteps: this.stageSteps, levelsPlayed: this.stagesPlayed,
      station: this.focus ? this.focus.def.label : null, progress: this.course ? Math.round(this.course.progress() * 100) : 0,
    };
  }

  // 控制台指令
  command(c) {
    if (c.cmd === 'skip') this.skipRequested = true;
    if (c.cmd === 'reload') location.reload();
    if (c.cmd === 'volume') this.audio.setVolumes(c.volumes || {});
    if (c.cmd === 'dance') this.gifts.ready.push({ users: ['测试老板'], user: '测试老板', gift: '小心心', count: 1, value: 1, tier: Number(c.tier) || 0, at: this.gifts.now });
    if (c.cmd === 'chat') this.onLive({ type: 'chat', user: { name: c.user || '测试观众' }, text: String(c.text || '') });
  }
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
