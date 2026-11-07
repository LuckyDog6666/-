// 一条闯关路线（沿 +x 方向）：解压站 / 任务站 与 闯关元素穿插排列，最后是巨型终点解压物。
// 负责：路线编排（起承转合）、小路、灯光（暖色主光 + 轮廓光）、环境（见 world/envs.js）、地面高度查询、
// 每帧更新，以及每关结束时彻底释放 GPU 资源（长时间直播内存稳定）。
import * as THREE from 'three';
import { MaterialBank } from '../render/materials.js';
import { Tex } from '../render/textures.js';
import { GeoBank, roundedBox } from '../world/geo.js';
import { buildEnvironment } from '../world/envs.js';
import { createStation } from './stations.js';
import { TASK_TYPES } from './tasks.js';
import { createGimmick } from './gimmicks.js';
import { Rng, clamp } from '../core/util.js';

export const PATH_Y = 0.035; // 小路（软垫）的表面高度
const GAP = 0.85;            // 站与站之间的小路长度
const PATH_W = 2.0;

export class Course {
  constructor(scene, stage, opts = {}) {
    this.scene = scene;
    this.stage = stage;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = 'course';
    this.M = new MaterialBank();
    this.G = new GeoBank();
    this.rng = new Rng(opts.seed || 1);
    this.t = 0;
    this.uniforms = [];
    this.anims = [];
    this.segments = [];
    this.stations = [];  // 解压站 + 任务站
    this.gimmicks = [];
  }

  vcMat(o = {}) { return this.M.soft('#ffffff', { vc: true, rough: o.rough ?? 0.65, rim: o.rim ?? 0.35 }); }

  // 路线编排：站点（首站固定 = 本世界招牌）+ 闯关元素（滑梯/蹦床放在"转"的位置），交替排列
  plan() {
    const st = this.stage, r = this.rng;
    let sdefs = st.stations.map((d) => ({ ...d }));
    if (!st.fixedOrder) {
      for (let i = sdefs.length - 1; i > 1; i--) { const j = 1 + r.int(0, i - 1); [sdefs[i], sdefs[j]] = [sdefs[j], sdefs[i]]; }
      sdefs = sdefs.slice(0, this.opts.stations || 4);
    }
    const pool = (st.gimmicks || []).map((d) => ({ ...d }));
    r.shuffle(pool);
    if (this.opts.forceGimmick) { const k = pool.findIndex((g) => g.type === this.opts.forceGimmick); if (k > 0) pool.unshift(pool.splice(k, 1)[0]); }
    const want = Math.min(pool.length, sdefs.length - 1, this.opts.gimmicks ?? 3);
    let gdefs = pool.slice(0, want);
    // "转"：第二个闯关元素最好是画面最热闹的滑梯/蹦床
    const twist = gdefs.findIndex((g) => g.type === 'slide' || g.type === 'bounce');
    if (twist >= 0 && gdefs.length > 1 && twist !== 1 && !(this.opts.forceGimmick && twist === 0)) [gdefs[1], gdefs[twist]] = [gdefs[twist], gdefs[1]];
    if (twist < 0) { const t = pool.find((g) => g.type === 'slide' || g.type === 'bounce'); if (t && gdefs.length) gdefs[Math.min(1, gdefs.length - 1)] = t; }
    const out = [];
    sdefs.forEach((d, i) => { out.push(d); if (i < gdefs.length) out.push({ ...gdefs[i], gimmick: true }); });
    out.push({ ...st.finale });
    return out;
  }

  build() {
    const st = this.stage;
    this._buildLights();
    const ctx = { M: this.M, G: this.G, rng: this.rng, stage: st };
    let x = 2.2; // 起点
    for (const d of this.plan()) {
      let s;
      if (d.gimmick) s = createGimmick(ctx, d);
      else if (TASK_TYPES[d.type]) s = new TASK_TYPES[d.type](ctx, d).build();
      else s = createStation(ctx, d);
      s.index = this.segments.length;
      s.finale = !!d.finale;
      if (this.segments.length) {
        const prevG = this.segments[this.segments.length - 1].kind === 'gimmick';
        // 闯关元素落地点在下一段起点前 0.43：下一段是要跳上去的一块块（果冻、面包）时多留一点，
        // 落地时圆肚子不会顶到第一块
        let gap = d.finale ? GAP + 0.4 : prevG && (s.blocks || s.items) ? 0.95 : s.kind === 'gimmick' || prevG ? 0.55 : GAP;
        // 闯关元素的起跳点（entryX）离起点越远，前面留的空就要越大：站在起跳点时圆肚子的后背不会碰到上一段的东西
        if (s.kind === 'gimmick' && s.entryX != null) gap = Math.max(gap, 0.45 - s.entryX);
        x += gap;
      }
      s.x0 = x;
      s.x1 = x + s.length;
      // 走上去的解压站（沙子、雪、史莱姆、泥巴、冰面、泡泡……）表面和小路基本齐平（像嵌在地上的一池）：
      // 圆滚滚的糯糯走上走下时，肚子不会被高出来的托盘边缘切到。跳上去玩的（果冻、面包块）和终点大物件保持原样
      let y = s.kind === 'gimmick' ? PATH_Y : PATH_Y - 0.02;
      if (s.kind === 'station' && !s.blocks && !s.items && !d.finale) {
        const top = s.topY(s.length / 2, 0);
        if (top > 0.03) y = PATH_Y + 0.02 - top;
      }
      s.group.position.set(x, y, 0);
      this.group.add(s.group);
      this.segments.push(s);
      if (s.kind === 'gimmick') this.gimmicks.push(s); else this.stations.push(s);
      x = s.x1;
    }
    this.length = x + 2.4;
    this.start = new THREE.Vector3(0.9, PATH_Y, 0);
    this.end = new THREE.Vector3(this.length - 1.0, PATH_Y, 0);
    buildEnvironment(this);
    if (!st.noPath) this._buildPath();
    this.scene.add(this.group);
    return this;
  }

  // ---------------- 查询 ----------------
  // 脚下是不是解压站（踩上去会留下痕迹、播放真实录音）
  stationAt(x, z = 0, margin = 0) {
    for (const s of this.stations) if (s.kind === 'station' && x >= s.x0 - margin && x <= s.x1 + margin && Math.abs(z) <= s.width / 2 + margin) return s;
    return null;
  }
  segmentAt(x, z = 0) {
    for (const s of this.segments) if (x >= s.x0 && x <= s.x1 && Math.abs(z) <= s.width / 2 + 0.05) return s;
    return null;
  }
  // 世界坐标 (x,z) 处糯糯脚下的高度
  yAt(x, z) {
    const s = this.segmentAt(x, z);
    if (!s) return PATH_Y;
    const lx = x - s.x0;
    return s.group.position.y + s.topY(clamp(lx, 0, s.length), clamp(z, -s.width / 2, s.width / 2));
  }
  world(s, lx, lz, ly = 0) { return new THREE.Vector3(s.x0 + lx, s.group.position.y + ly, lz); }
  progress() {
    const n = this.segments.length;
    let p = 0;
    for (const s of this.segments) p += s.done ? 1 : Math.min(0.95, s.progress ? s.progress() : 0);
    return p / n;
  }

  // ---------------- 灯光 ----------------
  _buildLights() {
    const st = this.stage;
    // 补光压低、主光加强：明暗对比出来，圆圆的身体才有体积感（动画电影的打光）
    // 动画电影式打光：暖暖的阳光做主光，天空的冷色做补光（阴影带一点蓝紫，不是灰灰的），地面反弹一点暖色
    const skyFill = new THREE.Color(st.hemi[0]).lerp(new THREE.Color('#9fbfff'), 0.3);
    const bounce = new THREE.Color(st.hemi[1]).lerp(new THREE.Color(st.ground || st.hemi[1]), 0.35);
    this.hemi = new THREE.HemisphereLight(skyFill, bounce, st.hemi[2] * 0.56);
    this.group.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, st.ambient * 0.26);
    this.group.add(this.amb);
    // 暖色主光：从镜头这一侧（+x、+z 的斜上方）照过来，小脸亮亮的；影子落在糯糯身后（脚印的凹凸也看得清）
    const sun = new THREE.DirectionalLight(new THREE.Color(st.sun[0]).lerp(new THREE.Color('#ffe6c4'), 0.25), st.sun[1] * 1.22);
    sun.castShadow = true;
    const q = this.opts.shadowSize || 2048;
    sun.shadow.mapSize.set(q, q);
    const S = 5;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(3.2, 7.5, 5.5);
    this.group.add(sun);
    this.group.add(sun.target);
    // 轮廓光（逆光）：动画电影里角色边缘那一圈柔柔的亮边
    this.rim = new THREE.DirectionalLight(new THREE.Color(st.rimLight || '#ffe0f0'), 1.1);
    this.rimOffset = new THREE.Vector3(-5, 3.5, -4);
    this.group.add(this.rim);
    this.group.add(this.rim.target);
  }

  // 一段一段的软垫小路（像桌面上的绒布跑道）；跳跳石、气球、摇摇桥那里是"断开"的
  _buildPath() {
    const st = this.stage;
    const gaps = this.gimmicks.filter((g) => g.def.type === 'hop' || g.def.type === 'float' || g.def.type === 'bridge').map((g) => [g.x0 + 0.02, g.x1 - 0.02]);
    const pieces = [];
    let a = -1.2;
    for (const [g0, g1] of gaps) { pieces.push([a, g0]); a = g1; }
    pieces.push([a, this.length + 1.2]);
    const tex = this.M.track(Tex.groundNoise().clone());
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(this.length / 1.5, 1.2);
    const mat = this.M.soft(st.path, { rough: 0.98, rim: st.pathRug ? 0.35 : 0.15, map: tex });
    const dotGeo = this.G.track(new THREE.SphereGeometry(0.022, 6, 4));
    const dotMat = this.M.soft(st.pathSide, { rough: 0.8 });
    for (const [x0, x1] of pieces) {
      const L = x1 - x0;
      if (L < 0.05) continue;
      const m = new THREE.Mesh(this.G.track(roundedBox(L, 0.05, PATH_W, 0.025, 3).translate(x0 + L / 2, -0.01, 0)), mat);
      m.receiveShadow = true;
      this.group.add(m);
      // 两侧的缝线小圆点（让跑道更像精致的手工垫子）
      const n = Math.max(0, Math.floor(L / 0.32)) * 2;
      if (!n) continue;
      const im = new THREE.InstancedMesh(dotGeo, dotMat, n);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1; m4.makeTranslation(x0 + 0.15 + Math.floor(i / 2) * 0.32, 0.015, side * (PATH_W / 2 - 0.07)); im.setMatrixAt(i, m4); }
      this.group.add(im);
    }
  }

  // ---------------- 每帧 ----------------
  update(dt, petPos, camPos) {
    this.t += dt;
    const t = this.t;
    for (const u of this.uniforms) if (u.uTime) u.uTime.value = t;
    if (camPos && this.sky) this.sky.position.copy(camPos);
    if (petPos) {
      this.sun.position.copy(petPos).add(this.sunOffset); this.sun.target.position.copy(petPos);
      this.rim.position.copy(petPos).add(this.rimOffset); this.rim.target.position.copy(petPos);
    }
    // 只更新镜头附近的站点（省电）
    for (const s of this.segments) if (!petPos || Math.abs((s.x0 + s.x1) / 2 - petPos.x) < 10) s.update(dt);
    for (const a of this.anims) {
      const o = a.obj, ph = o.userData.ph || 0;
      if (a.kind === 'sway') { o.rotation.z = Math.sin(t * 1.3 + ph) * 0.12; o.rotation.x = Math.cos(t * 1.1 + ph) * 0.06; }
      else if (a.kind === 'bob') o.position.y = Math.sin(t * 0.8 + ph) * 0.18;
      else if (a.kind === 'spin') o.rotation.y = t * 0.8 + ph;
      else if (a.kind === 'windmill') { for (const c of o.children) if (c.userData.spin) c.rotation.z = -t * 0.55 + ph; }
      else if (a.kind === 'clouds') for (const c of o.children) { c.position.x += dt * c.userData.drift; if (c.position.x > this.length + 40) c.position.x -= this.length + 80; }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.sun) this.sun.dispose();
    if (this.rim) this.rim.dispose();
    for (const s of this.segments) { try { s.dispose(); } catch {} }
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    this.M.dispose();
    this.G.dispose();
    this.segments = []; this.stations = []; this.gimmicks = [];
    this.anims = [];
    this.scene.fog = null;
  }
}
