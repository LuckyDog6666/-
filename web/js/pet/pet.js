// 原创萌宠「糯糯」：一颗软糯的麻薯团子，兔猫耳朵，头顶一棵小豆芽，蹦蹦跳跳地闯关。
// 模型完全由代码程序化生成（无外部模型文件），动画为程序化骨骼 + 弹簧次级运动。
import * as THREE from 'three';
import { outlineMaterial } from '../render/materials.js';
import { Tex } from '../render/textures.js';
import { Spring, clamp, lerp, damp, dampAngle, TAU, ease, rand } from '../core/util.js';

const C = {
  body: '#fff4ea',
  bodyBottom: '#ffe3d6',
  belly: '#fffaf5',
  rim: '#ffc9dc',
  ear: '#fff1e6',
  earInner: '#ffb3c8',
  eye: '#2a1830',
  blush: '#ff8fb0',
  mouth: '#6b3247',
  tongue: '#ff7f9e',
  sprout: '#72cc6e',
  sproutDark: '#4fa859',
  outline: '#6a4656',
};

// 椭球体（把缩放烘焙进几何体，描边粗细才一致）
function ellipsoid(rx, ry, rz, ws = 32, hs = 24) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

function leafGeometry(len = 0.16, wid = 0.09) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wid, len * 0.25, wid * 0.9, len * 0.8, 0, len);
  s.bezierCurveTo(-wid * 0.9, len * 0.8, -wid, len * 0.25, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.006);
  return g;
}

export class Pet {
  constructor(mats) {
    this.mats = mats;
    this.root = new THREE.Group();
    this.root.name = 'nuonuo';
    this.disposables = [];
    this._build();
    // 动画状态
    this.t = 0;
    this.sq = new Spring(260, 13, 1); // 挤压
    this.earL = new Spring(90, 6, 0);
    this.earR = new Spring(90, 6, 0);
    this.sprout = new Spring(70, 4.5, 0);
    this.sproutZ = new Spring(70, 4.5, 0);
    this.leanX = 0; this.leanZ = 0;
    this.facing = 0; this.targetFacing = 0;
    this.blinkT = rand(1, 3); this.blinking = 0;
    this.eyesMode = 'open'; this.mouthMode = 'cat';
    this.exprUntil = 0;
    this.lookX = 0; this.lookY = 0; this.lookTX = 0; this.lookTY = 0;
    this.action = null; // 当前动作（跳跃/舞蹈等）
    this.groundY = 0; // 当前脚下地面高度
    this.sink = 0; this.sinkTarget = 0; // 陷入软东西的深度
    this.pose = this._basePose();
    this.idleBob = 1;
    this.sleepy = 0;
    this.accessory = null;
    this.extraAccessory = null;
  }

  // ---------------- 建模 ----------------
  _build() {
    const M = this.mats;
    const OL = outlineMaterial(C.outline, 0.016);
    this.disposables.push(OL);
    const addOutline = (mesh, w) => {
      const o = new THREE.Mesh(mesh.geometry, w ? (() => { const m = outlineMaterial(C.outline, w); this.disposables.push(m); return m; })() : OL);
      o.raycast = () => {};
      mesh.add(o);
      return o;
    };

    // 身体枢轴放在底部，挤压拉伸以脚底为中心
    this.bodyPivot = new THREE.Group();
    this.root.add(this.bodyPivot);
    this.lean = new THREE.Group(); // 倾斜/旋转（舞蹈用）
    this.bodyPivot.add(this.lean);

    // 麻薯身体：底部压扁、略呈梨形，并带顶点色渐变
    const R = 0.5;
    const bg = new THREE.SphereGeometry(R, 64, 48);
    const pos = bg.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cTop = new THREE.Color(C.body), cBot = new THREE.Color(C.bodyBottom), cBelly = new THREE.Color(C.belly);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ny = y / R;
      if (ny < -0.35) y = -0.35 * R + (y + 0.35 * R) * 0.45; // 压扁底部
      const bulge = 1 + 0.07 * clamp(-ny, 0, 1) - 0.03 * clamp(ny, 0, 1);
      x *= 1.06 * bulge; z *= 1.0 * bulge; y *= 0.9;
      pos.setXYZ(i, x, y, z);
      // 颜色：上浅下暖，肚皮更白
      tmp.copy(cTop).lerp(cBot, clamp((-ny + 0.2) * 0.8, 0, 1));
      const bellyW = clamp((z / R - 0.3) * 1.6, 0, 1) * clamp(1 - Math.abs(ny + 0.3) * 1.8, 0, 1);
      tmp.lerp(cBelly, bellyW * 0.8);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    bg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bg.computeVertexNormals();
    bg.translate(0, R * 0.9 * 0.86, 0); // 让底部贴地
    this.bodyGeo = bg;
    const bodyMat = M.soft('#ffffff', { vc: true, rough: 0.58, rim: 0.55, rimColor: C.rim, rimPower: 2.2 });
    this.body = new THREE.Mesh(bg, bodyMat);
    this.body.castShadow = true;
    this.lean.add(this.body);
    addOutline(this.body, 0.018);
    this.disposables.push(bg);

    const bodyCenterY = R * 0.9 * 0.86;
    this.headY = bodyCenterY + R * 0.9; // 头顶
    // 求身体表面上的点（用于贴五官）
    const surf = (x, y) => {
      const a = R * 1.06, b = R * 0.9, c = R;
      const yy = (y - bodyCenterY) / b;
      const xx = x / a;
      const zz = Math.sqrt(Math.max(0, 1 - xx * xx - yy * yy));
      return new THREE.Vector3(x, y, zz * c);
    };
    this.surf = surf;

    // ---- 脸 ----
    this.faceGroup = new THREE.Group();
    this.lean.add(this.faceGroup);
    const eyeMat = M.soft(C.eye, { rough: 0.18, rim: 0.0 });
    const hiMat = M.basic('#ffffff');
    this.eyes = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const p = surf(0.165 * s, 0.53);
      g.position.copy(p);
      g.rotation.y = Math.atan2(p.x, p.z) * 0.8;
      g.rotation.x = -0.12;
      const eyeGeo = ellipsoid(0.072, 0.092, 0.035, 24, 16);
      this.disposables.push(eyeGeo);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      g.add(eye);
      // 高光：一大一小，让眼睛水汪汪
      const h1g = new THREE.SphereGeometry(0.026, 12, 8); this.disposables.push(h1g);
      const h1 = new THREE.Mesh(h1g, hiMat); h1.position.set(-0.024 * s - 0.004, 0.032, 0.03); g.add(h1);
      const h2g = new THREE.SphereGeometry(0.012, 10, 6); this.disposables.push(h2g);
      const h2 = new THREE.Mesh(h2g, hiMat); h2.position.set(0.024 * s, -0.03, 0.03); g.add(h2);
      // 开心眼 ^ ^
      const arcG = new THREE.TorusGeometry(0.052, 0.013, 8, 20, Math.PI); this.disposables.push(arcG);
      const happy = new THREE.Mesh(arcG, eyeMat); happy.position.set(0, -0.015, 0.02); happy.visible = false; g.add(happy);
      // 闭眼 ︶
      const closed = new THREE.Mesh(arcG, eyeMat); closed.rotation.z = Math.PI; closed.position.set(0, 0.02, 0.02); closed.scale.set(1, 0.6, 1); closed.visible = false; g.add(closed);
      this.faceGroup.add(g);
      this.eyes.push({ g, eye, h1, h2, happy, closed, side: s });
    }
    // 腮红
    const blushMat = M.basic(C.blush, { opacity: 0.75, map: Tex.soft() });
    this.blush = [];
    for (const s of [-1, 1]) {
      const p = surf(0.3 * s, 0.43);
      const bgeo = new THREE.CircleGeometry(0.085, 20); this.disposables.push(bgeo);
      const m = new THREE.Mesh(bgeo, blushMat);
      m.position.copy(p).multiplyScalar(1.01);
      m.lookAt(p.clone().multiplyScalar(2).setY(p.y));
      m.scale.set(1.25, 0.8, 1);
      this.faceGroup.add(m);
      this.blush.push(m);
    }
    // 嘴巴：小猫嘴 ω / 张嘴
    const mouthMat = M.soft(C.mouth, { rough: 0.5, rim: 0 });
    this.mouthCat = new THREE.Group();
    const mp = surf(0, 0.43);
    this.mouthCat.position.copy(mp).add(new THREE.Vector3(0, 0, 0.005));
    const mg = new THREE.TorusGeometry(0.024, 0.0075, 6, 14, Math.PI); this.disposables.push(mg);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(mg, mouthMat);
      m.rotation.z = Math.PI;
      m.position.x = 0.024 * s;
      this.mouthCat.add(m);
    }
    this.faceGroup.add(this.mouthCat);
    this.mouthOpen = new THREE.Group();
    this.mouthOpen.position.copy(surf(0, 0.41)).add(new THREE.Vector3(0, 0, -0.012));
    const moG = ellipsoid(0.05, 0.045, 0.03, 16, 12); this.disposables.push(moG);
    const mo = new THREE.Mesh(moG, mouthMat);
    this.mouthOpen.add(mo);
    const tgG = ellipsoid(0.03, 0.018, 0.02, 12, 8); this.disposables.push(tgG);
    const tg = new THREE.Mesh(tgG, M.soft(C.tongue, { rim: 0 }));
    tg.position.set(0, -0.022, 0.015);
    this.mouthOpen.add(tg);
    this.mouthOpen.visible = false;
    this.faceGroup.add(this.mouthOpen);

    // ---- 耳朵（兔猫耳） ----
    const earMat = M.soft(C.ear, { rough: 0.6, rim: 0.5, rimColor: C.rim });
    const innerMat = M.soft(C.earInner, { rough: 0.7, rim: 0.2 });
    const earGeo = ellipsoid(0.115, 0.25, 0.075, 24, 16); earGeo.translate(0, 0.21, 0); this.disposables.push(earGeo);
    const inGeo = ellipsoid(0.065, 0.16, 0.03, 16, 12); inGeo.translate(0, 0.2, 0.05); this.disposables.push(inGeo);
    this.ears = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.2 * s, this.headY - 0.12, -0.02);
      pivot.rotation.z = -0.42 * s;
      pivot.rotation.x = -0.12;
      const ear = new THREE.Mesh(earGeo, earMat);
      ear.castShadow = true;
      addOutline(ear);
      const inner = new THREE.Mesh(inGeo, innerMat);
      ear.add(inner);
      pivot.add(ear);
      this.lean.add(pivot);
      this.ears.push({ pivot, ear, side: s, baseZ: -0.42 * s });
    }

    // ---- 小豆芽 ----
    this.sproutPivot = new THREE.Group();
    this.sproutPivot.position.set(0.0, this.headY - 0.03, 0.02);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, 0.08, 0), new THREE.Vector3(0.035, 0.15, 0.0), new THREE.Vector3(0.05, 0.2, 0),
    ]);
    const stemG = new THREE.TubeGeometry(curve, 12, 0.014, 8, false); this.disposables.push(stemG);
    const sproutMat = M.soft(C.sprout, { rough: 0.5, rim: 0.4, rimColor: '#d8ffb0' });
    const stem = new THREE.Mesh(stemG, sproutMat);
    this.sproutPivot.add(stem);
    const lg = leafGeometry(0.15, 0.085); this.disposables.push(lg);
    const top = new THREE.Group(); top.position.set(0.05, 0.2, 0);
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(lg, sproutMat);
      leaf.rotation.z = -1.05 * s - 0.1;
      leaf.rotation.y = 0.25 * s;
      leaf.castShadow = true;
      top.add(leaf);
    }
    this.sproutPivot.add(top);
    this.lean.add(this.sproutPivot);

    // ---- 小手 ----
    const armGeo = ellipsoid(0.085, 0.11, 0.085, 16, 12); armGeo.translate(0, -0.07, 0); this.disposables.push(armGeo);
    this.arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.43 * s, 0.4, 0.06);
      const arm = new THREE.Mesh(armGeo, earMat);
      arm.castShadow = true;
      addOutline(arm, 0.012);
      pivot.add(arm);
      this.lean.add(pivot);
      this.arms.push({ pivot, arm, side: s });
    }

    // ---- 小脚 ----
    const footGeo = ellipsoid(0.12, 0.065, 0.14, 16, 12); this.disposables.push(footGeo);
    const footMat = M.soft('#ffe6dc', { rough: 0.65, rim: 0.3, rimColor: C.rim });
    this.feet = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, footMat);
      f.position.set(0.19 * s, 0.05, 0.12);
      f.castShadow = true;
      addOutline(f, 0.012);
      this.bodyPivot.add(f);
      this.feet.push({ m: f, side: s, baseX: 0.19 * s, baseZ: 0.12 });
    }

    // ---- 尾巴 ----
    const tailGeo = new THREE.IcosahedronGeometry(0.1, 2); this.disposables.push(tailGeo);
    this.tail = new THREE.Mesh(tailGeo, earMat);
    this.tail.position.set(0, 0.2, -0.47);
    addOutline(this.tail, 0.012);
    this.lean.add(this.tail);

    // ---- 配饰挂点（头顶） ----
    this.hatAnchor = new THREE.Group();
    this.hatAnchor.position.set(0, this.headY - 0.04, 0);
    this.lean.add(this.hatAnchor);
    this.neckAnchor = new THREE.Group();
    this.neckAnchor.position.set(0, 0.24, 0);
    this.lean.add(this.neckAnchor);

    // ---- 脚下柔和阴影（贴地） ----
    const sg = new THREE.PlaneGeometry(1.2, 1.2); this.disposables.push(sg);
    this.shadow = new THREE.Mesh(sg, M.basic('#000000', { map: Tex.shadow(), opacity: 1 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  // ---------------- 配饰 ----------------
  setAccessory(type) {
    if (this.accessory) { this.hatAnchor.remove(this.accessory); this.neckAnchor.remove(this.accessory); this._disposeObj(this.accessory); this.accessory = null; }
    if (!type) return;
    const a = buildAccessory(type, this.mats);
    if (!a) return;
    (a.userData.neck ? this.neckAnchor : this.hatAnchor).add(a);
    this.accessory = a;
  }
  // 大礼物时的临时皇冠
  setCrown(on) {
    if (this.extraAccessory) { this.hatAnchor.remove(this.extraAccessory); this._disposeObj(this.extraAccessory); this.extraAccessory = null; }
    if (on) {
      this.extraAccessory = buildAccessory('crown', this.mats);
      this.extraAccessory.position.y += this.accessory && !this.accessory.userData.neck ? 0.16 : 0;
      this.hatAnchor.add(this.extraAccessory);
      this.crownPop = 0;
    }
  }
  _disposeObj(o) {
    o.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
  }

  // ---------------- 表情 ----------------
  expr(eyes = 'open', mouth = 'cat', hold = 0) {
    this.eyesMode = eyes;
    this.mouthMode = mouth;
    this.exprUntil = hold ? this.t + hold : 0;
  }
  _applyExpr(dt) {
    if (this.exprUntil && this.t > this.exprUntil) { this.eyesMode = this.sleepy > 0.6 ? 'half' : 'open'; this.mouthMode = 'cat'; this.exprUntil = 0; }
    // 眨眼
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinking = 0.14; this.blinkT = rand(2.2, 5.5); if (Math.random() < 0.2) this.blinkT = 0.25; }
    if (this.blinking > 0) this.blinking -= dt;
    const mode = this._poseHappy && this.eyesMode === 'open' ? 'happy' : this.eyesMode;
    const blinkAmt = this.blinking > 0 ? Math.sin((1 - this.blinking / 0.14) * Math.PI) : 0;
    for (const e of this.eyes) {
      const normal = mode === 'open' || mode === 'wide' || mode === 'half';
      e.eye.visible = normal; e.h1.visible = normal; e.h2.visible = normal;
      e.happy.visible = mode === 'happy';
      e.closed.visible = mode === 'closed';
      let sy = mode === 'wide' ? 1.18 : mode === 'half' ? 0.5 : 1;
      sy *= 1 - blinkAmt * 0.92;
      const sx = mode === 'wide' ? 1.1 : 1;
      e.g.scale.set(sx, Math.max(0.06, sy), 1);
      e.eye.position.x = this.lookX * 0.018;
      e.eye.position.y = this.lookY * 0.014;
    }
    this.mouthCat.visible = this.mouthMode === 'cat' || this.mouthMode === 'smile';
    this.mouthOpen.visible = this.mouthMode === 'open' || this.mouthMode === 'o';
    if (this.mouthMode === 'o') this.mouthOpen.scale.set(0.7, 0.9, 1); else this.mouthOpen.scale.set(1, 1, 1);
  }

  // ---------------- 动作接口 ----------------
  _basePose() {
    return { y: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, armL: { z: 0, x: 0 }, armR: { z: 0, x: 0 }, footL: { y: 0, z: 0, x: 0 }, footR: { y: 0, z: 0, x: 0 }, ear: 0, earFlap: 0, tail: 0 };
  }

  face(angle) { this.targetFacing = angle; }
  faceTowards(x, z) { this.targetFacing = Math.atan2(x - this.root.position.x, z - this.root.position.z); }

  /**
   * 跳到目标点。o: { height, dur, spin(圈), flip, onLand }
   * 返回 Promise，落地时 resolve。
   */
  hop(to, o = {}) {
    const from = this.root.position.clone();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const height = o.height ?? 0.32 + dist * 0.08;
    const dur = o.dur ?? 0.46 + dist * 0.06;
    if (dist > 0.05) this.faceTowards(to.x, to.z);
    return new Promise((resolve) => {
      this.action = {
        kind: 'hop', t: 0, from, to: to.clone(), height, dur, ant: o.anticipation ?? 0.11, spin: o.spin || 0, flip: o.flip || 0, resolve, onTakeoff: o.onTakeoff, launched: false,
      };
    });
  }

  // 原地小跳（踩泡泡膜、开心）
  bounceInPlace(height = 0.25, dur = 0.4) { return this.hop(this.root.position.clone(), { height, dur, anticipation: 0.06 }); }

  // 冰面滑行
  slide(to, dur = 0.9) {
    const from = this.root.position.clone();
    this.faceTowards(to.x, to.z);
    return new Promise((resolve) => { this.action = { kind: 'slide', t: 0, from, to: to.clone(), dur, resolve }; });
  }

  // 舞蹈：dance = {fn(pose, t, beat, pet), beats}
  dance(dance, seconds, bpm = 112) {
    this.face(0);
    return new Promise((resolve) => { this.action = { kind: 'dance', t: 0, dance, seconds, bps: bpm / 60, resolve, events: dance.events ? dance.events.map((e) => ({ ...e, done: false })) : [] }; });
  }

  // 停顿/姿态（看看四周、闻一闻、坐下）
  idleAction(kind, seconds) {
    return new Promise((resolve) => { this.action = { kind: 'idle', sub: kind, t: 0, seconds, resolve }; });
  }

  cancelAction() {
    if (this.action && this.action.resolve) { const r = this.action.resolve; this.action = null; r(); }
  }

  kickEars(v) { this.earL.kick(v * (0.8 + Math.random() * 0.4)); this.earR.kick(-v * (0.8 + Math.random() * 0.4)); this.sprout.kick(v * 1.4); }

  setGround(y) { this.groundY = y; }

  // ---------------- 每帧更新 ----------------
  update(dt) {
    this.t += dt;
    const t = this.t;
    const P = this._basePose();
    const pos = this.root.position;
    let airborne = false;
    const a = this.action;

    // 默认呼吸起伏
    const breath = Math.sin(t * 2.2) * 0.018 * this.idleBob;
    P.sy += breath; P.sx -= breath * 0.5;
    P.armL.z = 0.12 + Math.sin(t * 2.2) * 0.04; P.armR.z = -0.12 - Math.sin(t * 2.2) * 0.04;
    P.tail = Math.sin(t * 3.1) * 0.15;

    if (a && a.kind === 'hop') {
      a.t += dt;
      const ant = a.ant;
      if (a.t < ant) {
        // 起跳前蓄力下蹲
        this.sq.target = 0.78;
        P.armL.z = 0.4; P.armR.z = -0.4;
      } else {
        if (!a.launched) {
          a.launched = true;
          this.sq.target = 1.0; this.sq.kick(4.5);
          this.kickEars(-6);
          if (a.onTakeoff) a.onTakeoff();
        }
        const u = clamp((a.t - ant) / a.dur, 0, 1);
        airborne = u < 1;
        pos.x = lerp(a.from.x, a.to.x, u);
        pos.z = lerp(a.from.z, a.to.z, u);
        const base = lerp(a.from.y, a.to.y, u);
        pos.y = base + 4 * a.height * u * (1 - u);
        // 空中拉伸、收脚、举手
        P.sy += 0.1 * Math.sin(u * Math.PI);
        P.footL.y = P.footR.y = 0.06 * Math.sin(u * Math.PI);
        P.armL.z = 0.9 * Math.sin(u * Math.PI) + 0.1; P.armR.z = -P.armL.z;
        if (a.spin) P.ry += a.spin * TAU * ease.inOutQuad(u);
        if (a.flip) P.rx += -a.flip * TAU * ease.inOutQuad(u);
        if (u >= 1) {
          this.action = null;
          this.sq.x = Math.min(this.sq.x, 0.95);
          this.sq.target = 1; this.sq.kick(-5.5 - a.height * 3);
          this.kickEars(5 + a.height * 4);
          pos.copy(a.to);
          a.resolve();
        }
      }
    } else if (a && a.kind === 'slide') {
      a.t += dt;
      const u = clamp(a.t / a.dur, 0, 1);
      const e = ease.inOutSine(u);
      pos.x = lerp(a.from.x, a.to.x, e);
      pos.z = lerp(a.from.z, a.to.z, e);
      pos.y = lerp(a.from.y, a.to.y, e);
      P.rx += 0.18 * Math.sin(u * Math.PI); // 身体前倾滑行
      P.armL.z = 1.1; P.armR.z = -1.1; // 张开手保持平衡
      P.rz += Math.sin(t * 9) * 0.06;
      if (u >= 1) { this.action = null; pos.copy(a.to); a.resolve(); }
    } else if (a && a.kind === 'dance') {
      a.t += dt;
      const beat = a.t * a.bps;
      a.dance.fn(P, a.t, beat, this, a);
      if (a.events) for (const ev of a.events) if (!ev.done && beat >= ev.beat) { ev.done = true; this.onDanceEvent && this.onDanceEvent(ev, this); }
      if (a.t >= a.seconds) { this.action = null; a.resolve(); }
    } else if (a && a.kind === 'idle') {
      a.t += dt;
      idlePose(a.sub, P, a.t, a.seconds, this);
      if (a.t >= a.seconds) { this.action = null; a.resolve(); }
    }

    // 陷入软物体（棉花糖/云朵）
    this.sink = damp(this.sink, airborne ? 0 : this.sinkTarget, 10, dt);

    // 次级运动
    const sqv = this.sq.update(dt);
    const sy = clamp(sqv * P.sy, 0.55, 1.5);
    const sxz = (1 / Math.sqrt(sy)) * P.sx;
    this.bodyPivot.scale.set(sxz, sy, sxz);
    this.bodyPivot.position.y = P.y - this.sink;
    this.bodyPivot.position.z = P.zOff || 0;
    this.lean.rotation.set(P.rx, P.ry, P.rz);
    this._poseHappy = !!P.happy;
    const bl = 1 + (P.blush || 0) * 0.35;
    for (const m of this.blush) m.scale.set(1.25 * bl, 0.8 * bl, 1);

    // 朝向
    this.facing = dampAngle(this.facing, this.targetFacing, 10, dt);
    this.root.rotation.y = this.facing;

    // 耳朵/豆芽弹簧：受加速度影响
    this.earL.target = P.ear + P.earFlap; this.earR.target = -P.ear - P.earFlap;
    const el = this.earL.update(dt), er = this.earR.update(dt);
    this.ears[0].pivot.rotation.z = this.ears[0].baseZ + el * 0.08 * -1 + (P.earFlap ? 0 : 0);
    this.ears[1].pivot.rotation.z = this.ears[1].baseZ + er * 0.08;
    this.ears[0].pivot.rotation.x = -0.12 - Math.abs(el) * 0.02;
    this.ears[1].pivot.rotation.x = -0.12 - Math.abs(er) * 0.02;
    this.sprout.target = 0;
    const sp = this.sprout.update(dt);
    this.sproutPivot.rotation.z = clamp(sp * 0.05, -0.6, 0.6) + Math.sin(t * 1.7) * 0.05;
    this.sproutPivot.rotation.x = Math.sin(t * 1.3 + 1) * 0.04;

    // 手脚
    this.arms[0].pivot.rotation.z = -P.armL.z; this.arms[0].pivot.rotation.x = -P.armL.x;
    this.arms[1].pivot.rotation.z = -P.armR.z; this.arms[1].pivot.rotation.x = -P.armR.x;
    this.feet[0].m.position.set(this.feet[0].baseX + P.footL.x, 0.05 + P.footL.y, this.feet[0].baseZ + P.footL.z);
    this.feet[1].m.position.set(this.feet[1].baseX + P.footR.x, 0.05 + P.footR.y, this.feet[1].baseZ + P.footR.z);
    this.feet[0].m.scale.setScalar(1 / Math.max(0.7, Math.min(1.3, sxz)));
    this.feet[1].m.scale.setScalar(1 / Math.max(0.7, Math.min(1.3, sxz)));
    this.tail.rotation.y = P.tail;
    this.tail.position.x = Math.sin(P.tail) * 0.06;

    // 视线
    this.lookX = damp(this.lookX, this.lookTX, 6, dt);
    this.lookY = damp(this.lookY, this.lookTY, 6, dt);
    if (Math.random() < dt * 0.4) { this.lookTX = rand(-1, 1); this.lookTY = rand(-0.5, 0.6); }

    this._applyExpr(dt);
    if (this.extraAccessory) {
      this.crownPop = Math.min(1, (this.crownPop || 0) + dt * 3);
      this.extraAccessory.scale.setScalar(ease.outBack(this.crownPop));
      this.extraAccessory.rotation.y = Math.sin(t * 2) * 0.15;
    }

    // 阴影跟随（高度越高阴影越小越淡）
    const h = Math.max(0, pos.y - this.groundY);
    this.shadow.position.set(pos.x, this.groundY + 0.015, pos.z);
    const ss = clamp(1 - h * 0.35, 0.45, 1) * 0.9;
    this.shadow.scale.set(ss * sxz, ss * sxz, 1);
    this.shadow.material.opacity = clamp(1 - h * 0.4, 0.3, 1);
  }

  dispose() {
    for (const d of this.disposables) d.dispose && d.dispose();
    this.setAccessory(null);
    this.setCrown(false);
  }
}

// 闲置小动作
function idlePose(kind, P, t, dur, pet) {
  const u = t / dur;
  const fade = Math.min(1, t / 0.25, (dur - t) / 0.25);
  switch (kind) {
    case 'look': // 左右张望
      P.ry += Math.sin(u * Math.PI * 2) * 0.6 * fade;
      P.rz += Math.sin(u * Math.PI * 2) * 0.05 * fade;
      pet.lookTX = Math.sin(u * Math.PI * 2) * 1.2;
      break;
    case 'sniff': // 低头闻闻
      P.rx += 0.28 * fade;
      P.y += Math.sin(t * 22) * 0.008 * fade;
      P.sy += Math.sin(t * 22) * 0.015 * fade;
      pet.lookTY = -0.8;
      break;
    case 'wiggle': // 开心扭一扭
      P.rz += Math.sin(t * 14) * 0.14 * fade;
      P.armL.z = 0.6 + Math.sin(t * 14) * 0.3; P.armR.z = -0.6 + Math.sin(t * 14) * 0.3;
      break;
    case 'sit': // 坐下歇一会儿
      P.sy *= 1 - 0.1 * fade; P.sx *= 1 + 0.05 * fade;
      P.footL.z = P.footR.z = 0.08 * fade; P.footL.y = P.footR.y = 0.02 * fade;
      P.rx += -0.06 * fade;
      break;
    case 'yawn':
      P.sy *= 1 + 0.08 * Math.sin(u * Math.PI); P.rx += -0.15 * Math.sin(u * Math.PI);
      P.armL.z = 1.8 * Math.sin(u * Math.PI); P.armR.z = -1.8 * Math.sin(u * Math.PI);
      break;
    case 'stretch':
      P.sy *= 1 + 0.15 * Math.sin(u * Math.PI); P.sx *= 1 - 0.05 * Math.sin(u * Math.PI);
      P.armL.z = 2.6 * Math.sin(u * Math.PI); P.armR.z = -2.6 * Math.sin(u * Math.PI);
      break;
    case 'tilt': // 歪头疑惑
      P.rz += 0.22 * fade;
      break;
    case 'wave': // 挥手
      P.armR.z = -2.4 * fade + Math.sin(t * 12) * 0.35 * fade;
      P.rz += Math.sin(t * 6) * 0.05;
      break;
    case 'celebrate':
      P.armL.z = 2.5 * fade; P.armR.z = -2.5 * fade;
      P.y += Math.abs(Math.sin(t * 9)) * 0.12 * fade;
      break;
    default:
      break;
  }
}

// ---------------- 配饰模型 ----------------
function buildAccessory(type, M) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m;
  };
  switch (type) {
    case 'bow': { // 粉色蝴蝶结
      const mat = M.soft('#ff7fae', { rough: 0.45, rim: 0.4 });
      const loop = ellipsoid(0.1, 0.07, 0.05, 16, 12);
      add(loop, mat, -0.09, 0.02, 0.0, 0, 0, 0.35);
      add(loop.clone(), mat, 0.09, 0.02, 0.0, 0, 0, -0.35);
      add(new THREE.SphereGeometry(0.045, 12, 10), M.soft('#ff5c97', { rim: 0.3 }), 0, 0.02, 0.02);
      g.position.set(0.18, -0.02, 0.14); g.rotation.z = -0.3;
      break;
    }
    case 'scarf': { // 红围巾
      const mat = M.soft('#ff6b6b', { rough: 0.8, rim: 0.3 });
      const ring = new THREE.TorusGeometry(0.43, 0.075, 12, 40); ring.scale(1.04, 1, 0.96);
      add(ring, mat, 0, 0, 0, Math.PI / 2, 0, 0);
      const tail = new THREE.BoxGeometry(0.12, 0.26, 0.05);
      add(tail, mat, 0.2, -0.12, 0.38, 0.2, 0, 0.25);
      add(new THREE.BoxGeometry(0.13, 0.03, 0.055), M.soft('#ffffff', { rough: 0.8 }), 0.215, -0.24, 0.41, 0.2, 0, 0.25);
      g.userData.neck = true;
      break;
    }
    case 'chef': { // 厨师帽
      const white = M.soft('#ffffff', { rough: 0.7, rim: 0.3 });
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 24), white, 0, 0.04, 0);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; add(new THREE.SphereGeometry(0.1, 14, 10), white, Math.cos(a) * 0.09, 0.17, Math.sin(a) * 0.09); }
      add(new THREE.SphereGeometry(0.12, 14, 10), white, 0, 0.22, 0);
      g.position.set(-0.08, 0, 0); g.rotation.z = 0.15;
      break;
    }
    case 'sailor': { // 水手帽
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 24), M.soft('#ffffff', { rough: 0.6 }), 0, 0.04, 0);
      add(new THREE.CylinderGeometry(0.222, 0.222, 0.04, 24), M.soft('#4a8bff', { rough: 0.5 }), 0, 0.02, 0);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 24), M.soft('#ffffff', { rough: 0.6 }), 0, 0.095, 0);
      g.position.set(0.08, 0, 0); g.rotation.z = -0.18;
      break;
    }
    case 'flower': { // 小花发饰
      const petal = M.soft('#ffb6d5', { rough: 0.5, rim: 0.4 });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; add(ellipsoid(0.055, 0.035, 0.02, 10, 8), petal, Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0, 0, 0, a); }
      add(new THREE.SphereGeometry(0.03, 10, 8), M.soft('#ffe066'), 0, 0, 0.015);
      g.position.set(-0.2, -0.06, 0.16); g.rotation.y = -0.4;
      break;
    }
    case 'starclip': { // 星星发卡
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.045 : 0.1; const a = (i / 10) * TAU + Math.PI / 2; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? s.lineTo(x, y) : s.moveTo(x, y); }
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
      add(geo, M.soft('#ffd84d', { emissive: '#ffcc33', ei: 0.4, rim: 0.4 }), 0, 0, 0);
      g.position.set(0.2, -0.06, 0.16); g.rotation.y = 0.4;
      break;
    }
    case 'party': { // 派对帽
      const cone = new THREE.ConeGeometry(0.13, 0.32, 24);
      add(cone, M.soft('#ffffff', { map: Tex.stripes('#7ad7ff', '#ffffff'), rim: 0.2 }), 0, 0.16, 0);
      add(new THREE.SphereGeometry(0.05, 12, 10), M.soft('#ff7fae'), 0, 0.34, 0);
      g.position.set(0.05, 0, 0); g.rotation.z = -0.2;
      break;
    }
    case 'miner': { // 矿工头盔（带发光灯）
      const dome = new THREE.SphereGeometry(0.24, 24, 12, 0, TAU, 0, Math.PI / 2);
      add(dome, M.soft('#ffcf3f', { rough: 0.4, rim: 0.3 }), 0, -0.02, 0);
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.025, 24), M.soft('#ffb52e', { rough: 0.5 }), 0, -0.02, 0.02);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16), M.glow('#fff7c2', 2.2), 0, 0.09, 0.22, Math.PI / 2, 0, 0);
      break;
    }
    case 'crown': { // 皇冠（大礼物）
      const gold = M.soft('#ffd23f', { rough: 0.3, emissive: '#ffb300', ei: 0.35, rim: 0.6, rimColor: '#fff3b0' });
      add(new THREE.CylinderGeometry(0.15, 0.16, 0.07, 20, 1, true), gold, 0, 0.06, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        add(new THREE.ConeGeometry(0.035, 0.09, 8), gold, Math.cos(a) * 0.15, 0.13, Math.sin(a) * 0.15);
        add(new THREE.SphereGeometry(0.022, 8, 6), M.glow(['#ff5c97', '#5cc8ff', '#7dff9b', '#c38bff', '#ff9d3d'][i], 0.8), Math.cos(a) * 0.15, 0.18, Math.sin(a) * 0.15);
      }
      g.position.y = 0.02;
      break;
    }
    default:
      return null;
  }
  return g;
}
