// 任务站：厨房做饭 & 打扫房间。
// 设计参考：
//  - Cooking Mama：一道菜 = 一串每个不到 10 秒的小任务（切菜 → 打蛋搅拌 → 煎饼翻面 → 裱花装饰）
//  - PowerWash Simulator：脏东西一擦就亮，进度看得见，"没有失败、只有满足"
//  - Unpacking / A Little to the Left：东西"啪"地放进属于它的位置，配上恰到好处的放置声
//  - Disney/Pixar 动画原则：预备 → 接触 → 跟随；眼睛看着手上的活儿
// 机位像美食节目：糯糯站在小操作台后面、面朝观众，小手和食物/物件都在画面正中。
//
// 动作的真实感：
//  - 糯糯的小手用 IK 去"够"东西：刀尖真的落在切口上、打蛋器真的在碗里转、拖把头真的贴着脏地板。
//    小短手够不着就像麻薯一样稍微拉长一点（最多约 2 倍），不会穿过身体。
//  - 道具平时放在台面上，用的时候拿起来、用完放回去（不会凭空出现 / 消失）。
//  - 圆滚滚的肚子挡在正前方，小手只够得到身体两侧前方的一小块地方：
//    所以台面边缘离肚子留出空隙，东西都放在右手边够得着的地方，换位置时糯糯在台子后面小碎步挪过去。
//  - 每个"接触"的瞬间（刀落到砧板、蛋敲到碗边、锅铲铲起松饼、拖把擦过）都在那一帧触发声音和特效。
import * as THREE from 'three';
import { Station } from './station.js';
import { roundedBox, blobGeometry } from '../world/geo.js';
import { buildTool, toolQuat } from '../pet/tools.js';
import { Spring, TAU, clamp, lerp, ease } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const RAINBOW = ['#ff8fb3', '#ffb37a', '#ffe27a', '#9be89b', '#7fd6ff', '#a99bff', '#e39bff'];
// 操作台任务：糯糯正对镜头（镜头在正前方，像美食节目）；地面任务：糯糯朝向镜头和前进方向之间
const FACE_BENCH = 0;
const FACE_FLOOR = 0.97;
// 操作台任务的机位：在糯糯左前方约 18°、俯角约 33°。糯糯用右手干活，
// 这个角度下右手和道具在画面里落在小脸的右下方，不会挡住眼睛；小脸几乎是正面
const TASK_CAM = V(-0.75, 1.6, 2.3);
const H = 0.3;      // 操作台台面高度：在糯糯肚子一半的位置，小手正好够得着
const EDGE = 0.62;  // 台面靠糯糯一侧的边（工作台坐标 z）：留出肚子前倾的空间，不会穿模
const LEAN = 0.15;  // 干活时身体前倾

class TaskStation extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.kind = 'task';
    this.tweens = [];
    this.prog = 0;
    this.tp = { tip: V(0, 0, 0), dir: V(0, -1, 0), side: V(1, 0, 0) }; // 右手道具的姿态（世界坐标）
    this.lp = V(0, 0, 0);  // 左手要去的位置（世界坐标）
    this.rp = V(0, 0, 0);  // 右手空手时要去的位置
    this.face = FACE_BENCH;
  }
  W(x, y, z) { return V(this.x0 + x, this.group.position.y + y, z); }
  topY() { return 0.02; }
  progress() { return this.done ? 1 : this.prog; }
  footstep() { return {}; }
  // 简单补间：返回 Promise，u 从 0 到 1
  tween(dur, fn) {
    return new Promise((res) => { this.tweens.push({ t: 0, dur: Math.max(1e-3, dur), fn, res }); fn(0); });
  }
  update(dt) {
    super.update(dt);
    if (this.carry) this.carry();
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur);
      tw.fn(u);
      if (u >= 1) { this.tweens.splice(i, 1); tw.res(); }
    }
  }
  dispose() { this.tweens = []; }

  // ---------------- 工作台坐标系 ----------------
  // 原点 = 糯糯干活时站的位置（就在小路上），+z = 糯糯面朝的方向（朝镜头），+x = 糯糯拿道具的右手一侧
  makeBench(x) {
    this.bench = new THREE.Group();
    this.bench.position.set(x, 0, 0);
    this.bench.rotation.y = this.face;
    this.group.add(this.bench);
    this.benchX = x;
    return this.bench;
  }
  B(x, y, z) { this.group.updateMatrixWorld(true); return this.bench.localToWorld(V(x, y, z)); }
  BD(x, y, z) { return V(x, y, z).applyAxisAngle(UP, this.face); }
  // 相对糯糯当前位置的点（糯糯在台子后面挪动时，小手的目标跟着走）；高度相对工作台
  PR(G, x, y, z) {
    const p = G.pet.root.position;
    return V(x, y, z).applyAxisAngle(UP, this.face).add(V(p.x, this.group.position.y, p.z));
  }
  bmesh(geo, mat, x = 0, y = 0, z = 0, parent = this.bench) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  mesh(geo, mat, x = 0, y = 0, z = 0, parent = this.group) { return this.bmesh(geo, mat, x, y, z, parent); }

  // 小操作台：圆润的台面 + 柜门 + 爱心把手（正面朝镜头）。糯糯站在它后面，只露出上半身和小脸
  counter(o = {}) {
    const { M, G } = this.ctx;
    const w = o.w || 1.8, d = o.d || 0.56, x = o.x || 0;
    const g = new THREE.Group();
    g.position.set(x, 0, EDGE + d / 2);
    this.bench.add(g);
    const top = M.soft(o.top || '#fffaf3', { rough: 0.4, rim: 0.35 });
    const body = M.soft(o.body || '#a8e6cf', { rough: 0.55, rim: 0.3 });
    const door = M.soft(o.door || '#c8f2df', { rough: 0.5, rim: 0.35 });
    const knob = M.soft(o.knob || '#ffd166', { rough: 0.3, rim: 0.5 });
    this.bmesh(G.track(roundedBox(w - 0.08, H - 0.07, d - 0.08, 0.05, 3).translate(0, 0.03 + (H - 0.07) / 2, 0)), body, 0, 0, 0, g);
    this.bmesh(G.track(roundedBox(w, 0.06, d, 0.028, 3).translate(0, H - 0.03, 0)), top, 0, 0, 0, g);
    this.bmesh(G.track(roundedBox(w - 0.14, 0.04, d - 0.12, 0.018, 2).translate(0, 0.02, 0)), M.soft(o.plinth || '#7fcfae', { rough: 0.6 }), 0, 0, 0, g);
    // 柜门：朝镜头的那一面（局部 +z）
    const n = Math.max(2, Math.round(w / 0.55));
    const dw = (w - 0.2) / n;
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + 0.1 + dw * (i + 0.5);
      this.bmesh(G.get(`counter|door|${dw.toFixed(3)}`, () => roundedBox(dw - 0.05, H - 0.15, 0.025, 0.02, 2)), door, cx, 0.03 + (H - 0.07) / 2, d / 2 - 0.035, g);
      this.bmesh(G.get('counter|knob', () => new THREE.SphereGeometry(0.022, 12, 8)), knob, cx + (i % 2 ? -1 : 1) * (dw / 2 - 0.07), 0.03 + (H - 0.07) / 2 + 0.02, d / 2 - 0.012, g);
    }
    this.counterW = w;
    return g;
  }

  // ---------------- 道具：平时放在台面上，拿起来用、用完放回去 ----------------
  // pose（工作台坐标）：tip 尖端位置，dir 握把→尖端方向，side 道具局部 +x 方向
  restTool(type, pose) {
    const obj = buildTool(type, this.ctx.M);
    obj.scale.setScalar(obj.userData.scale || 1);
    // 几何体登记到本关的回收列表（关卡结束统一释放，长时间直播不涨显存）
    obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; this.ctx.G.track(c.geometry); } });
    this.bench.add(obj);
    const rest = { obj, type, pose };
    this._placeRest(rest);
    return rest;
  }
  _placeRest(rest) {
    const { obj, pose } = rest;
    const q = toolQuat(pose.dir, pose.side);
    const tipLocal = obj.userData.tip.clone().multiplyScalar(obj.userData.scale || 1).applyQuaternion(q);
    obj.quaternion.copy(q);
    obj.position.copy(pose.tip).sub(tipLocal);
  }
  // 台面上那把道具此刻的世界姿态
  restPoseW(rest) {
    return { tip: this.B(rest.pose.tip.x, rest.pose.tip.y, rest.pose.tip.z), dir: this.BD(rest.pose.dir.x, rest.pose.dir.y, rest.pose.dir.z).normalize(), side: this.BD(rest.pose.side.x, rest.pose.side.y, rest.pose.side.z).normalize() };
  }
  gripW(rest) { this.group.updateMatrixWorld(true); return rest.obj.getWorldPosition(V(0, 0, 0)); }
  // 道具姿态（世界坐标）平滑移动到目标
  toolTo(pose, dur, e = ease.inOutSine) {
    const a = { tip: this.tp.tip.clone(), dir: this.tp.dir.clone(), side: this.tp.side.clone() };
    return this.tween(dur, (u) => {
      const k = e(u);
      this.tp.tip.lerpVectors(a.tip, pose.tip, k);
      this.tp.dir.lerpVectors(a.dir, pose.dir, k).normalize();
      this.tp.side.lerpVectors(a.side, pose.side, k).normalize();
    });
  }
  // 相对糯糯的道具姿态
  toolPR(G, x, y, z, dir, side) { return { tip: this.PR(G, x, y, z), dir: this.BD(dir[0], dir[1], dir[2]).normalize(), side: this.BD(side[0], side[1], side[2]).normalize() }; }
  moveL(to, dur, e = ease.inOutSine) { const a = this.lp.clone(); return this.tween(dur, (u) => this.lp.lerpVectors(a, to, e(u))); }
  moveR(to, dur, e = ease.inOutSine) { const a = this.rp.clone(); return this.tween(dur, (u) => this.rp.lerpVectors(a, to, e(u))); }

  // 伸手去拿台面上的道具：手先到握把，握住的那一刻台面上的道具换成手里的同一把（位置朝向完全一样）
  async pickTool(G, rest, dur = 0.38) {
    const pet = G.pet;
    this.rp.copy(pet.handWorld('R'));
    pet.reachTo('R', () => ({ pos: this.rp }));
    await this.moveR(this.gripW(rest), dur, ease.inOutQuad);
    rest.obj.visible = false;
    pet.hold(rest.type, { instant: true });
    const p = this.restPoseW(rest);
    this.tp.tip.copy(p.tip); this.tp.dir.copy(p.dir); this.tp.side.copy(p.side);
    pet.reachTo('R', () => this.tp, { snap: true });
    G.sfx('place', p.tip, { gain: -16, main: false });
    await G.wait(0.06);
  }
  // 放回台面原处
  async putTool(G, rest, dur = 0.4) {
    const pet = G.pet;
    await this.toolTo(this.restPoseW(rest), dur, ease.inOutQuad);
    G.sfx('place', this.tp.tip, { gain: -12, main: false });
    this.rp.copy(pet.handWorld('R'));
    pet.hold(null);
    rest.obj.visible = true;
    pet.reachTo('R', () => ({ pos: this.rp }), { snap: true });
    await this.moveR(this.rp.clone().add(V(0, 0.08, -0.05)), 0.18);
  }
  // 在台子后面横着小碎步挪一挪（dx：沿工作台 x 方向），手上的目标跟着一起走
  async shuffle(G, dx, dur = 0.2) {
    const pet = G.pet;
    const d = this.BD(dx, 0, 0);
    const p0 = pet.root.position.clone();
    const y0 = p0.y;
    let last = 0;
    await this.tween(dur, (u) => {
      const k = ease.inOutSine(u);
      const step = d.clone().multiplyScalar(k - last);
      last = k;
      pet.root.position.set(p0.x + d.x * k, y0 + Math.sin(u * Math.PI) * 0.018, p0.z + d.z * k);
      this.tp.tip.add(step); this.lp.add(step); this.rp.add(step);
    });
    pet.root.position.y = y0;
    pet.sq.kick(-0.7);
    pet.kickEars(0.8);
  }
  // 拿着道具走几步：道具和两只手的目标跟着身体一起平移
  // （不然身体会走进停在原地的扫帚 / 拖把里）
  async walkCarry(G, to, o) {
    const pet = G.pet;
    const last = pet.root.position.clone();
    this.carry = () => {
      const p = pet.root.position;
      const d = V(p.x - last.x, 0, p.z - last.z);
      last.copy(p);
      this.tp.tip.add(d); this.lp.add(d); this.rp.add(d);
    };
    try { await G.walkTo(to, o); } finally { this.carry = null; }
  }
  // 走到工作台后面、转身面向观众、身体微微前倾、左手轻轻搭在台面上
  async beginWork(G, o = {}) {
    const pet = G.pet;
    await G.walkTo(this.B(o.x || 0, 0, 0), { stepDur: 0.4, stride: 0.22 });
    pet.face(this.face);
    await G.wait(0.22);
    pet.setLean(o.lean ?? LEAN);
    this.lp.copy(pet.handWorld('L'));
    this.rp.copy(pet.handWorld('R'));
    pet.reachTo('L', () => ({ pos: this.lp }));
    await this.moveL(this.PR(G, -0.36, H + 0.03, EDGE + 0.05), 0.3);
  }
  async endWork(G) {
    const pet = G.pet;
    pet.release(null, { speed: 5 });
    pet.setLean(0);
    pet.gazeAt(null);
    pet.hold(null);
    await G.wait(0.2);
  }
}

// 弧线抛物：从 a 飞到 b（局部坐标），带一点旋转
function arc(obj, a, b, h, u) {
  obj.position.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u) + 4 * h * u * (1 - u), lerp(a.z, b.z, u));
}

// ================= 厨房 1. 切切蔬菜 =================
// 右手拿刀、左手扶着菜；一刀下去刀尖正好落在砧板上，切下的一片翻倒、排成整齐的一扇；
// 每切一刀，糯糯在台子后面往左挪一小步（左手顺着菜往后挪），刀口一直在右手正前方
export class ChopStation extends TaskStation {
  build() {
    const { M, G, rng } = this.ctx;
    const L = this.length;
    this.makeBench(L / 2 + 0.2);
    this.counter({ w: 2.0, x: -0.2 });
    // 砧板
    this.boardTop = H + 0.034;
    this.bmesh(G.track(roundedBox(1.42, 0.034, 0.36, 0.014, 2)), M.soft('#f2c99c', { rough: 0.7, rim: 0.25 }), 0.06, H + 0.017, EDGE + 0.21);
    // 一根长长的蔬菜，沿工作台 x 方向躺在砧板上
    const kind = this.def.veg || (rng.next() < 0.5 ? 'carrot' : 'cucumber');
    this.kind2 = kind;
    const carrot = kind === 'carrot';
    const skin = M.soft(carrot ? '#ff9a3d' : '#5fb35c', { rough: 0.5, rim: 0.3 });
    const flesh = M.soft(carrot ? '#ffb86b' : '#e3f7c6', { rough: 0.6, rim: 0.1 });
    this.colors = carrot ? ['#ffb86b', '#ff9a3d'] : ['#e3f7c6', '#5fb35c'];
    this.vegZ = EDGE + 0.12;
    this.T = 0.045; this.n = 6; this.cut0 = 0.36;
    const xL = -0.5, xR = this.cut0 + 0.06;
    const rAt = (x) => (carrot ? lerp(0.064, 0.036, clamp((x - xL) / (xR - xL), 0, 1)) : 0.056);
    this.rAt = rAt;
    // 切口位置（工作台坐标）：c_k = cut0 - k*T，k = 0..n-1；c_0 右边那一截是菜头
    const cuts = Array.from({ length: this.n }, (_, k) => this.cut0 - k * this.T);
    const piece = (a, b) => {
      const ra = rAt(a), rb = rAt(b);
      const geo = G.track(new THREE.CylinderGeometry(rb, ra, b - a, 22).rotateZ(Math.PI / 2));
      const m = this.bmesh(geo, [skin, flesh, flesh], (a + b) / 2, this.boardTop + Math.max(ra, rb), this.vegZ);
      return { m, a, b, r: Math.max(ra, rb) };
    };
    this.pieces = [];
    // 菜头（第一刀切下来）
    const tipR = rAt(xR);
    if (carrot) {
      const g = G.track(new THREE.ConeGeometry(rAt(cuts[0]), xR - cuts[0] + 0.05, 18).rotateZ(-Math.PI / 2));
      const m = this.bmesh(g, skin, (cuts[0] + xR + 0.05) / 2, this.boardTop + rAt(cuts[0]), this.vegZ);
      this.pieces.push({ m, a: cuts[0], b: xR, r: rAt(cuts[0]), end: true });
    } else {
      const g = new THREE.Group();
      g.position.set(cuts[0], this.boardTop + tipR, this.vegZ);
      this.bench.add(g);
      const cyl = new THREE.Mesh(G.track(new THREE.CylinderGeometry(tipR, tipR, xR - cuts[0], 22).rotateZ(Math.PI / 2).translate((xR - cuts[0]) / 2, 0, 0)), [skin, flesh, flesh]);
      const cap = new THREE.Mesh(G.track(new THREE.SphereGeometry(tipR, 18, 12, 0, TAU, 0, Math.PI / 2).rotateZ(-Math.PI / 2).translate(xR - cuts[0], 0, 0)), skin);
      for (const c of [cyl, cap]) { c.castShadow = true; g.add(c); }
      this.pieces.push({ m: g, a: cuts[0], b: xR, r: tipR, end: true, group: true });
    }
    for (let k = 1; k < this.n; k++) this.pieces.push(piece(cuts[k], cuts[k - 1]));
    // 剩下没切的一长段（左手扶着的地方）+ 菜尾
    const rest = piece(xL + 0.02, cuts[this.n - 1]);
    void rest;
    if (carrot) {
      for (let k = 0; k < 3; k++) {
        const lf = this.bmesh(G.get('chop|leaf', () => new THREE.ConeGeometry(0.024, 0.17, 8).translate(0, 0.085, 0)), M.soft('#6fcf6a', { rough: 0.6, rim: 0.3 }), xL + 0.02, this.boardTop + rAt(xL), this.vegZ + (k - 1) * 0.025);
        lf.rotation.z = Math.PI / 2 + 0.25 + (k - 1) * 0.3;
      }
    } else {
      this.bmesh(G.track(new THREE.SphereGeometry(0.056, 18, 12, 0, TAU, 0, Math.PI / 2).rotateZ(Math.PI / 2)), skin, xL + 0.02, this.boardTop + 0.056, this.vegZ);
    }
    // 小刀：放在台面右边，刀尖朝前
    this.knife = this.restTool('knife', { tip: V(0.74, H + 0.012, EDGE + 0.4), dir: V(0, 0, 1), side: V(1, 0, 0) });
    this.cutN = 0;
    this.total = this.n;
    return this;
  }
  async run(G) {
    const pet = G.pet, T = this.T;
    G.label(this.label);
    G.cam('task', { at: this.B(0.05, H, EDGE + 0.12), lookY: 0.1, dist: 0.98, off: TASK_CAM, cut: true });
    await this.beginWork(G);
    G.say(this.def.say || '切切切～');
    // 看着刀口
    pet.gazeAt(() => this.PR(G, this.cut0, this.boardTop, this.vegZ));
    await this.pickTool(G, this.knife);
    // 刀立起来、刀刃垂直于菜（刀面朝向 ±x）
    const blade = (y, tilt = 0.55) => this.toolPR(G, this.cut0, y, this.vegZ, [0, -1, tilt], [0, 0, 1]);
    const left = () => this.PR(G, -0.28, this.boardTop + 2 * this.rAt(-0.28 + this.benchOff()) + 0.006, this.vegZ - 0.01);
    await Promise.all([this.toolTo(blade(this.boardTop + 0.13), 0.35, ease.inOutQuad), this.moveL(left(), 0.35)]);
    for (let k = 0; k < this.n; k++) {
      const p = this.pieces[k];
      // 预备：抬刀
      await this.toolTo(blade(this.boardTop + 0.095, 0.5), 0.15, ease.outQuad);
      // 快速落下，刀尖碰到砧板的那一帧：声音 + 碎屑 + 这一片切下来
      await this.toolTo(blade(this.boardTop + 0.004, 0.55), 0.07, ease.inQuad);
      this.lp.y -= 0.008; // 左手跟着轻轻一按
      this._sliceOff(G, p, k);
      G.sfx('chop', this.tp.tip, { gain: -1 + G.rng() * 2 });
      G.burst('crumbs', this.tp.tip.clone().add(V(0, 0.02, 0)), { colors: this.colors, count: 4, scale: 0.3 });
      G.camBump(0.005);
      pet.sq.kick(-0.5);
      this.cutN++;
      this.prog = this.cutN / this.total;
      G.countStep();
      await G.wait(0.05);
      this.lp.y += 0.008;
      if (k === 1) { G.unsay(); pet.expr('happy', 'smile', 1); }
      // 往左挪一小步，下一刀还在右手正前方
      if (k < this.n - 1) await Promise.all([this.toolTo(blade(this.boardTop + 0.05, 0.5), 0.1), this.shuffle(G, -T, 0.16)]);
    }
    // 收刀：挪回原位，把刀放回台面右边
    await Promise.all([this.toolTo(blade(this.boardTop + 0.12), 0.18), this.moveL(this.PR(G, -0.36, H + 0.03, EDGE + 0.05), 0.2)]);
    await this.shuffle(G, (this.n - 1) * T, 0.32);
    await this.putTool(G, this.knife);
    G.burst('sparkles', this.B(0.6, this.boardTop + 0.08, EDGE + 0.18), { colors: ['#ffffff', '#fff2a8'], count: 14 });
    pet.expr('happy', 'open', 1.2);
    await this.endWork(G);
    await pet.idleAction('proud', 0.9);
    G.unsay();
  }
  // 糯糯相对工作台原点挪了多少（工作台 x 方向）
  benchOff() { return this.cutN > 0 ? -Math.min(this.cutN, this.n - 1) * this.T : 0; }
  // 切下来的一片：先往右分开一点，再翻倒平躺，滑到右边排成一扇
  _sliceOff(G, p, k) {
    const m = p.m;
    const from = m.position.clone();
    const fx = 0.5 + k * 0.03, fz = EDGE + 0.17 + k * 0.022;
    const flatY = this.boardTop + 0.026 + (k % 3) * 0.002;
    if (p.group) {
      // 菜头：整块往右滚一点
      const to = V(from.x + 0.14, from.y, from.z + 0.13);
      this.tween(0.35, (u) => { m.position.lerpVectors(from, to, ease.outQuad(u)); m.rotation.x = -u * 1.2; });
      return;
    }
    const to = V(fx, flatY, fz);
    this.tween(0.42, (u) => {
      if (u < 0.25) { const e = u / 0.25; m.position.set(from.x + 0.02 * e, from.y, from.z); return; }
      const e = (u - 0.25) / 0.75;
      const k2 = ease.outQuad(e);
      m.position.set(lerp(from.x + 0.02, to.x, k2), lerp(from.y, to.y, ease.inQuad(e)) + Math.sin(e * Math.PI) * 0.03, lerp(from.z, to.z, k2));
      m.rotation.z = -(Math.PI / 2) * ease.inOutQuad(Math.min(1, e * 1.4));
      m.rotation.y = 0.15 * e * (k % 2 ? 1 : -1);
    });
  }
}

// ================= 厨房 2. 打蛋 + 搅拌面糊 =================
// 从蛋托里拿起鸡蛋 → 在碗边轻轻敲两下（裂纹出现）→ 在碗上方掰开，蛋黄落进碗里 → 蛋壳放回蛋托
// → 拿起打蛋器在碗里一圈圈地搅（面糊纹路跟着打蛋器走）→ 提起来在碗边敲两下 → 放回原处
export class WhiskStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    this.makeBench(this.length / 2 - 0.1);
    this.counter({ w: 1.8 });
    // 碗
    this.bowlC = V(0.26, H, EDGE + 0.19);
    const bowl = new THREE.Group();
    bowl.position.copy(this.bowlC);
    this.bench.add(bowl);
    const bm = M.soft(this.def.bowlColor || '#9fd8ff', { rough: 0.22, rim: 0.55, rimColor: '#ffffff', side: THREE.DoubleSide });
    this.bmesh(G.track(new THREE.CylinderGeometry(0.17, 0.11, 0.13, 40, 1, true).translate(0, 0.065, 0)), bm, 0, 0, 0, bowl);
    this.bmesh(G.track(new THREE.CircleGeometry(0.11, 32).rotateX(-Math.PI / 2)), bm, 0, 0.004, 0, bowl);
    this.bmesh(G.track(new THREE.TorusGeometry(0.17, 0.012, 10, 48).rotateX(Math.PI / 2)), M.soft('#ffffff', { rough: 0.3, rim: 0.4 }), 0, 0.13, 0, bowl);
    // 碗里的面糊：画布贴图，打蛋、搅拌的纹路都画在上面
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    this.cv = c; this.g2 = c.getContext('2d');
    this.g2.fillStyle = '#fff8ee'; this.g2.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) { this.g2.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.5})`; this.g2.beginPath(); this.g2.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 0, TAU); this.g2.fill(); }
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.ctx.M.track({ dispose: () => this.tex.dispose() });
    this.batterR = 0.148;
    this.batterY = 0.085;
    this.batter = this.bmesh(G.track(new THREE.CircleGeometry(this.batterR, 48).rotateX(-Math.PI / 2)), M.track(new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.35 })), 0, this.batterY, 0, bowl);
    this.flour = this.bmesh(G.track(blobGeometry(0.08, 4, 0.08, 2).scale(1, 0.55, 1)), M.soft('#ffffff', { rough: 0.95, rim: 0.3 }), -0.03, this.batterY + 0.02, 0.01, bowl);
    this.bowl = bowl;
    this.bowlSq = new Spring(200, 8, 1);
    // 蛋托（两颗鸡蛋），在碗右边
    const tray = new THREE.Group();
    this.trayX = 1.0;
    tray.position.set(this.trayX, H, EDGE + 0.1);
    this.bench.add(tray);
    this.bmesh(G.track(roundedBox(0.22, 0.035, 0.12, 0.014, 2).translate(0, 0.0175, 0)), M.soft('#9fd8ff', { rough: 0.6, rim: 0.35 }), 0, 0, 0, tray);
    for (const x of [-0.05, 0.05]) this.bmesh(G.get('eggcup', () => new THREE.TorusGeometry(0.03, 0.01, 6, 16).rotateX(Math.PI / 2)), M.soft('#ffffff', { rough: 0.5 }), x, 0.036, 0, tray);
    this.eggMat = M.soft('#fff3e0', { rough: 0.55, rim: 0.3 });
    this.eggs = [-0.05, 0.05].map((x) => {
      const g = new THREE.Group();
      g.position.set(x, 0.03 + 0.048, 0);
      tray.add(g);
      const e = this.bmesh(G.get('egg', () => new THREE.SphereGeometry(0.045, 16, 12).scale(0.85, 1.1, 0.85)), this.eggMat, 0, 0, 0, g);
      void e;
      return { g, slot: g.position.clone() };
    });
    this.tray = tray;
    // 打蛋器：平放在台面上，把手朝糯糯
    this.whisk = this.restTool('whisk', { tip: V(0.56, H + 0.035, EDGE + 0.3), dir: V(0, 0, 1), side: V(1, 0, 0) });
    this.mix = 0;
    return this;
  }
  update(dt) {
    super.update(dt);
    const s = this.bowlSq.update(dt);
    this.bowl.scale.set(1 + (1 - s) * 0.4, s, 1 + (1 - s) * 0.4);
  }
  // 世界坐标 → 碗里面糊贴图上的像素
  _toTex(w) {
    this.group.updateMatrixWorld(true);
    const l = this.bowl.worldToLocal(w.clone());
    return [(l.x / (2 * this.batterR) + 0.5) * 256, (l.z / (2 * this.batterR) + 0.5) * 256];
  }
  _paintYolk(w) {
    const [px, py] = this._toTex(w);
    const g = this.g2;
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.arc(px, py, 30, 0, TAU); g.fill();
    g.fillStyle = '#ffc93c'; g.beginPath(); g.arc(px, py, 16, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(px - 5, py - 5, 5, 0, TAU); g.fill();
    this.tex.needsUpdate = true;
  }
  async _egg(G, i) {
    const pet = G.pet, { M, G: GB } = this.ctx;
    const egg = this.eggs[i];
    // 1) 往右挪到蛋托前，伸手拿起鸡蛋，再挪回碗前
    const SH = this.trayX - 0.5;
    await this.shuffle(G, SH, 0.4);
    this.group.updateMatrixWorld(true);
    await this.moveR(egg.g.getWorldPosition(V(0, 0, 0)).add(V(0, 0.035, 0)), 0.3, ease.inOutQuad);
    pet.grab('R', egg.g);
    G.sfx('place', this.rp, { gain: -16, main: false });
    await this.moveR(this.rp.clone().add(V(0, 0.1, 0)), 0.15, ease.outQuad);
    await this.shuffle(G, -SH, 0.4);
    // 2) 举到碗边，轻轻敲两下（第一下就出现裂纹）
    const rim = this.B(this.bowlC.x + 0.12, H + 0.13 + 0.05, this.bowlC.z - 0.05);
    await this.moveR(rim.clone().add(V(0, 0.07, 0)), 0.3, ease.inOutQuad);
    let crack = null;
    for (let k = 0; k < 2; k++) {
      await this.moveR(rim.clone().add(V(0, 0.045, 0)), 0.11, ease.outQuad);
      await this.moveR(rim, 0.06, ease.inQuad);
      G.sfx('ice_crack', rim, { gain: k ? -8 : -11 });
      pet.sq.kick(-0.4);
      if (!crack) {
        crack = new THREE.Mesh(GB.get('egg|crack', () => new THREE.TorusGeometry(0.039, 0.0035, 4, 18).rotateX(Math.PI / 2)), M.soft('#c99b6b', { rough: 0.8 }));
        egg.g.add(crack);
      }
      await G.wait(0.06);
    }
    // 3) 到碗中间上方掰开：两半蛋壳分开，蛋黄落进碗里
    const over = this.B(this.bowlC.x + 0.04, H + 0.25, this.bowlC.z - 0.07);
    await this.moveR(over, 0.28, ease.inOutQuad);
    pet.drop('R', this.bench);
    egg.g.remove(crack);
    egg.g.children[0].visible = false;
    const halves = [];
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(GB.get('egg|half', () => new THREE.SphereGeometry(0.045, 16, 8, 0, TAU, 0, Math.PI / 2).scale(0.85, 1.1, 0.85)), M.soft('#fff3e0', { rough: 0.55, rim: 0.3, side: THREE.DoubleSide }));
      h.rotation.z = s > 0 ? 0 : Math.PI;
      egg.g.add(h);
      halves.push({ h, s });
    }
    const yolk = this.bmesh(GB.get('egg|yolk', () => new THREE.SphereGeometry(0.03, 14, 10)), M.soft('#ffc93c', { rough: 0.2, rim: 0.4 }), 0, 0, 0, egg.g);
    this.tween(0.25, (u) => { for (const { h, s } of halves) { h.position.x = s * 0.03 * u; h.rotation.z = (s > 0 ? 0 : Math.PI) - s * 1.0 * u; } });
    const land = this.B(this.bowlC.x + (i ? 0.04 : -0.04), H + this.batterY + 0.01, this.bowlC.z + (i ? -0.03 : 0.03));
    const y0 = yolk.getWorldPosition(V(0, 0, 0));
    this.bench.attach(yolk);
    const l0 = yolk.position.clone(), l1 = this.bench.worldToLocal(land.clone());
    await this.tween(0.24, (u) => yolk.position.set(lerp(l0.x, l1.x, u), lerp(l0.y, l1.y, u * u), lerp(l0.z, l1.z, u)));
    void y0;
    this.bench.remove(yolk);
    this._paintYolk(land);
    G.sfx('plop', land, { gain: -5 });
    G.burst('water', land, { colors: ['#ffe9a8', '#ffffff'], count: 5, scale: 0.35 });
    this.bowlSq.x = 0.92;
    // 4) 蛋壳合起来，挪过去放回蛋托
    pet.grab('R', egg.g);
    this.tween(0.2, (u) => { for (const { h, s } of halves) { h.position.x = s * 0.03 * (1 - u); h.rotation.z = (s > 0 ? 0 : Math.PI) - s * 1.0 * (1 - u) * 0.6; } });
    await this.shuffle(G, SH, 0.4);
    this.group.updateMatrixWorld(true);
    const slotW = this.tray.localToWorld(egg.slot.clone()).add(V(0, 0.035, 0));
    await this.moveR(slotW.clone().add(V(0, 0.06, 0)), 0.3, ease.inOutQuad);
    await this.moveR(slotW, 0.1);
    pet.drop('R', this.tray);
    egg.g.position.copy(egg.slot);
    egg.g.quaternion.identity();
    G.sfx('place', slotW, { gain: -14, main: false });
    await this.moveR(slotW.clone().add(V(-0.05, 0.08, -0.05)), 0.15);
    await this.shuffle(G, -SH, 0.4);
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.B(0.25, H, EDGE + 0.1), lookY: 0.12, dist: 0.95, off: TASK_CAM, cut: true });
    await this.beginWork(G);
    G.say(this.def.say || '先打两个蛋～');
    pet.gazeAt(() => this.rp);
    this.rp.copy(pet.handWorld('R'));
    pet.reachTo('R', () => ({ pos: this.rp }));
    for (let i = 0; i < 2; i++) await this._egg(G, i);
    G.unsay();
    this.prog = 0.3;
    // 搅拌
    G.say('搅呀搅～');
    pet.gazeAt(() => this.tp.tip);
    await this.pickTool(G, this.whisk);
    const center = this.B(this.bowlC.x, H + this.batterY + 0.012, this.bowlC.z);
    const into = (a, r, lift = 0) => {
      const tip = center.clone().add(this.BD(Math.cos(a) * r, 0, Math.sin(a) * r)).add(V(0, lift, 0));
      // 打蛋器微微向画圈的外侧倾斜
      const dir = this.BD(-0.25 + Math.cos(a) * 0.12, -0.85, 0.45 + Math.sin(a) * 0.12).normalize();
      return { tip, dir, side: this.BD(1, 0, 0) };
    };
    await this.toolTo(into(0, 0.07, 0.12), 0.3, ease.inOutQuad);
    await this.toolTo(into(0, 0.07), 0.15, ease.inQuad);
    const revs = 7, per = 0.56;
    let lastTex = null;
    let rev = 0;
    await this.tween(revs * per, (u) => {
      const a = u * revs * TAU;
      const r = 0.07 + Math.sin(u * 37) * 0.012;
      const p = into(a, r);
      this.tp.tip.copy(p.tip); this.tp.dir.copy(p.dir); this.tp.side.copy(p.side);
      // 面糊上的纹路：打蛋器划过哪里就画在哪里，颜色慢慢混成均匀的奶油色
      this.mix = u;
      const [px, py] = this._toTex(p.tip);
      const g = this.g2;
      const col = `rgb(255,${Math.round(lerp(214, 226, u))},${Math.round(lerp(110, 168, u))})`;
      if (lastTex) {
        g.lineCap = 'round';
        g.strokeStyle = col; g.globalAlpha = 0.55; g.lineWidth = 9;
        g.beginPath(); g.moveTo(lastTex[0], lastTex[1]); g.lineTo(px, py); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2; g.globalAlpha = 1;
        g.beginPath(); g.moveTo(lastTex[0] + 5, lastTex[1] + 3); g.lineTo(px + 5, py + 3); g.stroke();
        g.globalAlpha = 0.015 + u * 0.03; g.fillStyle = '#ffe2a6'; g.fillRect(0, 0, 256, 256); g.globalAlpha = 1;
        this.tex.needsUpdate = true;
      }
      lastTex = [px, py];
      this.flour.scale.setScalar(Math.max(0.05, 1 - u * 1.25));
      this.batter.rotation.y += 0.004;
      const nr = Math.floor(u * revs);
      if (nr > rev) {
        rev = nr;
        this.prog = 0.3 + 0.7 * u;
        if (rev % 2 === 1) G.sfx('slime_squish', p.tip, { gain: -6, maxDur: 1.2 });
        G.burst('water', p.tip.clone().add(V(0, 0.02, 0)), { colors: ['#ffe2a6', '#fff8ee'], count: 2, scale: 0.25 });
        G.countStep();
      }
    });
    this.flour.visible = false;
    this.g2.fillStyle = '#ffe2a6'; this.g2.globalAlpha = 0.85; this.g2.fillRect(0, 0, 256, 256); this.g2.globalAlpha = 1;
    this.g2.strokeStyle = 'rgba(255,255,255,0.7)'; this.g2.lineWidth = 3;
    for (let r = 20; r < 120; r += 14) { this.g2.beginPath(); this.g2.arc(128, 128, r, r * 0.05, r * 0.05 + 4.2); this.g2.stroke(); }
    this.tex.needsUpdate = true;
    G.unsay();
    // 提起来，在碗边敲两下，把面糊抖干净
    const rimTap = this.B(this.bowlC.x + 0.15, H + 0.135, this.bowlC.z - 0.04);
    const tapPose = (lift) => ({ tip: rimTap.clone().add(V(0, lift, 0)), dir: this.BD(0.55, -0.6, 0.3).normalize(), side: this.BD(0, 0, 1) });
    await this.toolTo(tapPose(0.12), 0.3, ease.inOutQuad);
    G.burst('water', this.tp.tip.clone(), { colors: ['#ffe2a6'], count: 3, scale: 0.25 });
    for (let k = 0; k < 2; k++) {
      await this.toolTo(tapPose(0.05), 0.08, ease.outQuad);
      await this.toolTo(tapPose(0), 0.05, ease.inQuad);
      G.sfx('place', rimTap, { gain: -9 });
      this.bowlSq.x = 0.96;
    }
    await this.putTool(G, this.whisk);
    G.burst('sparkles', this.B(this.bowlC.x, H + 0.2, this.bowlC.z), { colors: ['#ffffff', '#fff2a8'], count: 14 });
    this.prog = 1;
    pet.expr('happy', 'open', 1.2);
    await this.endWork(G);
    await pet.idleAction('celebrate', 0.8);
  }
}

// ================= 厨房 3. 煎松饼（倒面糊 → 冒泡 → 翻面 → 铲到盘子上） =================
export class PanStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    const L = this.length;
    this.makeBench(L / 2 - 0.3);
    this.counter({ w: 2.1, x: 0.25 });
    // 电陶炉 + 平底锅（锅柄朝右后方）
    this.panC = V(0.28, H, EDGE + 0.2);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.21, 0.22, 0.025, 40).translate(0, 0.0125, 0)), M.soft('#ffffff', { rough: 0.35, rim: 0.3 }), this.panC.x, H, this.panC.z);
    this.bmesh(G.track(new THREE.TorusGeometry(0.15, 0.012, 8, 40).rotateX(Math.PI / 2)), M.soft('#ff8a65', { rough: 0.4, emissive: '#ff6a3d', ei: 0.5 }), this.panC.x, H + 0.026, this.panC.z);
    const pan = new THREE.Group();
    pan.position.set(this.panC.x, H + 0.027, this.panC.z);
    this.bench.add(pan);
    const pc = this.def.panColor || '#5fb8c9';
    this.bmesh(G.track(new THREE.CylinderGeometry(0.175, 0.155, 0.035, 40).translate(0, 0.0175, 0)), M.soft(pc, { rough: 0.35, rim: 0.4 }), 0, 0, 0, pan);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.158, 0.158, 0.004, 40)), M.soft('#3d4a5c', { rough: 0.3 }), 0, 0.036, 0, pan);
    this.bmesh(G.track(new THREE.TorusGeometry(0.172, 0.011, 8, 48).rotateX(Math.PI / 2)), M.soft(pc, { rough: 0.35 }), 0, 0.035, 0, pan);
    // 长长的锅柄朝着糯糯的左手（左手握着锅柄、右手倒面糊 / 翻松饼，像真的在煎）
    const handle = this.bmesh(G.track(new THREE.CapsuleGeometry(0.022, 0.33, 4, 10).rotateZ(Math.PI / 2)), M.soft('#ffb3d1', { rough: 0.5, rim: 0.3 }), -0.3175, 0.03, -0.1455, pan);
    handle.rotation.y = -0.43;
    this.panGrip = V(-0.454, 0.052, -0.208); // 锅柄靠末端的握手处（锅的局部坐标）
    this.pan = pan;
    this.panTop = 0.038;
    // 量杯（装着面糊）：在锅右边
    // 量杯：杯口朝上立在台面上（dir = 道具局部 -y 朝下），杯嘴朝前
    this.jug = this.restTool('jug', { tip: V(0.64, H + 0.132, EDGE + 0.19), dir: V(0, -1, 0), side: V(1, 0, 0) });
    // 锅铲：斜靠在锅边的小架子上（把手朝糯糯）
    this.spatula = this.restTool('spatula', { tip: V(0.56, H + 0.02, EDGE + 0.36), dir: V(0, -0.38, 0.92), side: V(1, 0, 0) });
    // 盘子：再往右（糯糯挪过去放）
    this.plateX = 0.98;
    this.plateC = V(this.plateX, H, EDGE + 0.17);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.15, 0.12, 0.02, 36).translate(0, 0.01, 0)), M.soft('#ffffff', { rough: 0.3, rim: 0.35 }), this.plateC.x, H, this.plateC.z);
    // 三张松饼（侧面金黄、上面是生面糊色、下面是煎好的金黄色）
    const side = M.soft('#f0b45a', { rough: 0.6 }), raw = M.soft('#ffe9b8', { rough: 0.5 }), gold = M.soft('#e9a043', { rough: 0.55, rim: 0.2 });
    const geo = G.get('pancake', () => new THREE.CylinderGeometry(0.115, 0.115, 0.024, 32));
    this.cakes = [0, 1, 2].map(() => { const m = this.bmesh(geo, [side, raw, gold], 0, this.panTop + 0.012, 0, pan); m.visible = false; return m; });
    // 面糊上的小气泡
    this.bub = new THREE.InstancedMesh(G.get('pancake|bub', () => new THREE.SphereGeometry(0.008, 6, 4)), M.soft('#fff7e0', { rough: 0.3 }), 14);
    this.bub.count = 0;
    pan.add(this.bub);
    this.bubbles = [];
    // 倒面糊的那一道细流
    this.stream = this.bmesh(G.get('pancake|stream', () => new THREE.CylinderGeometry(0.009, 0.013, 1, 10, 1, true).translate(0, -0.5, 0)), M.soft('#ffe2a6', { rough: 0.35 }));
    this.stream.visible = false;
    this.stack = 0;
    this.panSq = new Spring(220, 9, 1);
    return this;
  }
  update(dt) {
    super.update(dt);
    const s = this.panSq.update(dt);
    this.pan.scale.set(1, s, 1);
    if (this.bubbles.length) {
      const m4 = new THREE.Matrix4();
      let n = 0;
      for (const b of this.bubbles) {
        b.t += dt;
        if (b.t < 0 || b.t > b.life) continue;
        const k = Math.sin(Math.min(1, b.t / b.life) * Math.PI);
        m4.compose(V(b.x, this.panTop + 0.025, b.z), new THREE.Quaternion(), V(k, k * 0.6, k));
        this.bub.setMatrixAt(n++, m4);
      }
      this.bub.count = n;
      this.bub.instanceMatrix.needsUpdate = true;
    }
  }
  _panW(x, y, z) { this.group.updateMatrixWorld(true); return this.pan.localToWorld(V(x, y, z)); }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.B(0.42, H, EDGE + 0.12), lookY: 0.1, dist: 1.0, off: TASK_CAM, cut: true });
    await this.beginWork(G);
    G.say(this.def.say || '煎松饼喽～');
    const r = G.rng;
    // 量杯姿态：杯嘴在 (锅中心附近 + lift)，tilt = 向前倾倒的角度（0 = 立着）
    const panUp = (lift, tilt = 0) => ({ tip: this._panW(0.07, this.panTop + lift, -0.05), dir: this.BD(0, -Math.cos(tilt), -Math.sin(tilt)).normalize(), side: this.BD(1, 0, 0) });
    // 左手握住 / 松开锅柄
    const grip = () => this._panW(this.panGrip.x, this.panGrip.y, this.panGrip.z);
    const holdPan = async () => { await this.moveL(grip(), 0.3, ease.inOutQuad); pet.reachTo('L', () => ({ pos: grip() })); };
    const letGo = async () => { this.lp.copy(grip()); pet.reachTo('L', () => ({ pos: this.lp })); await this.moveL(this.PR(G, -0.36, H + 0.03, EDGE + 0.05), 0.2, ease.inOutQuad); };
    const panX0 = this.pan.position.x, panY0 = this.pan.position.y;
    for (let k = 0; k < this.cakes.length; k++) {
      const cake = this.cakes[k];
      pet.gazeAt(() => this._panW(0, this.panTop, 0));
      await holdPan();
      // 1) 拿起量杯，杯嘴对准锅中间，慢慢倾斜：一道细细的面糊流进锅里，摊成圆圆的一张
      await this.pickTool(G, this.jug);
      await this.toolTo(panUp(0.15, 0), 0.4, ease.inOutQuad);
      await this.toolTo(panUp(0.085, 1.35), 0.4, ease.inOutQuad);
      cake.visible = true; cake.rotation.set(0, 0, 0); cake.position.set(0.03, this.panTop + 0.012, -0.02); cake.scale.set(0.15, 1, 0.15);
      this.stream.visible = true;
      const sz = G.sfx('slime_pull', this.tp.tip, { gain: -8, maxDur: 1.3 });
      void sz;
      await this.tween(0.9, (u) => {
        // 面糊流：从杯嘴垂直落到锅里
        const top = this.tp.tip.clone();
        this.bench.updateMatrixWorld(true);
        const lt = this.bench.worldToLocal(top.clone());
        const bottomY = H + 0.027 + this.panTop + 0.02;
        this.stream.position.copy(lt);
        this.stream.scale.set(1 - 0.5 * Math.max(0, u - 0.8) * 5, Math.max(0.01, lt.y - bottomY), 1 - 0.5 * Math.max(0, u - 0.8) * 5);
        const s = 0.15 + 0.85 * ease.outCubic(u);
        cake.scale.set(s, 1, s);
        const bt = pet.tool && pet.tool.userData.batter;
        if (bt) bt.scale.setScalar(Math.max(0.05, 1 - u * 0.8));
      });
      this.stream.visible = false;
      await this.toolTo(panUp(0.15, 0), 0.3, ease.inOutQuad);
      await this.putTool(G, this.jug);
      if (k === 0) G.unsay();
      // 2) 滋滋煎着，表面冒小泡泡
      const sizzle = G.sfx('sizzle', this._panW(0, 0.05, 0), { gain: -9, main: false });
      this.bubbles = Array.from({ length: 14 }, () => ({ x: 0.03 + r() * 0.16 - 0.08, z: -0.02 + r() * 0.16 - 0.08, t: -r() * 1.0, life: 0.5 + r() * 0.6 }));
      // 左手握着锅柄轻轻晃一晃锅（松饼在锅里跟着滑一滑）
      await this.tween(0.75, (u) => { this.pan.position.x = panX0 + Math.sin(u * TAU * 3) * 0.011 * (1 - u); });
      this.pan.position.x = panX0;
      // 3) 拿起锅铲，从松饼边上铲进去，往上一挑：松饼在空中翻个面落回锅里
      await this.pickTool(G, this.spatula);
      const near = this._panW(0, this.panTop + 0.006, -0.17), under = this._panW(0, this.panTop + 0.004, 0.03);
      const flat = this.BD(0, -0.71, 0.71).normalize(), sideX = this.BD(1, 0, 0);
      await this.toolTo({ tip: near.clone().add(V(0, 0.06, 0)), dir: flat, side: sideX }, 0.35, ease.inOutQuad);
      await this.toolTo({ tip: near, dir: flat, side: sideX }, 0.12, ease.inQuad);
      G.sfx('place', near, { gain: -14, main: false });
      await this.toolTo({ tip: under, dir: flat, side: sideX }, 0.22, ease.outQuad);
      this.bubbles = [];
      // 挑起来：手腕往上一翻
      G.sfx('whoosh', under, { gain: -9, main: false });
      const lift = this.toolTo({ tip: under.clone().add(V(0, 0.08, -0.02)), dir: this.BD(0, -0.35, 0.94).normalize(), side: sideX }, 0.14, ease.outQuad);
      const c0 = cake.position.clone();
      // 翻的同时左手把锅往上轻轻一颠
      this.tween(0.22, (u) => { this.pan.position.y = panY0 + Math.sin(u * Math.PI) * 0.014; }).then(() => { this.pan.position.y = panY0; });
      await this.tween(0.6, (u) => {
        cake.position.set(lerp(c0.x, 0, u), c0.y + 4 * 0.2 * u * (1 - u), lerp(c0.z, 0, u));
        cake.rotation.x = Math.PI * ease.inOutQuad(u);
      });
      await lift;
      cake.position.set(0, this.panTop + 0.012, 0);
      G.sfx('place', this._panW(0, 0.05, 0), { gain: -7 });
      G.burst('crumbs', this._panW(0, 0.07, 0), { colors: ['#f0b45a', '#ffe9b8'], count: 5, scale: 0.35 });
      this.panSq.x = 0.85;
      G.camBump(0.01);
      await G.wait(0.6);
      if (sizzle) G.stopSfx(sizzle, 0.4);
      // 4) 再铲起来，糯糯端着锅铲往右挪两步，把松饼滑到盘子上
      await this.toolTo({ tip: near.clone().add(V(0, 0.01, 0)), dir: flat, side: sideX }, 0.25, ease.inOutQuad);
      await this.toolTo({ tip: under, dir: flat, side: sideX }, 0.18, ease.outQuad);
      // 松饼放到锅铲上，跟着锅铲走
      this.group.updateMatrixWorld(true);
      pet.root.updateMatrixWorld(true);
      const carry = this.tp.tip;
      const off = this.pan.localToWorld(cake.position.clone()).sub(carry);
      this.bench.attach(cake);
      const follow = () => { const w = carry.clone().add(off); w.y = Math.max(w.y, carry.y + 0.012); this.bench.worldToLocal(w); cake.position.copy(w); };
      this.tweens.push({ t: 0, dur: 99, fn: follow, res: () => {}, tag: 'follow' });
      await Promise.all([this.toolTo({ tip: under.clone().add(V(0, 0.09, 0)), dir: flat, side: sideX }, 0.25, ease.outQuad), letGo()]);
      await this.shuffle(G, 0.42, 0.42);
      const plateTop = this.B(this.plateC.x, H + 0.02 + this.stack * 0.024 + 0.012, this.plateC.z);
      await this.toolTo({ tip: plateTop.clone().add(V(0, 0.04, 0.06)), dir: flat, side: sideX }, 0.3, ease.inOutQuad);
      // 锅铲往后一抽，松饼留在盘子上
      this.tweens = this.tweens.filter((t) => t.tag !== 'follow');
      const cp = cake.position.clone(), cpT = this.bench.worldToLocal(plateTop.clone());
      this.tween(0.16, (u) => cake.position.lerpVectors(cp, cpT, ease.inQuad(u)));
      await this.toolTo({ tip: plateTop.clone().add(this.BD(0, 0.05, -0.16)), dir: flat, side: sideX }, 0.2, ease.inQuad);
      cake.position.copy(cpT);
      this.stack++;
      G.sfx('place', plateTop, { gain: -5 });
      G.countStep();
      this.prog = (k + 1) / this.cakes.length;
      if (k === 1) pet.expr('happy', 'smile', 1);
      await this.shuffle(G, -0.42, 0.42);
      await this.putTool(G, this.spatula);
    }
    // 最后放一小块黄油
    await this.shuffle(G, 0.42, 0.42);
    const top = this.B(this.plateC.x, H + 0.02 + this.stack * 0.024 + 0.018, this.plateC.z);
    const butter = this.bmesh(this.ctx.G.track(roundedBox(0.05, 0.026, 0.05, 0.009, 2)), this.ctx.M.soft('#fff1a8', { rough: 0.3, rim: 0.4 }), 0, 0, 0);
    this.rp.copy(pet.handWorld('R'));
    pet.reachTo('R', () => ({ pos: this.rp }));
    butter.position.copy(this.bench.worldToLocal(pet.handWorld('R').add(V(0, -0.03, 0))));
    pet.grab('R', butter, { upright: true });
    await this.moveR(top.clone().add(V(0, 0.08, 0)), 0.35, ease.inOutQuad);
    pet.drop('R', this.bench);
    const b0 = butter.position.clone(), b1 = this.bench.worldToLocal(top.clone());
    await this.tween(0.16, (u) => butter.position.lerpVectors(b0, b1, u * u));
    G.sfx('plop', top, { gain: -4 });
    G.burst('sparkles', top.clone().add(V(0, 0.08, 0)), { colors: ['#ffffff', '#fff2a8'], count: 14 });
    G.say('松饼好啦～');
    pet.expr('happy', 'open', 1.4);
    await this.endWork(G);
    await pet.idleAction('celebrate', 0.9);
    G.unsay();
  }
}

// ================= 厨房 4. 裱花蛋糕 =================
// 拿起裱花袋，袋口贴着蛋糕表面挤出一朵奶油花；转台转一格，再挤下一朵；最后放一颗大草莓
export class CreamStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    this.makeBench(this.length / 2 - 0.15);
    this.counter({ w: 1.9, x: 0.15 });
    this.cakeC = V(0.4, H, EDGE + 0.2);
    const stand = new THREE.Group();
    stand.position.copy(this.cakeC);
    this.bench.add(stand);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.05, 0.08, 0.03, 20).translate(0, 0.015, 0)), M.soft('#ffffff', { rough: 0.3, rim: 0.3 }), 0, 0, 0, stand);
    const turn = new THREE.Group();
    turn.position.y = 0.03;
    stand.add(turn);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.19, 0.18, 0.016, 40).translate(0, 0.008, 0)), M.soft('#ffffff', { rough: 0.3, rim: 0.35 }), 0, 0, 0, turn);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 40).translate(0, 0.046, 0)), M.soft('#fff6fa', { rough: 0.8, rim: 0.35 }), 0, 0, 0, turn);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.153, 0.153, 0.018, 40).translate(0, 0.085, 0)), M.soft(this.def.layer || '#ff9ec4', { rough: 0.6 }), 0, 0, 0, turn);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.15, 0.15, 0.045, 40).translate(0, 0.116, 0)), M.soft('#ffffff', { rough: 0.85, rim: 0.35 }), 0, 0, 0, turn);
    this.top = 0.139;
    this.turn = turn;
    // 奶油花：三层小圈一层比一层小，像真的裱花
    const rosG = G.get('rosette', () => {
      const parts = [new THREE.TorusGeometry(0.026, 0.013, 8, 18).rotateX(Math.PI / 2).translate(0, 0.007, 0), new THREE.TorusGeometry(0.017, 0.011, 8, 16).rotateX(Math.PI / 2).translate(0, 0.021, 0), new THREE.TorusGeometry(0.009, 0.009, 8, 14).rotateX(Math.PI / 2).translate(0, 0.033, 0), new THREE.ConeGeometry(0.007, 0.018, 8).translate(0, 0.044, 0)];
      return mergeGeoms(parts);
    });
    this.roses = [];
    for (let i = 0; i < 8; i++) {
      const m = this.bmesh(rosG, M.soft(i % 2 ? '#ffd6e8' : '#ffffff', { rough: 0.75, rim: 0.35 }), 0, this.top, 0, turn);
      m.scale.setScalar(0.001);
      this.roses.push(m);
    }
    // 裱花袋：斜放在台面上
    this.bag = this.restTool('piping', { tip: V(0.7, H + 0.035, EDGE + 0.3), dir: V(0.1, -0.12, 0.99), side: V(1, 0, 0) });
    // 一小碗草莓：在更右边（糯糯挪过去拿）
    this.berryBowlC = V(1.06, H, EDGE + 0.12);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.09, 0.06, 0.06, 24, 1, true).translate(0, 0.03, 0)), M.soft('#c9e8ff', { rough: 0.25, rim: 0.5, side: THREE.DoubleSide }), this.berryBowlC.x, H, this.berryBowlC.z);
    this.bmesh(G.track(new THREE.CircleGeometry(0.06, 20).rotateX(-Math.PI / 2)), M.soft('#c9e8ff', { rough: 0.3 }), this.berryBowlC.x, H + 0.003, this.berryBowlC.z);
    const berryG = G.get('berry', () => new THREE.SphereGeometry(0.035, 16, 12).scale(1, 1.2, 1));
    const leafG = G.get('berryLeaf', () => new THREE.ConeGeometry(0.025, 0.016, 6));
    this.berries = [-0.03, 0.03].map((dx, i) => {
      const b = new THREE.Group();
      b.position.set(this.berryBowlC.x + dx, H + 0.045 + i * 0.01, this.berryBowlC.z + (i ? 0.02 : -0.02));
      this.bench.add(b);
      this.bmesh(berryG, M.soft('#ff4d6d', { rough: 0.35, rim: 0.4 }), 0, 0, 0, b);
      this.bmesh(leafG, M.soft('#6fcf6a', { rough: 0.6 }), 0, 0.04, 0, b);
      return b;
    });
    return this;
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.B(0.35, H + 0.08, EDGE + 0.12), lookY: 0.1, dist: 0.95, off: TASK_CAM, cut: true });
    await this.beginWork(G);
    G.say(this.def.say || '挤一圈奶油花～');
    // 挤花的位置：蛋糕表面靠近糯糯右手的那一点（转台转，裱花袋不动）
    const ringR = 0.105;
    const spotA = -2.35; // 在蛋糕局部坐标里的角度（朝向糯糯右手一侧）
    this.group.updateMatrixWorld(true);
    const spot = () => this.B(this.cakeC.x + Math.cos(spotA) * ringR, H + 0.03 + this.top, this.cakeC.z + Math.sin(spotA) * ringR);
    pet.gazeAt(spot);
    await this.pickTool(G, this.bag);
    const bagDir = this.BD(-0.25, -0.8, 0.55).normalize();
    const bagPose = (lift) => ({ tip: spot().add(V(0, lift, 0)), dir: bagDir, side: this.BD(1, 0, 0) });
    await this.toolTo(bagPose(0.1), 0.4, ease.inOutQuad);
    let base = this.turn.rotation.y;
    for (let i = 0; i < this.roses.length; i++) {
      const m = this.roses[i];
      await this.toolTo(bagPose(0.006), 0.14, ease.inQuad);
      // 挤：袋子被捏扁一点，奶油花从袋口长出来，一边长一边旋
      const la = spotA + base; // 这一朵在转台局部坐标里的角度（转台转了 base）
      m.position.set(Math.cos(la) * ringR, this.top, Math.sin(la) * ringR);
      G.sfx('squishy_press', spot(), { gain: -8, maxDur: 0.9 });
      const tool = pet.tool;
      await this.tween(0.38, (u) => {
        m.scale.setScalar(Math.max(0.001, ease.outBack(u)));
        m.rotation.y = -la + (1 - u) * 1.6;
        if (tool) tool.scale.set(1 + 0.08 * Math.sin(u * Math.PI), 1 - 0.1 * Math.sin(u * Math.PI), 1 + 0.08 * Math.sin(u * Math.PI));
        this.tp.tip.copy(spot()).add(V(0, 0.006 + 0.03 * u, 0));
      });
      if (tool) tool.scale.setScalar(tool.userData.scale || 1);
      this.prog = (i + 1) / (this.roses.length + 1);
      G.countStep();
      await this.toolTo(bagPose(0.06), 0.1, ease.outQuad);
      if (i === 2) G.unsay();
      if (i < this.roses.length - 1) { const b0 = base; base += TAU / this.roses.length; await this.tween(0.3, (u) => { this.turn.rotation.y = b0 + (TAU / this.roses.length) * ease.inOutSine(u); }); }
    }
    await this.putTool(G, this.bag);
    // 往右挪两步，从小碗里拿一颗大草莓，放到蛋糕正中间
    await this.shuffle(G, 0.48, 0.42);
    const berry = this.berries[0];
    pet.gazeAt(() => berry.getWorldPosition(V(0, 0, 0)));
    this.group.updateMatrixWorld(true);
    await this.moveR(berry.getWorldPosition(V(0, 0, 0)).add(V(0, 0.03, 0)), 0.3, ease.inOutQuad);
    pet.grab('R', berry, { upright: true });
    G.sfx('place', this.rp, { gain: -16, main: false });
    await this.moveR(this.rp.clone().add(V(0, 0.12, 0)), 0.2, ease.outQuad);
    await this.shuffle(G, -0.48, 0.42);
    const centerTop = this.B(this.cakeC.x, H + 0.03 + this.top + 0.042, this.cakeC.z);
    pet.gazeAt(centerTop);
    // 小手只够得到蛋糕靠近自己的这一边：在边上方松手，草莓轻轻滚到正中间
    const dropAt = this.B(this.cakeC.x + 0.07, H + 0.03 + this.top + 0.16, this.cakeC.z - 0.09);
    await this.moveR(dropAt, 0.35, ease.inOutQuad);
    pet.drop('R', this.bench);
    const b0 = berry.position.clone(), b1 = this.bench.worldToLocal(centerTop.clone());
    await this.tween(0.36, (u) => { arc(berry, b0, b1, 0.05, ease.outQuad(u)); berry.rotation.z = (1 - u) * 0.6; });
    G.sfx('plop', centerTop, { gain: -4 });
    G.burst('confetti', centerTop.clone().add(V(0, 0.12, 0)), { colors: RAINBOW, count: 22, scale: 0.35, floor: centerTop.y - 0.04 });
    G.sfx('sand_step', centerTop, { gain: -12, main: false, delay: 0.1 });
    this.prog = 1;
    G.say('好漂亮的蛋糕～');
    pet.expr('happy', 'open', 1.4);
    await this.endWork(G);
    await pet.idleAction('celebrate', 0.9);
    G.unsay();
  }
}

// ================= 打扫：地面上的活儿（扫地、拖地） =================
// 右手握着扫帚/拖把的上端，刷头/拖把头在身体右前方贴着地面来回移动（接触时才有声音和效果）。
// 糯糯一边干活一边往前走；道具在身体右侧，不会扎进身体
class FloorTask extends TaskStation {
  constructor(ctx, def) { super(ctx, def); this.face = FACE_FLOOR; }
  // 地面上的点：相对糯糯位置的站点坐标偏移（dx 沿前进方向，dz 朝镜头一侧）
  FP(G, dx, dz) { const p = G.pet.root.position; return V(p.x + dx, this.group.position.y + 0.02, p.z + dz); }
  // 小手握在身体右前方（身体外面），道具从手斜着伸到地面上的刷头位置
  floorPose(G, head, lift = 0) {
    const pet = G.pet;
    const tip = head.clone().add(V(0, lift, 0));
    // 手的基准点在身体右前方、离肩膀有一段距离：手臂可伸可缩，道具头始终正好贴着地面
    const h0 = pet.root.position.clone().add(V(0.62, 0, 0.5).applyAxisAngle(UP, pet.facing));
    h0.y = pet.root.position.y + 0.34;
    const dir = tip.clone().sub(h0).normalize();
    return { tip, dir, side: V(-dir.z, 0, dir.x).normalize() };
  }
}

// ================= 打扫 1. 扫灰尘 =================
export class SweepStation extends FloorTask {
  build() {
    const { M, G, rng: r } = this.ctx;
    const L = this.length;
    this.makeBench(0.4);
    const n = 30;
    const dustG = G.get('dust', () => blobGeometry(0.035, 6, 0.25, 2));
    this.dustIM = new THREE.InstancedMesh(dustG, M.soft('#cfc6dd', { rough: 1, rim: 0.6, rimColor: '#ffffff' }), n);
    this.dustIM.castShadow = true;
    const crumbG = G.get('crumb', () => new THREE.TetrahedronGeometry(0.018, 0));
    this.crumbIM = new THREE.InstancedMesh(crumbG, M.soft('#e8d2b0', { rough: 0.8, flat: true }), 30);
    this.items = [];
    // 灰尘撒在小路前方那一条（扫帚扫得到的地方）
    for (let i = 0; i < n + 30; i++) {
      const x = r.range(1.0, L - 0.55), z = r.range(0.12, 0.36);
      this.items.push({ x, z, tx: x, tz: z, s: r.range(0.7, 1.3), rot: r.range(0, TAU), dust: i < n, k: i < n ? i : i - n, gone: false });
    }
    this.group.add(this.dustIM, this.crumbIM);
    // 簸箕：在这一段的尽头、小路旁边，开口朝来的方向
    const pan = new THREE.Group();
    pan.position.set(L - 0.2, 0, 0.6);
    this.mesh(G.track(roundedBox(0.2, 0.016, 0.42, 0.008, 2)), M.soft('#7fd6ff', { rough: 0.4, rim: 0.4 }), 0, 0.008, 0, pan);
    this.mesh(G.track(roundedBox(0.03, 0.11, 0.42, 0.012, 2)), M.soft('#7fd6ff', { rough: 0.4 }), 0.1, 0.055, 0, pan);
    for (const s of [-1, 1]) this.mesh(G.get('pan|side', () => roundedBox(0.2, 0.06, 0.02, 0.008, 2)), M.soft('#7fd6ff', { rough: 0.4 }), 0, 0.03, s * 0.21, pan);
    this.mesh(G.track(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 8)), M.soft('#ffd166', { rough: 0.5 }), 0.13, 0.25, 0, pan);
    this.group.add(pan);
    this.panObj = pan;
    this.panSq = new Spring(200, 8, 1);
    // 扫帚：立在起点右前方
    this.broom = this.restTool('broom', { tip: V(0.5, 0.02, 0.52), dir: V(0.05, -0.99, 0.12), side: V(1, 0, 0) });
    this._write();
    return this;
  }
  _write() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const it of this.items) {
      q.setFromAxisAngle(V(0, 1, 0), it.rot);
      const s = it.gone ? 0.0001 : it.s;
      m4.compose(V(it.x, (it.dust ? 0.025 : 0.01), it.z), q, V(s, s * (it.dust ? 0.8 : 1), s));
      (it.dust ? this.dustIM : this.crumbIM).setMatrixAt(it.k, m4);
    }
    this.dustIM.instanceMatrix.needsUpdate = true;
    this.crumbIM.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    super.update(dt);
    let moved = false;
    for (const it of this.items) {
      if (Math.abs(it.tx - it.x) + Math.abs(it.tz - it.z) > 0.002) { const k = 1 - Math.exp(-dt * 9); it.x += (it.tx - it.x) * k; it.z += (it.tz - it.z) * k; it.rot += dt * 4; moved = true; }
    }
    if (moved) this._write();
    const s = this.panSq.update(dt);
    this.panObj.scale.set(1, s, 1);
  }
  // 扫帚头从 a 扫到 b（站点局部坐标）：碰到的灰尘被推着往前走，堆在扫帚头前面
  _push(a, b) {
    let n = 0;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    for (const it of this.items) {
      if (it.gone) continue;
      const rx = it.tx - a.x, rz = it.tz - a.z;
      const along = rx * ux + rz * uz, across = Math.abs(-rx * uz + rz * ux);
      if (along > -0.05 && along < len + 0.06 && across < 0.1) {
        const k = len - along + 0.05 + Math.random() * 0.04;
        it.tx = Math.min(this.length - 0.3, it.tx + ux * k);
        it.tz = clamp(it.tz + uz * k * 0.6, 0.08, 0.66);
        n++;
      }
    }
    return n;
  }
  progress() { return this.done ? 1 : this.items.filter((it) => it.tx > this.length - 0.7 || it.gone).length / this.items.length; }
  async run(G) {
    const pet = G.pet, L = this.length;
    G.label(this.label);
    G.cam('follow', { off: V(2.6, 1.3, 1.45), lookY: 0.32, lookAhead: 0.3, lambda: 1.5 });
    await G.walkTo(this.W(0.4, 0, 0), { stepDur: 0.4, stride: 0.22 });
    pet.face(this.face);
    await G.wait(0.2);
    pet.setLean(0.08);
    G.say(this.def.say || '扫扫灰尘～');
    await this.pickTool(G, this.broom);
    const head = (x, z) => this.FP(G, x, z);
    pet.gazeAt(() => this.tp.tip);
    await this.toolTo(this.floorPose(G, head(0.55, 0.26), 0.04), 0.3, ease.inOutQuad);
    // 一下一下往前扫：刷头贴着地，从身前扫到右前方，扫完抬起来回到起点
    let zOff = 0;
    const stroke = async () => {
      const a = head(0.55, 0.26 + zOff), b = head(1.05, 0.22 + zOff);
      await this.toolTo(this.floorPose(G, a, 0), 0.1, ease.inQuad);
      const la = this.group.worldToLocal(a.clone()), lb = this.group.worldToLocal(b.clone());
      const n = this._push(la, lb);
      G.sfx('fabric_swish', a, { gain: -2 + Math.min(2, n * 0.15) });
      if (n) G.burst('fluff', b.clone().add(V(0, 0.03, 0)), { colors: ['#ece6f5', '#ffffff'], count: 2 + Math.min(3, Math.floor(n / 3)), scale: 0.24 });
      await this.toolTo(this.floorPose(G, b, 0), 0.3, ease.inOutSine);
      G.countStep();
      await this.toolTo(this.floorPose(G, a, 0.05), 0.22, ease.inOutSine);
    };
    let x = 0.4;
    while (x < L - 0.95) {
      await stroke();
      await stroke();
      if (x > 0.8) G.unsay();
      const nx = Math.min(L - 0.95, x + 0.32);
      await this.toolTo(this.floorPose(G, head(0.6, 0.26), 0.06), 0.15);
      await this.walkCarry(G, this.W(nx, 0, 0), { stepDur: 0.38, stride: 0.16, keepFace: true });
      x = nx;
    }
    // 最后几下：往簸箕那边挪一步，把一堆灰尘扫进簸箕
    await this.toolTo(this.floorPose(G, head(0.6, 0.26), 0.06), 0.15);
    await this.walkCarry(G, this.W(L - 1.2, 0, 0.3), { stepDur: 0.38, stride: 0.16, keepFace: true });
    zOff = 0.12;
    for (const it of this.items) { if (!it.gone) { it.tx = Math.max(it.tx, L - 0.62); it.tz = clamp(it.tz, 0.5, 0.68); } }
    await stroke();
    const into = this.W(L - 0.2, 0.02, 0.6);
    for (const it of this.items) { it.tx = L - 0.2 + (Math.random() - 0.5) * 0.08; it.tz = 0.52 + (Math.random() - 0.5) * 0.2; }
    G.sfx('fabric_swish', into, { gain: 0 });
    await G.wait(0.35);
    for (const it of this.items) it.gone = true;
    this._write();
    this.panSq.x = 0.8;
    G.sfx('place', into, { gain: -4 });
    G.burst('sparkles', this.W(L - 0.6, 0.15, 0.45), { colors: ['#ffffff', '#fff2a8'], count: 16 });
    // 扫帚立在簸箕旁边
    this.group.updateMatrixWorld(true);
    this.broom.pose = { tip: this.bench.worldToLocal(head(0.46, 0.4)), dir: V(0.05, -0.99, 0.12), side: V(1, 0, 0) };
    this._placeRest(this.broom);
    await this.putTool(G, this.broom, 0.3);
    await G.walkTo(this.W(L - 1.1, 0, 0), { stepDur: 0.36, stride: 0.2 });
    pet.expr('happy', 'open', 1.2);
    G.say('干干净净～');
    await this.endWork(G);
    await pet.idleAction('proud', 0.9);
    G.unsay();
  }
}

// ================= 打扫 2. 擦地板（脏脚印一擦就亮） =================
// 拖把头贴着地面来回画"8"字，划过的地方泥点被连续擦掉，留下一道会慢慢干掉的水光
export class MopStation extends FloorTask {
  build() {
    const { M, G, rng: r } = this.ctx;
    const L = this.length, W = this.width = 1.3;
    this.makeBench(0.4);
    // 干净的地砖
    const tc = document.createElement('canvas'); tc.width = 512; tc.height = Math.round(512 * W / L);
    const tg = tc.getContext('2d');
    const cs = this.def.tiles || ['#fff4f8', '#e9f6ff'];
    const n = 8, sz = tc.width / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < Math.ceil(tc.height / sz); j++) { tg.fillStyle = cs[(i + j) % 2]; tg.fillRect(i * sz, j * sz, sz, sz); }
    tg.strokeStyle = 'rgba(200,180,200,0.5)'; tg.lineWidth = 2;
    for (let i = 0; i <= n; i++) { tg.beginPath(); tg.moveTo(i * sz, 0); tg.lineTo(i * sz, tc.height); tg.stroke(); }
    for (let j = 0; j <= tc.height / sz; j++) { tg.beginPath(); tg.moveTo(0, j * sz); tg.lineTo(tc.width, j * sz); tg.stroke(); }
    this.tileTex = new THREE.CanvasTexture(tc); this.tileTex.colorSpace = THREE.SRGBColorSpace;
    this.ctx.M.track({ dispose: () => this.tileTex.dispose() });
    this.mesh(G.track(roundedBox(L, 0.02, W, 0.008, 2).translate(L / 2, 0.01, 0)), M.track(new THREE.MeshStandardMaterial({ map: this.tileTex, roughness: 0.25, metalness: 0 })));
    // 泥点和小泥脚印（集中在糯糯右前方、拖把够得着的那一条）
    const c = document.createElement('canvas'); c.width = tc.width; c.height = tc.height;
    this.cv = c; this.g2 = c.getContext('2d');
    const g = this.g2;
    const zTo = (z) => ((z + W / 2) / W) * c.height;
    for (let i = 0; i < 24; i++) {
      const x = r.range(0.32, 0.95) * c.width, y = zTo(r.range(0.12, 0.38)), rr = r.range(10, 26);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(150,110,80,0.75)'); gr.addColorStop(1, 'rgba(150,110,80,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    g.fillStyle = 'rgba(130,95,70,0.8)';
    for (let i = 0; i < 7; i++) {
      const x = (0.34 + i * 0.09) * c.width, y = zTo(0.25 + Math.sin(i * 1.7) * 0.1);
      g.beginPath(); g.ellipse(x, y, 9, 7, 0, 0, TAU); g.fill();
      for (const k of [-1, 0, 1]) { g.beginPath(); g.arc(x + 10, y + k * 6, 3, 0, TAU); g.fill(); }
    }
    this.dirtTex = new THREE.CanvasTexture(c); this.dirtTex.colorSpace = THREE.SRGBColorSpace;
    this.ctx.M.track({ dispose: () => this.dirtTex.dispose() });
    const dirt = this.mesh(G.track(new THREE.PlaneGeometry(L - 0.02, W - 0.02).rotateX(-Math.PI / 2).translate(L / 2, 0.022, 0)), M.track(new THREE.MeshStandardMaterial({ map: this.dirtTex, transparent: true, roughness: 0.9, depthWrite: false })));
    dirt.renderOrder = 2;
    dirt.castShadow = false;
    // 水光：拖把擦过的地方亮亮的，慢慢干掉
    const wc = document.createElement('canvas'); wc.width = 256; wc.height = Math.round(256 * W / L);
    this.wcv = wc; this.wg = wc.getContext('2d');
    this.wetTex = new THREE.CanvasTexture(wc);
    this.ctx.M.track({ dispose: () => this.wetTex.dispose() });
    const wet = this.mesh(G.track(new THREE.PlaneGeometry(L - 0.02, W - 0.02).rotateX(-Math.PI / 2).translate(L / 2, 0.024, 0)), M.track(new THREE.MeshStandardMaterial({ color: '#ffffff', alphaMap: this.wetTex, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2, depthWrite: false })));
    wet.renderOrder = 3; wet.castShadow = false;
    this.mop = this.restTool('mop', { tip: V(0.5, 0.02, 0.52), dir: V(0.05, -0.99, 0.12), side: V(1, 0, 0) });
    this.cleaned = 0;
    this.wetT = 0;
    return this;
  }
  update(dt) {
    super.update(dt);
    // 水光慢慢干掉
    this.wetT += dt;
    if (this.wetT > 0.12) {
      this.wetT = 0;
      const g = this.wg;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(0, 0, this.wcv.width, this.wcv.height);
      g.globalCompositeOperation = 'source-over';
      this.wetTex.needsUpdate = true;
    }
  }
  // 拖把头扫过的一小段：连续擦掉泥点、留下水光
  _wipe(la, lb) {
    const L = this.length, W = this.width;
    const c = this.cv, g = this.g2;
    const steps = Math.max(1, Math.ceil(Math.hypot(lb.x - la.x, lb.z - la.z) / 0.02));
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const rr = (0.1 / L) * c.width;
    for (let i = 0; i <= steps; i++) {
      const x = lerp(la.x, lb.x, i / steps), z = lerp(la.z, lb.z, i / steps);
      const px = (x / L) * c.width, py = ((z + W / 2) / W) * c.height;
      const gr = g.createRadialGradient(px, py, rr * 0.25, px, py, rr);
      gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill();
      // 水光
      const wx = (x / L) * this.wcv.width, wy = ((z + W / 2) / W) * this.wcv.height, wr = (0.11 / L) * this.wcv.width;
      const wgr = this.wg.createRadialGradient(wx, wy, 0, wx, wy, wr);
      wgr.addColorStop(0, 'rgba(255,255,255,0.9)'); wgr.addColorStop(1, 'rgba(255,255,255,0)');
      this.wg.fillStyle = wgr; this.wg.beginPath(); this.wg.arc(wx, wy, wr, 0, TAU); this.wg.fill();
    }
    g.restore();
    this.dirtTex.needsUpdate = true;
    this.wetTex.needsUpdate = true;
  }
  progress() { return this.done ? 1 : Math.min(1, this.cleaned / 14); }
  async run(G) {
    const pet = G.pet, L = this.length;
    G.label(this.label);
    G.cam('follow', { off: V(2.5, 1.25, 1.35), lookY: 0.3, lookAhead: 0.25, lambda: 1.5 });
    await G.walkTo(this.W(0.4, 0, 0), { stepDur: 0.4, stride: 0.22 });
    pet.face(this.face);
    await G.wait(0.2);
    pet.setLean(0.08);
    G.say(this.def.say || '擦呀擦，亮晶晶～');
    await this.pickTool(G, this.mop);
    pet.gazeAt(() => this.tp.tip);
    const head = (x, z) => this.FP(G, x, z);
    await this.toolTo(this.floorPose(G, head(0.6, 0.25), 0.03), 0.3, ease.inOutQuad);
    let x = 0.4, k = 0;
    while (x < L - 0.85) {
      // 一个"8"字：拖把头一直贴着地面
      let prev = this.group.worldToLocal(this.tp.tip.clone());
      const sq = G.sfx('cloth', this.tp.tip, { gain: -4 });
      void sq;
      await this.tween(1.25, (u) => {
        const a = u * TAU;
        const p = head(0.75 + Math.sin(a) * 0.24, 0.25 + Math.sin(a * 2) * 0.07);
        const pose = this.floorPose(G, p, 0);
        this.tp.tip.copy(pose.tip); this.tp.dir.copy(pose.dir); this.tp.side.copy(pose.side);
        const now = this.group.worldToLocal(p.clone());
        this._wipe(prev, now);
        prev = now;
        if (Math.abs(Math.sin(a * 2)) > 0.98 && !this._squeak) { this._squeak = true; G.sfx('cloth', p, { gain: -6, main: false }); G.burst('sparkles', p.clone().add(V(0, 0.04, 0)), { colors: ['#ffffff', '#e9f6ff'], count: 3, scale: 0.45 }); }
        if (Math.abs(Math.sin(a * 2)) < 0.5) this._squeak = false;
      });
      this.cleaned += 2; k++;
      G.countStep();
      if (k === 2) G.unsay();
      const nx = Math.min(L - 0.9, x + 0.42);
      if (nx <= x + 0.01) break;
      await this.toolTo(this.floorPose(G, head(0.6, 0.25), 0.04), 0.15);
      await this.walkCarry(G, this.W(nx, 0, 0), { stepDur: 0.36, stride: 0.18, keepFace: true });
      x = nx;
    }
    // 往路边挪一小步，把拖把靠在小路外侧（下一段走过去时不会蹭到）
    await this.toolTo(this.floorPose(G, head(0.55, 0.3), 0.05), 0.15);
    await this.walkCarry(G, this.W(x + 0.1, 0, 0.22), { stepDur: 0.36, stride: 0.18, keepFace: true });
    this.group.updateMatrixWorld(true);
    this.mop.pose = { tip: this.bench.worldToLocal(head(0.46, 0.46)), dir: V(0.05, -0.99, 0.12), side: V(1, 0, 0) };
    this._placeRest(this.mop);
    await this.putTool(G, this.mop, 0.3);
    // 退回小路中间再往前走（离靠在路边的拖把远远的）
    await G.walkTo(this.W(x, 0, 0), { stepDur: 0.36, stride: 0.2, keepFace: true });
    G.burst('sparkles', this.W(L / 2, 0.1, 0.45), { colors: ['#ffffff', '#e9f6ff', '#fff2a8'], count: 22 });
    pet.expr('happy', 'open', 1.2);
    await this.endWork(G);
    await pet.idleAction('proud', 0.9);
  }
}

// ================= 打扫 3. 叠衣服 =================
function shirtParts(G, M, color, Wd = 0.36, Ht = 0.26) {
  // 一件平铺的小 T 恤（领口朝糯糯）：左右三分之一可以翻折，靠糯糯的那一半可以向前翻折
  const T = 0.008;
  const mat = M.soft(color, { rough: 0.9, rim: 0.25 });
  const box = (w, h) => G.get(`shirt|${w.toFixed(3)}|${h.toFixed(3)}`, () => roundedBox(w, T, h, 0.004, 1));
  const root = new THREE.Group();
  const near = new THREE.Group(); root.add(near);      // 靠糯糯的一半（领口、袖子）：绕中线向前翻
  near.position.z = 0;
  const far = new THREE.Group(); root.add(far);
  const third = Wd / 3;
  const mk = (parent, w, h, x, z) => { const m = new THREE.Mesh(box(w, h), mat); m.position.set(x, 0, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  mk(near, third, Ht / 2, 0, -Ht / 4);
  mk(far, third, Ht / 2, 0, Ht / 4);
  const flaps = [];
  for (const s of [-1, 1]) {
    for (const half of [near, far]) {
      const pv = new THREE.Group(); pv.position.set(s * third / 2, 0, 0); half.add(pv);
      mk(pv, third, Ht / 2, s * third / 2, half === near ? -Ht / 4 : Ht / 4);
      if (half === near) { const sl = mk(pv, 0.09, 0.08, s * (third + 0.035), -Ht / 2 + 0.04); sl.rotation.y = s * 0.35; }
      flaps.push({ pv, s, near: half === near });
    }
  }
  const heart = new THREE.Mesh(G.get('shirt|heart', () => new THREE.CircleGeometry(0.022, 16).rotateX(-Math.PI / 2)), M.soft('#ffffff', { rough: 0.8 }));
  heart.position.set(0, T / 2 + 0.001, Ht / 8);
  far.add(heart);
  return { root, near, far, flaps, W: Wd, H: Ht };
}
// 揉成一团的衣服（在洗衣篮里）
function crumpleGeo(G) { return G.get('shirt|crumple', () => blobGeometry(0.075, 3, 0.18, 2).scale(1.15, 0.55, 1)); }

export class FoldStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    this.makeBench(this.length / 2 - 0.05);
    this.counter({ w: 2.3, x: 0.05, top: '#fff6ea', body: this.def.table || '#f6dcc0', door: '#fbe8d4', plinth: '#e8c4a0', knob: '#ff9ec4' });
    // 洗衣篮在左边（糯糯挪过去拿），叠好的那一摞在右边
    this.basketX = -0.55;
    this.basketC = V(this.basketX + 0.3, H, EDGE + 0.14);
    this.bmesh(G.track(new THREE.CylinderGeometry(0.15, 0.12, 0.1, 24, 1, true).translate(0, 0.05, 0)), M.soft('#ffd98a', { rough: 0.8, rim: 0.3, side: THREE.DoubleSide }), this.basketC.x, H, this.basketC.z);
    this.bmesh(G.track(new THREE.CircleGeometry(0.12, 20).rotateX(-Math.PI / 2)), M.soft('#f2c66e', { rough: 0.8 }), this.basketC.x, H + 0.004, this.basketC.z);
    this.foldC = V(0.42, H + 0.004, EDGE + 0.15); // 衣服铺在这里（右手正前方）
    this.stackC = V(0.98, H + 0.004, EDGE + 0.12);
    const colors = this.def.colors || ['#ffb3d1', '#9fd8ff', '#fff0a8'];
    this.shirts = colors.map((c, i) => {
      const s = shirtParts(G, M, c);
      s.root.visible = false;
      this.bench.add(s.root);
      // 篮子里揉成一团的样子
      const blob = this.bmesh(crumpleGeo(G), M.soft(c, { rough: 0.95, rim: 0.25 }), this.basketC.x + (i - 1) * 0.04, H + 0.06 + i * 0.03, this.basketC.z + (i % 2 ? 0.03 : -0.03));
      blob.rotation.y = i * 1.3;
      s.blob = blob;
      return s;
    });
    this.stack = 0;
    return this;
  }
  _flapEdge(s, f) {
    // 翻折的那一片外边缘中点（世界坐标）
    this.group.updateMatrixWorld(true);
    return f.pv.localToWorld(V(f.s * s.W / 3, 0.01, (f.near ? -1 : 1) * s.H / 4));
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.B(0.25, H, EDGE + 0.12), lookY: 0.1, dist: 1.05, off: TASK_CAM, cut: true });
    await this.beginWork(G);
    G.say(this.def.say || '叠衣服～');
    this.rp.copy(pet.handWorld('R'));
    pet.reachTo('R', () => ({ pos: this.rp }));
    const SH = this.basketX; // 挪到洗衣篮前面要走的距离
    for (let k = 0; k < this.shirts.length; k++) {
      const s = this.shirts[k];
      // 1) 往左挪到洗衣篮前，抓起一团衣服
      await this.shuffle(G, SH, 0.5);
      pet.gazeAt(() => s.blob.getWorldPosition(V(0, 0, 0)));
      this.group.updateMatrixWorld(true);
      await this.moveR(s.blob.getWorldPosition(V(0, 0, 0)).add(V(0, 0.03, 0)), 0.3, ease.inOutQuad);
      pet.grab('R', s.blob);
      G.sfx('cloth', this.rp, { gain: -6 });
      await this.moveR(this.rp.clone().add(V(0, 0.12, 0)), 0.2, ease.outQuad);
      // 2) 挪回来，把衣服抖开、铺平在台面上
      await this.shuffle(G, -SH, 0.5);
      const spot = this.B(this.foldC.x, this.foldC.y, this.foldC.z);
      pet.gazeAt(spot);
      await this.moveR(spot.clone().add(V(0, 0.12, -0.04)), 0.25, ease.inOutQuad);
      pet.drop('R', this.bench);
      s.blob.visible = false;
      s.root.visible = true;
      s.root.position.copy(this.foldC);
      G.sfx('cloth', spot, { gain: -3 });
      await this.tween(0.35, (u) => {
        const e = ease.outBack(u);
        s.root.scale.set(0.35 + 0.65 * e, 1, 0.35 + 0.65 * e);
        s.root.position.y = this.foldC.y + 0.04 * Math.sin(u * Math.PI);
        s.root.rotation.y = (1 - u) * 0.5;
        this.rp.copy(spot).add(V(0, 0.1 - 0.06 * u, -0.06 + 0.04 * Math.sin(u * Math.PI)));
      });
      // 3) 叠左右两边：右手捏住外边缘，翻起来、过了顶点就松手，布"啪"地落下
      for (const sideS of [-1, 1]) {
        const flapsS = s.flaps.filter((f) => f.s === sideS);
        const f0 = flapsS.find((f) => f.near);
        await this.moveR(this._flapEdge(s, f0).add(V(0, 0.02, 0)), 0.25, ease.inOutQuad);
        G.sfx('cloth', this.rp, { gain: -4 });
        await this.tween(0.42, (u) => {
          const a = sideS * Math.PI * ease.inOutQuad(u);
          for (const f of flapsS) { f.pv.rotation.z = a; f.pv.position.y = 0.007 * Math.min(1, u * 2); }
          if (u < 0.55) this.rp.copy(this._flapEdge(s, f0).add(V(0, 0.015, 0)));
        });
        G.countStep();
        await this.moveR(this.rp.clone().add(V(0, 0.05, 0)), 0.12);
      }
      // 4) 靠自己的那一半（领口）向前翻过去，盖在另一半上
      const nearEdge = () => { this.group.updateMatrixWorld(true); return s.near.localToWorld(V(0, 0.012, -s.H / 2)); };
      await this.moveR(nearEdge().add(V(0, 0.02, 0)), 0.25, ease.inOutQuad);
      G.sfx('cloth', this.rp, { gain: -3 });
      await this.tween(0.42, (u) => {
        s.near.rotation.x = -Math.PI * ease.inOutQuad(u);
        s.near.position.y = 0.012 * Math.min(1, u * 2);
        if (u < 0.5) this.rp.copy(nearEdge().add(V(0, 0.012, 0)));
      });
      G.countStep();
      // 5) 拍两下压平，抓起来放到右边那一摞上
      const center = () => { this.group.updateMatrixWorld(true); return s.far.localToWorld(V(0, 0.03, 0)); };
      for (let p = 0; p < 2; p++) {
        await this.moveR(center().add(V(0, 0.05, -0.02)), 0.12, ease.outQuad);
        await this.moveR(center().add(V(0, 0.01, -0.02)), 0.07, ease.inQuad);
        G.sfx('cloth', this.rp, { gain: -9, main: false });
        pet.sq.kick(-0.3);
      }
      const holder = new THREE.Group();
      this.bench.add(holder);
      holder.position.copy(this.bench.worldToLocal(center()));
      holder.attach(s.root);
      pet.grab('R', holder, { upright: true });
      await this.moveR(this.rp.clone().add(V(0, 0.1, 0)), 0.2, ease.outQuad);
      await this.shuffle(G, 0.45, 0.45);
      const stackTop = this.B(this.stackC.x, this.stackC.y + this.stack * 0.026 + 0.004, this.stackC.z);
      const offs = holder.getWorldPosition(V(0, 0, 0)).sub(this.rp);
      await this.moveR(stackTop.clone().sub(offs).add(V(0, 0.05, 0)), 0.3, ease.inOutQuad);
      await this.moveR(stackTop.clone().sub(offs), 0.1, ease.inQuad);
      pet.drop('R', this.bench);
      this.stack++;
      G.sfx('place', stackTop, { gain: -5 });
      G.burst('sparkles', stackTop.clone().add(V(0, 0.08, 0)), { colors: ['#ffffff', '#fff2a8'], count: 6, scale: 0.6 });
      this.prog = (k + 1) / this.shirts.length;
      if (k === 0) G.unsay();
      await this.moveR(this.rp.clone().add(V(-0.05, 0.1, -0.05)), 0.15);
      await this.shuffle(G, -0.45, 0.45);
    }
    pet.expr('happy', 'open', 1.2);
    G.say('整整齐齐～');
    await this.endWork(G);
    await pet.idleAction('proud', 0.9);
    G.unsay();
  }
}

// ================= 打扫 4. 收纳玩具（捡起来、抱过去、放进玩具箱） =================
export class TidyStation extends TaskStation {
  constructor(ctx, def) { super(ctx, def); this.face = FACE_FLOOR; }
  build() {
    const { M, G, rng: r } = this.ctx;
    const L = this.length;
    this.makeBench(0.4);
    // 玩具箱（开口朝上，正面有颗爱心）：在这一段的尽头、小路旁边（走过去不会碰到）
    const bx = L - 0.42;
    this.box = new THREE.Group();
    this.box.position.set(bx, 0, 0.68);
    this.group.add(this.box);
    const bm = M.soft(this.def.boxColor || '#ffc2d8', { rough: 0.55, rim: 0.35 });
    this.mesh(G.track(roundedBox(0.5, 0.04, 0.38, 0.015, 2).translate(0, 0.02, 0)), bm, 0, 0, 0, this.box);
    for (const [w, d, x, z] of [[0.5, 0.035, 0, 0.17], [0.5, 0.035, 0, -0.17], [0.035, 0.38, 0.23, 0], [0.035, 0.38, -0.23, 0]]) this.mesh(G.get(`box|${w}|${d}`, () => roundedBox(w, 0.2, d, 0.014, 2).translate(0, 0.1, 0)), bm, x, 0, z, this.box);
    this.mesh(G.get('box|heart', () => new THREE.CircleGeometry(0.05, 20)), M.soft('#ffffff', { rough: 0.6 }), 0, 0.11, 0.19, this.box);
    this.boxSq = new Spring(200, 8, 1);
    // 散落在小路上的玩具：糯糯走过去一个一个捡起来，扔进尽头的玩具箱
    const toyDefs = [['block', '#ff8fb3'], ['ball', '#7fd6ff'], ['star', '#ffd166'], ['duck', '#ffd84d']];
    const n = toyDefs.length;
    this.toys = toyDefs.map(([kind, col], i) => {
      const geo = G.get('toy|' + kind, () => toyGeo(kind));
      const g = new THREE.Group();
      const x = 0.95 + i * ((L - 1.75) / (n - 1)) + r.range(-0.05, 0.05);
      // 摆在小路靠镜头的一边：糯糯站在玩具斜后方，玩具正好在右手前面（圆肚子碰不到）
      g.position.set(x, 0.02, r.range(0.48, 0.56));
      g.rotation.y = r.range(0, TAU);
      this.group.add(g);
      this.mesh(geo, M.soft(col, { rough: 0.4, rim: 0.4 }), 0, 0, 0, g);
      return { g, kind, slot: V((i % 3 - 1) * 0.13, 0.05 + Math.floor(i / 3) * 0.08, (i % 2 ? 0.06 : -0.06)) };
    }).sort((a, b) => a.g.position.x - b.g.position.x);
    return this;
  }
  update(dt) {
    super.update(dt);
    const s = this.boxSq.update(dt);
    this.box.scale.set(1 + (1 - s) * 0.4, s, 1 + (1 - s) * 0.4);
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('follow', { off: V(2.4, 1.25, 1.6), lookY: 0.3, lookAhead: 0.35, lambda: 1.4 });
    G.say(this.def.say || '玩具回家啦～');
    this.rp.copy(pet.handWorld('R'));
    for (let i = 0; i < this.toys.length; i++) {
      const t = this.toys[i];
      this.group.updateMatrixWorld(true);
      const tp = t.g.getWorldPosition(V(0, 0, 0));
      // 走到玩具斜后方：面朝 3/4 正面时，玩具正好在右手前方 0.6 左右（身体、小脚都碰不到它）
      const f = 0.5;
      const fwd = V(Math.sin(f), 0, Math.cos(f)), right = V(Math.cos(f), 0, -Math.sin(f));
      const stand = tp.clone().addScaledVector(right, -0.26).addScaledVector(fwd, -0.56);
      await G.walkTo(V(stand.x, 0, stand.z), { stepDur: 0.36, stride: 0.2 });
      pet.face(f);
      pet.gazeAt(tp);
      await G.wait(0.18);
      // 蹲下去、伸手捡起来
      pet.setCrouch(0.85); pet.setLean(0.14);
      this.rp.copy(pet.handWorld('R'));
      pet.reachTo('R', () => ({ pos: this.rp }));
      await this.moveR(tp.clone().add(V(0, 0.08, 0)), 0.32, ease.inOutQuad);
      pet.grab('R', t.g, { upright: true });
      G.sfx('place', tp, { gain: -14, main: false });
      // 站起来，开心地举一举
      pet.setCrouch(0); pet.setLean(0);
      await this.moveR(this.rp.clone().add(V(-0.05, 0.3, 0.02)), 0.28, ease.outQuad);
      pet.expr('happy', 'smile', 0.6);
      // 瞄准玩具箱：手往后一收（预备），再往前一甩，在最高点前松手——玩具沿抛物线飞进箱子
      const boxTop = this.box.localToWorld(t.slot.clone());
      pet.gazeAt(boxTop);
      const hand0 = this.rp.clone();
      // 预备动作往身体外侧、往上收（不会把玩具收进肚子里），再往前一甩
      await this.moveR(hand0.clone().addScaledVector(right, 0.12).addScaledVector(fwd, -0.03).add(V(0, 0.07, 0)), 0.22, ease.outQuad);
      await this.moveR(hand0.clone().addScaledVector(fwd, 0.1).add(V(0.04, 0.1, 0)), 0.1, ease.inQuad);
      pet.drop('R', this.group);
      const p0 = t.g.position.clone(), p1 = this.group.worldToLocal(boxTop.clone());
      const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const fly = 0.35 + dist * 0.18;
      G.sfx('whoosh', tp, { gain: -14, main: false });
      const spin = (G.rng() - 0.5) * 6;
      const q0 = t.g.quaternion.clone();
      this.moveR(hand0.clone().addScaledVector(fwd, 0.06).add(V(0.03, -0.08, 0)), 0.25);
      await this.tween(fly, (u) => {
        arc(t.g, p0, p1, 0.35 + dist * 0.1, u);
        t.g.quaternion.copy(q0); t.g.rotateY(spin * u); t.g.rotateX(u * 1.5);
      });
      this.box.attach(t.g);
      t.g.position.copy(t.slot); t.g.quaternion.identity(); t.g.rotation.y = G.rng() * TAU;
      G.sfx(i % 2 ? 'place' : 'plop', boxTop, { gain: -4 });
      G.burst('sparkles', boxTop.clone().add(V(0, 0.1, 0)), { colors: ['#ffffff', '#fff2a8'], count: 5, scale: 0.6 });
      this.boxSq.x = 0.86;
      this.prog = (i + 1) / this.toys.length;
      G.countStep();
      pet.expr('happy', 'open', 0.6);
      pet.release('R');
      if (i === 1) G.unsay();
    }
    await G.wait(0.3);
    pet.face(this.face);
    pet.gazeAt(null);
    pet.expr('happy', 'open', 1.2);
    G.say('全部收好啦～');
    await pet.idleAction('celebrate', 0.9);
    G.unsay();
  }
}
function toyGeo(kind) {
  switch (kind) {
    case 'block': return roundedBox(0.1, 0.1, 0.1, 0.022, 2).translate(0, 0.05, 0);
    case 'ball': return new THREE.SphereGeometry(0.055, 16, 12).translate(0, 0.055, 0);
    case 'ring': return new THREE.TorusGeometry(0.05, 0.022, 10, 20).rotateX(Math.PI / 2).translate(0, 0.022, 0);
    case 'duck': { const g = blobGeometry(0.06, 2, 0.02, 2).scale(1.2, 0.85, 1).translate(0, 0.05, 0); return g; }
    case 'star': {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.03 : 0.068; const a = (i / 10) * TAU + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
      g.rotateX(-Math.PI / 2); g.translate(0, 0.012, 0);
      return g;
    }
    default: return new THREE.SphereGeometry(0.05, 12, 8);
  }
}
function mergeGeoms(list) {
  const g = new THREE.BufferGeometry();
  const pos = [], nrm = [], idx = [];
  let off = 0;
  for (const p of list) {
    const pa = p.attributes.position, na = p.attributes.normal;
    for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); nrm.push(na.getX(i), na.getY(i), na.getZ(i)); }
    if (p.index) for (let i = 0; i < p.index.count; i++) idx.push(p.index.getX(i) + off);
    else for (let i = 0; i < pa.count; i++) idx.push(i + off);
    off += pa.count;
    p.dispose();
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export const TASK_TYPES = { chop: ChopStation, whisk: WhiskStation, pan: PanStation, cream: CreamStation, sweep: SweepStation, mop: MopStation, fold: FoldStation, tidy: TidyStation };
