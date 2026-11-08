// 原创萌宠「糯糯」：一颗软糯的麻薯团子，兔猫耳朵，头顶一棵小豆芽。
// 造型按"婴儿图式"做可爱：大头身、Disney 式的大眼睛（眼白 + 暖琥珀色虹膜 + 会合上的眼皮，见 face.js）、会动的小眉毛、粉嫩腮红、
// 小猫嘴、脚底粉色肉垫；动画遵循挤压拉伸 + 弹簧次级运动（耳朵、豆芽、尾巴）。
// 模型完全由代码程序化生成（无外部模型文件）。
import * as THREE from 'three';
import { outlineMaterial, addRim } from '../render/materials.js';
import { Tex } from '../render/textures.js';
import { buildTool, toolQuat } from './tools.js';
import { irisTexture, eyeMaterial, inkMaterial, taperedTube, noseGeometry } from './face.js';
import { Spring, clamp, lerp, damp, dampAngle, TAU, ease, rand, smoothstep } from '../core/util.js';

const C = {
  body: '#fff6ee',
  bodyBottom: '#ffe1d3',
  belly: '#fffbf7',
  rim: '#ffc2d8',
  ear: '#fff3ea',
  earInner: '#ffadc6',
  eye: '#2a1830',
  lash: '#3b2229',     // 睫毛线、闭眼线：深可可色（不是纯黑，和描边一个色系）
  lid: '#fbe2d8',      // 眼皮：比脸稍微粉一点（动画里眼皮常带一点暖粉的阴影）
  brow: '#8a5a52',     // 眉毛：暖暖的焦糖棕
  mouthIn: '#7a2e44',  // 张嘴时嘴里：深玫瑰色
  blush: '#ff8fb0',
  mouth: '#6b3247',
  tongue: '#ff7f9e',
  nose: '#ff9eb8',
  pad: '#ffa9c2',
  sprout: '#72cc6e',
  outline: '#c49aa3', // 很淡的玫瑰色细边：动画电影里的角色不描黑边，靠明暗和轮廓光；留一圈若有若无的淡边，手机小屏也认得出轮廓
};

// 椭球体（把缩放烘焙进几何体，描边粗细才一致）
function ellipsoid(rx, ry, rz, ws = 32, hs = 24) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

// 毛绒材质：MeshPhysical 的 sheen（细绒毛在侧光下泛起的一层柔光）+ 粉色轮廓光
function plush(color, o = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), vertexColors: !!o.vc, roughness: o.rough ?? 0.6, metalness: 0, sheen: 0.55, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffdbe6') });
  addRim(m, o.rimColor || '#ffffff', o.rim ?? 0.4, o.rimPower ?? 2.4);
  m.customProgramCacheKey = () => 'plush-rim-v1';
  return m;
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
    // 两只小手"够到目标"（IK）：任务里刀尖、打蛋器、扫帚头、抹布真正接触到要处理的东西
    this.reach = { L: { get: null, w: 0, target: 0, speed: 8 }, R: { get: null, w: 0, target: 0, speed: 8 } };
    this.held = { L: null, R: null }; // 小手里抓着的物件（玩具、衣服……）
    this.work = { lean: 0, leanT: 0, crouch: 0, crouchT: 0 }; // 干活时身体前倾、蹲下（平滑过渡）
    this.gaze = null; // 视线跟着手里的活儿（世界坐标点，或返回点的函数）
  }

  // ---------------- 建模 ----------------
  _build() {
    const M = this.mats;
    const OL = outlineMaterial(C.outline, 0.006);
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
    // 身体：像绒绒的毛绒玩具 / 麻薯——顶点色渐变 + 细绒的"桃子毛"光泽（sheen）+ 柔和的粉色轮廓光
    const bodyMat = plush('#ffffff', { vc: true, rough: 0.6, rim: 0.55, rimColor: C.rim, rimPower: 2.2 });
    this.disposables.push(bodyMat);
    this.body = new THREE.Mesh(bg, bodyMat);
    this.body.castShadow = true;
    this.lean.add(this.body);
    addOutline(this.body, 0.007);

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

    // ---- 脸（Disney 式的五官：眼白 + 大虹膜 + 会合上的眼皮；手绘感的粗细线条）----
    this.faceGroup = new THREE.Group();
    this.lean.add(this.faceGroup);
    const irisTex = irisTexture();
    this.disposables.push(irisTex);
    const lineMat = inkMaterial(C.lash); // 哑光的墨线：闭眼线、^ ^、睫毛
    this.disposables.push(lineMat);
    this.eyes = [];
    const ERX = 0.097, ERY = 0.115, EZ = 0.024; // 眼睛再大一点点（小宝宝比例：大眼睛、靠下、分得开）
    this.eyeR = { x: ERX, y: ERY, z: EZ };
    // 闭眼笑 ^ ^：中间粗、两头细的弧线
    const happyG = taperedTube([new THREE.Vector3(-0.058, -0.022, 0), new THREE.Vector3(-0.03, 0.012, 0), new THREE.Vector3(0, 0.024, 0), new THREE.Vector3(0.03, 0.012, 0), new THREE.Vector3(0.058, -0.022, 0)], 0.013, (u) => 0.35 + 0.65 * Math.sin(Math.PI * u));
    this.disposables.push(happyG);
    const closedG = taperedTube([new THREE.Vector3(-0.06, 0.016, 0), new THREE.Vector3(-0.032, -0.008, 0), new THREE.Vector3(0, -0.016, 0), new THREE.Vector3(0.032, -0.008, 0), new THREE.Vector3(0.06, 0.016, 0)], 0.011, (u) => 0.3 + 0.7 * Math.sin(Math.PI * u));
    this.disposables.push(closedG);
    // 外眼角的两根小睫毛
    const lashG = [
      taperedTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.016, 0.008, 0), new THREE.Vector3(0.03, 0.02, 0)], 0.0065, (u) => 1 - u * 0.85, 10, 6),
      taperedTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.012, 0.012, 0), new THREE.Vector3(0.02, 0.028, 0)], 0.0055, (u) => 1 - u * 0.85, 10, 6),
    ];
    this.disposables.push(...lashG);
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const p = surf(0.177 * s, 0.52);
      g.position.copy(p);
      g.rotation.y = Math.atan2(p.x, p.z) * 0.8;
      g.rotation.x = -0.1;
      g.rotation.z = -0.07 * s; // 外眼角微微往下垂一点（温柔的"下垂眼"）：从上往下拍时眼角不会显得上挑、凶
      const eyeGeo = planarUV(ellipsoid(ERX, ERY, EZ, 36, 22), ERX, ERY);
      this.disposables.push(eyeGeo);
      const mat = eyeMaterial({ side: s, aspect: ERX / ERY, skin: C.lid, map: irisTex });
      this.disposables.push(mat);
      const eye = new THREE.Mesh(eyeGeo, mat);
      g.add(eye);
      const happy = new THREE.Mesh(happyG, lineMat); happy.position.set(0, -0.012, EZ * 0.8); happy.visible = false; g.add(happy);
      // 舒服地闭着眼 ︶：一条弯弯的睫毛线（不再显示眼珠，脸上干干净净）
      const closed = new THREE.Mesh(closedG, lineMat); closed.position.set(0, -0.03, EZ * 0.5); closed.visible = false; g.add(closed);
      const lashes = new THREE.Group();
      lashG.forEach((lg, k) => { const m = new THREE.Mesh(lg, lineMat); m.scale.x = s; m.rotation.z = s * (k ? 0.15 : -0.12); m.position.x = s * k * 0.006; lashes.add(m); });
      g.add(lashes);
      this.faceGroup.add(g);
      this.eyes.push({ g, eye, u: mat.userData.eye, happy, closed, lashes, side: s, lid: 0.82 });
    }
    // 眉毛：软软的小豆眉，靠鼻子的一端粗、往外慢慢变细（表情的灵魂：惊喜上扬、专注下压、开心弯弯）
    const browMat = inkMaterial(C.brow, { rough: 0.85, env: 0.25 });
    this.disposables.push(browMat);
    this.brows = [];
    for (const s of [-1, 1]) {
      const pv = new THREE.Group();
      const p = surf(0.175 * s, 0.676); // 眼睛变大了，眉毛也往上挪，留出眼皮的位置
      pv.position.copy(p).addScaledVector(p.clone().sub(new THREE.Vector3(0, bodyCenterY, 0)).normalize(), 0.006);
      pv.rotation.y = Math.atan2(p.x, p.z) * 0.85;
      pv.rotation.x = -0.3;
      const bg = taperedTube([new THREE.Vector3(-0.042 * s, -0.004, 0), new THREE.Vector3(-0.014 * s, 0.008, 0), new THREE.Vector3(0.018 * s, 0.008, 0), new THREE.Vector3(0.046 * s, -0.006, 0)], 0.0088, (u) => (1 - 0.45 * u) * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.12))), 20, 8);
      this.disposables.push(bg);
      const b = new THREE.Mesh(bg, browMat);
      b.position.y = -0.02;
      pv.add(b);
      this.faceGroup.add(pv);
      this.brows.push({ pv, b, side: s, y: p.y });
    }
    // 腮红
    const blushMat = M.basic(C.blush, { opacity: 0.8, map: Tex.soft() });
    this.blush = [];
    for (const s of [-1, 1]) {
      const p = surf(0.31 * s, 0.412); // 眼睛变大以后腮红往外下方挪一点，不盖到眼角
      const bgeo = new THREE.CircleGeometry(0.09, 20); this.disposables.push(bgeo);
      const m = new THREE.Mesh(bgeo, blushMat);
      m.position.copy(p).multiplyScalar(1.01);
      m.lookAt(p.clone().multiplyScalar(2).setY(p.y));
      m.scale.set(1.25, 0.8, 1);
      this.faceGroup.add(m);
      this.blush.push(m);
    }
    // 小鼻头：圆圆的粉色倒三角 + 一点小高光
    const noseG = noseGeometry(0.022, 0.016, 0.01); this.disposables.push(noseG);
    const nose = new THREE.Mesh(noseG, M.soft(C.nose, { rough: 0.35, rim: 0.2 }));
    const np = surf(0, 0.468);
    nose.position.copy(np).add(new THREE.Vector3(0, 0, 0.002));
    nose.rotation.x = -0.18;
    this.faceGroup.add(nose);
    const nhG = ellipsoid(0.007, 0.004, 0.003, 8, 6); this.disposables.push(nhG);
    const nh = new THREE.Mesh(nhG, M.basic('#ffffff', { opacity: 0.85 }));
    nh.position.copy(np).add(new THREE.Vector3(-0.008, 0.006, 0.014));
    this.faceGroup.add(nh);
    // 嘴巴：小猫嘴 ω / 微笑 / 张嘴 / 小 o（线条中间粗、两头细）
    const mouthMat = inkMaterial(C.mouth, { rough: 0.85, env: 0.2 });
    this.disposables.push(mouthMat);
    this.mouthCat = new THREE.Group();
    this.mouthCat.position.copy(surf(0, 0.432)).add(new THREE.Vector3(0, 0, 0.004));
    const catG = taperedTube([new THREE.Vector3(-0.046, 0.006, 0), new THREE.Vector3(-0.024, -0.011, 0.002), new THREE.Vector3(0, -0.001, 0.003), new THREE.Vector3(0.024, -0.011, 0.002), new THREE.Vector3(0.046, 0.006, 0)], 0.0068, (u) => 0.35 + 0.65 * Math.sin(Math.PI * u), 32, 6);
    this.disposables.push(catG);
    this.mouthCat.add(new THREE.Mesh(catG, mouthMat));
    this.faceGroup.add(this.mouthCat);
    this.mouthSmile = new THREE.Group();
    this.mouthSmile.position.copy(this.mouthCat.position);
    const smG = taperedTube([new THREE.Vector3(-0.046, 0.014, 0), new THREE.Vector3(-0.024, -0.006, 0.002), new THREE.Vector3(0, -0.012, 0.003), new THREE.Vector3(0.024, -0.006, 0.002), new THREE.Vector3(0.046, 0.014, 0)], 0.0078, (u) => 0.3 + 0.7 * Math.sin(Math.PI * u), 28, 6);
    this.disposables.push(smG);
    this.mouthSmile.add(new THREE.Mesh(smG, mouthMat));
    this.mouthSmile.visible = false;
    this.faceGroup.add(this.mouthSmile);
    this.mouthOpen = new THREE.Group();
    this.mouthOpen.position.copy(surf(0, 0.41)).add(new THREE.Vector3(0, 0, -0.012));
    const moG = ellipsoid(0.05, 0.045, 0.03, 16, 12); this.disposables.push(moG);
    this.mouthOpen.add(new THREE.Mesh(moG, M.soft(C.mouthIn, { rough: 0.6, rim: 0 })));
    const tgG = ellipsoid(0.03, 0.018, 0.02, 12, 8); this.disposables.push(tgG);
    const tg = new THREE.Mesh(tgG, M.soft(C.tongue, { rim: 0 }));
    tg.position.set(0, -0.022, 0.015);
    this.mouthOpen.add(tg);
    this.mouthOpen.visible = false;
    this.faceGroup.add(this.mouthOpen);

    // ---- 耳朵（兔猫耳） ----
    const earMat = plush(C.ear, { rough: 0.62, rim: 0.5, rimColor: C.rim });
    this.disposables.push(earMat);
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
      addOutline(arm, 0.005);
      pivot.add(arm);
      const hand = new THREE.Group();
      hand.position.set(0, -0.24, 0.02);
      pivot.add(hand);
      this.lean.add(pivot);
      this.arms.push({ pivot, arm, hand, side: s, base: pivot.position.clone() });
    }
    this.handR = this.arms[1].hand;
    this.handL = this.arms[0].hand;

    // ---- 小脚（脚底有粉色肉垫：一颗掌垫 + 三颗脚趾豆） ----
    const footGeo = ellipsoid(0.12, 0.065, 0.14, 16, 12); this.disposables.push(footGeo);
    const footMat = plush('#ffe9df', { rough: 0.66, rim: 0.3, rimColor: C.rim });
    this.disposables.push(footMat);
    const padMat = M.soft(C.pad, { rough: 0.5, rim: 0.1 });
    const padG = ellipsoid(0.055, 0.012, 0.045, 12, 6); this.disposables.push(padG);
    const toeG = ellipsoid(0.022, 0.01, 0.022, 10, 6); this.disposables.push(toeG);
    this.feet = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, footMat);
      f.position.set(0.19 * s, 0.05, 0.12);
      f.castShadow = true;
      addOutline(f, 0.005);
      const pad = new THREE.Mesh(padG, padMat); pad.position.set(0, -0.058, -0.012); f.add(pad);
      for (const k of [-1, 0, 1]) { const toe = new THREE.Mesh(toeG, padMat); toe.position.set(k * 0.042, -0.05, 0.072 - Math.abs(k) * 0.012); f.add(toe); }
      this.bodyPivot.add(f);
      this.feet.push({ m: f, side: s, baseX: 0.19 * s, baseZ: 0.12 });
    }

    // ---- 尾巴（毛球） ----
    const tailGeo = new THREE.IcosahedronGeometry(0.1, 2); this.disposables.push(tailGeo);
    this.tail = new THREE.Mesh(tailGeo, earMat);
    this.tail.position.set(0, 0.2, -0.47);
    addOutline(this.tail, 0.005);
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
  hold(type, o = {}) {
    if (this.toolType === type) return this.tool;
    if (this.tool) { this.handR.remove(this.tool); this._disposeObj(this.tool); this.tool = null; this.toolType = null; }
    if (!type) return null;
    const t = buildTool(type, this.mats);
    if (!t) return null;
    t.scale.setScalar(o.instant ? (t.userData.scale || 1) : 0.001);
    this.handR.add(t);
    this.tool = t; this.toolType = type; this.toolPop = o.instant ? 1 : 0;
    return t;
  }
  // 道具尖端在世界坐标中的位置（切菜刀口、扫帚头、抹布……）
  toolTipWorld() {
    if (!this.tool) return this.handWorld();
    this.root.updateMatrixWorld(true);
    return this.tool.localToWorld((this.tool.userData.tip || new THREE.Vector3()).clone());
  }
  handWorld(side = 'R') { this.root.updateMatrixWorld(true); return (side === 'L' ? this.handL : this.handR).localToWorld(new THREE.Vector3()); }

  /**
   * 让一只小手去够一个目标（每帧求解，目标可以是会动的）。
   * get() 返回 { pos }（手的位置），或 { tip, dir, side }（右手拿道具时：道具尖端要到的位置、
   * 握把→尖端的方向、道具局部 +x 朝向），都是世界坐标。手臂会像麻薯一样适当拉长来够到。
   */
  reachTo(side, get, o = {}) {
    const r = this.reach[side];
    r.get = typeof get === 'function' ? get : () => ({ pos: get });
    r.target = o.weight ?? 1;
    r.speed = o.speed ?? 8;
    if (o.snap) r.w = r.target;
  }
  release(side, o = {}) {
    const sides = side ? [side] : ['L', 'R'];
    for (const k of sides) { const r = this.reach[k]; r.target = 0; r.speed = o.speed ?? 6; }
  }
  // 世界坐标的点是否在身体里（< 1 在里面，r 用来留一点余量）。连续调用前先 refreshBodyInverse()
  refreshBodyInverse() {
    this.root.updateMatrixWorld(true);
    this._bodyInv = (this._bodyInv || new THREE.Matrix4()).copy(this.body.matrixWorld).invert();
  }
  bodyInside(p, r = 0.5) {
    if (!this._bodyInv) this.refreshBodyInverse();
    const q = _v3.copy(p).applyMatrix4(this._bodyInv);
    return bodyEll(q.x, q.y, q.z, r);
  }
  // 干活时身体前倾（弧度）、蹲下（0..1）、视线看着手上的活儿
  setLean(v) { this.work.leanT = v; }
  setCrouch(v) { this.work.crouchT = clamp(v, 0, 1); }
  gazeAt(p) { this.gaze = p || null; }

  // 抓起 / 放下一个物件（保持世界位置不跳变）
  grab(side, obj, o = {}) {
    const hand = side === 'L' ? this.handL : this.handR;
    this.root.updateMatrixWorld(true);
    if (o.upright) obj.userData.fixedQ = obj.getWorldQuaternion(new THREE.Quaternion());
    hand.attach(obj);
    this.held[side] = obj;
  }
  drop(side, parent) {
    const obj = this.held[side];
    if (!obj) return null;
    this.root.updateMatrixWorld(true);
    parent.attach(obj);
    delete obj.userData.fixedQ;
    this.held[side] = null;
    return obj;
  }
  _disposeObj(o) { o.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); }

  // ---------------- 表情 ----------------
  // eyes: open / wide / half / happy / closed；mouth: cat / smile / open / o；brows: neutral / up / down / worried / happy
  expr(eyes = 'open', mouth = 'cat', hold = 0, brows = null) {
    this.eyesMode = eyes;
    this.mouthMode = mouth;
    this.browMode = brows || (eyes === 'wide' ? 'up' : eyes === 'happy' || eyes === 'closed' || eyes === 'half' ? 'happy' : 'neutral'); // 困困的半睁眼配上放松的眉毛：是迷糊，不是不耐烦
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
      // 眼皮：自然睁着时上眼皮稍微盖住一点虹膜（眼神温柔）；惊讶时全睁开；困了半闭；舒服地闭眼 / 眨眼时眼皮合上来
      const happy = mode === 'happy';
      // 一直闭着（睡觉、享受）时换成一条睫毛线；眨眼仍然是眼皮快速合上
      const shut = mode === 'closed' && e.lid < -0.6;
      e.eye.visible = !happy && !shut;
      e.happy.visible = happy;
      e.closed.visible = shut;
      e.lashes.visible = !happy;
      let lidT = mode === 'wide' ? 1.15 : mode === 'half' ? 0.22 : mode === 'closed' ? -0.95 : 0.82;
      // 眼皮跟着视线走：往上看抬一点、往下看只跟一点点（干活时常低头看手里的东西，眼皮压太多会显得没精神 / 不耐烦）
      if (mode !== 'closed' && mode !== 'wide') lidT += this.lookY * (this.lookY < 0 ? 0.05 : 0.12);
      e.lid = damp(e.lid, Math.min(1.15, lidT), 16, dt);
      const lid = lerp(e.lid, -1.0, blinkAmt);
      const u = e.u;
      u.uLid.value = lid;
      u.uLook.value.set(this.lookX * 0.42, this.lookY * 0.36);
      u.uPupil.value = damp(u.uPupil.value, mode === 'wide' ? 0.42 : 0.5, 10, dt); // 大瞳孔显得天真；惊讶时缩小一点
      // 眼皮合上时眼珠也收平：闭着眼是脸上一道弯弯的睫毛线，而不是鼓起来的一大块
      e.eye.scale.z = 0.3 + 0.7 * smoothstep(-0.95, 0.6, lid);
      u.uTw.value = 0.7 + 0.3 * Math.sin(this.t * 3.1 + e.side); // 小星光一闪一闪
      const sc = mode === 'wide' ? 1.06 : 1;
      e.g.scale.set(sc, sc * (mode === 'wide' ? 1.03 : 1), 1);
      // 外眼角的小睫毛跟着眼皮的边走
      const R = this.eyeR;
      if (shut) {
        // 闭眼线的外眼角
        e.lashes.position.set(e.side * 0.058, -0.016, R.z * 0.5);
      } else {
        const k = lerp(-0.3, 0.2, smoothstep(-0.8, -0.15, lid)); // 和着色器里眼皮弧线的形状一致
        const ly = Math.max(-0.62, Math.min(0.6, lid - k * 0.64));
        e.lashes.position.set(e.side * 0.8 * R.x, ly * R.y, R.z * Math.sqrt(Math.max(0, 1 - 0.64 - ly * ly)) + 0.002);
      }
    }
    // 眉毛
    const bm = P.brows || this.browMode;
    const by = bm === 'up' ? 0.03 : bm === 'down' ? -0.012 : bm === 'happy' ? 0.014 : 0;
    // 正：靠鼻子的一端往下（专注 / 用力）；负：往上（担心 / 开心）。
    // 平时眉头就微微往上（天真、软萌）；专注时也只压一点点——镜头多是从上往下拍圆脸，
    // 五官两头会往上翘，眉头压太多看起来就像在生气
    const tilt = bm === 'down' ? 0.12 : bm === 'worried' ? -0.3 : bm === 'happy' ? -0.14 : -0.08;
    for (const b of this.brows) {
      b.pv.position.y = damp(b.pv.position.y, b.y + by, 12, dt);
      b.b.rotation.z = damp(b.b.rotation.z, tilt * b.side, 12, dt);
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
   * 跳到目标点。o: { height, dur, spin(圈), flip(圈), anticipation, onTakeoff, keepFacing, hEase(u)→水平进度 }
   * 返回 Promise，落地时 resolve。
   */
  hop(to, o = {}) {
    const from = this.root.position.clone();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const height = o.height ?? 0.32 + dist * 0.08;
    const dur = o.dur ?? 0.46 + dist * 0.06;
    if (dist > 0.05 && !o.keepFacing) this.faceTowards(to.x, to.z);
    return new Promise((resolve) => {
      this._start({ kind: 'hop', t: 0, from, to: to.clone(), height, dur, ant: o.anticipation ?? 0.11, spin: o.spin || 0, flip: o.flip || 0, resolve, onTakeoff: o.onTakeoff, launched: false, tuck: o.tuck ?? 0, hEase: o.hEase, liveY: o.liveY });
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
    return new Promise((resolve) => { this._start({ kind: 'ride', t: 0, curve, dur, resolve, bank: o.bank ?? 1, faceTo: o.faceTo, faceK: o.faceK ?? 0.45, align: !!o.align }); });
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
        // liveY：落点的表面在空中这段时间里会动（捏捏慢慢鼓回来）：跟着真实表面落下去，不会落进物体里面
        if (a.liveY) { const y = a.liveY(); if (Number.isFinite(y)) a.to.y = y; }
        // hEase：水平方向的缓动（例如先往上、再往前，越过高台的边缘）
        const uh = a.hEase ? a.hEase(u) : u;
        pos.x = lerp(a.from.x, a.to.x, uh);
        pos.z = lerp(a.from.z, a.to.z, uh);
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
      if (a.faceTo) { const c = a.faceTo(); const ac = Math.atan2(c.x - pos.x, c.z - pos.z); const d = ((ac - face + Math.PI) % TAU + TAU) % TAU - Math.PI; face += d * a.faceK; }
      this.targetFacing = face;
      this.facing = dampAngle(this.facing, face, 14, dt);
      if (a.align) {
        // 身体"坐正"在槽底：身体的上方向 = 滑道横截面的法线（下坡时自然往后靠）
        const side = _v1.crossVectors(tan, _UP).normalize();
        const up = _v2.crossVectors(side, tan).normalize().applyAxisAngle(_UP, -this.facing);
        P.rx += Math.atan2(up.z, up.y);
        P.rz += Math.atan2(-up.x, up.y);
      }
      // 弯道上身体顺势倾斜
      if (a.bank) {
        const tan2 = a.curve.getTangentAt(clamp(s + 0.03, 0, 1));
        const turn = Math.atan2(tan2.x, tan2.z) - Math.atan2(tan.x, tan.z);
        P.rz += clamp(-turn * 6 * a.bank, -0.35, 0.35);
      }
      P.sy *= a.align ? 0.95 : 0.9; P.sx *= a.align ? 0.98 : 1.05;
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

    // 干活：前倾看着手上的东西；蹲下去捡地上的东西
    const W = this.work;
    W.lean = damp(W.lean, W.leanT, 7, dt);
    W.crouch = damp(W.crouch, W.crouchT, 9, dt);
    P.rx += W.lean;
    P.sy *= 1 - 0.22 * W.crouch;

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
    // 卡通式"伸长"：手举得越高越长，动作更好认（只拉长手臂本身，手里的道具不变形）
    const stretch = (z) => 1 + clamp((Math.abs(z) - 1.1) / 1.4, 0, 1) * 0.4;
    for (const [arm, pa, key] of [[this.arms[0], P.armL, 'L'], [this.arms[1], P.armR, 'R']]) {
      _e1.set(-pa.x, 0, -pa.z);
      arm.pivot.quaternion.setFromEuler(_e1);
      arm.stretch = stretch(pa.z);
      arm.pivot.position.copy(arm.base);
      const r = this.reach[key];
      r.w = damp(r.w, r.get ? r.target : 0, r.speed, dt);
      if (r.w < 0.002 && r.target === 0) { r.w = 0; r.get = null; }
    }
    this._toolQ = null; this._toolW = 0;
    if (this.reach.L.w > 0 || this.reach.R.w > 0) this._solveReach();
    for (const arm of this.arms) {
      arm.arm.scale.set(1, arm.stretch, 1);
      arm.hand.position.y = -0.24 * arm.stretch;
    }
    // 端着/拎着的东西保持原来的世界朝向
    for (const [k, hand] of [['L', this.handL], ['R', this.handR]]) {
      const o = this.held[k];
      if (o && o.userData.fixedQ) { this.root.updateMatrixWorld(true); o.quaternion.copy(hand.getWorldQuaternion(_q1).invert().multiply(o.userData.fixedQ)); }
    }
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
      if (this._toolQ) {
        // 任务控制道具朝向（刀刃竖直落到砧板、打蛋器插进碗里……）：在默认朝向和任务朝向之间混合
        this.root.updateMatrixWorld(true);
        const hq = this.handR.getWorldQuaternion(_q1).invert();
        _q3.copy(this._toolQ);
        if (this._toolW < 1) {
          _q2.copy(this.root.getWorldQuaternion(_q4));
          if (aim != null) _q2.multiply(_q5.setFromAxisAngle(_X, -aim));
          _q3.slerpQuaternions(_q2, this._toolQ, this._toolW);
        }
        this.tool.quaternion.copy(hq.multiply(_q3));
      } else if (this.tool.userData.up || aim != null) {
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
    if (this.gaze) {
      // 眼睛看着手上的活儿（刀口、碗里、拖把头……）：把注视点换到头部局部坐标，映射成瞳孔偏移
      const gp = typeof this.gaze === 'function' ? this.gaze() : this.gaze;
      if (gp) {
        this.root.updateMatrixWorld(true);
        const lp = this.lean.worldToLocal(_v1.copy(gp));
        const ex = lp.x, ey = lp.y - 0.53, ez = Math.max(0.15, lp.z - 0.3);
        this.lookTX = clamp(ex / ez * 1.6, -1, 1);
        this.lookTY = clamp(ey / ez * 1.8, -1, 0.8);
      }
    } else if (Math.random() < dt * 0.4) { this.lookTX = rand(-0.6, 0.6); this.lookTY = rand(-0.3, 0.4); }
    this.lookX = damp(this.lookX, this.lookTX, 6, dt);
    this.lookY = damp(this.lookY, this.lookTY, 6, dt);

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

  // 两只小手的 IK：手臂从肩膀指向目标，必要时像麻薯一样拉长（最多约 1.9 倍）
  _solveReach() {
    this.root.updateMatrixWorld(true);
    for (const [key, arm] of [['L', this.arms[0]], ['R', this.arms[1]]]) {
      const r = this.reach[key];
      if (!(r.w > 0) || !r.get) continue;
      let goal;
      try { goal = r.get(); } catch (e) { console.error(e); goal = null; }
      if (!goal) continue;
      let hand;
      if (goal.tip && key === 'R' && this.tool) {
        // 道具：尖端落在 tip，朝向由 quat 或（dir 握把→尖端, side 局部 +x）给出。先定道具的世界朝向，再反推小手应该在哪
        const q = goal.quat ? goal.quat.clone() : toolQuat(goal.dir || _DOWN, goal.side);
        this._toolQ = q; this._toolW = r.w;
        const sc = this.tool.userData.scale || 1;
        const tipLocal = (this.tool.userData.tip || new THREE.Vector3(0, -0.2, 0)).clone().multiplyScalar(sc);
        hand = goal.tip.clone().sub(tipLocal.applyQuaternion(q));
      } else {
        hand = (goal.pos || goal.tip).clone();
      }
      // 转到 lean 的局部坐标（含身体的倾斜、挤压）
      const local = this.lean.worldToLocal(hand);
      // 伸手时肩膀往前挪一点（手臂根部仍藏在身体侧面里，看不出来），够得更远
      arm.pivot.position.z = arm.base.z + 0.15 * r.w;
      arm.pivot.position.x = arm.base.x * (1 - 0.05 * r.w);
      const d = local.sub(arm.pivot.position);
      const dist = d.length();
      if (dist < 1e-4) continue;
      const qIK = _q4.setFromUnitVectors(_DOWN, d.multiplyScalar(1 / dist));
      arm.pivot.quaternion.slerp(qIK, r.w);
      const want = clamp(dist / 0.24, 0.75, 2.0);
      arm.stretch = lerp(arm.stretch, want, r.w);
      arm.reachErr = Math.max(0, dist - 0.24 * want) * r.w; // 够不到的距离（调试/自检用）
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose && d.dispose();
    this.setAccessory(null);
    this.setCrown(false);
    this.hold(null);
  }
}

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion(), _q5 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _X = new THREE.Vector3(1, 0, 0), _DOWN = new THREE.Vector3(0, -1, 0), _UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// 身体形状的逆变换（和建模时"底部压扁、下半身微微鼓起"一一对应）：身体几何坐标里的点，返回 < 1 表示在身体里面
export function bodyEll(x, y, z, r = 0.5) {
  let y0 = (y - 0.387) / 0.9;
  if (y0 < -0.175) y0 = -0.175 + (y0 + 0.175) / 0.45;
  const ny = Math.max(-1, Math.min(1, y0 / 0.5));
  const bulge = 1 + 0.07 * Math.max(0, -ny) - 0.03 * Math.max(0, ny);
  const x0 = x / (1.06 * bulge), z0 = z / bulge;
  return (x0 * x0 + y0 * y0 + z0 * z0) / (r * r);
}
const _m1 = new THREE.Matrix4();

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
