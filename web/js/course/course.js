// 解压赛道：一条桌面微缩赛道（沿 +x 方向），上面依次摆着若干"解压站"和最后的巨型终点解压物。
// 负责环境（天空、灯光、地面、装饰物）、站点布局、地面高度查询，以及每关结束时彻底释放 GPU 资源。
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';
import { MaterialBank } from '../render/materials.js';
import { Tex } from '../render/textures.js';
import { GeoBank, roundedBox } from '../world/geo.js';
import { buildProp } from '../world/props.js';
import { createStation } from './stations.js';
import { Rng, TAU, clamp } from '../core/util.js';

export const PATH_Y = 0.035; // 小路（软垫）的表面高度
const GAP = 0.85;            // 站与站之间的软垫长度
const PATH_W = 2.0;

const SKY_VERT = `
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; uniform float uTime;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(cMid, cTop, smoothstep(0.0, 0.65, h)) : mix(cMid, cBot, smoothstep(0.0, -0.35, h));
  c += 0.02 * sin(vDir.x * 6.0 + uTime * 0.05) * (1.0 - abs(h));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

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
    this.stations = [];
  }

  build() {
    const st = this.stage;
    this._buildSky();
    this._buildLights();
    // ---- 站点布局 ----
    const ctx = { M: this.M, G: this.G, rng: this.rng, stage: st };
    let x = 2.2; // 起点软垫
    const defs = st.stations.map((d) => ({ ...d }));
    // 每关站点顺序轻微打乱（首站固定，保证开场就是本关招牌材质）
    for (let i = defs.length - 1; i > 1; i--) { const j = 1 + this.rng.int(0, i - 1); [defs[i], defs[j]] = [defs[j], defs[i]]; }
    defs.push({ ...st.finale });
    defs.forEach((d, i) => {
      const s = createStation(ctx, d);
      s.index = i;
      s.finale = !!d.finale;
      if (i > 0) x += d.finale ? GAP + 0.4 : GAP;
      s.x0 = x;
      s.x1 = x + s.length;
      s.group.position.set(x, PATH_Y - 0.02, 0);
      this.group.add(s.group);
      this.stations.push(s);
      x = s.x1;
    });
    this.length = x + 2.4;
    this.start = new THREE.Vector3(0.9, PATH_Y, 0);
    this.end = new THREE.Vector3(this.length - 1.0, PATH_Y, 0);
    this._buildGround();
    this._buildPath();
    this._buildProps();
    this.group.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshPhysicalMaterial) o.material.envMapIntensity = o.material.envMapIntensity ?? 1; });
    this.scene.add(this.group);
    this.scene.fog = new THREE.Fog(new THREE.Color(st.fog), st.fogRange[0], st.fogRange[1]);
    this.scene.background = new THREE.Color(st.sky[1]);
    return this;
  }

  // ---------------- 查询 ----------------
  stationAt(x, z = 0, margin = 0) {
    for (const s of this.stations) if (x >= s.x0 - margin && x <= s.x1 + margin && Math.abs(z) <= s.width / 2 + margin) return s;
    return null;
  }
  // 世界坐标 (x,z) 处糯糯脚下的高度
  yAt(x, z) {
    const s = this.stationAt(x, z);
    if (!s) return PATH_Y;
    const lx = x - s.x0, lz = z;
    return s.group.position.y + s.topY(clamp(lx, 0, s.length), clamp(lz, -s.width / 2, s.width / 2));
  }
  local(s, x, z) { return { x: x - s.x0, z }; }
  world(s, lx, lz, ly = 0) { return new THREE.Vector3(s.x0 + lx, s.group.position.y + ly, lz); }
  progress() {
    const n = this.stations.length;
    let p = 0;
    for (const s of this.stations) p += s.done ? 1 : Math.min(0.95, s.progress ? s.progress() : 0);
    return p / n;
  }

  // ---------------- 环境 ----------------
  _buildSky() {
    const st = this.stage;
    const geo = this.G.track(new THREE.SphereGeometry(140, 32, 16));
    const mat = this.M.track(new THREE.ShaderMaterial({
      uniforms: { cTop: { value: new THREE.Color(st.sky[0]) }, cMid: { value: new THREE.Color(st.sky[1]) }, cBot: { value: new THREE.Color(st.sky[2]) }, uTime: { value: 0 } },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.uniforms.push(mat.uniforms);
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);
  }

  _buildLights() {
    const st = this.stage;
    // 环境光压低一些、太阳更强：画面更有立体感（材质上的凹凸、反光看得清）
    this.hemi = new THREE.HemisphereLight(new THREE.Color(st.hemi[0]), new THREE.Color(st.hemi[1]), st.hemi[2] * 0.8);
    this.group.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, st.ambient * 0.6);
    this.group.add(this.amb);
    const sun = new THREE.DirectionalLight(new THREE.Color(st.sun[0]), st.sun[1] * 1.15);
    sun.castShadow = true;
    const q = this.opts.shadowSize || 2048;
    sun.shadow.mapSize.set(q, q);
    const S = 5;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(-5, 7.5, 6); // 偏低的阳光：脚印、坑、沟的凹凸看得更清楚
    this.group.add(sun);
    this.group.add(sun.target);
  }

  _buildGround() {
    const st = this.stage;
    const cx = this.length / 2;
    const R = this.length * 0.6 + 26;
    const geo = this.G.track(new THREE.CircleGeometry(R, 72));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const c1 = new THREE.Color(st.ground), c2 = new THREE.Color(st.groundAlt), tmp = new THREE.Color();
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = 0.5 + 0.5 * Math.sin(x * 0.35 + 1.3) * Math.sin(z * 0.41 + 0.7) * Math.sin((x + z) * 0.13);
      tmp.copy(c1).lerp(c2, n);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const tex = this.M.track(Tex.groundNoise().clone()); // 共享贴图的副本：各自设置平铺次数
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(R / 3, R / 3);
    const ground = new THREE.Mesh(geo, this.M.soft('#ffffff', { vc: true, rough: 0.95, rim: 0.05, map: tex }));
    ground.position.set(cx, -0.02, 0);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  // 一条长长的软垫小路（像桌面上的绒布跑道）
  _buildPath() {
    const st = this.stage;
    const L = this.length;
    const geo = this.G.track(roundedBox(L, 0.05, PATH_W, 0.025, 3).translate(L / 2, -0.01, 0));
    const tex = this.M.track(Tex.groundNoise().clone());
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(L / 1.5, 1.2);
    const mat = this.M.soft(st.path, { rough: 0.98, rim: 0.15, map: tex });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.group.add(m);
    // 两侧的缝线小圆点（让跑道更像精致的手工垫子）
    const dot = this.G.track(new THREE.SphereGeometry(0.022, 6, 4));
    const n = Math.floor(L / 0.32) * 2;
    const im = new THREE.InstancedMesh(dot, this.M.soft(st.pathSide, { rough: 0.8 }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1; m4.makeTranslation(0.15 + Math.floor(i / 2) * 0.32, 0.015, side * (PATH_W / 2 - 0.07)); im.setMatrixAt(i, m4); }
    this.group.add(im);
  }

  _buildProps() {
    const st = this.stage;
    const list = [];
    const L = this.length;
    // 背景一侧（-z）：大一些、密一些；镜头一侧（+z）：远、少、小，绝不挡住糯糯
    for (let x = -5; x < L + 6; x += this.rng.range(1.6, 2.8)) {
      list.push({ type: this.rng.pick(st.props), x: x + this.rng.range(-0.5, 0.5), z: -this.rng.range(2.4, 4.2), s: this.rng.range(0.7, 1.15), rot: this.rng.range(0, TAU) });
      if (this.rng.next() < 0.7) list.push({ type: this.rng.pick(st.props), x: x + this.rng.range(-0.8, 0.8), z: -this.rng.range(5, 9), s: this.rng.range(0.9, 1.5), rot: this.rng.range(0, TAU) });
      if (this.rng.next() < 0.35) list.push({ type: this.rng.pick(st.props), x: x + this.rng.range(-0.8, 0.8), z: this.rng.range(6.5, 10), s: this.rng.range(0.5, 0.8), rot: this.rng.range(0, TAU) });
    }
    const buckets = { vc: [], glow: [], glossy: [] };
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const vcMat = this.M.soft('#ffffff', { vc: true, rough: 0.65, rim: 0.35 });
    for (const p of list) {
      const { parts, anim } = buildProp(p.type, this.rng);
      m4.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(p.s, p.s, p.s));
      if (anim) {
        const g = new THREE.Group();
        for (const part of parts) {
          const mat = part.mat === 'vc' ? vcMat : part.mat === 'glow' ? this.M.basic(part.color, { fog: true }) : this.M.glossy(part.color, { opacity: 0.6 });
          const mesh = new THREE.Mesh(this.G.track(part.geo), mat);
          mesh.castShadow = true;
          g.add(mesh);
        }
        g.position.set(p.x, 0, p.z); g.rotation.y = p.rot; g.scale.setScalar(p.s);
        g.userData.ph = this.rng.range(0, TAU);
        this.anims.push({ obj: g, kind: anim });
        this.group.add(g);
        continue;
      }
      for (const part of parts) {
        const g = part.geo;
        g.applyMatrix4(m4);
        if (part.mat !== 'vc') {
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
    const make = (lst, mat, shadow) => {
      if (!lst.length) return;
      const merged = mergeGeometries(lst, false);
      for (const g of lst) g.dispose();
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

  // ---------------- 每帧 ----------------
  update(dt, petPos, camPos) {
    this.t += dt;
    const t = this.t;
    for (const u of this.uniforms) if (u.uTime) u.uTime.value = t;
    if (camPos) this.sky.position.copy(camPos);
    if (petPos) { this.sun.position.copy(petPos).add(this.sunOffset); this.sun.target.position.copy(petPos); }
    // 只更新镜头附近的站点（省电）
    for (const s of this.stations) if (!petPos || Math.abs((s.x0 + s.x1) / 2 - petPos.x) < 9) s.update(dt);
    for (const a of this.anims) {
      const o = a.obj, ph = o.userData.ph || 0;
      if (a.kind === 'sway') { o.rotation.z = Math.sin(t * 1.3 + ph) * 0.12; o.rotation.x = Math.cos(t * 1.1 + ph) * 0.06; }
      else if (a.kind === 'bob') o.position.y = Math.sin(t * 0.8 + ph) * 0.18;
      else if (a.kind === 'spin') o.rotation.y = t * 0.8 + ph;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.sun) this.sun.dispose();
    for (const s of this.stations) { try { s.dispose(); } catch {} }
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    this.M.dispose();
    this.G.dispose();
    this.stations = [];
    this.anims = [];
    this.scene.fog = null;
  }
}
