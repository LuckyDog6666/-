// 由关卡数据构建 3D 场景：地面、小路砖块、可踩物件、闯关机关、装饰物、天空、灯光。
// 每关结束时 dispose() 释放全部 GPU 资源，保证 7x24 小时直播内存稳定。
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';
import { MaterialBank } from '../render/materials.js';
import { Tex } from '../render/textures.js';
import { GeoBank, tileGeometry, roundedBox, starGeometry, heartGeometry, blobGeometry } from './geo.js';
import { buildItem, ItemInstance } from './items.js';
import { buildProp } from './props.js';
import { CELL } from './levelGen.js';
import { Rng, Spring, TAU, clamp, ease } from '../core/util.js';

export const TILE_TOP = 0.3;

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;
const SKY_FRAG = `
uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; uniform float uTime;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(cMid, cTop, smoothstep(0.0, 0.65, h)) : mix(cMid, cBot, smoothstep(0.0, -0.35, h));
  // 极淡的柔光条纹，让天空不那么"平"
  c += 0.025 * sin(vDir.x * 6.0 + uTime * 0.05) * (1.0 - abs(h));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const LIQ_VERT = `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const LIQ_FRAG = `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uLen; uniform float uWid;
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x * uWid, vUv.y * uLen);
  float w = sin(p.y * 4.2 + uTime * 1.6 + sin(p.x * 5.0 + uTime) * 1.5) * 0.5 + 0.5;
  float w2 = sin(p.x * 7.0 - uTime * 2.1 + p.y * 1.7) * 0.5 + 0.5;
  vec3 c = uColor * (0.82 + 0.3 * w * w2);
  c += vec3(1.0) * smoothstep(0.86, 1.0, w * w2) * 0.35;
  float edgeW = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  float d = min(p.y, uLen - p.y);
  float endF = smoothstep(0.0, 0.9, d);
  gl_FragColor = vec4(c, uAlpha * edgeW * endF);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const PORTAL_FRAG = `
uniform float uTime; uniform float uOpen;
varying vec2 vUv;
vec3 hsv(float h){ vec3 k = vec3(1.0, 2.0/3.0, 1.0/3.0); vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0); return clamp(p - 1.0, 0.0, 1.0); }
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float sw = sin(a * 3.0 + r * 10.0 - uTime * 3.0) * 0.5 + 0.5;
  vec3 c = mix(vec3(1.0), hsv(fract(a / 6.2831 + uTime * 0.05 + r * 0.3)) * 0.6 + 0.5, 0.7);
  c = mix(c, vec3(1.0), sw * 0.4 * (1.0 - r));
  float alpha = smoothstep(1.0, 0.85, r) * (0.55 + 0.45 * uOpen);
  gl_FragColor = vec4(c, alpha);
  #include <colorspace_fragment>
}`;
const PORTAL_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

export class World {
  constructor(scene, theme, level, opts = {}) {
    this.scene = scene;
    this.theme = theme;
    this.level = level;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.M = new MaterialBank();
    this.G = new GeoBank();
    this.items = new Map(); // cellId -> ItemInstance
    this.anims = []; // 动画装饰物
    this.uniforms = [];
    this.t = 0;
    this.tilePress = new Map();
    this.collectedStars = new Set();
    this.hasKey = false;
    this.gateOpen = false;
    this.rng = new Rng(level.seed ^ 0x5bd1e995);
  }

  build() {
    const th = this.theme;
    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildTiles();
    this._buildGaps();
    this._buildItems();
    this._buildMechanics();
    this._buildProps();
    this._buildGroundBits();
    this.scene.add(this.group);
    this.scene.fog = new THREE.Fog(new THREE.Color(th.fog), th.fogRange[0], th.fogRange[1]);
    this.scene.background = new THREE.Color(th.sky[1]);
    return this;
  }

  // ---------------- 坐标工具 ----------------
  cell(id) { return this.level.cells[id]; }
  cellXZ(id) { const c = this.cell(id); return new THREE.Vector3(c.gx * CELL, 0, c.gz * CELL); }
  cellTop(id) { return TILE_TOP + (this.tileJitter?.[id] || 0); }
  // 糯糯落脚点（考虑物件高度）
  standPoint(id) {
    const p = this.cellXZ(id);
    let y = this.cellTop(id);
    const it = this.items.get(id);
    if (it && it.available && it.meta.h) y += it.meta.h;
    if (this.springs && this.springs.has(id)) y += 0.12;
    p.y = y;
    return p;
  }

  // ---------------- 天空与灯光 ----------------
  _buildSky() {
    const th = this.theme;
    const geo = this.G.track(new THREE.SphereGeometry(140, 32, 16));
    const mat = this.M.track(new THREE.ShaderMaterial({
      uniforms: { cTop: { value: new THREE.Color(th.sky[0]) }, cMid: { value: new THREE.Color(th.sky[1]) }, cBot: { value: new THREE.Color(th.sky[2]) }, uTime: { value: 0 } },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.uniforms.push(mat.uniforms);
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);
  }

  _buildLights() {
    const th = this.theme;
    this.hemi = new THREE.HemisphereLight(new THREE.Color(th.hemi[0]), new THREE.Color(th.hemi[1]), th.hemi[2] * 1.15);
    this.group.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, th.ambient);
    this.group.add(this.amb);
    const sun = new THREE.DirectionalLight(new THREE.Color(th.sun[0]), th.sun[1]);
    sun.castShadow = true;
    const q = this.opts.shadowSize || 2048;
    sun.shadow.mapSize.set(q, q);
    const S = 11;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 50 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(-6, 14, 9);
    this.group.add(sun);
    this.group.add(sun.target);
    if (th.dark) {
      // 水晶洞：一盏跟随糯糯的暖光（矿工灯）
      this.petLight = new THREE.PointLight(0xfff1c8, 6, 7, 1.6);
      this.group.add(this.petLight);
    }
  }

  // ---------------- 地面 ----------------
  _buildGround() {
    const th = this.theme;
    const b = this.level.bounds;
    const cx = ((b.x0 + b.x1) / 2) * CELL, cz = ((b.z0 + b.z1) / 2) * CELL;
    const R = Math.max((b.x1 - b.x0) * CELL, 30) * 0.75 + 16;
    const geo = this.G.track(new THREE.CircleGeometry(R, 64));
    geo.rotateX(-Math.PI / 2);
    // 顶点色：两种地面颜色斑驳混合
    const pos = geo.attributes.position;
    const c1 = new THREE.Color(th.ground), c2 = new THREE.Color(th.groundAlt), tmp = new THREE.Color();
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = 0.5 + 0.5 * Math.sin(x * 0.35 + 1.3) * Math.sin(z * 0.41 + 0.7) * Math.sin((x + z) * 0.13);
      tmp.copy(c1).lerp(c2, n);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const tex = Tex.groundNoise();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(R / 3, R / 3);
    const mat = this.M.soft('#ffffff', { vc: true, rough: 0.95, rim: 0.05, map: tex });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.set(cx, 0, cz);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.ground = ground;
    if (th.groundIsCloud || th.id === 'sky') {
      // 云海：地面边缘堆满蓬松的云
      const puff = this.G.track(blobGeometry(1, 3, 0.06, 2));
      const n = 70;
      const im = new THREE.InstancedMesh(puff, this.M.soft('#ffffff', { rough: 0.95, rim: 0.6, rimColor: '#dbeeff' }), n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.rng.range(-0.05, 0.05);
        const r = R * this.rng.range(0.6, 0.98);
        const s = this.rng.range(1.2, 3.2);
        m.compose(new THREE.Vector3(cx + Math.cos(a) * r, -0.4 + this.rng.range(0, 0.6), cz + Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.6, s));
        im.setMatrixAt(i, m);
      }
      im.receiveShadow = true;
      this.group.add(im);
    }
    if (th.underwater) {
      // 海底的光柱
      const ray = this.G.track(new THREE.CylinderGeometry(0.6, 1.6, 16, 16, 1, true));
      const rm = this.M.basic('#e8fbff', { opacity: 0.07, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
      for (let i = 0; i < 9; i++) {
        const r = new THREE.Mesh(ray, rm);
        r.position.set(cx + this.rng.range(-20, 20), 7, cz + this.rng.range(-9, 3));
        r.rotation.z = 0.25; r.rotation.x = 0.1;
        r.userData.ph = this.rng.range(0, TAU);
        this.anims.push({ obj: r, kind: 'ray' });
        this.group.add(r);
      }
    }
  }

  // ---------------- 小路砖块（实例化，一次绘制） ----------------
  _buildTiles() {
    const th = this.theme;
    const cells = this.level.cells.filter((c) => !c.gap);
    const geo = this.G.track(tileGeometry(CELL * 0.9, 0.32));
    const mat = this.M.soft('#ffffff', { vc: true, rough: 0.6, rim: 0.3 });
    const im = new THREE.InstancedMesh(geo, mat, cells.length);
    im.receiveShadow = true;
    im.castShadow = true;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const surfColor = Object.fromEntries(th.surfaces.map((s) => [s.id, s.color]));
    this.tileIndex = new Map();
    this.tileJitter = {};
    this.tileRot = {};
    cells.forEach((c, i) => {
      const rot = this.rng.range(-0.06, 0.06);
      this.tileRot[c.id] = rot;
      m.compose(new THREE.Vector3(c.gx * CELL, TILE_TOP, c.gz * CELL), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
      const sc = surfColor[c.surface];
      col.set(sc || this.rng.pick(th.tile.top));
      if (c.kind === 'branch') col.offsetHSL(0, 0, -0.02);
      im.setColorAt(i, col);
      this.tileIndex.set(c.id, i);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.tiles = im;
    this.group.add(im);
    // 砖块侧边的颜色由顶点色决定：底下再垫一层深色"底座"让小路更立体
    const baseGeo = this.G.track(roundedBox(CELL * 0.94, 0.12, CELL * 0.94, 0.1, 2).translate(0, 0.02, 0));
    const base = new THREE.InstancedMesh(baseGeo, this.M.soft(th.tile.side, { rough: 0.8, rim: 0.1 }), cells.length);
    cells.forEach((c, i) => { m.compose(new THREE.Vector3(c.gx * CELL, 0.0, c.gz * CELL), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); base.setMatrixAt(i, m); });
    base.receiveShadow = true;
    this.group.add(base);
  }

  // 落地时砖块轻轻一沉（Q 弹的反馈）
  pressTile(id, amount = 1) {
    if (!this.tileIndex.has(id)) return;
    let s = this.tilePress.get(id);
    if (!s) { s = new Spring(300, 12, 0); this.tilePress.set(id, s); }
    s.v -= 0.9 * amount;
  }

  // ---------------- 小河（缺口） ----------------
  _buildGaps() {
    const th = this.theme;
    const pathCells = new Set(this.level.cells.filter((c) => !c.gap).map((c) => `${c.gx},${c.gz}`));
    for (const g of this.level.gaps) {
      const cells = g.cells.map((id) => this.cell(id));
      const x0 = Math.min(...cells.map((c) => c.gx)), x1 = Math.max(...cells.map((c) => c.gx));
      const z = cells[0].gz;
      // 小河只横穿这一段路：向两侧延伸，碰到别的路就停下（最多 5 格）
      const blockedAt = (zz) => { for (let x = x0 - 1; x <= x1 + 1; x++) if (pathCells.has(`${x},${zz}`)) return true; return false; };
      let up = 0.5, down = 0.5;
      for (let k = 1; k <= 5; k++) { if (blockedAt(z + k)) { up = k - 0.75; break; } up = k + 0.4; }
      for (let k = 1; k <= 5; k++) { if (blockedAt(z - k)) { down = k - 0.75; break; } down = k + 0.4; }
      up = Math.max(0.6, up); down = Math.max(0.6, down);
      const w = (x1 - x0 + 1) * CELL;
      const len = (up + down) * CELL;
      const geo = this.G.track(new THREE.PlaneGeometry(w, len, 1, 1));
      geo.rotateX(-Math.PI / 2);
      const mat = this.M.track(new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(th.liquid) }, uTime: { value: 0 }, uAlpha: { value: th.groundIsCloud ? 0.85 : 0.95 }, uLen: { value: len }, uWid: { value: w } }]),
        vertexShader: LIQ_VERT, fragmentShader: LIQ_FRAG, transparent: true, depthWrite: false, fog: true,
      }));
      this.uniforms.push(mat.uniforms);
      const mesh = new THREE.Mesh(geo, mat);
      const cz = (z + (up - down) / 2) * CELL;
      mesh.position.set(((x0 + x1) / 2) * CELL, 0.04, cz);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      // 两岸的小石头
      const stone = this.G.get('bankStone', () => blobGeometry(0.12, 2, 0.2, 1));
      const sm = this.M.soft(th.tile.side, { rough: 0.9 });
      const n = Math.round(len / 0.55);
      for (let k = 0; k < n * 2; k++) {
        const side = k % 2 ? -1 : 1;
        const s = new THREE.Mesh(stone, sm);
        const along = (Math.floor(k / 2) + this.rng.range(0.1, 0.9)) / n - 0.5;
        s.position.set(((x0 + x1) / 2) * CELL + side * (w / 2 + 0.02), 0.03, cz + along * (len - 0.6));
        s.scale.setScalar(this.rng.range(0.6, 1.3));
        s.receiveShadow = true;
        this.group.add(s);
      }
    }
  }

  // ---------------- 可踩物件 ----------------
  _buildItems() {
    const ctx = { M: this.M, G: this.G };
    for (const c of this.level.cells) {
      if (!c.item || c.gap) continue;
      const built = buildItem(c.item, ctx, this.rng, c);
      const p = this.cellXZ(c.id);
      p.y = this.cellTop(c.id);
      const inst = new ItemInstance(c.item, c, built, p);
      this.group.add(inst.obj);
      this.items.set(c.id, inst);
    }
  }

  // ---------------- 机关：星星、钥匙、小门、弹簧、起点、终点 ----------------
  _buildMechanics() {
    const lv = this.level;
    const M = this.M, G = this.G;
    // 星星
    this.starObjs = new Map();
    const starGeo = G.get('starCollect', () => starGeometry(0.28, 0.13, 0.1));
    const starMat = M.soft('#ffd84d', { emissive: '#ffb800', ei: 0.55, rim: 0.7, rimColor: '#fff6c2', rough: 0.3 });
    const haloMat = M.basic('#fff3a8', { map: Tex.soft(), opacity: 0.55, blending: THREE.AdditiveBlending });
    const haloGeo = G.get('halo', () => new THREE.PlaneGeometry(1.2, 1.2));
    for (const id of lv.stars) {
      const g = new THREE.Group();
      const s = new THREE.Mesh(starGeo, starMat); s.castShadow = true; g.add(s);
      const h = new THREE.Mesh(haloGeo, haloMat); h.renderOrder = 3; g.add(h);
      g.userData.halo = h;
      const p = this.cellXZ(id); p.y = this.cellTop(id) + 1.0;
      g.position.copy(p);
      g.userData.base = p.clone();
      this.group.add(g);
      this.starObjs.set(id, g);
    }
    // 钥匙
    if (lv.keyId != null) {
      const gold = M.soft('#ffd23f', { emissive: '#ffb300', ei: 0.4, rim: 0.7, rimColor: '#fff3b0', rough: 0.25 });
      const g = new THREE.Group();
      const ring = new THREE.Mesh(G.get('keyRing', () => new THREE.TorusGeometry(0.13, 0.045, 10, 24)), gold); ring.position.y = 0.16; g.add(ring);
      const heart = new THREE.Mesh(G.get('keyHeart', () => heartGeometry(0.07, 0.03)), M.soft('#ff6fa3', { emissive: '#ff6fa3', ei: 0.3 })); heart.position.set(0, 0.16, 0.0); g.add(heart);
      const shaft = new THREE.Mesh(G.get('keyShaft', () => new THREE.CylinderGeometry(0.035, 0.035, 0.36, 10)), gold); shaft.position.y = -0.13; g.add(shaft);
      const tooth = G.get('keyTooth', () => new THREE.BoxGeometry(0.1, 0.05, 0.05));
      for (let i = 0; i < 2; i++) { const t = new THREE.Mesh(tooth, gold); t.position.set(0.06, -0.24 + i * 0.09, 0); g.add(t); }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const h = new THREE.Mesh(haloGeo, haloMat); h.renderOrder = 3; g.add(h); g.userData.halo = h;
      const p = this.cellXZ(lv.keyId); p.y = this.cellTop(lv.keyId) + 1.0;
      g.position.copy(p); g.userData.base = p.clone();
      this.group.add(g);
      this.keyObj = g;
    }
    // 小门（可爱的栅栏 + 爱心锁）
    if (lv.gateId != null) {
      const id = lv.gateId;
      const c = this.cell(id);
      const prev = this.cell(lv.main[c.idx - 1]);
      const dirX = c.gx - prev.gx, dirZ = c.gz - prev.gz;
      const g = new THREE.Group();
      const wood = M.soft(this.theme.dark ? '#c9b8ff' : '#ffffff', { rough: 0.6, rim: 0.4 });
      const pink = M.soft('#ff8fb3', { rough: 0.5, rim: 0.4 });
      const post = G.get('gatePost', () => roundedBox(0.16, 1.0, 0.16, 0.05, 2).translate(0, 0.5, 0));
      const cap = G.get('gateCap', () => new THREE.SphereGeometry(0.11, 12, 10));
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(post, wood); p.position.set(0, 0, s * 0.62); p.castShadow = true; g.add(p);
        const k = new THREE.Mesh(cap, pink); k.position.set(0, 1.05, s * 0.62); k.castShadow = true; g.add(k);
      }
      const bars = new THREE.Group();
      const bar = G.get('gateBar', () => roundedBox(0.1, 0.12, 1.15, 0.05, 2));
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(bar, i === 1 ? pink : wood); b.position.y = 0.3 + i * 0.25; b.castShadow = true; bars.add(b); }
      const lock = new THREE.Mesh(G.get('lockHeart', () => heartGeometry(0.16, 0.08)), M.soft('#ffd23f', { emissive: '#ffb300', ei: 0.35, rim: 0.6 }));
      lock.position.set(0.08, 0.55, 0); lock.rotation.y = Math.PI / 2; lock.castShadow = true;
      bars.add(lock);
      g.add(bars);
      g.userData.bars = bars;
      const p = this.cellXZ(id); p.y = this.cellTop(id);
      // 门放在格子靠近来路的一侧，朝向行进方向
      g.position.set(p.x - dirX * CELL * 0.45, p.y, p.z - dirZ * CELL * 0.45);
      g.rotation.y = Math.atan2(dirX, dirZ) - Math.PI / 2;
      this.group.add(g);
      this.gateObj = g;
      this.gateOpenT = 0;
    }
    // 弹簧垫
    this.springs = new Map();
    for (const c of lv.cells) {
      if (!c.spring) continue;
      const g = new THREE.Group();
      const coil = G.get('coil', () => new THREE.TorusGeometry(0.2, 0.03, 8, 20).rotateX(Math.PI / 2));
      const cm = M.soft('#c9c9d6', { rough: 0.3, rim: 0.4 });
      for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(coil, cm); t.position.y = 0.03 + i * 0.04; g.add(t); }
      const pad = new THREE.Mesh(G.get('springPad', () => new THREE.CylinderGeometry(0.32, 0.32, 0.06, 24)), M.soft('#ff6b8b', { rough: 0.4, rim: 0.4 }));
      pad.position.y = 0.15; pad.castShadow = true; g.add(pad);
      const dot = new THREE.Mesh(G.get('springDot', () => new THREE.CircleGeometry(0.12, 16).rotateX(-Math.PI / 2)), M.basic('#ffffff'));
      dot.position.y = 0.185; g.add(dot);
      const p = this.cellXZ(c.id); p.y = this.cellTop(c.id);
      g.position.copy(p);
      this.group.add(g);
      this.springs.set(c.id, { obj: g, sq: new Spring(200, 7, 1) });
    }
    // 起点地垫
    {
      const id = lv.main[0];
      const mat = new THREE.Mesh(G.get('mat', () => roundedBox(0.9, 0.03, 0.9, 0.05, 2)), M.soft('#ffb3d1', { rough: 0.9 }));
      const p = this.cellXZ(id); mat.position.set(p.x, this.cellTop(id) + 0.015, p.z);
      mat.receiveShadow = true;
      this.group.add(mat);
      const paw = G.get('pawPad', () => new THREE.CircleGeometry(0.1, 16).rotateX(-Math.PI / 2));
      const toe = G.get('pawToe', () => new THREE.CircleGeometry(0.045, 12).rotateX(-Math.PI / 2));
      const pm = M.basic('#ffffff', { opacity: 0.9 });
      const a = new THREE.Mesh(paw, pm); a.position.set(p.x, this.cellTop(id) + 0.035, p.z + 0.05); this.group.add(a);
      for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(toe, pm); t.position.set(p.x - 0.1 + i * 0.1, this.cellTop(id) + 0.035, p.z - 0.12 - (i === 1 ? 0.03 : 0)); this.group.add(t); }
    }
    // 终点传送门
    {
      const id = lv.main[lv.main.length - 1];
      const g = new THREE.Group();
      const ringGeo = G.get('portalRing', () => {
        const t = new THREE.TorusGeometry(0.85, 0.12, 14, 48);
        const pos = t.attributes.position;
        const col = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) { const a = Math.atan2(pos.getY(i), pos.getX(i)); c.setHSL(((a / TAU) + 1) % 1, 0.75, 0.72); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        t.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return t;
      });
      const ring = new THREE.Mesh(ringGeo, M.soft('#ffffff', { vc: true, emissive: '#ffffff', ei: 0.15, rim: 0.6 }));
      ring.castShadow = true;
      g.add(ring);
      const discMat = M.track(new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } }, vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      this.uniforms.push(discMat.uniforms);
      this.portalUniforms = discMat.uniforms;
      const disc = new THREE.Mesh(G.get('portalDisc', () => new THREE.CircleGeometry(0.8, 48)), discMat);
      g.add(disc);
      const p = this.cellXZ(id);
      g.position.set(p.x + 0.2, this.cellTop(id) + 1.05, p.z);
      g.rotation.y = Math.PI / 2 - 0.5;
      this.group.add(g);
      this.portal = g;
      // 小旗子
      const flagPole = new THREE.Mesh(G.get('pole', () => new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8).translate(0, 0.8, 0)), M.soft('#ffffff'));
      flagPole.position.set(p.x - 0.45, this.cellTop(id), p.z - 0.5);
      this.group.add(flagPole);
      const flag = new THREE.Mesh(G.get('flag', () => new THREE.PlaneGeometry(0.5, 0.32, 6, 1).translate(0.25, 0, 0)), M.soft('#ff6fa3', { side: THREE.DoubleSide, rim: 0.2 }));
      flag.position.set(p.x - 0.45, this.cellTop(id) + 1.42, p.z - 0.5);
      this.group.add(flag);
      this.flag = flag;
    }
  }

  // ---------------- 装饰物（静态合批） ----------------
  _buildProps() {
    const buckets = { vc: [], glow: [], glossy: [] };
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const vcMat = this.M.soft('#ffffff', { vc: true, rough: 0.65, rim: 0.35 });
    for (const p of this.level.props) {
      const { parts, anim } = buildProp(p.type, this.rng);
      m4.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(p.s, p.s, p.s));
      if (anim) {
        // 会动的装饰物单独成组
        const g = new THREE.Group();
        for (const part of parts) {
          const mat = part.mat === 'vc' ? vcMat : part.mat === 'glow' ? this.M.basic(part.color, { fog: true }) : this.M.glossy(part.color, { opacity: 0.6 });
          const mesh = new THREE.Mesh(this.G.track(part.geo), mat);
          mesh.castShadow = true;
          g.add(mesh);
        }
        g.position.set(p.x, 0, p.z); g.rotation.y = p.rot; g.scale.setScalar(p.s);
        g.userData.ph = this.rng.range(0, TAU);
        g.userData.baseY = 0;
        this.anims.push({ obj: g, kind: anim });
        this.group.add(g);
        continue;
      }
      for (const part of parts) {
        const g = part.geo;
        g.applyMatrix4(m4);
        if (part.mat !== 'vc') {
          // 给发光/透明零件也写入顶点色
          col.set(part.color);
          let gg = g.index ? g.toNonIndexed() : g;
          if (gg !== g) g.dispose();
          for (const n of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(n)) gg.deleteAttribute(n);
          if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
          const c = new Float32Array(gg.attributes.position.count * 3);
          for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
          gg.setAttribute('color', new THREE.BufferAttribute(c, 3));
          buckets[part.mat].push(gg);
        } else buckets.vc.push(g);
      }
    }
    const make = (list, mat, shadow) => {
      if (!list.length) return;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) return;
      this.G.track(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadow; mesh.receiveShadow = shadow;
      this.group.add(mesh);
    };
    make(buckets.vc, vcMat, true);
    make(buckets.glow, this.M.track(new THREE.MeshBasicMaterial({ vertexColors: true })), false);
    make(buckets.glossy, this.M.track(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.62, roughness: 0.1, depthWrite: false })), false);
  }

  // ---------------- 地面小细节 ----------------
  _buildGroundBits() {
    const th = this.theme;
    const kind = th.groundBits?.kind;
    if (!kind) return;
    const colors = th.groundBits.colors;
    let geo;
    switch (kind) {
      case 'sprinkles': geo = new THREE.CapsuleGeometry(0.025, 0.09, 2, 6).rotateZ(Math.PI / 2); break;
      case 'pebbles': geo = blobGeometry(0.07, 2, 0.25, 1); break;
      case 'snowlumps': geo = blobGeometry(0.16, 3, 0.15, 1).scale(1, 0.45, 1); break;
      case 'grass': geo = new THREE.ConeGeometry(0.05, 0.22, 4).translate(0, 0.11, 0); break;
      case 'cloudlets': geo = blobGeometry(0.2, 4, 0.1, 1).scale(1, 0.5, 1); break;
      case 'confetti': geo = new THREE.BoxGeometry(0.1, 0.01, 0.06); break;
      case 'gems': geo = new THREE.OctahedronGeometry(0.06, 0); break;
      default: geo = new THREE.SphereGeometry(0.05, 6, 4);
    }
    this.G.track(geo);
    const b = this.level.bounds;
    const occupied = new Set(this.level.cells.map((c) => `${c.gx},${c.gz}`));
    const n = 360;
    const mat = kind === 'gems' ? this.M.basic('#ffffff') : this.M.soft('#ffffff', { rough: 0.7, rim: 0.2 });
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const x = this.rng.range(b.x0 - 6, b.x1 + 6) * CELL;
      const z = this.rng.range(b.z0 - 6, b.z1 + 3) * CELL;
      const gx = Math.round(x / CELL), gz = Math.round(z / CELL);
      if (occupied.has(`${gx},${gz}`)) continue;
      e.set(kind === 'grass' ? this.rng.range(-0.3, 0.3) : 0, this.rng.range(0, TAU), kind === 'grass' ? this.rng.range(-0.3, 0.3) : 0);
      q.setFromEuler(e);
      const s = this.rng.range(0.6, 1.4);
      m.compose(new THREE.Vector3(x, kind === 'cloudlets' || kind === 'snowlumps' ? 0.02 : 0.015, z), q, new THREE.Vector3(s, s, s));
      im.setMatrixAt(k, m);
      im.setColorAt(k, c.set(this.rng.pick(colors)));
      k++;
    }
    im.count = k;
    im.receiveShadow = true;
    this.group.add(im);
  }

  // ---------------- 机关交互 ----------------
  collectStar(id) {
    const g = this.starObjs.get(id);
    if (!g || this.collectedStars.has(id)) return false;
    this.collectedStars.add(id);
    g.userData.collectT = 0;
    return true;
  }
  collectKey() {
    if (!this.keyObj || this.hasKey) return false;
    this.hasKey = true;
    this.keyObj.userData.collectT = 0;
    return true;
  }
  openGate() {
    if (!this.gateObj || this.gateOpen) return false;
    this.gateOpen = true;
    this.gateOpenT = 0.0001;
    return true;
  }
  bounceSpring(id) { const s = this.springs.get(id); if (s) { s.sq.x = 0.4; s.sq.v = 0; } }
  openPortal() { this.portalOpen = true; }

  // ---------------- 每帧更新 ----------------
  update(dt, petPos, camPos) {
    this.t += dt;
    const t = this.t;
    for (const u of this.uniforms) if (u.uTime) u.uTime.value = t;
    if (this.portalUniforms) this.portalUniforms.uOpen.value = Math.min(1, this.portalUniforms.uOpen.value + (this.portalOpen ? dt : 0));
    // 天空跟随镜头
    if (camPos) this.sky.position.copy(camPos);
    // 阳光与阴影跟随糯糯
    if (petPos) {
      this.sun.position.copy(petPos).add(this.sunOffset);
      this.sun.target.position.copy(petPos);
      if (this.petLight) this.petLight.position.set(petPos.x, petPos.y + 1.6, petPos.z + 0.6);
    }
    for (const it of this.items.values()) it.update(dt);
    // 星星/钥匙：旋转 + 浮动；被收集时飞起变小
    const bob = (g, ph) => {
      const b = g.userData.base;
      if (g.userData.collectT != null) {
        g.userData.collectT += dt;
        const u = g.userData.collectT / 0.6;
        g.position.y = b.y + ease.outCubic(Math.min(1, u)) * 1.6;
        g.scale.setScalar(Math.max(0.001, 1 - u));
        g.rotation.y += dt * 18;
        if (u >= 1) g.visible = false;
        return;
      }
      g.position.y = b.y + Math.sin(t * 2 + ph) * 0.1;
      g.rotation.y = t * 1.8 + ph;
      if (g.userData.halo) { g.userData.halo.rotation.y = -g.rotation.y; g.userData.halo.lookAt(camPos || g.position); }
    };
    let i = 0;
    for (const g of this.starObjs.values()) bob(g, i++);
    if (this.keyObj) bob(this.keyObj, 5);
    // 门打开：栅栏沉入地下
    if (this.gateObj && this.gateOpenT > 0) {
      this.gateOpenT = Math.min(1, this.gateOpenT + dt * 1.2);
      const bars = this.gateObj.userData.bars;
      bars.position.y = -ease.inOutQuad(this.gateOpenT) * 1.0;
      bars.scale.y = 1 - this.gateOpenT * 0.6;
      if (this.gateOpenT >= 1) bars.visible = false;
    }
    // 弹簧
    if (this.springs) for (const s of this.springs.values()) { const v = s.sq.update(dt); s.obj.scale.set(1, clamp(v, 0.3, 1.6), 1); }
    // 砖块按压
    if (this.tilePress.size) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      for (const [id, s] of this.tilePress) {
        const v = s.update(dt);
        const c = this.cell(id);
        q.setFromAxisAngle(up, this.tileRot[id] || 0);
        m.compose(new THREE.Vector3(c.gx * CELL, TILE_TOP + v * 0.06, c.gz * CELL), q, new THREE.Vector3(1, 1 + v * 0.05, 1));
        this.tiles.setMatrixAt(this.tileIndex.get(id), m);
        if (Math.abs(v) < 0.001 && Math.abs(s.v) < 0.01) {
          m.compose(new THREE.Vector3(c.gx * CELL, TILE_TOP, c.gz * CELL), q, new THREE.Vector3(1, 1, 1));
          this.tiles.setMatrixAt(this.tileIndex.get(id), m);
          this.tilePress.delete(id);
        }
      }
      this.tiles.instanceMatrix.needsUpdate = true;
    }
    // 传送门转动、旗子飘动
    if (this.portal) this.portal.children[0].rotation.z = t * 0.6;
    if (this.flag) this.flag.rotation.y = Math.sin(t * 3) * 0.25;
    // 动画装饰物
    for (const a of this.anims) {
      const o = a.obj, ph = o.userData.ph || 0;
      if (a.kind === 'sway') { o.rotation.z = Math.sin(t * 1.3 + ph) * 0.12; o.rotation.x = Math.cos(t * 1.1 + ph) * 0.06; }
      else if (a.kind === 'bob') o.position.y = Math.sin(t * 0.8 + ph) * 0.18;
      else if (a.kind === 'spin') o.rotation.y = t * 0.8 + ph;
      else if (a.kind === 'ray') o.material.opacity = 0.05 + 0.03 * Math.sin(t * 0.5 + ph);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    this.M.dispose();
    this.G.dispose();
    this.items.clear();
    this.anims = [];
    this.scene.fog = null;
  }
}
