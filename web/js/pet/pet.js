// 原创萌宠「糯糯」：一颗软糯的麻薯团子，兔猫耳朵，头顶一棵小豆芽。
// 造型按"婴儿图式"做可爱：大头身、水汪汪的大眼睛（彩色虹膜 + 双高光）、会动的小眉毛、粉嫩腮红、
// 小猫嘴、脚底粉色肉垫；动画遵循挤压拉伸 + 弹簧次级运动（耳朵、豆芽、尾巴）。
// 模型完全由代码程序化生成（无外部模型文件）。
import * as THREE from 'three';
import { outlineMaterial } from '../render/materials.js';
import { Tex } from '../render/textures.js';
import { buildTool } from './tools.js';
import { Spring, clamp, lerp, damp, dampAngle, TAU, ease, rand, smoothstep } from '../core/util.js';

const C = {
  body: '#fff6ee',
  bodyBottom: '#ffe1d3',
  belly: '#fffbf7',
  rim: '#ffc2d8',
  ear: '#fff3ea',
  earInner: '#ffadc6',
  eye: '#2a1830',
  brow: '#7a4a5e',
  blush: '#ff8fb0',
  mouth: '#6b3247',
  tongue: '#ff7f9e',
  nose: '#ff9eb8',
  pad: '#ffa9c2',
  sprout: '#72cc6e',
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

// 大眼睛的虹膜贴图：外圈深色描边 → 渐变虹膜（下方更亮，像反射了地面的光）→ 瞳孔
function irisTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#24142c'; g.fillRect(0, 0, s, s);
  const cx = s / 2, cy = s / 2;
  const ir = g.createRadialGradient(cx, cy + s * 0.1, s * 0.05, cx, cy, s * 0.47);
  ir.addColorStop(0, '#9b6bd6'); ir.addColorStop(0.45, '#6a3f9c'); ir.addColorStop(0.85, '#3b2154'); ir.addColorStop(1, '#24142c');
  g.fillStyle = ir; g.beginPath(); g.arc(cx, cy, s * 0.44, 0, TAU); g.fill();
  // 下半部分的暖色反光（Disney/Pixar 常见的"眼底光"）
  const lo = g.createRadialGradient(cx, cy + s * 0.26, 0, cx, cy + s * 0.26, s * 0.3);
  lo.addColorStop(0, 'rgba(255,190,235,0.75)'); lo.addColorStop(1, 'rgba(255,190,235,0)');
  g.fillStyle = lo; g.beginPath(); g.arc(cx, cy, s * 0.44, 0, TAU); g.fill();
  // 瞳孔
  g.fillStyle = '#140a18'; g.beginPath(); g.ellipse(cx, cy + s * 0.02, s * 0.2, s * 0.23, 0, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 平面投影 UV（沿 z 轴），让贴图正正地贴在眼球正面
function planarUV(geo, rx, ry) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / rx * 0.5 + 0.5; uv[i * 2 + 1] = p.getY(i) / ry * 0.5 + 0.5; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
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
    this.tailS = new Spring(120, 6, 0);
    this.facing = 0; this.targetFacing = 0;
    this.blinkT = rand(1, 3); this.blinking = 0;
    this.eyesMode = 'open'; this.mouthMode = 'cat'; this.browMode = 'neutral';
    this.exprUntil = 0;
    this.lookX = 0; this.lookY = 0; this.lookTX = 0; this.lookTY = 0;
    this.action = null; // 当前动作（跳跃/舞蹈等）
    this.groundY = 0; // 当前脚下地面高度
    this.sink = 0; this.sinkTarget = 0; // 陷入软东西的深度
    this.idleBob = 1;
    this.sleepy = 0;
    this.accessory = null;
    this.extraAccessory = null;
    this.tool = null;
    this.toolType = null;
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

    // 麻薯身体：底部压扁、略呈梨形，并带顶点色渐变（上浅下暖，肚皮更白）
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
      tmp.copy(cTop).lerp(cBot, clamp((-ny + 0.2) * 0.8, 0, 1));
      const bellyW = clamp((z / R - 0.3) * 1.6, 0, 1) * clamp(1 - Math.abs(ny + 0.3) * 1.8, 0, 1);
      tmp.lerp(cBelly, bellyW * 0.8);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    bg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bg.computeVertexNormals();
    bg.translate(0, R * 0.9 * 0.86, 0); // 让底部贴地
    this.disposables.push(bg);
    const bodyMat = M.soft('#ffffff', { vc: true, rough: 0.55, rim: 0.6, rimColor: C.rim, rimPower: 2.2 });
    this.body = new THREE.Mesh(bg, bodyMat);
    this.body.castShadow = true;
    this.lean.add(this.body);
    addOutline(this.body, 0.018);

    const bodyCenterY = R * 0.9 * 0.86;
    this.headY = bodyCenterY + R * 0.9; // 头顶
    // 身体表面上的点（用于贴五官）
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
    const irisTex = irisTexture();
    this.disposables.push(irisTex);
    const eyeMat = new THREE.MeshPhysicalMaterial({ map: irisTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.9 });
    this.disposables.push(eyeMat);
    const lineMat = M.soft(C.eye, { rough: 0.3, rim: 0 });
    const hiMat = M.basic('#ffffff');
    this.eyes = [];
    const ERX = 0.088, ERY = 0.108;
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const p = surf(0.172 * s, 0.53);
      g.position.copy(p);
      g.rotation.y = Math.atan2(p.x, p.z) * 0.8;
      g.rotation.x = -0.1;
      const eyeGeo = planarUV(ellipsoid(ERX, ERY, 0.04, 28, 18), ERX, ERY);
      this.disposables.push(eyeGeo);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      g.add(eye);
      // 高光：左上一大颗 + 右下一小颗 + 一颗小星光（水汪汪）
      const h1g = new THREE.SphereGeometry(0.03, 12, 8); this.disposables.push(h1g);
      const h1 = new THREE.Mesh(h1g, hiMat); h1.position.set(-0.03, 0.042, 0.032); h1.scale.set(1, 1.1, 0.4); g.add(h1);
      const h2g = new THREE.SphereGeometry(0.014, 10, 6); this.disposables.push(h2g);
      const h2 = new THREE.Mesh(h2g, hiMat); h2.position.set(0.032, -0.04, 0.034); h2.scale.set(1, 1, 0.4); g.add(h2);
      const h3 = new THREE.Mesh(h2g, hiMat); h3.position.set(0.004, 0.06, 0.034); h3.scale.set(0.55, 0.55, 0.3); g.add(h3);
      // 开心眼 ^ ^
      const arcG = new THREE.TorusGeometry(0.056, 0.015, 8, 20, Math.PI); this.disposables.push(arcG);
      const happy = new THREE.Mesh(arcG, lineMat); happy.position.set(0, -0.015, 0.022); happy.visible = false; g.add(happy);
      // 闭眼 ︶（舒服地眯起来）
      const closed = new THREE.Mesh(arcG, lineMat); closed.rotation.z = Math.PI; closed.position.set(0, 0.02, 0.022); closed.scale.set(1, 0.6, 1); closed.visible = false; g.add(closed);
      this.faceGroup.add(g);
      this.eyes.push({ g, eye, h1, h2, h3, happy, closed, side: s });
    }
    // 小眉毛（表情的灵魂：惊喜上扬、专注下压、开心弯弯）
    const browG = new THREE.TorusGeometry(0.042, 0.0105, 6, 14, Math.PI * 0.62); this.disposables.push(browG);
    const browMat = M.soft(C.brow, { rough: 0.6, rim: 0 });
    this.brows = [];
    for (const s of [-1, 1]) {
      const pv = new THREE.Group();
      const p = surf(0.172 * s, 0.665);
      pv.position.copy(p);
      pv.rotation.y = Math.atan2(p.x, p.z) * 0.85;
      pv.rotation.x = -0.35;
      const b = new THREE.Mesh(browG, browMat);
      b.rotation.z = Math.PI * 0.19;
      b.position.y = -0.03;
      pv.add(b);
      this.faceGroup.add(pv);
      this.brows.push({ pv, b, side: s, y: p.y });
    }
    // 腮红
    const blushMat = M.basic(C.blush, { opacity: 0.8, map: Tex.soft() });
    this.blush = [];
    for (const s of [-1, 1]) {
      const p = surf(0.3 * s, 0.425);
      const bgeo = new THREE.CircleGeometry(0.09, 20); this.disposables.push(bgeo);
      const m = new THREE.Mesh(bgeo, blushMat);
      m.position.copy(p).multiplyScalar(1.01);
      m.lookAt(p.clone().multiplyScalar(2).setY(p.y));
      m.scale.set(1.25, 0.8, 1);
      this.faceGroup.add(m);
      this.blush.push(m);
    }
    // 小鼻头
    const noseG = ellipsoid(0.019, 0.013, 0.012, 12, 8); this.disposables.push(noseG);
    const nose = new THREE.Mesh(noseG, M.soft(C.nose, { rough: 0.4, rim: 0.2 }));
    nose.position.copy(surf(0, 0.468)).add(new THREE.Vector3(0, 0, 0.004));
    this.faceGroup.add(nose);
    // 嘴巴：小猫嘴 ω / 微笑 / 张嘴 / 小 o
    const mouthMat = M.soft(C.mouth, { rough: 0.5, rim: 0 });
    this.mouthCat = new THREE.Group();
    this.mouthCat.position.copy(surf(0, 0.432)).add(new THREE.Vector3(0, 0, 0.005));
    const mg = new THREE.TorusGeometry(0.024, 0.0075, 6, 14, Math.PI); this.disposables.push(mg);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(mg, mouthMat);
      m.rotation.z = Math.PI;
      m.position.x = 0.024 * s;
      this.mouthCat.add(m);
    }
    this.faceGroup.add(this.mouthCat);
    this.mouthSmile = new THREE.Group();
    this.mouthSmile.position.copy(this.mouthCat.position);
    const sg = new THREE.TorusGeometry(0.04, 0.008, 6, 16, Math.PI); this.disposables.push(sg);
    const sm = new THREE.Mesh(sg, mouthMat); sm.rotation.z = Math.PI; sm.position.y = 0.01;
    this.mouthSmile.add(sm);
    this.mouthSmile.visible = false;
    this.faceGroup.add(this.mouthSmile);
    this.mouthOpen = new THREE.Group();
    this.mouthOpen.position.copy(surf(0, 0.41)).add(new THREE.Vector3(0, 0, -0.012));
    const moG = ellipsoid(0.05, 0.045, 0.03, 16, 12); this.disposables.push(moG);
    this.mouthOpen.add(new THREE.Mesh(moG, mouthMat));
    const tgG = ellipsoid(0.03, 0.018, 0.02, 12, 8); this.disposables.push(tgG);
    const tg = new THREE.Mesh(tgG, M.soft(C.tongue, { rim: 0 }));
    tg.position.set(0, -0.022, 0.015);
    this.mouthOpen.add(tg);
    this.mouthOpen.visible = false;
    this.faceGroup.add(this.mouthOpen);

    // ---- 耳朵（兔猫耳） ----
    const earMat = M.soft(C.ear, { rough: 0.6, rim: 0.55, rimColor: C.rim });
    const innerMat = M.soft(C.earInner, { rough: 0.7, rim: 0.2 });
    const earGeo = ellipsoid(0.115, 0.24, 0.075, 24, 16); earGeo.translate(0, 0.2, 0); this.disposables.push(earGeo);
    const inGeo = ellipsoid(0.065, 0.15, 0.03, 16, 12); inGeo.translate(0, 0.19, 0.05); this.disposables.push(inGeo);
    this.ears = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.2 * s, this.headY - 0.12, -0.02);
      pivot.rotation.z = -0.42 * s;
      pivot.rotation.x = -0.12;
      const ear = new THREE.Mesh(earGeo, earMat);
      ear.castShadow = true;
      addOutline(ear);
      ear.add(new THREE.Mesh(inGeo, innerMat));
      pivot.add(ear);
      this.lean.add(pivot);
      this.ears.push({ pivot, ear, side: s, baseZ: -0.42 * s });
    }

    // ---- 小豆芽 ----
    this.sproutPivot = new THREE.Group();
    this.sproutPivot.position.set(0.0, this.headY - 0.03, 0.02);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, 0.08, 0), new THREE.Vector3(0.035, 0.15, 0.0), new THREE.Vector3(0.05, 0.2, 0)]);
    const stemG = new THREE.TubeGeometry(curve, 12, 0.014, 8, false); this.disposables.push(stemG);
    const sproutMat = M.soft(C.sprout, { rough: 0.5, rim: 0.4, rimColor: '#d8ffb0' });
    this.sproutPivot.add(new THREE.Mesh(stemG, sproutMat));
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

    // ---- 小手（右手末端有"握把"挂点，用来拿道具） ----
    const armGeo = ellipsoid(0.095, 0.16, 0.095, 16, 12); armGeo.translate(0, -0.12, 0); this.disposables.push(armGeo);
    this.arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.47 * s, 0.44, 0.1);
      const arm = new THREE.Mesh(armGeo, earMat);
      arm.castShadow = true;
      addOutline(arm, 0.012);
      pivot.add(arm);
      const hand = new THREE.Group();
      hand.position.set(0, -0.24, 0.02);
      pivot.add(hand);
      this.lean.add(pivot);
      this.arms.push({ pivot, arm, hand, side: s });
    }
    this.handR = this.arms[1].hand;

    // ---- 小脚（脚底有粉色肉垫：一颗掌垫 + 三颗脚趾豆） ----
    const footGeo = ellipsoid(0.12, 0.065, 0.14, 16, 12); this.disposables.push(footGeo);
    const footMat = M.soft('#ffe9df', { rough: 0.65, rim: 0.3, rimColor: C.rim });
    const padMat = M.soft(C.pad, { rough: 0.5, rim: 0.1 });
    const padG = ellipsoid(0.055, 0.012, 0.045, 12, 6); this.disposables.push(padG);
    const toeG = ellipsoid(0.022, 0.01, 0.022, 10, 6); this.disposables.push(toeG);
    this.feet = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, footMat);
      f.position.set(0.19 * s, 0.05, 0.12);
      f.castShadow = true;
      addOutline(f, 0.012);
      const pad = new THREE.Mesh(padG, padMat); pad.position.set(0, -0.058, -0.012); f.add(pad);
      for (const k of [-1, 0, 1]) { const toe = new THREE.Mesh(toeG, padMat); toe.position.set(k * 0.042, -0.05, 0.072 - Math.abs(k) * 0.012); f.add(toe); }
      this.bodyPivot.add(f);
      this.feet.push({ m: f, side: s, baseX: 0.19 * s, baseZ: 0.12 });
    }

    // ---- 尾巴（毛球） ----
    const tailGeo = new THREE.IcosahedronGeometry(0.1, 2); this.disposables.push(tailGeo);
    this.tail = new THREE.Mesh(tailGeo, earMat);
    this.tail.position.set(0, 0.2, -0.47);
    addOutline(this.tail, 0.012);
    this.lean.add(this.tail);

    // ---- 配饰挂点 ----
    this.hatAnchor = new THREE.Group();
    this.hatAnchor.position.set(0, this.headY - 0.04, 0);
    this.lean.add(this.hatAnchor);
    this.neckAnchor = new THREE.Group();
    this.neckAnchor.position.set(0, 0.24, 0);
    this.lean.add(this.neckAnchor);

    // ---- 脚下柔和阴影（贴地） ----
    const shg = new THREE.PlaneGeometry(1.2, 1.2); this.disposables.push(shg);
    this.shadow = new THREE.Mesh(shg, M.basic('#000000', { map: Tex.shadow(), opacity: 1 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  // ---------------- 配饰与道具 ----------------
  setAccessory(type) {
    if (this.accessory) { this.accessory.parent?.remove(this.accessory); this._disposeObj(this.accessory); this.accessory = null; }
    if (!type) return;
    const a = buildAccessory(type, this.mats);
    if (!a) return;
    (a.userData.neck ? this.neckAnchor : this.hatAnchor).add(a);
    this.accessory = a;
    this._placeCrown();
  }
  // 大礼物时的临时皇冠
  setCrown(on) {
    if (this.extraAccessory) { this.hatAnchor.remove(this.extraAccessory); this._disposeObj(this.extraAccessory); this.extraAccessory = null; }
    if (on) {
      this.extraAccessory = buildAccessory('crown', this.mats);
      this.hatAnchor.add(this.extraAccessory);
      this.crownPop = 0;
      this._placeCrown();
    }
  }
  _placeCrown() {
    if (this.extraAccessory) this.extraAccessory.position.y = 0.02 + (this.accessory && !this.accessory.userData.neck && this.accessory.userData.tall ? 0.16 : 0);
  }
  // 拿起 / 放下道具（刀、打蛋器、锅铲、扫帚、抹布、气球……）
  hold(type) {
    if (this.toolType === type) return this.tool;
    if (this.tool) { this.handR.remove(this.tool); this._disposeObj(this.tool); this.tool = null; this.toolType = null; }
    if (!type) return null;
    const t = buildTool(type, this.mats);
    if (!t) return null;
    t.scale.setScalar(0.001);
    this.handR.add(t);
    this.tool = t; this.toolType = type; this.toolPop = 0;
    return t;
  }
  // 道具尖端在世界坐标中的位置（切菜刀口、扫帚头、抹布……）
  toolTipWorld() {
    if (!this.tool) return this.handWorld();
    this.root.updateMatrixWorld(true);
    return this.tool.localToWorld((this.tool.userData.tip || new THREE.Vector3()).clone());
  }
  handWorld() { this.root.updateMatrixWorld(true); return this.handR.localToWorld(new THREE.Vector3()); }
  _disposeObj(o) { o.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); }

  // ---------------- 表情 ----------------
  // eyes: open / wide / half / happy / closed；mouth: cat / smile / open / o；brows: neutral / up / down / worried / happy
  expr(eyes = 'open', mouth = 'cat', hold = 0, brows = null) {
    this.eyesMode = eyes;
    this.mouthMode = mouth;
    this.browMode = brows || (eyes === 'wide' ? 'up' : eyes === 'happy' || eyes === 'closed' ? 'happy' : 'neutral');
    this.exprUntil = hold ? this.t + hold : 0;
  }
  _applyExpr(dt, P) {
    if (this.exprUntil && this.t > this.exprUntil) { this.eyesMode = this.sleepy > 0.6 ? 'half' : 'open'; this.mouthMode = 'cat'; this.browMode = 'neutral'; this.exprUntil = 0; }
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinking = 0.14; this.blinkT = rand(2.2, 5.5); if (Math.random() < 0.2) this.blinkT = 0.25; }
    if (this.blinking > 0) this.blinking -= dt;
    const mode = P.eyes || (P.happy && this.eyesMode === 'open' ? 'happy' : this.eyesMode);
    const blinkAmt = this.blinking > 0 && (mode === 'open' || mode === 'wide' || mode === 'half') ? Math.sin((1 - this.blinking / 0.14) * Math.PI) : 0;
    for (const e of this.eyes) {
      const normal = mode === 'open' || mode === 'wide' || mode === 'half';
      e.eye.visible = normal; e.h1.visible = normal; e.h2.visible = normal; e.h3.visible = normal;
      e.happy.visible = mode === 'happy';
      e.closed.visible = mode === 'closed';
      let sy = mode === 'wide' ? 1.14 : mode === 'half' ? 0.55 : 1;
      sy *= 1 - blinkAmt * 0.92;
      const sx = mode === 'wide' ? 1.08 : 1;
      e.g.scale.set(sx, Math.max(0.06, sy), 1);
      // 视线：瞳孔转动，高光保持在原处（光源方向不变，更像真的眼睛）
      e.eye.position.x = this.lookX * 0.014;
      e.eye.position.y = this.lookY * 0.012;
      const tw = 1 + Math.sin(this.t * 3.1 + e.side) * 0.08; // 星光一闪一闪
      e.h3.scale.set(0.55 * tw, 0.55 * tw, 0.3);
    }
    // 眉毛
    const bm = P.brows || this.browMode;
    const by = bm === 'up' ? 0.03 : bm === 'down' ? -0.012 : bm === 'happy' ? 0.012 : 0;
    const tilt = bm === 'down' ? -0.32 : bm === 'worried' ? 0.32 : 0;
    for (const b of this.brows) {
      b.pv.position.y = damp(b.pv.position.y, b.y + by, 12, dt);
      b.b.rotation.z = damp(b.b.rotation.z, Math.PI * 0.19 + tilt * b.side, 12, dt);
    }
    const mm = P.mouth || this.mouthMode;
    this.mouthCat.visible = mm === 'cat';
    this.mouthSmile.visible = mm === 'smile';
    this.mouthOpen.visible = mm === 'open' || mm === 'o';
    if (mm === 'o') this.mouthOpen.scale.set(0.65, 0.85, 1); else this.mouthOpen.scale.set(1, 1, 1);
  }

  // ---------------- 动作接口 ----------------
  _basePose() {
    return {
      y: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1,
      armL: { z: 0, x: 0 }, armR: { z: 0, x: 0 },
      footL: { y: 0, z: 0, x: 0, rx: 0 }, footR: { y: 0, z: 0, x: 0, rx: 0 },
      ear: 0, earFlap: 0, tail: 0,
    };
  }

  face(angle) { this.targetFacing = angle; }
  faceTowards(x, z) { this.targetFacing = Math.atan2(x - this.root.position.x, z - this.root.position.z); }

  /**
   * 跳到目标点。o: { height, dur, spin(圈), flip(圈), anticipation, onTakeoff, keepFacing }
   * 返回 Promise，落地时 resolve。
   */
  hop(to, o = {}) {
    const from = this.root.position.clone();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const height = o.height ?? 0.32 + dist * 0.08;
    const dur = o.dur ?? 0.46 + dist * 0.06;
    if (dist > 0.05 && !o.keepFacing) this.faceTowards(to.x, to.z);
    return new Promise((resolve) => {
      this._start({ kind: 'hop', t: 0, from, to: to.clone(), height, dur, ant: o.anticipation ?? 0.11, spin: o.spin || 0, flip: o.flip || 0, resolve, onTakeoff: o.onTakeoff, launched: false, tuck: o.tuck ?? 0 });
    });
  }

  // 原地小跳
  bounceInPlace(height = 0.25, dur = 0.4) { return this.hop(this.root.position.clone(), { height, dur, anticipation: 0.06 }); }

  /**
   * 一步一步走（踩踏型 ASMR 的核心动作）。
   * o: { steps, stepDur, lift, heavy, gait(normal/stomp/tiptoe/balance), onStep(side, footWorldPos, index), yAt(x,z), keepFacing }
   * 每一步脚落地时回调 onStep，用来压脚印、播放声音（声画同步：就在脚落地的那一帧）。
   */
  walk(to, o = {}) {
    const from = this.root.position.clone();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, o.steps || Math.round(dist / 0.3));
    const stepDur = o.stepDur || 0.6;
    if (dist > 0.02 && !o.keepFacing) {
      this.faceTowards(to.x, to.z);
      // "对着镜头演"（电影里的 cheat to camera）：身体朝镜头稍微偏一点，
      // 走 S 形、斜着走的时候小脸也一直看得到，而不是变成侧面
      if (o.cheatTo && o.cheat) {
        const ac = Math.atan2(o.cheatTo.x - from.x, o.cheatTo.z - from.z);
        const d = ((ac - this.targetFacing + Math.PI) % TAU + TAU) % TAU - Math.PI;
        this.targetFacing += clamp(d * o.cheat, -0.35, 0.35);
      }
    }
    return new Promise((resolve) => {
      this._start({ kind: 'walk', t: 0, from, to: to.clone(), steps, stepDur, lift: o.lift ?? 0.07, heavy: o.heavy || 0, gait: o.gait || 'normal', onStep: o.onStep, yAt: o.yAt, done: -1, side: this._nextFoot || 1, resolve });
    });
  }

  /**
   * 踩奶：站在原地，左右小脚轮流往下按（猫咪"踩奶"），每按一下回调 onPress(side, footWorldPos, i)。
   */
  knead(o = {}) {
    return new Promise((resolve) => {
      this._start({ kind: 'knead', t: 0, count: o.count || 4, dur: o.pressDur || 0.75, depth: o.depth ?? 1, onPress: o.onPress, done: -1, side: this._nextFoot || 1, resolve });
    });
  }

  /**
   * 用小手/道具做动作（切菜、搅拌、扫地、擦拭、翻面、挤奶油……），每一下"接触"的那一帧回调 onHit(i)。
   * kind: chop / whisk / sweep / wipe / flip / pipe / tap / fold / push / pour / scrub
   */
  act(kind, o = {}) {
    return new Promise((resolve) => {
      this._start({ kind: 'act', sub: kind, t: 0, reps: o.reps || 1, dur: o.dur || 0.7, hitAt: o.hitAt ?? ACT_HIT[kind] ?? 0.5, onHit: o.onHit, done: -1, resolve });
    });
  }

  // 脚在世界坐标中的位置（side: 1 右脚 / -1 左脚）
  footWorld(side) {
    const s = this.root.scale.x;
    return new THREE.Vector3(0.19 * (side > 0 ? 1 : -1) * s, 0, 0.14 * s).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y).add(new THREE.Vector3(this.root.position.x, this.groundY, this.root.position.z));
  }

  /**
   * 坐着沿曲线滑下来（滑滑梯）。curve: THREE.Curve（世界坐标），dur 秒；onDone 前一刻回调 onEnd。
   * 速度先慢后快（重力感），身体顺着弯道倾斜，小手举高。
   */
  ride(curve, dur = 1.8, o = {}) {
    return new Promise((resolve) => { this._start({ kind: 'ride', t: 0, curve, dur, resolve, bank: o.bank ?? 1, faceTo: o.faceTo }); });
  }

  /** 抓着气球/雨伞飘过去：弧线 + 轻轻摇摆，小脚晃呀晃 */
  float(to, o = {}) {
    const from = this.root.position.clone();
    if (!o.keepFacing) this.faceTowards(to.x, to.z);
    return new Promise((resolve) => { this._start({ kind: 'float', t: 0, from, to: to.clone(), dur: o.dur || 3, height: o.height ?? 0.9, resolve }); });
  }

  // 舞蹈：dance = {fn(pose, t, beat, pet), beats}
  // beatClock：返回"当前是第几拍"的函数（用音乐播放时钟算，长时间也不会和音乐错拍）
  dance(dance, seconds, bpm = 112, beatOffset = 0, beatClock = null) {
    return new Promise((resolve) => { this._start({ kind: 'dance', t: 0, dance, seconds, bps: bpm / 60, off: beatOffset, clock: beatClock, resolve, events: dance.events ? dance.events.map((e) => ({ ...e, done: false })) : [] }); });
  }

  // 停顿/姿态（看看四周、闻一闻、坐下、准备起跳……）
  idleAction(kind, seconds) {
    return new Promise((resolve) => { this._start({ kind: 'idle', sub: kind, t: 0, seconds, resolve }); });
  }

  cancelAction() {
    if (this.action && this.action.resolve) { const r = this.action.resolve; this.action = null; this.sq.target = 1; r(); }
  }

  // 新动作替换旧动作时，先让旧动作的 Promise 结束（防止调用方永远等待），并恢复挤压
  _start(a) {
    if (this.action) this.cancelAction();
    this.sq.target = 1;
    this.action = a;
  }

  kickEars(v) { this.earL.kick(v * (0.8 + Math.random() * 0.4)); this.earR.kick(-v * (0.8 + Math.random() * 0.4)); this.sprout.kick(v * 1.4); this.tailS.kick(v * 0.6); }

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
    P.armL.z = 0.3 + Math.sin(t * 2.2) * 0.05; P.armR.z = -0.3 - Math.sin(t * 2.2) * 0.05;
    P.tail = Math.sin(t * 3.1) * 0.15;

    if (a && a.kind === 'hop') {
      a.t += dt;
      const ant = a.ant;
      if (a.t < ant) {
        this.sq.target = 0.78; // 起跳前蓄力下蹲
        P.armL.z = 0.4; P.armR.z = -0.4; P.armL.x = P.armR.x = -0.3;
        P.brows = 'down';
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
        pos.y = lerp(a.from.y, a.to.y, u) + 4 * a.height * u * (1 - u);
        const air = Math.sin(u * Math.PI);
        P.sy += 0.1 * air;
        P.footL.y = P.footR.y = 0.06 * air;
        P.footL.rx = P.footR.rx = -0.5 * air; // 空中小脚翘起，露出肉垫
        P.armL.z = 0.9 * air + 0.1; P.armR.z = -P.armL.z;
        if (a.height > 0.5) { P.mouth = 'open'; P.eyes = u > 0.25 && u < 0.75 ? 'happy' : null; }
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
    } else if (a && a.kind === 'walk') {
      a.t += dt;
      const total = a.steps * a.stepDur;
      const u = clamp(a.t / total, 0, 1);
      const k = Math.min(a.steps - 1e-6, a.t / a.stepDur);
      const i = Math.floor(k), ph = k - i; // 当前第 i 步，步内相位 0..1
      // 位置：每一步里前 70% 移动，后 30% 站稳（踮脚走路的顿挫感）
      const stepU = Math.min(1, ph / 0.7);
      const prog = (i + ease.inOutSine(stepU)) / a.steps;
      pos.x = lerp(a.from.x, a.to.x, prog);
      pos.z = lerp(a.from.z, a.to.z, prog);
      // 地面高度做一点平滑：走过高低不平的落叶堆、台阶时身体不会抖
      const rawGround = a.yAt ? a.yAt(pos.x, pos.z) : lerp(a.from.y, a.to.y, prog);
      a.gy = a.gy == null ? rawGround : damp(a.gy, rawGround, 14, dt);
      const ground = a.gy;
      this.groundY = ground;
      const side = (i % 2 === 0 ? 1 : -1) * a.side;
      const stomp = a.gait === 'stomp';
      const lift = stomp ? smoothstep(0, 0.3, ph) * (1 - smoothstep(0.58, 0.7, ph)) : Math.sin(Math.min(1, ph / 0.7) * Math.PI);
      pos.y = ground + lift * (stomp ? 0.06 : 0.035);
      const f = side > 0 ? P.footR : P.footL;
      f.y = lift * a.lift; f.z = (stepU - 0.5) * 0.12 * (ph < 0.7 ? 1 : 0);
      f.rx = -0.35 * lift; // 抬脚时脚底朝后，正面镜头能看到粉色肉垫
      P.rz += side * 0.07 * lift;
      P.rx += 0.04;
      P.sy *= 1 + 0.03 * lift - (ph > 0.7 ? 0.05 + a.heavy * 0.08 : 0);
      P.armL.z = 0.55 + 0.15 * lift; P.armR.z = -0.55 - 0.15 * lift;
      P.armL.x = 0.25 * side * lift; P.armR.x = -0.25 * side * lift; // 小手前后摆
      P.ear = side * 2 * lift;
      if (ph >= 0.7 && a.done < i) {
        a.done = i;
        this.sq.kick(-1.2 - a.heavy * 2.5);
        this.kickEars(1.5 + a.heavy * 2);
        if (a.onStep) {
          const sc = this.root.scale.x;
          const local = new THREE.Vector3(0.19 * (side > 0 ? 1 : -1) * sc, 0, 0.14 * sc);
          const wp = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y).add(new THREE.Vector3(pos.x, ground, pos.z));
          try { a.onStep(side, wp, i); } catch (e) { console.error(e); }
        }
      }
      if (stomp && ph > 0.25 && ph < 0.62) { P.armL.z = 0.9; P.armR.z = -0.9; P.sy *= 1.04; P.brows = 'down'; }
      if (a.gait === 'tiptoe') { P.sy *= 1.03; P.armL.z = 0.25; P.armR.z = -0.25; P.armL.x = P.armR.x = 0.35; }
      if (a.gait === 'balance') { P.armL.z = 1.35 + Math.sin(t * 5) * 0.15; P.armR.z = -1.35 + Math.sin(t * 5) * 0.15; P.rz += Math.sin(t * 4.3) * 0.06; P.mouth = 'o'; P.brows = 'worried'; }
      if (u >= 1) { this.action = null; this._nextFoot = -side; pos.set(a.to.x, a.yAt ? a.yAt(a.to.x, a.to.z) : a.to.y, a.to.z); this.groundY = pos.y; a.resolve(); }
    } else if (a && a.kind === 'knead') {
      // 踩奶：轮流按压，身体随之一沉一沉，小手放在胸前，眯着眼很享受
      a.t += dt;
      const k = Math.min(a.count - 1e-6, a.t / a.dur);
      const i = Math.floor(k), ph = k - i;
      const side = (i % 2 === 0 ? 1 : -1) * a.side;
      const f = side > 0 ? P.footR : P.footL;
      const lift = smoothstep(0, 0.35, ph) * (1 - smoothstep(0.45, 0.6, ph));
      f.y = lift * 0.07; f.z = 0.03 * lift; f.rx = -0.4 * lift;
      const press = smoothstep(0.55, 0.65, ph) * (1 - smoothstep(0.75, 1, ph));
      P.sy *= 1 - press * 0.07 * a.depth;
      P.rz += side * 0.06 * (lift - press * 0.5);
      P.rx += 0.07 + press * 0.05;
      P.armL.z = 0.25; P.armR.z = -0.25; P.armL.x = P.armR.x = 0.55;
      P.happy = true; P.blush = 0.6;
      P.ear = side * 1.5 * lift;
      if (ph >= 0.6 && a.done < i) {
        a.done = i;
        this.sq.kick(-0.8 * a.depth);
        if (a.onPress) { try { a.onPress(side, this.footWorld(side), i); } catch (e) { console.error(e); } }
      }
      if (a.t >= a.count * a.dur) { this.action = null; this._nextFoot = -side; a.resolve(); }
    } else if (a && a.kind === 'act') {
      a.t += dt;
      const k = Math.min(a.reps - 1e-6, a.t / a.dur);
      const i = Math.floor(k), ph = k - i;
      actPose(a.sub, P, ph, i, this);
      if (ph >= a.hitAt && a.done < i) {
        a.done = i;
        this.sq.kick(-0.9);
        if (a.onHit) { try { a.onHit(i); } catch (e) { console.error(e); } }
      }
      if (a.t >= a.reps * a.dur) { this.action = null; a.resolve(); }
    } else if (a && a.kind === 'ride') {
      a.t += dt;
      const u = clamp(a.t / a.dur, 0, 1);
      const s = u * u * (1.6 - 0.6 * u); // 先慢后快、最后稍微收一点
      const p = a.curve.getPointAt(clamp(s, 0, 1));
      const tan = a.curve.getTangentAt(clamp(s, 0, 1));
      pos.copy(p);
      this.groundY = p.y;
      let face = Math.atan2(tan.x, tan.z);
      // 弯道上也把小脸转向镜头一些（一半顺着滑道、一半看观众）
      if (a.faceTo) { const c = a.faceTo(); const ac = Math.atan2(c.x - pos.x, c.z - pos.z); const d = ((ac - face + Math.PI) % TAU + TAU) % TAU - Math.PI; face += d * 0.45; }
      this.targetFacing = face;
      this.facing = dampAngle(this.facing, face, 14, dt);
      // 弯道上身体顺势倾斜
      const tan2 = a.curve.getTangentAt(clamp(s + 0.03, 0, 1));
      const turn = Math.atan2(tan2.x, tan2.z) - Math.atan2(tan.x, tan.z);
      P.rz += clamp(-turn * 6 * a.bank, -0.35, 0.35);
      P.sy *= 0.9; P.sx *= 1.05;
      P.footL.z = P.footR.z = 0.12; P.footL.y = P.footR.y = 0.04; P.footL.rx = P.footR.rx = -1.1; // 坐着滑，小脚伸向前方
      P.armL.z = 2.5; P.armR.z = -2.5; P.armL.x = P.armR.x = 0.3; // 小手举高高
      P.mouth = 'open'; P.eyes = 'happy'; P.blush = 1;
      P.ear = Math.sin(t * 20) * 2;
      if (u >= 1) { this.action = null; a.resolve(); }
    } else if (a && a.kind === 'float') {
      a.t += dt;
      const u = clamp(a.t / a.dur, 0, 1);
      const e = ease.inOutSine(u);
      airborne = u < 1;
      pos.x = lerp(a.from.x, a.to.x, e);
      pos.z = lerp(a.from.z, a.to.z, e) + Math.sin(u * Math.PI * 2) * 0.08;
      pos.y = lerp(a.from.y, a.to.y, e) + Math.sin(u * Math.PI) * a.height;
      P.armR.z = -2.9; P.armR.x = 0.1; // 右手举高抓着气球
      P.armL.z = 0.9 + Math.sin(t * 3) * 0.2;
      P.footL.y = P.footR.y = 0.02; P.footL.rx = Math.sin(t * 6) * 0.5; P.footR.rx = -Math.sin(t * 6) * 0.5; // 小脚晃呀晃
      P.footL.z = Math.sin(t * 6) * 0.04; P.footR.z = -Math.sin(t * 6) * 0.04;
      P.rz += Math.sin(t * 2.2) * 0.12;
      P.happy = true; P.mouth = 'smile';
      if (u >= 1) { this.action = null; pos.copy(a.to); this.sq.kick(-3); a.resolve(); }
    } else if (a && a.kind === 'dance') {
      a.t += dt;
      // 拍点：优先用音乐的播放时钟（不受掉帧影响），没有音乐时用本地时间
      const beat = a.clock ? Math.max(0, a.clock()) : Math.max(0, a.t + (a.off || 0)) * a.bps;
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
    if (!(a && a.kind === 'ride')) this.facing = dampAngle(this.facing, this.targetFacing, 10, dt);
    this.root.rotation.y = this.facing;

    // 耳朵/豆芽/尾巴弹簧：受加速度影响
    this.earL.target = P.ear + P.earFlap; this.earR.target = -P.ear - P.earFlap;
    const el = this.earL.update(dt), er = this.earR.update(dt);
    this.ears[0].pivot.rotation.z = this.ears[0].baseZ - el * 0.08;
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
    // 卡通式"伸长"：手举得越高越长，动作更好认
    const stretch = (z) => 1 + clamp((Math.abs(z) - 1.1) / 1.4, 0, 1) * 0.4;
    this.arms[0].pivot.scale.set(1, stretch(P.armL.z), 1);
    this.arms[1].pivot.scale.set(1, stretch(P.armR.z), 1);
    for (const [ft, fp] of [[this.feet[0], P.footL], [this.feet[1], P.footR]]) {
      ft.m.position.set(ft.baseX + fp.x, 0.05 + fp.y, ft.baseZ + fp.z);
      ft.m.rotation.x = fp.rx || 0;
      ft.m.scale.setScalar(1 / Math.max(0.7, Math.min(1.3, sxz)));
    }
    const ts = this.tailS.update(dt);
    this.tail.rotation.y = P.tail + ts * 0.05;
    this.tail.position.x = Math.sin(P.tail + ts * 0.05) * 0.06;

    // 道具弹出来（拿起时"啵"地变大）
    if (this.tool) {
      this.toolPop = Math.min(1, (this.toolPop || 0) + dt * 4);
      const s = ease.outBack(this.toolPop);
      this.tool.scale.setScalar(Math.max(0.001, s) * (this.tool.userData.scale || 1));
      // 道具朝向：气球/雨伞永远朝上；刀、打蛋器、裱花袋永远朝下（刀口垂直落到砧板上）；扫帚、拖把斜着靠向前方。
      // 握把始终在小手里，只是朝向不跟着手臂转，画面更自然
      const aim = this.tool.userData.aim;
      if (this.tool.userData.up || aim != null) {
        this.root.updateMatrixWorld(true);
        const hq = this.handR.getWorldQuaternion(_q1).invert();
        this.tool.quaternion.copy(hq.multiply(this.root.getWorldQuaternion(_q2)));
        if (this.tool.userData.up) this.tool.rotateZ(Math.sin(t * 1.6) * 0.08);
        else {
          this.tool.rotateX(-aim);
          if (this.toolWobble) this.tool.rotateZ(this.toolWobble);
        }
      }
    }

    // 视线
    this.lookX = damp(this.lookX, this.lookTX, 6, dt);
    this.lookY = damp(this.lookY, this.lookTY, 6, dt);
    if (Math.random() < dt * 0.4) { this.lookTX = rand(-0.6, 0.6); this.lookTY = rand(-0.3, 0.4); }

    this._applyExpr(dt, P);
    if (this.extraAccessory) {
      this.crownPop = Math.min(1, (this.crownPop || 0) + dt * 3);
      this.extraAccessory.scale.setScalar(ease.outBack(this.crownPop));
      this.extraAccessory.rotation.y = Math.sin(t * 2) * 0.15;
    }

    // 阴影跟随（高度越高阴影越小越淡）
    const h = Math.max(0, pos.y - this.groundY);
    this.shadow.position.set(pos.x, this.groundY + 0.015, pos.z);
    const ss = clamp(1 - h * 0.35, 0.45, 1) * 0.9 * this.root.scale.x;
    this.shadow.scale.set(ss * sxz, ss * sxz, 1);
    this.shadow.material.opacity = clamp(1 - h * 0.4, 0.3, 1);
  }

  dispose() {
    for (const d of this.disposables) d.dispose && d.dispose();
    this.setAccessory(null);
    this.setCrown(false);
    this.hold(null);
  }
}

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// 每种道具动作"接触"的相位（0~1）：声音和特效在这一帧触发
const ACT_HIT = { chop: 0.55, whisk: 0.5, sweep: 0.55, wipe: 0.5, flip: 0.35, pipe: 0.6, tap: 0.5, fold: 0.6, push: 0.55, pour: 0.4, scrub: 0.5, crack: 0.5 };

// 道具动作的姿态（ph：本次重复的相位 0..1）
function actPose(kind, P, ph, i, pet) {
  const s = Math.sin(ph * Math.PI);
  pet.toolWobble = 0;
  switch (kind) {
    case 'chop': { // 举起来 → 快速落下（0.55 接触砧板）→ 停一下
      const up = ph < 0.4 ? ease.outQuad(ph / 0.4) : ph < 0.55 ? 1 - ease.inQuad((ph - 0.4) / 0.15) : 0;
      P.armR.z = -0.15; P.armR.x = 0.75 + up * 1.0;
      P.armL.z = 0.5; P.armL.x = 0.7; // 左手按住菜
      P.rx += 0.12 + (ph > 0.55 && ph < 0.7 ? 0.05 : 0);
      P.brows = 'down'; P.mouth = 'cat';
      pet.lookTY = -0.7;
      break;
    }
    case 'whisk': { // 在碗里画圈
      const a = ph * TAU;
      P.armR.z = -0.25 + Math.cos(a) * 0.18; P.armR.x = 1.0 + Math.sin(a) * 0.18;
      pet.toolWobble = Math.sin(a) * 0.25;
      P.armL.z = 0.45; P.armL.x = 0.85; // 左手扶碗
      P.rz += Math.cos(a) * 0.04; P.rx += 0.12;
      P.happy = ph > 0.5 && i % 2 === 1;
      pet.lookTY = -0.6;
      break;
    }
    case 'sweep': { // 扫帚左右扫
      const sw = Math.sin(ph * TAU);
      P.armR.z = -0.35 + sw * 0.35; P.armR.x = 0.75 + Math.abs(sw) * 0.1;
      pet.toolWobble = sw * 0.45;
      P.armL.z = 0.35 - sw * 0.25; P.armL.x = 0.75;
      P.ry += sw * 0.18; P.rx += 0.1;
      pet.lookTY = -0.6;
      break;
    }
    case 'wipe': case 'scrub': { // 小圈圈擦擦
      const a = ph * TAU;
      P.armR.z = -0.6 + Math.cos(a) * 0.25; P.armR.x = 0.9 + Math.sin(a) * 0.25;
      pet.toolWobble = Math.cos(a) * 0.3;
      P.armL.z = 0.5; P.armL.x = 0.45;
      P.rx += 0.18; P.rz += Math.sin(a) * 0.05;
      P.brows = kind === 'scrub' ? 'down' : null;
      pet.lookTY = -0.7;
      break;
    }
    case 'flip': { // 锅铲往上一挑
      const k = ph < 0.35 ? ph / 0.35 : 1 - (ph - 0.35) / 0.65;
      P.armR.z = -0.6; P.armR.x = 0.7 + k * 0.9;
      P.armL.z = 0.6; P.armL.x = 0.5;
      P.sy *= 1 + k * 0.04;
      P.mouth = ph > 0.3 ? 'o' : 'cat'; P.brows = 'up';
      pet.lookTY = ph > 0.3 ? 0.6 : -0.4;
      break;
    }
    case 'pipe': { // 挤奶油：往下压，再轻轻旋一下
      const k = smoothstep(0, 0.6, ph) * (1 - smoothstep(0.8, 1, ph));
      P.armR.z = -0.2 + Math.sin(ph * TAU) * 0.08; P.armR.x = 1.05 - k * 0.15;
      P.armL.z = 0.4; P.armL.x = 0.9;
      P.rx += 0.16 + k * 0.05;
      P.brows = 'down';
      pet.lookTY = -0.8;
      break;
    }
    case 'tap': case 'push': { // 小手点一点 / 推一推
      P.armR.z = -0.5; P.armR.x = 0.6 + s * 0.7;
      P.armL.z = 0.4 + (kind === 'push' ? 0.1 : 0); P.armL.x = kind === 'push' ? 0.6 + s * 0.7 : 0.2;
      P.rx += 0.1 + s * 0.08;
      pet.lookTY = -0.5;
      break;
    }
    case 'fold': { // 两只小手把衣服叠起来
      P.armR.z = -0.5 + s * 0.4; P.armR.x = 0.8 + s * 0.6;
      P.armL.z = 0.5 - s * 0.4; P.armL.x = 0.8 + s * 0.6;
      P.rx += 0.14;
      P.happy = ph > 0.7;
      pet.lookTY = -0.6;
      break;
    }
    case 'pour': case 'crack': { // 倒面糊 / 敲蛋
      P.armR.z = -0.5; P.armR.x = 0.9 + s * 0.5;
      P.armL.z = 0.5; P.armL.x = 0.9 + s * 0.3;
      P.rx += 0.12;
      P.brows = 'up'; P.mouth = 'o';
      pet.lookTY = -0.6;
      break;
    }
    default: break;
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
      P.happy = true;
      break;
    case 'sit': // 坐下歇一会儿
      P.sy *= 1 - 0.1 * fade; P.sx *= 1 + 0.05 * fade;
      P.footL.z = P.footR.z = 0.08 * fade; P.footL.y = P.footR.y = 0.02 * fade;
      P.footL.rx = P.footR.rx = -1.0 * fade;
      P.rx += -0.06 * fade;
      break;
    case 'yawn':
      P.sy *= 1 + 0.08 * Math.sin(u * Math.PI); P.rx += -0.15 * Math.sin(u * Math.PI);
      P.armL.z = 1.8 * Math.sin(u * Math.PI); P.armR.z = -1.8 * Math.sin(u * Math.PI);
      P.mouth = 'open'; P.eyes = 'closed';
      break;
    case 'stretch':
      P.sy *= 1 + 0.15 * Math.sin(u * Math.PI); P.sx *= 1 - 0.05 * Math.sin(u * Math.PI);
      P.armL.z = 2.6 * Math.sin(u * Math.PI); P.armR.z = -2.6 * Math.sin(u * Math.PI);
      P.eyes = 'closed'; P.mouth = 'o';
      break;
    case 'tilt': // 歪头疑惑
      P.rz += 0.22 * fade;
      P.brows = 'worried';
      break;
    case 'wave': // 挥手
      P.armR.z = -2.4 * fade + Math.sin(t * 12) * 0.35 * fade;
      P.rz += Math.sin(t * 6) * 0.05;
      P.mouth = 'smile';
      break;
    case 'celebrate':
      P.armL.z = 2.5 * fade; P.armR.z = -2.5 * fade;
      P.y += Math.abs(Math.sin(t * 9)) * 0.12 * fade;
      P.happy = true; P.mouth = 'open';
      break;
    case 'ready': // 准备起跳：下蹲蓄力、眉毛压低、小手往后
      P.sy *= 1 - 0.12 * fade; P.sx *= 1 + 0.05 * fade;
      P.armL.z = 0.7; P.armR.z = -0.7; P.armL.x = P.armR.x = -0.6 * fade;
      P.rx += 0.12 * fade + Math.sin(t * 18) * 0.01;
      P.brows = 'down'; P.mouth = 'cat';
      break;
    case 'sitdown': // 一屁股坐进软软的东西里（脚底肉垫朝向镜头）
      P.sy *= 1 - 0.16 * fade; P.sx *= 1 + 0.08 * fade;
      P.footL.z = P.footR.z = 0.12 * fade; P.footL.y = P.footR.y = 0.03 * fade;
      P.footL.rx = P.footR.rx = -1.2 * fade;
      P.rx += -0.1 * fade;
      P.armL.z = 0.7 * fade + 0.3; P.armR.z = -0.7 * fade - 0.3;
      P.happy = t > 0.35; P.blush = 0.5 * fade;
      break;
    case 'reach': // 俯身用小手按下去（手往前伸）
      P.rx += 0.32 * fade;
      P.armL.z = 0.35; P.armR.z = -0.35; P.armL.x = P.armR.x = 1.25 * fade;
      P.sy *= 1 - 0.05 * fade;
      pet.lookTY = -0.9;
      break;
    case 'peek': // 走到边上先低头看一看（期待感）
      P.rx += 0.2 * fade;
      P.y += Math.sin(t * 3) * 0.004;
      P.brows = 'up';
      pet.lookTY = -0.8; pet.lookTX = Math.sin(t * 1.4) * 0.5;
      break;
    case 'bliss': // 舒服得眯起眼睛轻轻摇
      P.rz += Math.sin(t * 2.2) * 0.05 * fade;
      P.sy *= 1 - 0.03 * fade;
      P.happy = true; P.blush = 0.8 * fade; P.eyes = 'closed'; P.mouth = 'smile';
      P.armL.z = 0.2; P.armR.z = -0.2;
      break;
    case 'shiver': // 爽到抖一抖
      P.rz += Math.sin(t * 38) * 0.035 * fade;
      P.sx *= 1 + Math.sin(t * 38) * 0.015 * fade;
      P.happy = true;
      break;
    case 'shake': // 从雪堆/球池里钻出来，甩甩身体
      P.ry += Math.sin(t * 30) * 0.25 * fade;
      P.earFlap = Math.sin(t * 30) * 6 * fade;
      P.eyes = 'closed'; P.mouth = 'open';
      break;
    case 'lookback': // 回头看看自己留下的脚印（向镜头那一侧转身，回头时小脸正对"反打"机位）
      P.ry -= 2.4 * fade;
      pet.lookTY = -0.6;
      break;
    case 'proud': // 叉腰得意
      P.armL.z = 0.9 * fade; P.armR.z = -0.9 * fade; P.armL.x = P.armR.x = -0.4 * fade;
      P.sy *= 1 + 0.04 * fade; P.rx += -0.06 * fade;
      P.happy = true; P.mouth = 'smile';
      break;
    case 'sleep':
      P.sy *= 1 - 0.08 * fade; P.rx += 0.06 * fade;
      P.eyes = 'closed'; P.mouth = 'cat';
      P.y += Math.sin(t * 1.6) * 0.008;
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
      add(new THREE.BoxGeometry(0.12, 0.26, 0.05), mat, 0.2, -0.12, 0.38, 0.2, 0, 0.25);
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
      g.userData.tall = true;
      break;
    }
    case 'kerchief': { // 打扫用的小头巾（波点）
      const cap = new THREE.SphereGeometry(0.22, 24, 12, 0, TAU, 0, Math.PI * 0.42);
      add(cap, M.soft('#ffffff', { rough: 0.8, rim: 0.3, map: Tex.dots('#9fd8ff', '#ffffff') }), 0, -0.04, 0);
      add(new THREE.SphereGeometry(0.05, 10, 8), M.soft('#9fd8ff', { rough: 0.8 }), 0.0, 0.0, -0.21);
      add(ellipsoid(0.07, 0.04, 0.03, 10, 8), M.soft('#9fd8ff', { rough: 0.8 }), 0.05, -0.02, -0.24, 0, 0, 0.6);
      add(ellipsoid(0.07, 0.04, 0.03, 10, 8), M.soft('#9fd8ff', { rough: 0.8 }), -0.05, -0.02, -0.24, 0, 0, -0.6);
      g.userData.tall = true;
      break;
    }
    case 'sailor': { // 水手帽
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 24), M.soft('#ffffff', { rough: 0.6 }), 0, 0.04, 0);
      add(new THREE.CylinderGeometry(0.222, 0.222, 0.04, 24), M.soft('#4a8bff', { rough: 0.5 }), 0, 0.02, 0);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 24), M.soft('#ffffff', { rough: 0.6 }), 0, 0.095, 0);
      g.position.set(0.08, 0, 0); g.rotation.z = -0.18;
      g.userData.tall = true;
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
      add(new THREE.ConeGeometry(0.13, 0.32, 24), M.soft('#ffffff', { map: Tex.stripes('#7ad7ff', '#ffffff'), rim: 0.2 }), 0, 0.16, 0);
      add(new THREE.SphereGeometry(0.05, 12, 10), M.soft('#ff7fae'), 0, 0.34, 0);
      g.position.set(0.05, 0, 0); g.rotation.z = -0.2;
      g.userData.tall = true;
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
      break;
    }
    default:
      return null;
  }
  return g;
}
