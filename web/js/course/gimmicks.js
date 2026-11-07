// 闯关元素（夹在解压站之间的"小挑战"）：跳跳石、蹦床、滑滑梯、气球飘飘、摇摇桥。
// 设计参考：
//  - Fall Guys（障碍秀：弹跳垫、滑梯、摇摇板；角色要"看起来软软的、弹弹的"）
//  - 3D 马里奥"起承转合"：每个世界先用解压站"起"，跳跳石"承"，滑梯/蹦床"转"，巨型终点"合"
//  - Crash Bandicoot 追逐关：滑梯从下往上拍，糯糯迎着镜头滑下来，小脸一直看得到
// 这里没有"失败"：每个挑战都会成功，看点是蓄力 → 起跳 → 落地的挤压回弹、表情、真实录音和溅起的粒子。
// 坐标：局部 x ∈ [0, length] 为前进方向，z 为横向，y=0 为地面（小路表面）。
import * as THREE from 'three';
import { roundedBox, blobGeometry } from '../world/geo.js';
import { addJiggle, kickJiggle } from './station.js';
import { Spring, TAU, clamp, lerp } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RAINBOW = ['#ff8fb3', '#ffb37a', '#ffe27a', '#9be89b', '#7fd6ff', '#a99bff', '#e39bff'];

// ---------------- 水面 / 布丁湖（带涟漪的着色器） ----------------
const LIQ_VERT = `
varying vec3 vPos;
void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const LIQ_FRAG = `
uniform vec3 uColor; uniform vec3 uDeep; uniform float uTime; uniform vec4 uDrops[6]; uniform float uOpacity; uniform float uFade;
varying vec3 vPos;
void main(){
  float h = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 d = uDrops[i];
    float age = uTime - d.z;
    if (age < 0.0 || age > 3.0) continue;
    float r = distance(vPos.xz, d.xy);
    float front = age * 0.5;
    h += sin((r - front) * 38.0) * exp(-abs(r - front) * 12.0) * exp(-age * 1.3) * d.w;
  }
  float w = 0.5 + 0.5 * sin(vPos.x * 6.0 + uTime * 0.9) * sin(vPos.z * 7.0 - uTime * 0.6);
  vec3 c = mix(uDeep, uColor, 0.55 + 0.45 * w);
  c += vec3(1.0) * clamp(h, 0.0, 1.0) * 0.5;
  c += vec3(1.0) * pow(w, 8.0) * 0.12;
  float edge = uFade > 0.0 ? 1.0 - smoothstep(uFade, uFade + 1.0, abs(vPos.z)) : 1.0;
  gl_FragColor = vec4(c, uOpacity * edge);
  #include <colorspace_fragment>
}`;

class Gimmick {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.def = def;
    this.kind = 'gimmick';
    this.group = new THREE.Group();
    this.length = def.length || 3;
    this.width = def.width || 2.2;
    this.label = def.label || '';
    this.t = 0;
    this.done = false;
    this.floaters = [];
  }
  build() { return this; }
  topY() { return 0; }
  progress() { return this.done ? 1 : 0; }
  update(dt) {
    this.t += dt;
    if (this.liq) this.liq.uTime.value = this.t;
    // 飞走的气球 / 弹起的小球
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      f.obj.position.y += dt * (0.5 + f.t * 0.25);
      f.obj.position.x += Math.sin(f.t * 1.3) * dt * 0.15;
      f.obj.rotation.z = Math.sin(f.t * 1.7) * 0.15;
      if (f.t > 9) { this.group.remove(f.obj); f.obj.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); this.floaters.splice(i, 1); }
    }
  }
  dispose() {
    for (const f of this.floaters) f.obj.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
    this.floaters = [];
  }
  // 局部 → 世界
  W(x, y, z) { return V(this.x0 + x, this.group.position.y + y, z); }
  ripple(x, z, amp = 1) {
    if (!this.liq) return;
    this.liq.uDrops.value[(this._di = (this._di || 0) + 1) % 6].set(x, z, this.t, amp);
  }
  // 一段横穿小路的"小河 / 布丁河 / 云海 / 地毯海"；厨房里是摆在台面上的"水槽"（raised）
  _channel(o = {}) {
    const { M, G } = this.ctx;
    const L = this.length, W = this.width;
    const kind = o.liquid || 'water';
    const up = o.raised ? 0.1 : 0;
    this.up = up;
    if (o.raised) {
      // 台面上的小水槽：圆润的槽壁 + 槽底
      const wall = M.soft(o.bed || '#e3e9ef', { rough: 0.3, rim: 0.4 });
      const b = new THREE.Mesh(G.track(roundedBox(L - 0.1, 0.03, W, 0.012, 2).translate(L / 2, 0.015, 0)), wall);
      b.receiveShadow = true; this.group.add(b);
      for (const zz of [-W / 2, W / 2]) { const m = new THREE.Mesh(G.track(roundedBox(L - 0.1, 0.12, 0.06, 0.025, 2).translate(L / 2, 0.06, zz)), wall); m.castShadow = true; this.group.add(m); }
    }
    if (kind === 'rug' || kind === 'cloud') {
      // 室内："地板是大海"——一块蓝色的蓬松地毯 / 一片软软的云
      const col = kind === 'rug' ? (o.color || '#8fcdf2') : '#ffffff';
      const rug = new THREE.Mesh(G.track(roundedBox(L - 0.1, 0.03, W - 0.1, 0.015, 2).translate(L / 2, -0.02, 0)), M.soft(col, { rough: 0.98, rim: 0.3 }));
      rug.receiveShadow = true;
      this.group.add(rug);
      if (kind === 'cloud') {
        const g = G.get('cloudPuff', () => blobGeometry(0.22, 3, 0.1, 2));
        const n = Math.round(L * 7);
        const im = new THREE.InstancedMesh(g, M.soft('#ffffff', { rough: 0.9, rim: 0.6, rimColor: '#e7f0ff' }), n);
        const m4 = new THREE.Matrix4(), r = this.ctx.rng;
        for (let i = 0; i < n; i++) { const s = r.range(0.6, 1.3); m4.compose(V(r.range(0.1, L - 0.1), -0.04, r.range(-W / 2 + 0.15, W / 2 - 0.15)), new THREE.Quaternion(), V(s, s * 0.45, s)); im.setMatrixAt(i, m4); }
        im.receiveShadow = true;
        this.group.add(im);
      } else {
        // 地毯上的波浪花纹
        const wave = new THREE.Mesh(G.track(new THREE.TorusGeometry(0.18, 0.012, 6, 20, Math.PI).rotateX(-Math.PI / 2)), M.soft('#ffffff', { rough: 0.9 }));
        for (let i = 0; i < Math.floor(L / 0.6); i++) { const w = wave.clone(); w.position.set(0.35 + i * 0.6, 0.0, (i % 2 ? 0.45 : -0.45)); this.group.add(w); }
      }
      this.liquidY = -0.005;
      return;
    }
    const u = { uColor: { value: new THREE.Color(o.color || '#7fd0f0') }, uDeep: { value: new THREE.Color(o.deep || '#4aa8d8') }, uTime: { value: 0 }, uOpacity: { value: o.opacity ?? 0.92 }, uFade: { value: o.raised ? 0 : 2.2 }, uDrops: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) } };
    const mat = M.track(new THREE.ShaderMaterial({ uniforms: u, vertexShader: LIQ_VERT, fragmentShader: LIQ_FRAG, transparent: true, depthWrite: false }));
    // 户外的小河比小路宽很多、两边慢慢淡掉，看起来像一条横穿草地的小溪
    const geo = G.track(new THREE.PlaneGeometry(L - 0.12, o.raised ? W - 0.1 : 7.5).rotateX(-Math.PI / 2).translate(L / 2, o.raised ? 0.05 : -0.042, 0));
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    this.group.add(m);
    this.liq = u;
    this.liquidY = o.raised ? 0.05 : -0.042;
  }
  // 两岸的小台阶（让小路"断开"的地方看起来自然）
  _banks(color) {
    const { M, G } = this.ctx;
    if (this.up) return;
    for (const x of [0.06, this.length - 0.06]) {
      const b = new THREE.Mesh(G.get('bank', () => roundedBox(0.14, 0.07, 2.0, 0.035, 2)), M.soft(color, { rough: 0.85, rim: 0.2 }));
      b.position.set(x, -0.005, 0);
      b.receiveShadow = true;
      this.group.add(b);
    }
  }
}

// ======================= 1. 跳跳石 =======================
const STONES = {
  snowball: (M, G) => ({ parts: [[G.get('st|snow', () => blobGeometry(0.21, 2, 0.06, 3).scale(1, 0.62, 1)), M.soft('#ffffff', { rough: 0.85, rim: 0.5, rimColor: '#dbeaff' }), 0]], top: 0.1 }),
  mushroom: (M, G, r) => {
    const cap = G.get('st|cap', () => { const g = new THREE.SphereGeometry(0.24, 24, 12, 0, TAU, 0, Math.PI / 2); g.scale(1, 0.5, 1); return g; });
    const c = r.pick(['#ff7f7f', '#ff9ec4', '#ffb35c']);
    return { parts: [[G.get('st|stem', () => new THREE.CylinderGeometry(0.07, 0.09, 0.22, 12).translate(0, 0.0, 0)), M.soft('#fff3df', { rough: 0.7 }), 0], [cap, M.soft(c, { rough: 0.5, rim: 0.4 }), 0.1]], top: 0.22, dots: true };
  },
  gumdrop: (M, G, r) => ({ parts: [[G.get('st|gum', () => new THREE.LatheGeometry([0, 0.22, 0.23, 0.2, 0.13, 0].map((x, i) => new THREE.Vector2(x, [-0.06, -0.06, 0.0, 0.08, 0.13, 0.15][i])), 24)), M.soft(r.pick(['#ff7fb8', '#7fe0a8', '#ffb35c', '#9f8fff', '#ffe066']), { rough: 0.35, rim: 0.5 }), 0]], top: 0.15 }),
  lily: (M, G) => ({ parts: [[G.get('st|lily', () => new THREE.CylinderGeometry(0.26, 0.26, 0.025, 24, 1, false, 0.3, TAU - 0.6)), M.soft('#7ccf6a', { rough: 0.6, rim: 0.3 }), 0]], top: 0.02, flower: true }),
  rock: (M, G, r) => ({ parts: [[G.get('st|rock' + r.int(1, 3), () => blobGeometry(0.22, r.int(1, 9), 0.15, 2).scale(1.1, 0.55, 1)), M.soft(r.pick(['#c9d4e0', '#d8cfe8', '#e6d8c8']), { rough: 0.75, rim: 0.3 }), 0]], top: 0.1 }),
  block: (M, G, r) => ({ parts: [[G.get('st|block', () => roundedBox(0.34, 0.2, 0.34, 0.05, 3)), M.soft(r.pick(RAINBOW), { rough: 0.45, rim: 0.35 }), 0]], top: 0.1 }),
  lid: (M, G, r) => ({ parts: [[G.get('st|lid', () => new THREE.CylinderGeometry(0.21, 0.21, 0.07, 28)), M.soft(r.pick(['#ff9ec4', '#7fd6ff', '#ffd166', '#9be89b']), { rough: 0.35, rim: 0.4 }), 0], [G.get('st|lidtop', () => new THREE.CylinderGeometry(0.16, 0.16, 0.012, 24)), M.soft('#ffffff', { rough: 0.4 }), 0.04]], top: 0.045 }),
  cushion: (M, G, r) => ({ parts: [[G.get('st|cush', () => { const g = roundedBox(0.42, 0.16, 0.42, 0.07, 4); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) * (1 - 0.35 * (x * x + z * z) / 0.09)); } g.computeVertexNormals(); return g; }), M.soft(r.pick(['#ffc2d8', '#c9e8ff', '#fff0a8', '#d7c9ff']), { rough: 0.9, rim: 0.4 }), 0]], top: 0.07 }),
  cloud: (M, G) => ({ parts: [[G.get('st|cloud', () => blobGeometry(0.24, 4, 0.12, 2).scale(1.2, 0.5, 1)), M.soft('#ffffff', { rough: 0.9, rim: 0.6, rimColor: '#e9f0ff' }), 0]], top: 0.1 }),
};

export class HopGimmick extends Gimmick {
  build() {
    const d = this.def, r = this.ctx.rng;
    const n = d.count || 4;
    const sp = d.spacing || 0.56;
    this.length = 0.62 + (n - 1) * sp + 0.62;
    this._channel(d);
    this._banks(d.bank || '#f4e8dc');
    const make = STONES[d.skin] || STONES.rock;
    this.stones = [];
    let side = r.sign();
    for (let i = 0; i < n; i++) {
      const x = 0.62 + i * sp, z = side * r.range(0.1, 0.2);
      side = -side;
      const s = make(this.ctx.M, this.ctx.G, r);
      const g = new THREE.Group();
      for (const [geo, mat, y] of s.parts) { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); }
      if (s.dots) for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + 0.4; const dot = new THREE.Mesh(this.ctx.G.get('st|dot', () => new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.45, 1)), this.ctx.M.soft('#ffffff', { rough: 0.5 })); dot.position.set(Math.cos(a) * 0.13, 0.2, Math.sin(a) * 0.13); g.add(dot); }
      if (s.flower && i % 2 === 0) { const f = new THREE.Mesh(this.ctx.G.get('st|lflower', () => new THREE.SphereGeometry(0.05, 10, 8).scale(1, 0.6, 1)), this.ctx.M.soft('#ffb3d1', { rough: 0.5, rim: 0.4 })); f.position.set(0.12, 0.04, -0.1); g.add(f); }
      const baseY = d.stoneY ?? 0.0;
      g.position.set(x, baseY, z);
      g.rotation.y = r.range(0, TAU);
      this.group.add(g);
      this.stones.push({ g, x, z, top: baseY + s.top, baseY, sp: new Spring(160, 9, 0), ph: r.range(0, TAU) });
    }
    return this;
  }
  topY(x, z) {
    for (const s of this.stones) if (Math.hypot(s.x - x, s.z - z) < 0.26) return s.top + s.g.position.y - s.baseY;
    return x < 0.15 || x > this.length - 0.15 ? 0 : (this.liquidY ?? -0.03);
  }
  update(dt) {
    super.update(dt);
    for (const s of this.stones) {
      const dip = s.sp.update(dt);
      s.g.position.y = s.baseY + Math.sin(this.t * 1.3 + s.ph) * 0.012 + dip;
    }
  }
  async run(G) {
    const pet = G.pet, d = this.def;
    // 机位稍远、看向略高：跳到最高点时耳朵尖也在画面里
    G.cam('follow', { off: V(2.9, 1.3, 1.5), lookY: 0.52, lambda: 1.4 });
    G.label(this.label);
    pet.face(Math.PI / 2 - 0.25);
    pet.expr('wide', 'o', 1, 'up');
    await pet.idleAction('peek', 0.7);
    G.say(d.say || '跳过去～');
    await pet.idleAction('ready', 0.45);
    G.unsay();
    for (let i = 0; i < this.stones.length; i++) {
      const s = this.stones[i];
      const to = this.W(s.x, s.top, s.z);
      // 一直朝前（迎着镜头）跳，身体稍微朝镜头偏一点，左右的小偏移不转身，小脸始终看得到
      pet.face(Math.PI / 2 - 0.25 + (s.z - pet.root.position.z) * 0.6);
      await pet.hop(to, { height: 0.34 + (i % 2) * 0.05, dur: 0.52, anticipation: 0.1, keepFacing: true });
      pet.setGround(to.y);
      s.sp.v -= 0.55; // 石头被踩得往下一沉
      this.ripple(s.x, s.z, 0.9);
      G.sfx(d.land || 'land_soft', to, { gain: d.landGain ?? -2 });
      if (this.liq) G.burst('water', this.W(s.x, (this.liquidY ?? 0) + 0.03, s.z), { colors: ['#e3f6ff', '#ffffff'], count: 6, scale: 0.5 });
      if (d.fx) G.burst(d.fx, this.W(s.x, s.top, s.z), { colors: d.fxColors || ['#ffffff'], count: 6, scale: 0.6 });
      G.countStep();
      if (i === 1) pet.expr('happy', 'smile', 0.8);
      await G.wait(i === this.stones.length - 1 ? 0.15 : 0.22 + G.rng() * 0.18);
    }
    const end = this.W(this.length + 0.12, 0, 0);
    end.y = G.yAt(end.x, end.z);
    await pet.hop(end, { height: 0.36, dur: 0.52 });
    pet.setGround(end.y);
    G.sfx(G.pathSound, end, { gain: -1 });
    pet.expr('happy', 'open', 1.2);
    this.done = true;
  }
}

// ======================= 2. 蹦床（三连跳 + 空中翻转） =======================
const PADS = {
  mushroom: (M, G) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.get('pad|stem', () => new THREE.CylinderGeometry(0.22, 0.3, 0.3, 20).translate(0, 0.15, 0)), M.soft('#fff1dc', { rough: 0.7, rim: 0.3 })));
    const cap = new THREE.Mesh(G.get('pad|cap', () => { const c = new THREE.SphereGeometry(0.62, 32, 14, 0, TAU, 0, Math.PI / 2); c.scale(1, 0.38, 1); return c.translate(0, 0.28, 0); }), M.soft('#ff8fb3', { rough: 0.45, rim: 0.45 }));
    g.add(cap);
    for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; const dd = new THREE.Mesh(G.get('pad|dot', () => new THREE.SphereGeometry(0.07, 10, 8).scale(1, 0.35, 1)), M.soft('#ffffff', { rough: 0.5 })); dd.position.set(Math.cos(a) * 0.38, 0.47, Math.sin(a) * 0.38); g.add(dd); }
    return { g, top: 0.52, squashY: 0.3 };
  },
  jelly: (M, G, color = '#ff8fb3') => {
    const mat = M.track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0.85, emissive: new THREE.Color(color), emissiveIntensity: 0.15 }));
    const ju = addJiggle(mat);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.get('pad|jelly', () => roundedBox(1.0, 0.36, 1.0, 0.14, 4).translate(0, 0.18, 0)), mat));
    return { g, top: 0.36, ju, squashY: 0 };
  },
  pudding: (M, G) => {
    const mat = M.track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#ffd98a'), roughness: 0.18, clearcoat: 0.8 }));
    const ju = addJiggle(mat);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.get('pad|pud', () => new THREE.CylinderGeometry(0.42, 0.55, 0.4, 32).translate(0, 0.2, 0)), mat));
    const top = new THREE.Mesh(G.get('pad|pudtop', () => new THREE.CylinderGeometry(0.43, 0.43, 0.04, 32).translate(0, 0.41, 0)), M.soft('#a8653a', { rough: 0.25, rim: 0.4 }));
    g.add(top);
    const plate = new THREE.Mesh(G.get('pad|plate', () => new THREE.CylinderGeometry(0.75, 0.7, 0.04, 36).translate(0, 0.02, 0)), M.soft('#ffffff', { rough: 0.3, rim: 0.3 }));
    g.add(plate);
    return { g, top: 0.44, ju, squashY: 0 };
  },
  trampoline: (M, G) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(G.get('pad|ring', () => new THREE.TorusGeometry(0.62, 0.06, 10, 40).rotateX(Math.PI / 2).translate(0, 0.3, 0)), M.soft('#7fd6ff', { rough: 0.4, rim: 0.4 }));
    g.add(ring);
    const cloth = new THREE.Mesh(G.get('pad|cloth', () => new THREE.CylinderGeometry(0.6, 0.6, 0.02, 40).translate(0, 0.29, 0)), M.soft('#ff8fb3', { rough: 0.8, rim: 0.3 }));
    g.add(cloth);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.6; const leg = new THREE.Mesh(G.get('pad|leg', () => new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8).translate(0, 0.15, 0)), M.soft('#ffd166', { rough: 0.5 })); leg.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55); g.add(leg); }
    return { g, top: 0.31, cloth, squashY: 0 };
  },
  bed: (M, G) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.get('pad|bedbase', () => roundedBox(1.25, 0.18, 1.1, 0.06, 3).translate(0, 0.09, 0)), M.soft('#e8b98a', { rough: 0.6 })));
    g.add(new THREE.Mesh(G.get('pad|mattress', () => roundedBox(1.2, 0.2, 1.05, 0.09, 4).translate(0, 0.28, 0)), M.soft('#ffffff', { rough: 0.9, rim: 0.3 })));
    g.add(new THREE.Mesh(G.get('pad|blanket', () => roundedBox(0.8, 0.06, 1.08, 0.03, 3).translate(0.2, 0.39, 0)), M.soft('#ffc2d8', { rough: 0.95, rim: 0.3 })));
    const pil = new THREE.Mesh(G.get('pad|pillow', () => blobGeometry(0.2, 3, 0.04, 3).scale(1, 0.4, 1.6)), M.soft('#c9e8ff', { rough: 0.9 }));
    pil.position.set(-0.45, 0.42, 0); g.add(pil);
    return { g, top: 0.42, squashY: 0.25 };
  },
  cake: (M, G) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.get('pad|cake1', () => new THREE.CylinderGeometry(0.6, 0.6, 0.22, 36).translate(0, 0.11, 0)), M.soft('#fff4f8', { rough: 0.85, rim: 0.3 })));
    g.add(new THREE.Mesh(G.get('pad|cake2', () => new THREE.CylinderGeometry(0.61, 0.61, 0.05, 36).translate(0, 0.17, 0)), M.soft('#ff9ec4', { rough: 0.7 })));
    g.add(new THREE.Mesh(G.get('pad|cake3', () => new THREE.CylinderGeometry(0.6, 0.6, 0.12, 36).translate(0, 0.28, 0)), M.soft('#ffffff', { rough: 0.9, rim: 0.35 })));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; const b = new THREE.Mesh(G.get('pad|berry', () => new THREE.SphereGeometry(0.06, 10, 8)), M.soft('#ff4d6d', { rough: 0.4, rim: 0.3 })); b.position.set(Math.cos(a) * 0.48, 0.38, Math.sin(a) * 0.48); g.add(b); }
    return { g, top: 0.36, squashY: 0.25 };
  },
  ball: (M, G) => {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) g.add(new THREE.Mesh(G.get('pad|ball' + i, () => new THREE.SphereGeometry(0.45, 24, 16, (i / 6) * TAU, TAU / 6).translate(0, 0.45, 0)), M.soft(RAINBOW[i], { rough: 0.35, rim: 0.4 })));
    return { g, top: 0.9, squashY: 0.45 };
  },
};

export class BounceGimmick extends Gimmick {
  build() {
    const d = this.def;
    this.length = d.length || 2.4;
    const pad = (PADS[d.skin] || PADS.mushroom)(this.ctx.M, this.ctx.G, d.color);
    pad.g.position.set(this.length / 2, 0, 0);
    pad.g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.group.add(pad.g);
    this.pad = pad;
    this.sq = new Spring(220, 7, 1);
    return this;
  }
  topY(x, z) {
    const c = this.length / 2;
    return Math.hypot(x - c, z) < 0.55 ? this.pad.top * this.pad.g.scale.y : 0;
  }
  _impact(G, power) {
    this.sq.x = 1 - 0.18 * power;
    this.sq.v -= 1.5 * power;
    if (this.pad.ju) kickJiggle(this.pad.ju, V(0, this.pad.top, 0), 0.8 + power * 0.6);
    const p = this.W(this.length / 2, this.pad.top, 0);
    G.sfx(this.def.sound || 'bounce', p, { gain: -3 + power * 3 });
    G.burst('sparkles', p, { colors: ['#ffffff', '#fff2a8', '#ffd6e8'], count: 4 + Math.round(power * 6), scale: 0.6 });
  }
  update(dt) {
    super.update(dt);
    const s = this.sq.update(dt);
    const sy = clamp(s, 0.65, 1.25);
    this.pad.g.scale.set(1 + (1 - sy) * 0.35, sy, 1 + (1 - sy) * 0.35);
    if (this.pad.ju) this.pad.ju.uJT.value += dt;
  }
  async run(G) {
    const pet = G.pet, d = this.def;
    const c = this.length / 2;
    const top = () => this.W(c, this.pad.top, 0);
    G.label(this.label);
    // 低机位正面仰拍：跳得越高越显得开心
    G.cam('point', { pos: () => this.W(c + 2.7, 0.75, 2.3), look: () => V(this.x0 + c, Math.max(0.65, pet.root.position.y * 0.6 + 0.5), 0), lambda: 1.8 });
    pet.face(Math.PI / 2);
    pet.expr('wide', 'o', 1);
    await pet.idleAction('ready', 0.5);
    await pet.hop(top(), { height: 0.45, dur: 0.5 });
    pet.setGround(top().y);
    this._impact(G, 0.5);
    G.countStep();
    // 面向镜头连跳三下：一下比一下高，最后一下翻个跟头
    pet.faceTowards(G.camPos().x, G.camPos().z);
    const heights = [0.62, 0.95, 1.35];
    for (let k = 0; k < 3; k++) {
      const last = k === 2;
      if (last) G.say(d.say || '看我翻个跟头！');
      const trick = last ? (d.trick === 'spin' ? { spin: 1 } : { flip: 1 }) : {};
      if (last) G.sfx('whoosh', top(), { gain: -4, main: false, delay: 0.12 });
      await pet.hop(top(), { height: heights[k], dur: 0.48 + heights[k] * 0.32, anticipation: 0.06, keepFacing: true, ...trick });
      pet.setGround(top().y);
      this._impact(G, 0.6 + k * 0.2);
      G.countStep();
      if (last) { G.burst('stars', V(pet.root.position.x, pet.root.position.y + 0.8, pet.root.position.z), { colors: ['#ffd166', '#ff8fb3', '#7fd6ff'], count: 12 }); G.camBump(0.03); }
    }
    G.unsay();
    pet.expr('happy', 'open', 1.4);
    const end = this.W(this.length + 0.12, 0, 0);
    end.y = G.yAt(end.x, end.z);
    await pet.hop(end, { height: 0.5, dur: 0.6 });
    pet.setGround(end.y);
    G.sfx('land_soft', end, { gain: -2 });
    this.done = true;
  }
}

// ======================= 3. 滑滑梯 =======================
// 跳上果冻垫弹两下 → "嘣"地弹上平台 → 在顶上对镜头挥手 → 坐着滑下来（镜头在底部迎着拍）→ 扑进球池 / 雪堆 / 落叶堆 / 面粉 / 枕头堆
export class SlideGimmick extends Gimmick {
  build() {
    const d = this.def, { M, G } = this.ctx;
    // 尺寸按糯糯的身材来（身体约 1.1 宽、1.0 深）：
    //  - 不爬楼梯：圆滚滚的肚子底下是圆的，任何台阶都会被肚子"吃"进去（穿模）。
    //    改成一个弹弹果冻垫——跳上去弹两下蓄力，"嘣"地一下先往上、再往前弹上平台（肚子离平台前缘留着空隙）
    //  - 顶上的平台比糯糯大，站得稳
    //  - 滑道是半径 0.72 的 U 形槽，糯糯整个身子坐在槽里滑下来：脚底贴着槽底、身体顺着槽底的法线倾斜，
    //    不会和槽壁、护栏穿插（离线几何检查：整段滑行身体和槽面零相交）
    const H = this.H = d.height || 0.9;
    this.entryX = -0.3; // 在果冻垫前面停下（圆肚子不会顶到垫子边）
    this.padX = 0.62; this.padR = 0.42; this.padH = 0.15;
    this.platX0 = 1.25;
    this.topEnd = this.platX0 + 1.1; // 平台够长：站在上面挥手时，身体和滑道口之间还留着空隙
    this.landX = this.platX0 + 0.48;
    const R = this.chuteR = 0.72;
    this.chuteDrop = 0.7 * R; // 槽底比中心线低多少
    const colA = d.color || '#7fd6ff', colB = d.color2 || '#ff8fb3';
    // 果冻垫：半透明、亮晶晶、一压就"duang"
    const pc = new THREE.Color(colB);
    const padCol = d.padColor || (pc.getHSL({ h: 0, s: 0, l: 0 }).s < 0.25 ? colA : colB);
    const padMat = M.track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(padCol), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.86, emissive: new THREE.Color(padCol), emissiveIntensity: 0.14 }));
    this.padJu = addJiggle(padMat);
    const pad = new THREE.Group();
    pad.position.set(this.padX, 0, 0);
    const dome = new THREE.Mesh(G.get('slidepad|dome', () => { const g = new THREE.SphereGeometry(this.padR, 36, 12, 0, TAU, 0, Math.PI / 2); g.scale(1, this.padH / this.padR, 1); return g; }), padMat);
    dome.castShadow = true; dome.receiveShadow = true;
    pad.add(dome);
    const ring = new THREE.Mesh(G.get('slidepad|ring', () => new THREE.TorusGeometry(this.padR, 0.035, 10, 44).rotateX(Math.PI / 2).translate(0, 0.02, 0)), M.soft('#ffffff', { rough: 0.4, rim: 0.4 }));
    pad.add(ring);
    // 果冻里的小气泡
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.4, rr = k % 2 ? 0.2 : 0.29;
      const b = new THREE.Mesh(G.get('slidepad|bub', () => new THREE.SphereGeometry(0.022, 10, 8)), M.soft('#ffffff', { rough: 0.2, rim: 0.6 }));
      b.position.set(Math.cos(a) * rr, 0.05 + (k % 3) * 0.015, Math.sin(a) * rr);
      pad.add(b);
    }
    this.group.add(pad);
    this.padObj = pad;
    this.padSq = new Spring(220, 7, 1);
    this.padSy = 1;
    // 平台：圆角厚台面 + 四根粗粗的糖果柱
    const plat = new THREE.Mesh(G.track(roundedBox(this.topEnd - this.platX0, 0.1, 1.2, 0.045, 3).translate((this.platX0 + this.topEnd) / 2, H - 0.05, 0)), M.soft(colB, { rough: 0.5, rim: 0.35 }));
    plat.castShadow = true; plat.receiveShadow = true;
    this.group.add(plat);
    const trim = new THREE.Mesh(G.track(roundedBox(this.topEnd - this.platX0 + 0.02, 0.035, 1.22, 0.016, 2).translate((this.platX0 + this.topEnd) / 2, H - 0.105, 0)), M.soft('#ffffff', { rough: 0.45, rim: 0.3 }));
    this.group.add(trim);
    for (const xx of [this.platX0 + 0.1, this.topEnd - 0.08]) for (const zz of [-0.48, 0.48]) {
      const leg = new THREE.Mesh(G.get('slide|platleg|' + H.toFixed(2), () => new THREE.CylinderGeometry(0.055, 0.07, H - 0.12, 12).translate(0, (H - 0.12) / 2, 0)), M.soft(colA, { rough: 0.5, rim: 0.3 }));
      leg.position.set(xx, 0, zz); leg.castShadow = true; this.group.add(leg);
      const foot = new THREE.Mesh(G.get('slide|platfoot', () => new THREE.SphereGeometry(0.085, 12, 8, 0, TAU, 0, Math.PI / 2)), M.soft('#ffffff', { rough: 0.5 }));
      foot.position.set(xx, 0, zz); this.group.add(foot);
    }
    // 扶手只做在背向镜头的一侧，离糯糯身体留出空隙
    const zz = -0.64;
    for (const xx of [this.platX0 + 0.06, this.topEnd - 0.04]) {
      const post = new THREE.Mesh(G.get('slide|post', () => new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10).translate(0, 0.21, 0)), M.soft('#ffd166', { rough: 0.45, rim: 0.3 }));
      post.position.set(xx, H, zz); post.castShadow = true; this.group.add(post);
      const ball = new THREE.Mesh(G.get('slide|postball', () => new THREE.SphereGeometry(0.05, 12, 8)), M.soft('#ffd166', { rough: 0.4, rim: 0.4 }));
      ball.position.set(xx, H + 0.44, zz); this.group.add(ball);
    }
    const rail = new THREE.Mesh(G.track(new THREE.CylinderGeometry(0.025, 0.025, this.topEnd - this.platX0 - 0.1, 8).rotateZ(Math.PI / 2)), M.soft('#ffd166', { rough: 0.45 }));
    rail.position.set((this.platX0 + this.topEnd) / 2 + 0.01, H + 0.4, zz);
    this.group.add(rail);
    // 滑道：一条 S 形的 U 形槽（开口朝上），槽底的起点和平台一样高
    const lift = this.chuteDrop;
    // 滑道末端微微翘起、悬在落地盆上方（比盆沿高）：糯糯从盆沿上方飞进去，不会擦着盆沿 / 雪堆的边冲进去
    // 末端停在落地盆的边上（不伸到盆中间：糯糯坐在盆里时，背后不会碰到滑道）
    const pts = [V(this.topEnd - 0.04, H + lift, 0), V(this.topEnd + 0.7, H * 0.8 + lift, 0.3), V(this.topEnd + 1.5, H * 0.5 + lift, -0.22), V(this.topEnd + 2.2, Math.max(0.3, H * 0.3) + lift, 0.04), V(this.topEnd + 2.55, 0.3 + lift, 0)];
    this.curveLocal = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const chute = new THREE.Mesh(G.track(halfPipe(this.curveLocal, R, 90, 16)), M.soft(colA, { rough: 0.25, rim: 0.5, rimColor: '#ffffff', side: THREE.DoubleSide }));
    chute.castShadow = true; chute.receiveShadow = true;
    this.group.add(chute);
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(G.track(new THREE.TubeGeometry(offsetCurve(this.curveLocal, side * R, R * 0.05 - 0.05), 90, 0.04, 8, false)), M.soft('#ffffff', { rough: 0.4, rim: 0.4 }));
      rim.castShadow = true;
      this.group.add(rim);
    }
    // 支柱：撑在槽底下面
    for (const u of [0.22, 0.5, 0.75]) {
      const p = this.curveLocal.getPointAt(u);
      const hgt = Math.max(0.05, p.y - lift - 0.02);
      const post = new THREE.Mesh(G.get('slide|leg|' + u + '|' + hgt.toFixed(2), () => new THREE.CylinderGeometry(0.05, 0.06, hgt, 10).translate(0, hgt / 2, 0)), M.soft(colB, { rough: 0.5 }));
      post.position.set(p.x, 0, p.z);
      post.castShadow = true;
      this.group.add(post);
    }
    // 落地堆
    this.pileX = this.topEnd + 3.3;
    this.length = this.pileX + 1.2; // 出口离落地堆的边留出糯糯一个身位（跳出来不会坐在盆沿上）
    this._pile(d.pile || 'balls', this.pileX);
    return this;
  }
  _pile(kind, x) {
    const { M, G, rng: r } = this.ctx;
    this.pileKind = kind;
    const tub = new THREE.Mesh(G.get('slide|tub', () => new THREE.CylinderGeometry(0.72, 0.68, 0.22, 36, 1, true).translate(0, 0.11, 0)), M.soft(this.def.tubColor || '#ffffff', { rough: 0.5, rim: 0.35, side: THREE.DoubleSide }));
    tub.position.set(x, 0, 0);
    if (kind !== 'pool') this.group.add(tub);
    this.pileItems = [];
    if (kind === 'balls' || kind === 'pillows' || kind === 'leaves') {
      const geo = kind === 'balls' ? G.get('pile|ball', () => new THREE.SphereGeometry(0.085, 14, 10)) : kind === 'leaves' ? G.get('pile|leaf', () => { const g = new THREE.SphereGeometry(0.1, 10, 4); g.scale(1, 0.15, 0.55); return g; }) : G.get('pile|pillow', () => blobGeometry(0.16, 2, 0.05, 2).scale(1.2, 0.5, 1));
      const n = kind === 'balls' ? 90 : kind === 'leaves' ? 140 : 18;
      const cols = this.def.pileColors || (kind === 'leaves' ? ['#f29b4b', '#e9603b', '#f7c548', '#d77a3a'] : kind === 'pillows' ? ['#ffc2d8', '#c9e8ff', '#fff0a8', '#d7c9ff', '#ffffff'] : RAINBOW);
      const im = new THREE.InstancedMesh(geo, M.soft('#ffffff', { rough: kind === 'balls' ? 0.3 : 0.85, rim: 0.35 }), n);
      im.castShadow = true;
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const a = r.range(0, TAU), rr = Math.sqrt(r.next()) * 0.6;
        const it = { x: x + Math.cos(a) * rr, z: Math.sin(a) * rr, y: 0.08 + (0.6 - rr) * 0.35 * r.next() + r.range(0, 0.12), vx: 0, vy: 0, vz: 0, rot: r.range(0, TAU), live: false };
        it.y0 = it.y; it.x0 = it.x; it.z0 = it.z;
        this.pileItems.push(it);
        im.setColorAt(i, c.set(r.pick(cols)));
      }
      this.pileIM = im;
      this._writePile();
      this.group.add(im);
    } else if (kind === 'snow' || kind === 'flour') {
      const g = G.get('pile|mound', () => blobGeometry(0.62, 5, 0.08, 3).scale(1, 0.5, 1));
      const m = new THREE.Mesh(g, M.soft(kind === 'snow' ? '#ffffff' : '#fffaf2', { rough: 0.95, rim: 0.5, rimColor: kind === 'snow' ? '#dbeaff' : '#fff1dc' }));
      m.position.set(x, 0.08, 0);
      m.receiveShadow = true; m.castShadow = true;
      this.group.add(m);
      this.mound = m;
    } else if (kind === 'pool') {
      // 小水池
      const rim = new THREE.Mesh(G.get('pile|pool', () => new THREE.TorusGeometry(0.72, 0.08, 10, 40).rotateX(Math.PI / 2).translate(0, 0.08, 0)), M.soft(this.def.tubColor || '#ffd166', { rough: 0.5, rim: 0.4 }));
      rim.position.set(x, 0, 0); this.group.add(rim);
      const u = { uColor: { value: new THREE.Color('#8fe0ff') }, uDeep: { value: new THREE.Color('#4ab8e8') }, uTime: { value: 0 }, uOpacity: { value: 0.9 }, uFade: { value: 0 }, uDrops: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) } };
      const mat = M.track(new THREE.ShaderMaterial({ uniforms: u, vertexShader: LIQ_VERT, fragmentShader: LIQ_FRAG, transparent: true, depthWrite: false }));
      const w = new THREE.Mesh(G.track(new THREE.CircleGeometry(0.7, 40).rotateX(-Math.PI / 2).translate(x, 0.1, 0)), mat);
      w.renderOrder = 2;
      this.group.add(w);
      this.liq = u;
    }
  }
  _writePile() {
    if (!this.pileIM) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.pileItems.forEach((it, i) => { q.setFromAxisAngle(V(0, 1, 0), it.rot); m4.compose(V(it.x, it.y, it.z), q, V(1, 1, 1)); this.pileIM.setMatrixAt(i, m4); });
    this.pileIM.instanceMatrix.needsUpdate = true;
  }
  topY(x, z) {
    const dp = Math.hypot(x - this.padX, z);
    if (dp < this.padR) { const k = dp / this.padR; return this.padH * this.padSy * Math.sqrt(Math.max(0, 1 - k * k)); }
    if (x >= this.platX0 && x < this.topEnd && Math.abs(z) < 0.6) return this.H;
    if (Math.hypot(x - this.pileX, z) < 0.6) return this.pileTop();
    return 0;
  }
  // 坐在落地堆里时脚底的高度：球池 / 枕头 / 落叶是一圈"坑"，雪堆 / 面粉堆被压扁后坐在上面，水池坐在池底
  pileTop() {
    const k = this.pileKind;
    if (k === 'snow' || k === 'flour') return 0.08 + 0.31 * (this.mound ? this.mound.scale.y : 1) - 0.04;
    if (k === 'pool') return 0;
    return 0.1;
  }
  // 果冻垫被压一下 / 弹一下
  _boing(G, power, sound = true) {
    this.padSq.x = Math.min(this.padSq.x, 1 - 0.28 * power);
    this.padSq.v -= 1.2 * power;
    kickJiggle(this.padJu, V(0, this.padH, 0), 0.7 + power * 0.6);
    const p = this.W(this.padX, this.padH, 0);
    if (sound) G.sfx(this.def.padSound || 'bounce', p, { gain: -5 + power * 3 });
    G.burst('sparkles', p, { colors: ['#ffffff', '#fff2a8', '#ffd6e8'], count: 3 + Math.round(power * 5), scale: 0.5 });
  }
  update(dt) {
    super.update(dt);
    if (this.pileLive) {
      let any = false;
      for (const it of this.pileItems) {
        if (!it.live) continue;
        any = true;
        it.vy -= 9 * dt;
        it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
        it.rot += dt * 3;
        if (it.y < it.y0 && it.vy < 0) {
          it.vy *= -0.3; it.vx *= 0.5; it.vz *= 0.5; it.y = it.y0;
          // 落到堆上它该在的位置（被挤开的落在坑的四周）
          it.x = lerp(it.x, it.x0, 0.45); it.z = lerp(it.z, it.z0, 0.45);
          if (Math.abs(it.vy) < 0.3) { it.live = false; it.x = it.x0; it.z = it.z0; }
        }
      }
      this._writePile();
      if (!any) this.pileLive = false;
    }
    if (this.mound && this.moundSq) { const s = this.moundSq.update(dt); this.mound.scale.set(1 + (1 - s) * 0.45, s, 1 + (1 - s) * 0.45); }
    if (this.padObj) {
      const s = clamp(this.padSq.update(dt), 0.6, 1.3);
      this.padSy = s;
      this.padObj.scale.set(1 + (1 - s) * 0.3, s, 1 + (1 - s) * 0.3);
      this.padJu.uJT.value += dt;
    }
  }
  _splash(G, p) {
    const d = this.def;
    const k = this.pileKind;
    if (this.pileIM) {
      // 砸出一个坑：身体占住的那一圈里的球 / 枕头 / 叶子被挤开，飞起来落到四周堆成一圈（不会落回糯糯身体里）
      const r = this.ctx.rng;
      const cx = p.x - this.x0, cz = p.z;
      for (const it of this.pileItems) {
        const dx = it.x - cx, dz = it.z - cz, dist = Math.hypot(dx, dz);
        if (dist < 0.6) {
          const a = dist > 0.01 ? Math.atan2(dz, dx) : r.range(0, TAU);
          const rr = r.range(0.58, 0.68);
          it.x0 = cx + Math.cos(a) * rr; it.z0 = cz + Math.sin(a) * rr; it.y0 = 0.07 + r.range(0, 0.16);
          it.live = true;
          if (dist < 0.48) {
            // 正好在肚子底下的：直接挤到坑边上（被身体挡着看不见），再轻轻弹一下
            it.x = it.x0; it.z = it.z0; it.y = it.y0;
            it.vx = Math.cos(a) * 0.3; it.vz = Math.sin(a) * 0.3; it.vy = r.range(0.6, 1.1);
          } else {
            // 坑边上的：贴着地面往外飞（不会往上穿过身体）
            const sp = r.range(0.5, 0.8);
            it.vx = Math.cos(a) * sp; it.vz = Math.sin(a) * sp; it.vy = r.range(0.6, 1.0);
          }
        }
      }
      this.pileLive = true;
    }
    // 雪堆 / 面粉堆被砸扁（一直扁着，糯糯坐在上面）
    if (this.mound) { this.moundSq = this.moundSq || new Spring(120, 7, 1); this.moundSq.x = 0.45; this.moundSq.target = 0.58; }
    if (k === 'snow' || k === 'flour') G.burst('poof', V(p.x, p.y + 0.1, p.z), { colors: k === 'snow' ? ['#ffffff', '#eef6ff'] : ['#ffffff', '#fff6e8'], count: 18, scale: 1.0 });
    if (k === 'snow') G.burst('snow', V(p.x, p.y + 0.1, p.z), { colors: ['#ffffff'], count: 12 });
    if (k === 'leaves') G.burst('leaves', V(p.x, p.y + 0.1, p.z), { colors: d.pileColors || ['#f29b4b', '#e9603b', '#f7c548'], count: 18 });
    if (k === 'pool') { this.ripple(p.x - this.x0, p.z, 1.4); G.burst('water', V(p.x, p.y + 0.05, p.z), { colors: ['#d8f5ff', '#ffffff'], count: 30 }); }
    if (k === 'balls') G.burst('sparkles', V(p.x, p.y + 0.3, p.z), { colors: ['#ffffff', '#fff2a8'], count: 10 });
  }
  async run(G) {
    const pet = G.pet, d = this.def;
    const H = this.H;
    G.label(this.label);
    // 侧前方的机位：果冻垫、平台、滑梯口都在画面里，糯糯迎着镜头
    const far = G.portrait ? 1.25 : 1;
    G.cam('point', { pos: () => this.W(1.3, 1.55, 4.3 * far), look: () => V(lerp(this.x0 + 1.2, pet.root.position.x, 0.35), lerp(this.group.position.y + 0.9, pet.root.position.y + 0.55, 0.6), 0), lambda: 3.2 });
    pet.expr('wide', 'open', 1.2, 'up');
    G.say(d.say || '哇，滑滑梯！');
    await pet.idleAction('peek', 0.6);
    G.unsay();
    // 跳上果冻垫（脚微微陷进果冻里，垫子一压一弹，脚一直贴着垫面）
    const padTop = () => this.W(this.padX, this.padH, 0);
    await pet.hop(padTop(), { height: 0.36, dur: 0.5 });
    pet.setGround(padTop().y);
    pet.sinkTarget = 0.03;
    this._boing(G, 0.55);
    G.countStep();
    // 原地弹两下蓄力（对着镜头）
    pet.faceTowards(G.camPos().x, G.camPos().z);
    pet.expr('happy', 'open', 1.0);
    for (const h of [0.28, 0.48]) {
      await pet.hop(padTop(), { height: h, dur: 0.4 + h * 0.3, anticipation: 0.05, keepFacing: true, onTakeoff: () => this._boing(G, 0.25, false) });
      pet.setGround(padTop().y);
      this._boing(G, 0.45 + h);
    }
    // 嘣！先往上、再往前（水平方向缓入），肚子从平台前缘上方越过去
    G.say(d.boing || '弹——上去！');
    this.padSq.x = 0.72; // 蓄力时把果冻压扁
    const landP = this.W(this.landX, H, 0);
    G.sfx('whoosh', padTop(), { gain: -6, main: false, delay: 0.1 });
    // 侧着身子往上弹（3/4 正脸一直对着镜头，不露后背）
    pet.face(0.55);
    await pet.hop(landP, { height: 0.62, dur: 0.8, anticipation: 0.14, keepFacing: true, hEase: (u) => Math.pow(u, 1.6), onTakeoff: () => { pet.sinkTarget = 0; this.padSq.v += 3.5; this._boing(G, 1.0); } });
    pet.setGround(landP.y);
    G.sfx(d.stepSound || 'wood_step', landP, { gain: 0 });
    G.sfx('land_soft', landP, { gain: -6, main: false });
    G.unsay();
    // 在顶上转身对镜头挥挥手
    // 镜头在平台左前方偏高（滑道口在糯糯身后，不会挡住她）
    const waveCam = this.W(this.landX - 1.05, H + 0.95, 2.3 * far);
    G.cam('point', { pos: () => waveCam, look: () => V(pet.root.position.x + 0.15, pet.root.position.y + 0.45, pet.root.position.z), lambda: 1.8 });
    pet.faceTowards(waveCam.x, waveCam.z);
    pet.expr('happy', 'open', 1.4);
    G.say(d.ready || '准备好啦～');
    await pet.idleAction('wave', 1.0);
    G.unsay();
    // 小跳一下到滑道口（不在滑道旁边慢慢走：那样会被滑道的边挡住）
    const lip = this.W(this.topEnd - 0.12, H, 0);
    await pet.hop(lip, { height: 0.22, dur: 0.36, anticipation: 0.06 });
    pet.setGround(lip.y);
    G.sfx(d.stepSound || 'wood_step', lip, { gain: -4 });
    // 滑！镜头切到滑梯底部，迎着糯糯拍（Crash Bandicoot 式正面）
    G.cam('point', { pos: () => this.W(this.pileX + 1.9, 0.95, 1.7), look: () => V(pet.root.position.x, pet.root.position.y + 0.38, pet.root.position.z * 0.6), lambda: 3.0, cut: true });
    // 糯糯坐在 U 形槽的槽底滑下来（脚底贴着槽底，身体在槽里，不会悬空也不会穿过槽壁）
    // 滑行路线 = 槽底（沿槽的横截面法线往下，而不是竖直往下：陡的地方横截面是斜的）再抬高 3 厘米
    const drop = this.chuteDrop - 0.03;
    const ridePts = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, p = this.curveLocal.getPointAt(u), t = this.curveLocal.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(t, V(0, 1, 0)).normalize();
      const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
      p.addScaledVector(nrm, -drop);
      ridePts.push(this.W(p.x, p.y, p.z));
    }
    ridePts.push(this.W(this.pileX - 0.08, this.pileTop() + 0.12, 0));
    const curveW = new THREE.CatmullRomCurve3(ridePts, false, 'centripetal');
    G.sfx('whoosh', this.W(this.topEnd, H, 0), { gain: -2, main: false });
    G.sfx('slide_roll', this.W(this.topEnd, H, 0), { gain: -3, maxDur: 1.7 });
    G.say(d.wee || '呜呼～～');
    const slideDur = d.slideDur || 2.0;
    const riding = pet.ride(curveW, slideDur, { faceTo: () => G.camPos(), faceK: 0.35, align: true, bank: 0 });
    // 落地前一瞬间：球 / 枕头被冲开、雪堆被压扁（身体落下去的地方已经空出来了）
    const land = this.W(this.pileX, this.pileTop(), 0);
    await G.wait(slideDur - 0.15);
    this._splash(G, land);
    await riding;
    G.unsay();
    // 扑进软软的落地堆，坐在坑里 / 压扁的雪堆上
    if (this.mound) { this.mound.scale.y = 0.58; land.y = this.W(0, this.pileTop(), 0).y; }
    pet.root.position.copy(land);
    pet.setGround(land.y);
    pet.sinkTarget = this.pileKind === 'pool' ? 0.05 : 0.03;
    pet.sq.x = 0.7;
    G.sfx(d.land || 'land_soft', land, { gain: 1 });
    if (d.land2) G.sfx(d.land2, land, { gain: -2, main: false, delay: 0.06 });
    G.camBump(0.05);
    G.countStep();
    pet.expr('closed', 'open', 1.0);
    await pet.idleAction('sit', 0.9);
    pet.sinkTarget = 0;
    await pet.idleAction('shake', 0.6);
    pet.expr('happy', 'smile', 1.4);
    const out = this.W(this.length + 0.12, 0, 0);
    out.y = G.yAt(out.x, out.z);
    G.cam('front', {});
    pet.sinkTarget = 0;
    await pet.hop(out, { height: 0.45, dur: 0.6 });
    pet.setGround(out.y);
    G.sfx(G.pathSound, out, { gain: -1 });
    this.done = true;
  }
}

// 半圆管（开口朝上）：沿曲线扫掠一个 U 形截面
function halfPipe(curve, r, segs, rad) {
  const pos = [], idx = [], uv = [];
  const up = V(0, 1, 0);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
    for (let j = 0; j <= rad; j++) {
      const a = Math.PI * (j / rad); // 0..π：从一侧经过底部到另一侧
      const v = p.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(nrm, -Math.sin(a) * r * 0.75 + r * 0.05);
      pos.push(v.x, v.y, v.z);
      uv.push(u, j / rad);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function offsetCurve(curve, off, dy) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(t, V(0, 1, 0)).normalize();
    pts.push(p.clone().addScaledVector(side, off).add(V(0, dy + 0.05, 0)));
  }
  return new THREE.CatmullRomCurve3(pts);
}

// ======================= 4. 气球 / 雨伞飘飘 =======================
export class FloatGimmick extends Gimmick {
  build() {
    const d = this.def, { M, G } = this.ctx;
    this.length = d.length || 3.0;
    this._channel(d);
    this._banks(d.bank || '#f4e8dc');
    // 起点的小立柱，上面系着气球（或者插着一把小伞）
    const post = new THREE.Mesh(G.get('float|post', () => new THREE.CylinderGeometry(0.03, 0.04, 0.55, 10).translate(0, 0.275, 0)), M.soft('#ffffff', { rough: 0.5, rim: 0.3 }));
    post.position.set(0.08, 0, -0.55);
    this.group.add(post);
    this.standBalloons = new THREE.Group();
    const cols = d.skin === 'umbrella' ? ['#ff8fb3'] : ['#ff8fb3', '#7fd6ff', '#ffd166', '#b38fff'];
    cols.forEach((c, i) => {
      const b = new THREE.Mesh(G.get('float|b', () => new THREE.SphereGeometry(0.14, 18, 14).scale(1, 1.15, 1)), M.soft(c, { rough: 0.25, rim: 0.7 }));
      b.position.set((i - 1.5) * 0.17, 0.95 + (i % 2) * 0.1, 0);
      this.standBalloons.add(b);
    });
    this.standBalloons.position.set(0.08, 0, -0.55);
    if (d.skin !== 'umbrella') this.group.add(this.standBalloons);
    return this;
  }
  topY(x) { return x < 0.15 || x > this.length - 0.15 ? 0 : -0.04; }
  update(dt) {
    super.update(dt);
    this.standBalloons.rotation.z = Math.sin(this.t * 1.2) * 0.06;
  }
  async run(G) {
    const pet = G.pet, d = this.def;
    G.label(this.label);
    G.cam('follow', { off: V(1.5, 1.0, 2.4), lookY: 0.55, lambda: 1.2 });
    pet.face(Math.PI / 2);
    pet.expr('wide', 'o', 1, 'up');
    G.say(d.say || (d.skin === 'umbrella' ? '撑开小伞～' : '抓住气球，飞～'));
    await pet.idleAction('peek', 0.6);
    pet.hold(d.skin === 'umbrella' ? 'umbrella' : 'balloon');
    if (d.skin !== 'umbrella') this.standBalloons.visible = false;
    G.sfx('whoosh', pet.root.position, { gain: -6, main: false });
    await G.wait(0.45);
    G.unsay();
    const to = this.W(this.length + 0.12, 0, 0);
    to.y = G.yAt(to.x, to.z);
    // 飘起来的时候镜头往后、往上一点：小伞 / 气球和糯糯都要在画面里；
    // 糯糯身体转向镜头一侧（侧着飘过去），一路都看得到小脸
    // （跟得紧一点：飘起、落下时镜头不落后，气球和落地都不会被裁到画面外）
    G.cam('follow', { off: V(2.2, 1.0, 3.4), lookY: 0.85, lookFromPet: true, lookAhead: 0.3, lambda: 2.4 });
    pet.face(Math.PI / 2 - 0.8);
    G.sfx('whoosh', pet.root.position, { gain: -8, main: false, delay: 0.3 });
    await pet.float(to, { dur: d.dur || 3.2, height: d.height ?? 0.85, keepFacing: true });
    pet.setGround(to.y);
    G.sfx('land_soft', to, { gain: -2 });
    G.countStep();
    // 松手：气球自己飘上天
    const tool = pet.tool;
    if (tool) {
      pet.root.updateMatrixWorld(true);
      const wp = tool.getWorldPosition(V(0, 0, 0));
      pet.handR.remove(tool);
      tool.position.set(wp.x - this.x0, wp.y, wp.z);
      tool.quaternion.identity();
      this.group.add(tool);
      this.floaters.push({ obj: tool, t: 0 });
      pet.tool = null; pet.toolType = null;
    }
    pet.expr('happy', 'open', 1.2);
    await pet.idleAction('wave', 0.8);
    this.done = true;
  }
}

// ======================= 5. 摇摇桥 =======================
export class BridgeGimmick extends Gimmick {
  build() {
    const d = this.def, { M, G, rng: r } = this.ctx;
    const n = d.count || 7;
    const pw = 0.26;
    this.length = 0.35 + n * (pw + 0.04) + 0.3;
    this._channel(d);
    this._banks(d.bank || '#f4e8dc');
    this.planks = [];
    // 桥面比糯糯宽（身体约 1.1 宽），两边的绳子在身体外面：走过去时小手正好扶着绳子
    const geo = d.skin === 'jelly' ? G.get('br|jelly2', () => roundedBox(pw, 0.1, 1.08, 0.04, 3)) : d.skin === 'cloud' ? G.get('br|cloud2', () => blobGeometry(0.2, 3, 0.1, 2).scale(0.75, 0.35, 2.7)) : G.get('br|plank2', () => roundedBox(pw, 0.07, 1.1, 0.025, 2));
    for (let i = 0; i < n; i++) {
      const x = 0.35 + pw / 2 + i * (pw + 0.04);
      const col = d.skin === 'jelly' || d.skin === 'block' ? RAINBOW[i % RAINBOW.length] : d.skin === 'cloud' ? '#ffffff' : r.pick(['#e8b07a', '#d99a62', '#f0c08a']);
      const mat = d.skin === 'jelly' ? M.glossy(col, { opacity: 0.85, ei: 0.2 }) : M.soft(col, { rough: d.skin === 'cloud' ? 0.9 : 0.6, rim: 0.35 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0.04, 0);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this.planks.push({ m, x, sp: new Spring(130, 6, 0), rs: new Spring(90, 4, 0) });
    }
    // 两边的绳子和桩
    for (const zz of [-0.74, 0.74]) {
      for (const xx of [0.2, this.length - 0.2]) {
        const post = new THREE.Mesh(G.get('br|post', () => new THREE.CylinderGeometry(0.045, 0.05, 0.5, 10).translate(0, 0.2, 0)), M.soft(d.postColor || '#ffd166', { rough: 0.5, rim: 0.3 }));
        post.position.set(xx, 0, zz); post.castShadow = true; this.group.add(post);
        const ball = new THREE.Mesh(G.get('br|ball', () => new THREE.SphereGeometry(0.065, 12, 10)), M.soft(d.postColor2 || '#ff8fb3', { rough: 0.4 }));
        ball.position.set(xx, 0.47, zz); this.group.add(ball);
      }
      const rope = new THREE.Mesh(G.track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.2, 0.46, zz), V(this.length / 2, 0.4, zz), V(this.length - 0.2, 0.46, zz)]), 30, 0.02, 6, false)), M.soft('#ffffff', { rough: 0.8 }));
      this.group.add(rope);
    }
    return this;
  }
  _plank(x) { return this.planks.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b), this.planks[0]); }
  topY(x, z) {
    if (x < 0.32 || x > this.length - 0.28) return 0;
    const p = this._plank(x);
    return p.m.position.y + 0.04;
  }
  update(dt) {
    super.update(dt);
    for (const p of this.planks) {
      p.m.position.y = 0.04 + p.sp.update(dt) + Math.sin(this.t * 1.5 + p.x * 3) * 0.006;
      p.m.rotation.x = p.rs.update(dt);
    }
  }
  async run(G) {
    const pet = G.pet, d = this.def;
    G.label(this.label);
    G.cam('front', {});
    pet.face(Math.PI / 2);
    G.say(d.say || '小心翼翼～');
    await pet.idleAction('peek', 0.6);
    G.unsay();
    const end = this.W(this.length + 0.12, 0, 0);
    end.y = G.yAt(end.x, end.z);
    await G.walkTo(end, {
      gait: 'balance', stepDur: 0.5, stride: 0.2, sound: d.stepSound || 'wood_step', gain: -2,
      onStep: (side, wp) => {
        const lx = wp.x - this.x0;
        if (lx < 0.3 || lx > this.length - 0.25) return;
        const p = this._plank(lx);
        p.sp.v -= 0.45; p.rs.v += side * 0.9;
        if (d.fx) G.burst(d.fx, wp, { colors: d.fxColors || ['#ffffff'], count: 4, scale: 0.5 });
      },
    });
    pet.expr('happy', 'smile', 1);
    this.done = true;
  }
}

export const GIMMICK_TYPES = { hop: HopGimmick, bounce: BounceGimmick, slide: SlideGimmick, float: FloatGimmick, bridge: BridgeGimmick };

export function createGimmick(ctx, def) {
  const C = GIMMICK_TYPES[def.type];
  if (!C) throw new Error('未知闯关元素 ' + def.type);
  return new C(ctx, def).build();
}
