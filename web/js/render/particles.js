// 高性能粒子系统：每种贴图一个 Points 对象，对象池复用，长时间运行无内存增长。
import * as THREE from 'three';
import { Tex } from './textures.js';
import { rand, TAU } from '../core/util.js';

const VERT = `
attribute float aSize;
attribute vec4 aColor;
attribute float aRot;
varying vec4 vColor;
varying float vRot;
uniform float uScale;
void main() {
  vColor = aColor;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying vec4 vColor;
varying float vRot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot), co = cos(vRot);
  vec2 uv = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
  uv.y = 1.0 - uv.y;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 t = texture2D(map, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

const KINDS = {
  soft: { tex: 'soft', add: true },
  sparkle: { tex: 'sparkle', add: true },
  star: { tex: 'star', add: false },
  heart: { tex: 'heart', add: false },
  note: { tex: 'note', add: false },
  leaf: { tex: 'leaf', add: false },
  snow: { tex: 'snow', add: false },
  bubble: { tex: 'bubble', add: false },
  crumb: { tex: 'crumb', add: false },
  dot: { tex: 'dot', add: false },
  zzz: { tex: 'zzz', add: false },
  exclaim: { tex: 'exclaim', add: false },
  question: { tex: 'question', add: false },
  ring: { tex: 'ring', add: false },
};

class Pool {
  constructor(kind, cap, scene, uniforms) {
    this.cap = cap;
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.col = new Float32Array(cap * 4);
    this.rot = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    const def = KINDS[kind];
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: Tex[def.tex]() }, uScale: uniforms.uScale },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: def.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.p = []; // 活动粒子数据
  }
  spawn(o) {
    if (this.p.length >= this.cap) this.p.shift();
    this.p.push(o);
  }
  update(dt) {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i];
      q.age += dt;
      if (q.age >= q.life) continue;
      q.vy -= q.grav * dt;
      const d = Math.exp(-q.drag * dt);
      q.vx *= d; q.vy *= d; q.vz *= d;
      q.x += q.vx * dt + (q.sway ? Math.sin(q.age * q.swayF + q.ph) * q.sway * dt : 0);
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      if (q.floor != null && q.y < q.floor) { q.y = q.floor; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      q.r += q.vr * dt;
      p[w++] = q;
    }
    p.length = w;
    const n = Math.min(w, this.cap);
    for (let i = 0; i < n; i++) {
      const q = p[i];
      const u = q.age / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      const pop = q.popIn ? Math.min(1, q.age / q.popIn) : 1;
      this.size[i] = (q.s0 + (q.s1 - q.s0) * u) * (q.popIn ? 0.4 + 0.6 * easeOutBack(pop) : 1);
      const fadeIn = q.fadeIn ? Math.min(1, q.age / q.fadeIn) : 1;
      const fadeOut = u > q.fadeStart ? 1 - (u - q.fadeStart) / (1 - q.fadeStart) : 1;
      this.col[i * 4] = q.cr; this.col[i * 4 + 1] = q.cg; this.col[i * 4 + 2] = q.cb;
      this.col[i * 4 + 3] = q.a * fadeIn * fadeOut;
      this.rot[i] = q.r;
    }
    this.geo.setDrawRange(0, n);
    if (n || this._lastN) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aRot.needsUpdate = true;
    }
    this._lastN = n;
  }
  clear() { this.p.length = 0; }
  dispose(scene) { scene.remove(this.points); this.geo.dispose(); this.mat.dispose(); }
}

function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

const tmpColor = new THREE.Color();

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = { uScale: { value: 500 } };
    this.pools = {};
    for (const k of Object.keys(KINDS)) this.pools[k] = new Pool(k, k === 'soft' || k === 'dot' ? 600 : 300, scene, this.uniforms);
  }
  setScale(heightPx, fovDeg) {
    this.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }
  emit(kind, o) {
    const pool = this.pools[kind];
    if (!pool) return;
    tmpColor.set(o.color || '#ffffff');
    pool.spawn({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      grav: o.grav ?? 0, drag: o.drag ?? 0.5,
      age: 0, life: o.life ?? 1,
      s0: o.size ?? 0.3, s1: o.size1 ?? (o.size ?? 0.3),
      cr: tmpColor.r, cg: tmpColor.g, cb: tmpColor.b, a: o.alpha ?? 1,
      r: o.rot ?? 0, vr: o.vr ?? 0,
      fadeIn: o.fadeIn ?? 0, fadeStart: o.fadeStart ?? 0.6,
      sway: o.sway || 0, swayF: o.swayF || 2, ph: Math.random() * TAU,
      floor: o.floor ?? null, popIn: o.popIn || 0,
    });
  }

  // ---- 预设特效 ----
  burst(preset, x, y, z, o = {}) {
    const colors = o.colors || [o.color || '#ffffff'];
    const col = () => colors[Math.floor(Math.random() * colors.length)];
    const k = o.scale || 1;
    switch (preset) {
      case 'crumbs':
        for (let i = 0; i < (o.count || 14); i++) {
          const a = rand(0, TAU), sp = rand(0.8, 2.4) * k;
          this.emit('crumb', { x, y: y + 0.1, z, vx: Math.cos(a) * sp, vy: rand(1.5, 3.5) * k, vz: Math.sin(a) * sp, grav: 9, drag: 0.4, life: rand(0.6, 1.0), size: rand(0.08, 0.16) * k, color: col(), vr: rand(-8, 8), floor: (o.floor ?? 0) + 0.02, fadeStart: 0.7 });
        }
        break;
      case 'snow':
        for (let i = 0; i < (o.count || 16); i++) {
          const a = rand(0, TAU), sp = rand(0.6, 1.8) * k;
          this.emit('snow', { x, y: y + 0.1, z, vx: Math.cos(a) * sp, vy: rand(1.5, 3) * k, vz: Math.sin(a) * sp, grav: 5, drag: 1.2, life: rand(0.8, 1.3), size: rand(0.12, 0.22) * k, color: col(), vr: rand(-3, 3), floor: o.floor ?? 0, sway: 0.4 });
        }
        break;
      case 'leaves':
        for (let i = 0; i < (o.count || 10); i++) {
          const a = rand(0, TAU), sp = rand(0.6, 1.6) * k;
          this.emit('leaf', { x, y: y + 0.1, z, vx: Math.cos(a) * sp, vy: rand(2, 3.5) * k, vz: Math.sin(a) * sp, grav: 3.5, drag: 1.6, life: rand(1.0, 1.6), size: rand(0.18, 0.3) * k, color: col(), vr: rand(-5, 5), floor: o.floor ?? 0, sway: 1.2, swayF: 4 });
        }
        break;
      case 'water':
        for (let i = 0; i < (o.count || 18); i++) {
          const a = rand(0, TAU), sp = rand(0.5, 2) * k;
          this.emit('dot', { x, y: y + 0.05, z, vx: Math.cos(a) * sp, vy: rand(2.5, 4.5) * k, vz: Math.sin(a) * sp, grav: 12, drag: 0.2, life: rand(0.4, 0.7), size: rand(0.06, 0.12) * k, color: col(), alpha: 0.85 });
        }
        break;
      case 'bubbles':
        for (let i = 0; i < (o.count || 8); i++) {
          this.emit('bubble', { x: x + rand(-0.3, 0.3), y: y + rand(0, 0.3), z: z + rand(-0.3, 0.3), vx: rand(-0.2, 0.2), vy: rand(0.6, 1.4) * k, vz: rand(-0.2, 0.2), grav: -0.5, drag: 0.8, life: rand(1.2, 2.2), size: rand(0.12, 0.3) * k, color: col(), sway: 0.5, swayF: 3, popIn: 0.15 });
        }
        break;
      case 'sparkles':
        for (let i = 0; i < (o.count || 12); i++) {
          const a = rand(0, TAU), sp = rand(0.5, 2) * k;
          this.emit('sparkle', { x, y: y + rand(0.1, 0.6), z, vx: Math.cos(a) * sp, vy: rand(0.5, 2.5) * k, vz: Math.sin(a) * sp, grav: 1.5, drag: 1.5, life: rand(0.5, 1.0), size: rand(0.18, 0.36) * k, size1: 0.04, color: col(), alpha: 0.8, vr: rand(-2, 2), fadeStart: 0.3 });
        }
        break;
      case 'stars':
        for (let i = 0; i < (o.count || 10); i++) {
          const a = rand(0, TAU), sp = rand(1, 3) * k;
          this.emit('star', { x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rand(2, 4) * k, vz: Math.sin(a) * sp, grav: 4, drag: 1, life: rand(0.8, 1.4), size: rand(0.2, 0.35) * k, color: col(), vr: rand(-6, 6), popIn: 0.1 });
        }
        break;
      case 'hearts':
        for (let i = 0; i < (o.count || 6); i++) {
          this.emit('heart', { x: x + rand(-0.4, 0.4), y: y + rand(0.3, 0.8), z: z + rand(-0.2, 0.2), vx: rand(-0.4, 0.4), vy: rand(0.8, 1.6) * k, vz: rand(-0.2, 0.2), grav: -0.3, drag: 0.6, life: rand(1.2, 2.0), size: rand(0.25, 0.42) * k, color: col(), rot: rand(-0.3, 0.3), sway: 0.6, swayF: 3, popIn: 0.2 });
        }
        break;
      case 'notes':
        for (let i = 0; i < (o.count || 3); i++) {
          this.emit('note', { x: x + rand(-0.3, 0.3), y: y + rand(0.4, 0.8), z, vx: rand(-0.5, 0.5), vy: rand(0.8, 1.4), vz: 0, grav: -0.2, drag: 0.5, life: rand(1.0, 1.6), size: rand(0.3, 0.42) * k, color: col(), rot: rand(-0.4, 0.4), sway: 0.5, popIn: 0.15 });
        }
        break;
      case 'confetti':
        for (let i = 0; i < (o.count || 40); i++) {
          const a = rand(0, TAU), sp = rand(1, 4) * k;
          this.emit(Math.random() < 0.5 ? 'crumb' : 'star', { x, y: y + 0.5, z, vx: Math.cos(a) * sp, vy: rand(3, 7) * k, vz: Math.sin(a) * sp, grav: 5, drag: 1.2, life: rand(1.5, 2.5), size: rand(0.12, 0.24) * k, color: col(), vr: rand(-10, 10), sway: 0.8, swayF: 5, floor: o.floor ?? 0 });
        }
        break;
      case 'fluff':
        for (let i = 0; i < (o.count || 10); i++) {
          const a = rand(0, TAU), sp = rand(0.3, 1.0) * k;
          this.emit('soft', { x, y: y + 0.1, z, vx: Math.cos(a) * sp, vy: rand(0.4, 1.2) * k, vz: Math.sin(a) * sp, grav: 0.2, drag: 2, life: rand(0.8, 1.4), size: rand(0.3, 0.6) * k, size1: 0.9 * k, color: col(), alpha: 0.6 });
        }
        break;
      case 'spores':
        for (let i = 0; i < (o.count || 14); i++) {
          const a = rand(0, TAU), sp = rand(0.3, 1.2) * k;
          this.emit('soft', { x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rand(0.5, 1.5), vz: Math.sin(a) * sp, grav: -0.1, drag: 1.5, life: rand(1.2, 2.0), size: rand(0.1, 0.2) * k, color: col(), alpha: 0.9, sway: 0.5 });
        }
        break;
      case 'ring':
        this.emit('ring', { x, y: y + 0.03, z, life: o.life || 0.7, size: 0.3 * k, size1: 2.2 * k, color: col(), alpha: 0.8, fadeStart: 0.2 });
        break;
      case 'poof':
        for (let i = 0; i < (o.count || 12); i++) {
          const a = rand(0, TAU), sp = rand(1, 2.5) * k;
          this.emit('soft', { x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rand(0, 1.2), vz: Math.sin(a) * sp, grav: -0.3, drag: 3, life: rand(0.6, 1.0), size: rand(0.4, 0.8) * k, size1: 1.2 * k, color: col(), alpha: 0.7, fadeStart: 0.3 });
        }
        break;
      case 'emote':
        this.emit(o.kind || 'exclaim', { x, y, z, vy: 0.4, drag: 2, life: o.life || 1.4, size: 0.55 * k, color: '#ffffff', popIn: 0.2, fadeStart: 0.75 });
        break;
      case 'zzz':
        for (let i = 0; i < 3; i++) this.emit('zzz', { x: x + i * 0.12, y: y + i * 0.1, z, vx: 0.15, vy: 0.35, drag: 0.3, life: 2.2, size: 0.18 + i * 0.07, color: '#9fb4ff', fadeIn: i * 0.5 + 0.1, fadeStart: 0.6, sway: 0.3 });
        break;
      default:
        break;
    }
  }

  // 环境飘浮粒子（雪花、泡泡、萤火、花瓣），围绕镜头持续生成
  ambient(type, cx, cz, dt, o = {}) {
    if (!type) return;
    this._acc = (this._acc || 0) + dt * (o.rate || 10);
    while (this._acc >= 1) {
      this._acc -= 1;
      const x = cx + rand(-14, 14), z = cz + rand(-12, 8);
      const colors = o.colors || ['#ffffff'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      if (type === 'snow') this.emit('snow', { x, y: rand(6, 9), z, vx: rand(-0.2, 0.2), vy: -rand(0.5, 1.0), drag: 0, life: 9, size: rand(0.08, 0.2), color, sway: 0.4, vr: rand(-1, 1), fadeIn: 0.8, fadeStart: 0.85 });
      else if (type === 'bubbles') this.emit('bubble', { x, y: rand(-0.5, 1), z, vy: rand(0.4, 0.9), drag: 0, life: 9, size: rand(0.08, 0.3), color, sway: 0.5, fadeIn: 0.5, fadeStart: 0.85 });
      else if (type === 'fireflies') this.emit('soft', { x, y: rand(0.4, 3), z, vx: rand(-0.2, 0.2), vy: rand(-0.1, 0.1), vz: rand(-0.2, 0.2), drag: 0, life: rand(4, 7), size: rand(0.12, 0.22), color, sway: 0.6, fadeIn: 1.5, fadeStart: 0.6 });
      else if (type === 'petals') this.emit('leaf', { x, y: rand(5, 8), z, vx: rand(0.2, 0.6), vy: -rand(0.4, 0.8), drag: 0, life: 10, size: rand(0.12, 0.2), color, sway: 0.8, swayF: 2, vr: rand(-2, 2), fadeIn: 0.8, fadeStart: 0.85 });
      else if (type === 'sparkle') this.emit('sparkle', { x, y: rand(0.5, 5), z, drag: 0, life: rand(1.5, 3), size: rand(0.12, 0.3), size1: 0.02, color, vr: rand(-1, 1), fadeIn: 0.6, fadeStart: 0.5 });
      else if (type === 'dust') this.emit('soft', { x, y: rand(0.3, 4), z, vx: rand(-0.1, 0.1), vy: rand(-0.05, 0.1), drag: 0, life: rand(5, 8), size: rand(0.05, 0.12), color, alpha: 0.6, sway: 0.2, fadeIn: 1.5, fadeStart: 0.6 });
    }
  }

  update(dt) { for (const k in this.pools) this.pools[k].update(dt); }
  clear() { for (const k in this.pools) this.pools[k].clear(); }
  count() { let n = 0; for (const k in this.pools) n += this.pools[k].p.length; return n; }
}
