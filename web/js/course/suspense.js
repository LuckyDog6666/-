// 悬念点 & 新的解压段落（v4）。
//
// 以前的闯关"没有悬念"：每个挑战都必然成功，观众只是看着糯糯往前走。这里的每一段都有一个"结果还不知道"的瞬间，
// 而且观众不花钱就能左右它（发弹幕投票、点赞加成）：
//  - 盲盒蛋（egg）    ：敲三下裂开，开出什么看运气 + 直播间热度（点赞越多越容易出稀有款）
//  - 烦恼泡泡（worries）：观众弹幕里写的烦恼变成带名字的泡泡，糯糯一个个踩扁（没人写就用"打工人烦恼清单"）
//  - 多米诺（domino）  ：推倒第一块，一长串哗啦啦倒下去（纯解压）
//  - 三选一礼盒（boxes）：弹幕发 1 / 2 / 3 投票，里面是大奖、小奖或者整蛊
//  - 脆脆桥（crisp）   ：每一排左右两块里有一块是脆的，弹幕投「左 / 右」，踩错了咔嚓碎掉、掉进云里再弹回来
// 镜头统一用"框住主体"的机位（frame）：竖屏、横屏都能把糯糯和眼前的东西完整地放进画面中间。
import * as THREE from 'three';
import { Gimmick, GIMMICK_TYPES } from './gimmicks.js';
import { roundedBox } from '../world/geo.js';
import { Tex } from '../render/textures.js';
import { textSprite, setSpriteText } from '../render/label.js';
import { collectibleMesh } from '../game/collectibleMesh.js';
import { WORRIES } from '../game/cheer.js';
import { Spring, TAU, clamp, lerp, ease } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PASTEL = ['#ffb3cf', '#a8dcff', '#ffe08a', '#c9b6ff', '#a8ecc0', '#ffc49a'];
const RAINBOW = ['#ff8fb3', '#ffb37a', '#ffe27a', '#9be89b', '#7fd6ff', '#a99bff', '#e39bff'];

// 小动画：在 dur 秒内每帧调用 fn(0..1)，结束时 Promise 完成（由段落的 update 驱动，跟着游戏时间走）
export class Fx {
  constructor() { this.list = []; }
  run(dur, fn) { return new Promise((res) => this.list.push({ t: 0, dur: Math.max(1e-3, dur), fn, res })); }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      try { a.fn(u); } catch (e) { console.error(e); }
      if (u >= 1) { this.list.splice(i, 1); a.res(); }
    }
  }
  clear() { for (const a of this.list) a.res(); this.list = []; }
}

// 带"小动画 / 碎片 / 旋转的手办"的闯关元素基类
export class Suspense extends Gimmick {
  constructor(ctx, def) {
    super(ctx, def);
    this.suspense = true;
    this.fx = new Fx();
    this.shards = [];
    this.spin = [];
    this.trash = [];   // 运行中临时创建、需要自己释放的东西
  }
  update(dt) {
    super.update(dt);
    this.fx.update(dt);
    for (const m of this.spin) m.rotation.y += dt * 2.4;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      s.v.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
      if (s.floor != null && s.m.position.y < s.floor) { s.m.position.y = s.floor; s.v.set(s.v.x * 0.4, Math.abs(s.v.y) * 0.25, s.v.z * 0.4); s.w.multiplyScalar(0.5); }
      if (s.life < 0.3) s.m.scale.setScalar(Math.max(0.001, s.life / 0.3) * (s.s0 || 1));
      if (s.life <= 0) { this.group.remove(s.m); this.shards.splice(i, 1); }
    }
  }
  // 一块碎片飞出去
  shard(mesh, v, o = {}) {
    this.shards.push({ m: mesh, v, w: V((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), life: o.life ?? 1.2, floor: o.floor, s0: mesh.scale.x });
  }
  dispose() {
    super.dispose();
    this.fx.clear();
    for (const t of this.trash) { try { t.userData && t.userData.dispose ? t.userData.dispose() : t.dispose && t.dispose(); } catch {} }
    this.trash = [];
  }
  // 开出来的手办：从 at（局部坐标）升起来、转一圈给大家看、再飞向图鉴
  // o.side：升起来的同时往屏幕右边（负数 = 左边）飘这么远。糯糯站在盒子后面看的时候，手办不会正好挡住它的小脸
  async revealItem(G, res, at, o = {}) {
    const rar = res.rarity;
    const side = o.side || 0, rv = side ? G.camRight() : null;
    const dx = rv ? rv.x * side : 0, dz = rv ? rv.z * side : 0;
    const mesh = collectibleMesh(res.item, this.ctx.rng, o.size || 0.46);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.soft(), color: new THREE.Color(rar.color), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    // 光晕只罩住手办自己：再大就会照到旁边糯糯的眼睛上，深色的瞳孔被染成金色，看起来像眼睛变了颜色
    halo.scale.set(0.92, 0.92, 1);
    halo.position.y = 0.25;
    const g = new THREE.Group();
    g.add(halo); g.add(mesh);
    g.position.copy(at);
    g.scale.setScalar(0.01);
    this.group.add(g);
    this.spin.push(mesh);
    this.trash.push(mesh, halo.material);
    const wp = this.W(at.x + dx, at.y + 0.5, at.z + dz);
    G.reveal({
      tag: `${rar.name}${res.isNew ? ' · NEW' : ''}`, cls: rar.cls, title: res.item.name, secs: (o.hold ?? 2.0) + 0.9,
      sub: res.isNew ? `【${res.item.set}系列】图鉴 ${res.allDone ? res.total : res.count}/${res.total}${res.by ? ` · ${res.by} 点亮` : ''}` : `已经有 ${res.times - 1} 个啦，换成应援值 +8`,
    });
    G.sfx('whoosh', wp, { gain: -5, main: false });
    G.sfx('plop_pop', wp, { gain: -2, main: false, delay: 0.12 });
    const cols = [rar.color, '#ffffff', '#ffe9a8'];
    if (res.item.r === 'n') G.burst('sparkles', wp, { colors: cols, count: 14 });
    else if (res.item.r === 'r') { G.burst('stars', wp, { colors: cols, count: 14 }); G.burst('sparkles', wp, { colors: cols, count: 12 }); }
    else { G.burst('confetti', wp, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b', '#c9a0ff'], count: res.item.r === 'ssr' ? 70 : 40 }); G.burst('stars', wp, { colors: cols, count: 18 }); G.camBump(res.item.r === 'ssr' ? 0.07 : 0.04); }
    G.pet.expr(res.item.r === 'n' ? 'happy' : 'wide', 'open', 2.2);
    // 糯糯被"啵"地吓一小跳，往另一边让半步：小脸和手办并排入镜
    const pp = G.pet.root.position;
    const step = rv ? G.pet.hop(V(pp.x - dx * 0.5, pp.y, pp.z - dz * 0.5), { height: 0.16, dur: 0.4, keepFacing: true }) : null;
    await this.fx.run(0.55, (u) => {
      const k = ease.outCubic(u);
      g.scale.setScalar(Math.max(0.01, ease.outBack(u)));
      g.position.set(at.x + dx * k, at.y + 0.42 * k, at.z + dz * k);
    });
    if (step) await step;
    await G.wait(o.hold ?? 2.0);
    await this.fx.run(0.4, (u) => { g.scale.setScalar(Math.max(0.01, 1 - u)); g.position.y += 0.02 + u * 0.05; });
    this.group.remove(g);
    this.spin.splice(this.spin.indexOf(mesh), 1);
    await afterDraw(G, res, wp);
  }
}

// 开完盲盒以后：重复的换成应援值；集齐一个系列 / 全部集齐，全屏庆祝
export async function afterDraw(G, res, wp) {
  if (!res.isNew) G.addCheer(8);
  if (res.setDone) {
    G.reveal({ tag: '🎉 集齐一套', cls: 'ssr', title: `【${res.item.set}系列】`, sub: `5 款全部到手！图鉴 ${res.allDone ? res.total : res.count}/${res.total}`, secs: 3 });
    G.burst('confetti', wp, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b', '#c9a0ff'], count: 70 });
    G.sfx('bubble_pop', wp, { gain: -3, main: false });
    G.addCheer(20);
    G.pet.expr('happy', 'open', 2);
    await G.pet.idleAction('celebrate', 1.3);
  }
  if (res.allDone) {
    G.reveal({ tag: '👑 图鉴大满贯', cls: 'ssr', title: `${res.total} 款全部集齐！`, sub: `开启第 ${res.round + 1} 轮图鉴，谢谢大家的应援`, secs: 4 });
    G.burst('confetti', wp, { colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b', '#c9a0ff'], count: 90 });
    await G.pet.idleAction('celebrate', 1.6);
  }
}

// 上尖下圆的蛋。thetaStart / thetaLen 可以只取一部分（下半个蛋壳）
function eggGeometry(R, H, thetaStart = 0, thetaLen = Math.PI) {
  const g = new THREE.SphereGeometry(1, 28, 18, 0, TAU, thetaStart, thetaLen);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + 1) / 2; // 0 底 → 1 顶
    const k = R * (1 - 0.24 * t);
    p.setXYZ(i, p.getX(i) * k, t * H, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
const eggR = (R, t) => R * (1 - 0.24 * t) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));

// ======================= 1. 盲盒蛋 =======================
export class EggSegment extends Suspense {
  build() {
    const { M, G, rng } = this.ctx, d = this.def;
    this.length = d.length || 1.5;
    this.label = d.label || '盲盒蛋';
    const R = 0.23, H = 0.6;
    const ex = d.eggX ?? this.length / 2, ez = d.eggZ ?? 0.5; // 蛋在靠镜头的一侧，糯糯站在它后面、面向镜头
    this.egg = { x: ex, z: ez, R, H };
    const col = d.color || rng.pick(PASTEL);
    this.col = col;
    const rug = new THREE.Mesh(G.track(new THREE.CylinderGeometry(0.33, 0.37, 0.03, 28)), M.soft('#ffffff', { rough: 0.9, rim: 0.3 }));
    rug.position.set(ex, 0.015, ez); rug.receiveShadow = true;
    this.group.add(rug);
    const eg = this.eggG = new THREE.Group();
    eg.position.set(ex, 0.03, ez);
    this.group.add(eg);
    this.shell = new THREE.Mesh(G.track(eggGeometry(R, H)), M.soft(col, { rough: 0.32, rim: 0.6 }));
    this.shell.castShadow = true;
    eg.add(this.shell);
    // 蛋壳上的波点
    const dotG = G.get('egg|dot', () => new THREE.SphereGeometry(0.034, 10, 8));
    const dotM = M.soft('#ffffff', { rough: 0.4, rim: 0.3 });
    for (let i = 0; i < 9; i++) {
      const t = 0.2 + rng.next() * 0.6, a = rng.next() * TAU, r = eggR(R, t) * 0.99;
      const m = new THREE.Mesh(dotG, dotM);
      m.position.set(Math.cos(a) * r, t * H, Math.sin(a) * r);
      this.shell.add(m);
    }
    // 三道裂纹（敲一下出现一道）
    const crackM = M.soft('#6b3f55', { rough: 0.8, rim: 0 });
    this.cracks = [0.52, 0.36, 0.66].map((f, k) => {
      const pts = [];
      const n = 26;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + k, t = f + (i % 2 ? 0.035 : -0.035) + Math.sin(i * 1.7 + k) * 0.012, r = eggR(R, t) * 1.012;
        pts.push(V(Math.cos(a) * r, t * H, Math.sin(a) * r));
      }
      const m = new THREE.Mesh(G.track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.2), 78, 0.0065, 5, true)), crackM);
      m.visible = false;
      this.shell.add(m);
      return m;
    });
    // 打开以后留下的下半个蛋壳
    this.bowl = new THREE.Mesh(G.track(eggGeometry(R, H, Math.PI * 0.56, Math.PI * 0.44)), M.soft(col, { rough: 0.4, rim: 0.5, side: THREE.DoubleSide }));
    this.bowl.visible = false;
    eg.add(this.bowl);
    this.q = textSprite('?', { height: 0.26, stroke: '#e08a00', color: '#fff6c4' });
    this.q.position.set(0, H + 0.22, 0);
    eg.add(this.q);
    this.trash.push(this.q);
    this.wob = new Spring(140, 5, 0);
    this.sq = new Spring(260, 9, 1);
    return this;
  }
  update(dt) {
    super.update(dt);
    const w = this.wob.update(dt), s = this.sq.update(dt);
    this.eggG.rotation.z = w + (this.shell.visible ? Math.sin(this.t * 2.1) * 0.03 : 0);
    this.eggG.scale.set(1 + (1 - s) * 0.5, s, 1 + (1 - s) * 0.5);
    this.q.position.y = this.egg.H + 0.22 + Math.sin(this.t * 2.6) * 0.03;
  }
  // 蛋从天上掉下来（应援条攒满的奖励蛋）
  async dropIn(G) {
    const y0 = this.eggG.position.y;
    const wp = this.W(this.egg.x, 0, this.egg.z);
    G.sfx('whoosh', wp, { gain: -6, main: false });
    await this.fx.run(0.55, (u) => { this.eggG.position.y = y0 + 3.2 * (1 - ease.inQuad(u)); });
    this.eggG.position.y = y0;
    this.sq.x = 0.72; this.sq.v = 0;
    G.sfx('land_soft', wp, { gain: 0, main: false });
    G.burst('poof', wp, { colors: ['#ffffff', '#ffe3f1'], count: 10, scale: 0.7 });
    G.camBump(0.025);
  }
  async run(G) {
    const pet = G.pet, e = this.egg;
    const eggW = this.W(e.x, 0, e.z);
    G.label(this.label);
    // 走到蛋的后面，面向镜头：竖屏里是"上面是糯糯的脸、下面是蛋"
    await G.walkTo(this.W(e.x, 0, e.z - 0.82), { stepDur: 0.4, stride: 0.28 });
    pet.faceTowards(eggW.x, eggW.z + 3);
    G.cam('frame', { center: this.W(e.x, 0.5, e.z - 0.3), radius: 0.98, dir: V(0.22, 0.42, 0.88) });
    pet.expr('wide', 'o', 1.2, 'up');
    G.say(this.def.say || '盲盒！会开出什么呢？');
    await pet.idleAction('peek', 0.8);
    G.unsay();
    this.q.visible = false;
    // 敲三下：这几秒里大家点的赞会提高稀有度
    const v0 = G.viewerPts();
    const boost = () => clamp(G.heat() * 0.45 + (G.viewerPts() - v0) / Math.max(18, G.cheerGoal() * 0.3), 0, 1);
    G.prompt({ title: '🎁 开盲盒！', sub: '快点赞！点赞越多，越容易开出稀有款', rate: boost(), rateLabel: '稀有加成' });
    for (let k = 0; k < 3; k++) {
      await pet.act('tap', {
        reps: 1, dur: 0.72,
        onHit: () => {
          this.cracks[k].visible = true;
          this.wob.v += (k % 2 ? -1 : 1) * (2.2 + k);
          this.sq.x = 0.9 - k * 0.03;
          G.sfx('ice_crack', eggW, { gain: -3 + k * 1.5 });
          G.burst('crumbs', this.W(e.x, e.H * 0.6, e.z), { colors: [this.col, '#ffffff'], count: 4 + k * 3, scale: 0.5 });
          G.countStep();
        },
      });
      G.promptUpdate({ rate: boost() });
      await G.wait(k === 2 ? 0.15 : 0.5);
      G.promptUpdate({ rate: boost() });
    }
    const b = boost();
    G.promptHide();
    // 裂开！
    this.shell.visible = false;
    this.q.visible = false;
    this.bowl.visible = true;
    const top = this.W(e.x, e.H * 0.75, e.z);
    G.sfx('plop_pop', top, { gain: 1 });
    G.sfx('snow_crunch', top, { gain: -4, main: false });
    G.burst('crumbs', top, { colors: [this.col, '#ffffff'], count: 26, scale: 0.9 });
    G.camBump(0.03);
    const sg = this.ctx.G.get('egg|shard', () => new THREE.TetrahedronGeometry(0.07).scale(1, 0.35, 1));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + Math.random();
      const m = new THREE.Mesh(sg, this.shell.material);
      m.position.set(e.x + Math.cos(a) * 0.12, 0.03 + e.H * 0.75, e.z + Math.sin(a) * 0.12);
      this.group.add(m);
      this.shard(m, V(Math.cos(a) * (1 + Math.random()), 2.2 + Math.random() * 1.6, Math.sin(a) * (1 + Math.random())), { life: 1.3, floor: 0.02 });
    }
    const res = G.openBox({ boost: b, min: this.def.min || 'n', by: this.def.by || '' });
    await this.revealItem(G, res, V(e.x, 0.12, e.z), { side: 0.46 });
    pet.expr('happy', 'smile', 1.2);
    // 从蛋的旁边绕出去
    G.cam('front');
    await G.walkTo(this.W(Math.min(this.length + 0.1, e.x + 0.75), 0, -0.22), { stepDur: 0.42, stride: 0.3 });
    if (!this.def.bonus) await G.walkTo(this.W(this.length + 0.12, 0, 0), { stepDur: 0.42, stride: 0.3 });
    this.done = true;
  }
}

// ======================= 2. 烦恼泡泡 =======================
// 一个带字的软泡泡：文字 = 观众写的烦恼（或者清单里的词），下面的小字 = 是谁写的
export class WorryBubble {
  constructor(ctx, text, name, color) {
    const { M, G } = ctx;
    this.text = text; this.name = name || '';
    this.color = color;
    this.g = new THREE.Group();
    this.r = 0.21;
    this.ball = new THREE.Mesh(G.get('worry|ball', () => new THREE.SphereGeometry(0.21, 24, 18)), M.glossy(color, { opacity: 0.62, ei: 0.22, rough: 0.1 }));
    this.ball.position.y = this.r * 0.92;
    this.ball.scale.y = 0.92;
    this.ball.castShadow = true;
    this.g.add(this.ball);
    const hl = new THREE.Mesh(G.get('worry|hl', () => new THREE.SphereGeometry(0.035, 8, 6)), M.basic('#ffffff', { opacity: 0.85 }));
    hl.position.set(0.08, this.r * 1.5, 0.12);
    this.g.add(hl);
    this.hl = hl;
    this.label = textSprite(text, { height: 0.2, stroke: '#7a4bc9' });
    this.label.position.y = this.r * 2 + 0.17;
    this.g.add(this.label);
    this.tag = null;
    if (name) this._tag(name);
    this.popped = false;
    this.sq = new Spring(240, 10, 1);
    this.ph = Math.random() * TAU;
    this.t = 0;
  }
  _tag(name) {
    if (this.tag) { this.g.remove(this.tag); this.tag.userData.dispose(); }
    this.tag = textSprite(`@${name}`, { height: 0.1, stroke: '#3f7fd6', color: '#eaf4ff' });
    this.tag.position.y = this.r * 2 + 0.02;
    this.label.position.y = this.r * 2 + 0.2;
    this.g.add(this.tag);
  }
  relabel(text, name) {
    this.text = text; this.name = name || '';
    setSpriteText(this.label, text, { height: 0.2, stroke: '#7a4bc9' });
    if (name) this._tag(name);
  }
  update(dt) {
    this.t += dt;
    if (this.popped) return;
    const s = this.sq.update(dt);
    const wob = 1 + Math.sin(this.t * 2.4 + this.ph) * 0.025;
    this.ball.scale.set((1 + (1 - s) * 0.6) * wob, 0.92 * s / wob, (1 + (1 - s) * 0.6) * wob);
    this.ball.position.y = this.r * 0.92 * s;
  }
  // 踩扁 → 啵地破掉；文字飞起来、变淡。wp：泡泡的世界坐标
  pop(G, fx, wp) {
    if (this.popped) return;
    this.popped = true;
    this.ball.visible = false; this.hl.visible = false;
    G.sfx('bubble_pop', wp, { gain: 1 });
    G.sfx('plop_pop', wp, { gain: -4, main: false, delay: 0.05 });
    G.burst('bubbles', V(wp.x, wp.y + 0.1, wp.z), { colors: [this.color, '#ffffff'], count: 9 });
    G.burst('sparkles', V(wp.x, wp.y + 0.2, wp.z), { colors: [this.color, '#ffffff', '#fff2a8'], count: 12 });
    G.burst('ring', V(wp.x, wp.y, wp.z), { colors: [this.color], scale: 0.7 });
    const l = this.label, tg = this.tag, y0 = l.position.y, b = l.userData.baseScale.clone();
    fx.run(0.75, (u) => {
      const k = u < 0.2 ? 1 + u * 1.6 : 1.32 * (1 - ease.inQuad((u - 0.2) / 0.8));
      l.scale.set(b.x * Math.max(0.01, k), b.y * Math.max(0.01, k), 1);
      l.position.y = y0 + u * 0.4;
      l.material.opacity = 1 - ease.inQuad(u);
      l.material.rotation = u * 0.5;
      if (tg) { tg.material.opacity = 1 - u; tg.position.y += 0.004; }
    }).then(() => { l.visible = false; if (tg) tg.visible = false; });
    G.tick(this.name ? `${this.name} 的「${this.text}」被踩扁啦！` : `「${this.text}」被踩扁啦！`, this.name ? 'gold' : '');
    G.countStep();
  }
  dispose() { this.label.userData.dispose(); if (this.tag) this.tag.userData.dispose(); }
}

export class WorrySegment extends Suspense {
  build() {
    const d = this.def, r = this.ctx.rng;
    this.suspense = false;
    this.label = d.label || '烦恼泡泡';
    const n = d.count || 5, sp = 0.6;
    this.length = 0.55 + (n - 1) * sp + 0.6;
    this.bubbles = [];
    for (let i = 0; i < n; i++) {
      const b = new WorryBubble(this.ctx, (d.words && d.words[i]) || WORRIES[(r.int(0, WORRIES.length - 1) + i * 7) % WORRIES.length], '', PASTEL[(i + (d.colorOff || 0)) % PASTEL.length]);
      b.x = 0.55 + i * sp; b.z = (i % 2 ? 1 : -1) * r.range(0.04, 0.12);
      b.g.position.set(b.x, 0, b.z);
      this.group.add(b.g);
      this.bubbles.push(b);
      this.trash.push(b);
    }
    return this;
  }
  update(dt) { super.update(dt); for (const b of this.bubbles) b.update(dt); }
  topY(x, z) {
    for (const b of this.bubbles) if (!b.popped && Math.hypot(b.x - x, b.z - z) < 0.2) return b.r * 1.6;
    return 0;
  }
  async run(G) {
    const pet = G.pet;
    // 先把泡泡上的字换成观众刚写的烦恼（没有就用清单里的）
    for (const b of this.bubbles) { const w = G.takeWorry() || G.defaultWorry(); b.relabel(w.text, w.name); }
    G.label(this.label);
    G.cam('follow', { off: V(2.6, 1.55, 1.0), lookY: 0.5, lambda: 1.5 });
    pet.face(Math.PI / 2);
    G.say('把烦恼一个个踩扁！');
    pet.expr('open', 'cat', 1, 'down');
    await pet.idleAction('ready', 0.5);
    G.unsay();
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      // 还没踩到的泡泡：有观众新写的烦恼就换上去（弹幕发出去十几秒就能看到自己的字被踩）
      if (!b.name) { const w = G.takeWorry(); if (w) b.relabel(w.text, w.name); }
      const to = this.W(b.x, 0, b.z);
      pet.face(Math.PI / 2 - 0.2 + (b.z - pet.root.position.z) * 0.5);
      await pet.hop(to, { height: 0.42, dur: 0.5, anticipation: 0.1, keepFacing: true });
      pet.setGround(to.y);
      b.sq.x = 0.3;
      b.pop(G, this.fx, to);
      G.camBump(0.018);
      if (i === 1) pet.expr('happy', 'smile', 1);
      await G.wait(0.42 + G.rng() * 0.2);
    }
    pet.faceTowards(G.camPos().x, G.camPos().z);
    pet.expr('happy', 'open', 1.6);
    G.say('烦恼都踩扁啦！');
    await pet.idleAction('celebrate', 1.0);
    G.unsay();
    pet.face(Math.PI / 2);
    const end = this.W(this.length + 0.12, 0, 0);
    await pet.hop(end, { height: 0.3, dur: 0.48 });
    pet.setGround(G.yAt(end.x, end.z));
    G.sfx(G.pathSound, end, { gain: -2, main: false });
    this.done = true;
  }
}

// ======================= 3. 多米诺 =======================
export class DominoSegment extends Suspense {
  build() {
    const { M, G } = this.ctx, d = this.def;
    this.suspense = false;
    this.label = d.label || '多米诺骨牌';
    const n = this.n = d.count || 30, sp = 0.1;
    this.length = 0.55 + n * sp + 0.75;
    const H = 0.3;
    const geo = G.get('domino', () => roundedBox(0.045, H, 0.17, 0.014, 2).translate(0, H / 2, 0));
    this.tiles = [];
    for (let i = 0; i < n; i++) {
      const x = 0.55 + i * sp, z = 0.42 + Math.sin((i / n) * TAU * 1.25) * 0.16;
      const dz = Math.cos((i / n) * TAU * 1.25) * 0.16 * TAU * 1.25 / (n * sp);
      const m = new THREE.Mesh(geo, M.soft(RAINBOW[Math.floor(i / 2) % RAINBOW.length], { rough: 0.4, rim: 0.4 }));
      const pv = new THREE.Group();
      pv.position.set(x, 0.005, z);
      pv.rotation.y = -Math.atan(dz);
      pv.add(m);
      m.castShadow = true;
      this.group.add(pv);
      this.tiles.push({ pv, m, x, z, a: 0 });
    }
    // 尽头的礼花筒
    const last = this.tiles[n - 1];
    const cone = new THREE.Mesh(G.track(new THREE.ConeGeometry(0.11, 0.3, 20, 1, true).rotateX(Math.PI).translate(0, 0.15, 0)), M.soft('#ffd166', { rough: 0.4, rim: 0.4, side: THREE.DoubleSide }));
    cone.position.set(last.x + 0.34, 0, last.z);
    cone.castShadow = true;
    this.group.add(cone);
    this.popper = cone;
    this.front = 0.55; // 倒到哪儿了（镜头跟着它）
    return this;
  }
  async run(G) {
    const pet = G.pet, T = this.tiles, n = this.n;
    G.label(this.label);
    // 糯糯走在里侧，多米诺在靠镜头的一侧
    await G.walkTo(this.W(0.22, 0, -0.2), { stepDur: 0.42, stride: 0.3 });
    pet.faceTowards(this.x0 + T[0].x + 0.3, T[0].z + 0.5);
    G.cam('frame', { center: () => this.W(this.front + 0.25, 0.22, 0.25), radius: 1.05, dir: V(0.8, 0.52, 0.42), lambda: 3.2 });
    pet.expr('wide', 'o', 1, 'up');
    G.say(this.def.say || '推倒第一块…');
    await pet.idleAction('peek', 0.7);
    G.unsay();
    let go = false;
    await pet.act('push', { reps: 1, dur: 0.7, onHit: () => { go = true; } });
    if (!go) go = true;
    pet.expr('happy', 'open', 2.4);
    // 一块推一块：越倒越快
    let gap = 0.085;
    for (let i = 0; i < n; i++) {
      const t = T[i], lastOne = i === n - 1;
      this.fx.run(0.2, (u) => { t.pv.rotation.z = -(lastOne ? Math.PI / 2 : 1.22) * ease.inQuad(u); });
      this.front = t.x;
      G.sfx('key_thock', this.W(t.x, 0.1, t.z), { gain: -7 + (i / n) * 4, rate: 0.9 + (i / n) * 0.55, main: i % 3 === 0 });
      if (i % 4 === 0) G.countStep();
      await G.wait(gap);
      gap = Math.max(0.045, gap * 0.975);
    }
    await G.wait(0.16);
    // 最后一块碰到礼花筒：嘭！
    const pp = this.W(this.popper.position.x, 0.35, this.popper.position.z);
    G.sfx('bubble_pop', pp, { gain: 2 });
    G.sfx('whoosh', pp, { gain: -6, main: false });
    G.burst('confetti', pp, { colors: RAINBOW, count: 50 });
    G.burst('stars', pp, { colors: ['#ffd166', '#ffffff'], count: 10 });
    G.camBump(0.04);
    this.fx.run(0.3, (u) => { this.popper.scale.set(1 + Math.sin(u * Math.PI) * 0.3, 1 - Math.sin(u * Math.PI) * 0.25, 1 + Math.sin(u * Math.PI) * 0.3); });
    G.addCheer(10);
    G.tick('多米诺全倒！应援 +10', 'gold');
    await pet.idleAction('celebrate', 1.0);
    G.cam('front');
    pet.face(Math.PI / 2);
    await G.walkTo(this.W(this.length - 0.35, 0, -0.2), { stepDur: 0.36, stride: 0.32 });
    await G.walkTo(this.W(this.length + 0.12, 0, 0), { stepDur: 0.4, stride: 0.3 });
    this.done = true;
  }
}

// ======================= 4. 三选一礼盒 =======================
const BOX_COLS = [['#ff9ec4', '#ffffff', '粉'], ['#ffd166', '#ff8fb3', '黄'], ['#8fd3ff', '#ffffff', '蓝']];
export class BoxesSegment extends Suspense {
  build() {
    const { M, G, rng } = this.ctx;
    this.label = this.def.label || '三选一礼盒';
    this.length = 2.6;
    const c = this.c = 1.12, S = 0.4;
    this.bz = 0.52; // 礼盒在靠镜头的一侧，糯糯站在后面
    this.boxes = [];
    // 里面装的是什么：大奖 / 小奖 / 整蛊，位置随机
    const what = rng.shuffle(['jackpot', 'small', 'prank']);
    for (let i = 0; i < 3; i++) {
      const [col, rib, cn] = BOX_COLS[i];
      const g = new THREE.Group();
      g.position.set(c + (i - 1) * 0.64, 0.005, this.bz);
      const body = new THREE.Mesh(G.get('box|body', () => roundedBox(S, S * 0.78, S, 0.04, 3).translate(0, S * 0.39, 0)), M.soft(col, { rough: 0.55, rim: 0.4 }));
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      const rb = new THREE.Mesh(G.get('box|rib', () => roundedBox(0.07, S * 0.79, S + 0.012, 0.01, 2).translate(0, S * 0.39, 0)), M.soft(rib, { rough: 0.5, rim: 0.3 }));
      g.add(rb);
      // 盖子：打开的时候整个"啵"地弹飞（见 _open）
      const hinge = new THREE.Group();
      hinge.position.set(0, S * 0.78, -S / 2);
      const lid = new THREE.Mesh(G.get('box|lid', () => roundedBox(S + 0.05, 0.1, S + 0.05, 0.035, 3).translate(0, 0.05, S / 2)), M.soft(col, { rough: 0.5, rim: 0.45 }));
      lid.castShadow = true;
      hinge.add(lid);
      const lr = new THREE.Mesh(G.get('box|lrib', () => roundedBox(0.07, 0.104, S + 0.062, 0.01, 2).translate(0, 0.05, S / 2)), M.soft(rib, { rough: 0.5, rim: 0.3 }));
      hinge.add(lr);
      const bow = new THREE.Mesh(G.get('box|bow', () => new THREE.TorusGeometry(0.05, 0.022, 8, 16).translate(0, 0.13, S / 2)), M.soft(rib, { rough: 0.5, rim: 0.3 }));
      hinge.add(bow);
      g.add(hinge);
      const num = textSprite(String(i + 1), { height: 0.26, stroke: '#d6467f', depthTest: false });
      num.position.set(0, S * 0.36, S / 2 + 0.03);
      g.add(num);
      this.trash.push(num);
      this.group.add(g);
      this.boxes.push({ g, hinge, num, x: c + (i - 1) * 0.64, what: what[i], cn, col, wob: new Spring(150, 6, 0), open: false });
    }
    // 整蛊用的弹簧小球
    const sp = this.spring = new THREE.Group();
    const coil = new THREE.Mesh(G.track(new THREE.CylinderGeometry(0.035, 0.035, 1, 10).translate(0, 0.5, 0)), M.soft('#c9d4e0', { rough: 0.35, rim: 0.3 }));
    const ball = new THREE.Mesh(G.track(new THREE.SphereGeometry(0.13, 18, 14)), M.soft('#ff6b6b', { rough: 0.4, rim: 0.5 }));
    sp.add(coil); sp.add(ball);
    sp.userData = { coil, ball };
    sp.visible = false;
    this.group.add(sp);
    return this;
  }
  update(dt) {
    super.update(dt);
    for (const b of this.boxes) b.g.rotation.z = b.wob.update(dt);
  }
  _open(G, b, loud = true) {
    if (b.open) return Promise.resolve();
    b.open = true;
    const wp = this.W(b.x, 0.35, this.bz);
    if (loud) G.sfx('place', wp, { gain: -2, main: false });
    // 盖子"啵"地弹起来、朝镜头这边翻着跟头飞出去。
    // （以前是向后翻开：竖起来的盖子正好夹在礼盒和糯糯中间，竖屏里把它的小脸挡掉一半）
    const h = b.hinge;
    b.g.remove(h);
    h.position.set(b.x + h.position.x, b.g.position.y + h.position.y, this.bz + h.position.z);
    this.group.add(h);
    // 飞到最高点就缩小消失（不落地：厨房的台面窄，落下来会悬在台面外面）
    this.shard(h, V((Math.random() - 0.5) * 0.7, 3.0 + Math.random() * 0.5, 1.0 + Math.random() * 0.3), { life: 0.62 });
    return G.wait(0.3);
  }
  async run(G) {
    const pet = G.pet, c = this.c;
    G.label(this.label);
    const stand = (i) => this.W(c + (i - 1) * 0.64, 0, this.bz - 0.86);
    await G.walkTo(stand(1), { stepDur: 0.4, stride: 0.28 });
    pet.faceTowards(this.x0 + c, this.bz + 3);
    G.cam('frame', { center: this.W(c, 0.5, 0.12), radius: 1.3, dir: V(0.1, 0.42, 0.9) });
    pet.expr('wide', 'o', 1.2, 'up');
    G.say('三个礼盒，选哪个？');
    const look = pet.idleAction('look', 60);
    const r = await G.poll({
      title: '🎁 选一个礼盒！', sub: '弹幕发 1 / 2 / 3　有大奖，也有整蛊', seconds: this.def.seconds || 9,
      options: this.boxes.map((b, i) => ({ key: String(i + 1), label: `${b.cn}色礼盒`, short: `${b.cn}盒`, match: [['一', '①', '粉'], ['二', '②', '黄', '两'], ['三', '③', '蓝']][i] })),
    });
    pet.cancelAction(); await look;
    G.unsay();
    const k = r.pick, b = this.boxes[k];
    // 跳到选中的礼盒后面
    const to = stand(k);
    if (k !== 1) { await pet.hop(to, { height: 0.3, dur: 0.45, keepFacing: true }); pet.setGround(to.y); G.sfx(G.pathSound, to, { gain: -3, main: false }); }
    pet.faceTowards(this.x0 + b.x, this.bz + 3);
    // 卖个关子：礼盒抖三下
    pet.expr('open', 'o', 2, 'worried');
    for (let i = 0; i < 3; i++) {
      b.wob.v += (i % 2 ? -1 : 1) * (1.6 + i * 0.6);
      G.sfx('key_thock', this.W(b.x, 0.3, this.bz), { gain: -6 + i * 2, rate: 0.85 + i * 0.12, main: false });
      await G.wait(0.42 - i * 0.07);
    }
    G.promptHide();
    await pet.act('tap', { reps: 1, dur: 0.6, onHit: () => { this._open(G, b); } });
    await G.wait(0.12);
    const wp = this.W(b.x, 0.45, this.bz);
    let msg = '';
    if (b.what === 'jackpot') {
      G.burst('confetti', wp, { colors: RAINBOW, count: 44 });
      G.camBump(0.035);
      const res = G.openBox({ boost: 0.55, min: 'r' });
      await this.revealItem(G, res, V(b.x, 0.3, this.bz), { hold: 1.8, side: b.x > this.c + 0.1 ? -0.46 : 0.46 });
      msg = '大奖';
    } else if (b.what === 'small') {
      // 小奖：一把糖果（应援值）
      G.sfx('gravel_step', wp, { gain: -2 });
      G.sfx('gravel_step', wp, { gain: -4, main: false, delay: 0.12 });
      G.burst('crumbs', wp, { colors: RAINBOW, count: 26, scale: 0.8 });
      G.burst('sparkles', wp, { colors: ['#ffffff', '#fff2a8'], count: 12 });
      G.reveal({ tag: '🍬 小奖', cls: 'win', title: '一把彩虹糖', sub: '应援值 +15', secs: 2.2 });
      G.addCheer(15);
      pet.expr('happy', 'open', 1.6);
      await pet.idleAction('wiggle', 1.3);
      msg = '小奖';
    } else {
      // 整蛊：弹簧小球"啵"地弹出来，糯糯吓得往后一跳
      const sp = this.spring, { coil, ball } = sp.userData;
      sp.position.set(b.x, 0.3, this.bz);
      sp.visible = true;
      G.sfx('bounce', wp, { gain: 2 });
      G.sfx('whoosh', wp, { gain: -6, main: false });
      G.burst('stars', wp, { colors: ['#ffd166', '#ff8fb3'], count: 10 });
      this.fx.run(0.9, (u) => { const hgt = 0.85 * Math.abs(Math.sin(u * Math.PI * 2.5)) * (1 - u * 0.5) + 0.25; coil.scale.set(1, hgt, 1); ball.position.y = hgt + 0.1; sp.rotation.z = Math.sin(u * 14) * 0.12 * (1 - u); });
      G.reveal({ tag: '🤡 整蛊', cls: 'lose', title: '啵！是弹簧小球', sub: '被整蛊啦～下次换一个选', secs: 2.2 });
      pet.expr('wide', 'o', 1.2, 'up');
      G.camBump(0.03);
      const back = to.clone(); back.z -= 0.22;
      await pet.hop(back, { height: 0.3, dur: 0.4, keepFacing: true });
      pet.setGround(back.y);
      G.sfx('land_soft', back, { gain: -3, main: false });
      await pet.idleAction('shake', 0.9);
      pet.expr('happy', 'smile', 1.4);
      G.say('吓我一跳～');
      await G.wait(0.7);
      G.unsay();
      msg = '整蛊';
    }
    // 把另外两个也打开看看：大奖原来在哪
    for (const o of this.boxes) {
      if (o === b) continue;
      await this._open(G, o, false);
      const tag = textSprite({ jackpot: '大奖', small: '小奖', prank: '整蛊' }[o.what], { height: 0.2, stroke: o.what === 'jackpot' ? '#e08a00' : '#7384a3' });
      tag.position.set(0, 0.62, 0.05);
      o.g.add(tag);
      this.trash.push(tag);
      if (o.what === 'jackpot') G.burst('sparkles', this.W(o.x, 0.5, this.bz), { colors: ['#ffd166', '#ffffff'], count: 10 });
    }
    // 投中大奖的观众加分
    const jack = this.boxes.findIndex((o) => o.what === 'jackpot');
    const winners = r.voters.filter((v) => v.idx === jack);
    if (winners.length) { G.award(winners, 20, '猜中大奖'); G.tick(`猜中大奖的 ${winners.length} 位：应援 +20`, 'gold'); }
    else if (!r.auto && msg !== '大奖') G.tick(`大奖在 ${jack + 1} 号…下次再来！`);
    await G.wait(0.9);
    G.cam('front');
    pet.face(Math.PI / 2);
    await G.walkTo(this.W(this.length - 0.25, 0, this.bz - 0.86), { stepDur: 0.4, stride: 0.3 });
    await G.walkTo(this.W(this.length + 0.12, 0, 0), { stepDur: 0.4, stride: 0.3 });
    this.done = true;
  }
}

// ======================= 5. 脆脆桥 =======================
const CRISP_SKINS = {
  ice: { col: '#8fd0ff', mat: 'glossy', name: '冰砖', snd: 'ice_crack', snd2: 'snow_crunch', fx: 'snow' },
  cookie: { col: '#e8b877', mat: 'soft', name: '饼干', snd: 'ice_crack', snd2: 'leaves_crunch', fx: 'crumbs' },
};
export class CrispSegment extends Suspense {
  build() {
    const { M, G, rng } = this.ctx, d = this.def;
    this.label = d.label || '脆脆桥';
    const rows = this.rows = d.rows || 3, sp = 0.72;
    this.length = 0.78 + (rows - 1) * sp + 0.78;
    this._channel({ liquid: 'cloud', bed: d.bed, bank: d.bank });
    this._banks(d.bank || '#f4e8dc');
    const skin = this.skin = CRISP_SKINS[d.skin] || CRISP_SKINS.cookie;
    const mat = skin.mat === 'glossy' ? M.glossy(skin.col, { opacity: 0.88, ei: 0.2, rough: 0.08 }) : M.soft(skin.col, { rough: 0.75, rim: 0.3 });
    const pg = G.get('crisp|piece', () => roundedBox(0.2, 0.06, 0.14, 0.02, 2));
    this.tileY = 0.1; // 砖块浮在云上面一点
    this.tiles = [];
    // "左 / 右"两块牌子：投票时立在当前这一排的两块砖上
    this.marks = ['左', '右'].map((t) => { const m = textSprite(t, { height: 0.26, stroke: '#d6467f', depthTest: false }); m.visible = false; this.group.add(m); this.trash.push(m); return m; });
    for (let r = 0; r < rows; r++) {
      const x = 0.78 + r * sp;
      const weak = rng.next() < 0.5 ? 0 : 1; // 这一排哪一块是脆的
      const row = [];
      for (let s = 0; s < 2; s++) {
        const z = s === 0 ? 0.37 : -0.37; // 0 = 靠镜头一侧
        const g = new THREE.Group();
        g.position.set(x, this.tileY, z);
        const pieces = [];
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
          const m = new THREE.Mesh(pg, mat);
          m.position.set((i - 0.5) * 0.21, 0, (j - 1) * 0.15);
          m.rotation.y = (rng.next() - 0.5) * 0.06;
          m.castShadow = true; m.receiveShadow = true;
          g.add(m);
          pieces.push(m);
        }
        this.group.add(g);
        row.push({ g, pieces, x, z, weak: s === weak, broken: false, sp: new Spring(170, 9, 0) });
      }
      this.tiles.push(row);
    }
    return this;
  }
  topY(x, z) {
    for (const row of this.tiles) for (const t of row) if (!t.broken && Math.abs(t.x - x) < 0.24 && Math.abs(t.z - z) < 0.26) return 0.03 + t.g.position.y;
    return x < 0.2 || x > this.length - 0.2 ? 0 : (this.liquidY ?? -0.03);
  }
  update(dt) {
    super.update(dt);
    for (const row of this.tiles) for (const t of row) if (!t.broken) t.g.position.y = this.tileY + t.sp.update(dt);
    for (const m of this.marks) if (m.visible) m.position.y = this.tileY + 0.3 + Math.sin(this.t * 3) * 0.02;
  }
  _break(G, t) {
    t.broken = true;
    const wp = this.W(t.x, this.tileY + 0.03, t.z), sk = this.skin;
    G.sfx(sk.snd, wp, { gain: 2 });
    G.sfx(sk.snd2, wp, { gain: -1, main: false, delay: 0.06 });
    G.burst(sk.fx, wp, { colors: [sk.col, '#ffffff'], count: 18 });
    G.camBump(0.035);
    for (const m of t.pieces) {
      t.g.remove(m);
      m.position.add(t.g.position);
      this.group.add(m);
      this.shard(m, V((Math.random() - 0.5) * 1.6, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6), { life: 1.1 });
    }
  }
  async run(G) {
    const pet = G.pet, sk = this.skin;
    G.label(this.label);
    // 屏幕上的"左"是哪一侧：按镜头的朝向算（镜头在糯糯正前方时，屏幕左边 = +z）
    const front = V(0.88, 0.5, 0.1);
    G.cam('frame', { center: this.W(0.5, 0.4, 0), radius: 1.02, dir: front });
    await G.wait(0.05);
    pet.face(Math.PI / 2);
    pet.expr('wide', 'o', 1.4, 'worried');
    G.say(`${sk.name}桥…有的一踩就碎！`);
    await pet.idleAction('peek', 0.9);
    G.unsay();
    let safe = 0;
    const lucky = new Map(); // 每一排都投对的观众
    for (let r = 0; r < this.rows; r++) {
      const row = this.tiles[r];
      G.cam('frame', { center: this.W(row[0].x - 0.28, 0.42, 0), radius: 1.02, dir: front });
      const look = pet.idleAction('look', 60);
      const leftIdx = G.camRight().z < 0 ? 0 : 1; // row[0] 在 +z
      this.marks.forEach((m, i) => { const tt = row[i === 0 ? leftIdx : 1 - leftIdx]; m.position.set(tt.x, this.tileY + 0.3, tt.z); m.visible = true; });
      const res = await G.poll({
        title: `第 ${r + 1}/${this.rows} 排：左还是右？`, sub: '弹幕发「左」或「右」　有一块是脆的！', seconds: this.def.seconds || 6,
        options: [{ key: '左', label: '左边这块', short: '左边', match: ['1', 'l', 'left', '左边'] }, { key: '右', label: '右边这块', short: '右边', match: ['2', 'r', 'right', '右边'] }],
      });
      this.marks.forEach((m) => { m.visible = false; });
      pet.cancelAction(); await look;
      const t = row[res.pick === 0 ? leftIdx : 1 - leftIdx], other = row[res.pick === 0 ? 1 - leftIdx : leftIdx];
      const to = this.W(t.x, this.tileY + 0.03, t.z);
      pet.expr('open', 'o', 1.2, 'worried');
      await pet.hop(to, { height: 0.36, dur: 0.5, anticipation: 0.12, keepFacing: true });
      pet.setGround(to.y);
      G.countStep();
      const good = res.voters.filter((v) => v.idx === (t.weak ? 1 - res.pick : res.pick));
      for (const v of good) lucky.set(v.id, { ...v, n: (lucky.get(v.id)?.n || 0) + 1 });
      if (!t.weak) {
        safe++;
        t.sp.v -= 0.5;
        G.sfx('place', to, { gain: -1 });
        G.burst('sparkles', to, { colors: ['#ffffff', '#fff2a8'], count: 8, scale: 0.7 });
        G.promptUpdate({ sub: '✔ 安全！' });
        pet.expr('happy', 'smile', 1);
        await G.wait(0.55);
      } else {
        // 咔嚓——碎了，掉进云里，再弹回对面那一块
        G.promptUpdate({ sub: '✘ 咔嚓！这块是脆的' });
        G.sfx(sk.snd, to, { gain: -2 });
        await G.wait(0.22);
        this._break(G, t);
        pet.expr('wide', 'o', 1.5, 'up');
        const pit = this.W(t.x, -0.36, t.z * 0.6);
        await pet.hop(pit, { height: 0.04, dur: 0.34, anticipation: 0, keepFacing: true });
        pet.setGround(pit.y);
        G.sfx('land_soft', pit, { gain: 1 });
        G.burst('fluff', this.W(t.x, 0, t.z * 0.6), { colors: ['#ffffff', '#eef4ff'], count: 16 });
        const back = this.W(other.x, this.tileY + 0.03, other.z);
        G.sfx('bounce', pit, { gain: -1, main: false, delay: 0.1 });
        await pet.hop(back, { height: 0.85, dur: 0.72, anticipation: 0.12, keepFacing: true });
        pet.setGround(back.y);
        other.sp.v -= 0.5;
        G.sfx('place', back, { gain: -3, main: false });
        pet.expr('happy', 'open', 1.2);
        G.say('吓我一跳！');
        await pet.idleAction('shake', 0.7);
        G.unsay();
      }
      G.promptHide();
    }
    const end = this.W(this.length + 0.12, 0, 0);
    end.y = G.yAt(end.x, end.z);
    await pet.hop(end, { height: 0.38, dur: 0.52 });
    pet.setGround(end.y);
    G.sfx(G.pathSound, end, { gain: -1 });
    pet.faceTowards(G.camPos().x, G.camPos().z);
    G.cam('front');
    // 结算
    if (safe === this.rows) {
      G.reveal({ tag: '🎉 完美通过', cls: 'win', title: `${safe}/${this.rows} 全对！`, sub: '奖励一个盲盒 🎁', secs: 2.6 });
      G.burst('confetti', V(end.x, end.y + 1.1, end.z), { colors: RAINBOW, count: 44 });
      G.grantEgg('脆脆桥全对');
      pet.expr('happy', 'open', 2);
      await pet.idleAction('celebrate', 1.2);
    } else if (safe > 0) {
      G.reveal({ tag: '好险', cls: 'win', title: `踩对了 ${safe}/${this.rows}`, sub: `应援值 +${safe * 8}`, secs: 2.2 });
      G.addCheer(safe * 8);
      await pet.idleAction('wiggle', 1.0);
    } else {
      G.reveal({ tag: '全踩空', cls: 'lose', title: '0 块安全…', sub: '还好云朵是软的，下次一定行', secs: 2.2 });
      await pet.idleAction('tilt', 1.0);
    }
    const all = [...lucky.values()].filter((v) => v.n === this.rows);
    if (all.length) { G.award(all, 20, '脆脆桥全部猜对'); G.tick(`${all.length} 位全部猜对：应援 +20`, 'gold'); }
    pet.face(Math.PI / 2);
    this.done = true;
  }
}

Object.assign(GIMMICK_TYPES, { egg: EggSegment, worries: WorrySegment, domino: DominoSegment, boxes: BoxesSegment, crisp: CrispSegment });
