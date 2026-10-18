// 场景装饰物（不可踩，只负责好看）。全部用顶点色合并成单一几何体，世界构建时再按材质合批，
// 几十上百个装饰物只需要几次绘制调用，长时间直播也不卡。
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';
import { roundedBox, starGeometry, blobGeometry, scallopGeometry } from './geo.js';
import { TAU } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RAINBOW = ['#ff7f9e', '#ffa86b', '#ffd95c', '#8fe07a', '#6fd0ff', '#8f9bff', '#c58fff'];

// 零件：{ geo, color, pos, rot, scale }
function part(geo, color, pos = V(0, 0, 0), rot = [0, 0, 0], scale = null) { return { geo, color, pos, rot, scale }; }

export function bake(parts) {
  const geos = [];
  const col = new THREE.Color();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const s = p.scale == null ? V(1, 1, 1) : typeof p.scale === 'number' ? V(p.scale, p.scale, p.scale) : p.scale;
    g.applyMatrix4(new THREE.Matrix4().compose(p.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rot)), s));
    col.set(p.color);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geos.push(g);
    p.geo.dispose();
  }
  const m = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return m;
}

const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 16) => new THREE.ConeGeometry(r, h, s);

/**
 * 返回 { parts: [{geo, mat:'vc'|'glow'|'glossy', color?}], anim?: 'sway'|'bob'|'spin' }
 * 坐标原点在地面。
 */
export function buildProp(type, rng) {
  const P = [];   // 普通顶点色零件
  const GL = [];  // 发光零件
  const GS = [];  // 半透明零件
  let anim = null;
  const pick = (a) => rng.pick(a);
  switch (type) {
    // ---------- 糖果 ----------
    case 'lollipop': {
      const c = pick(['#ff6fa3', '#7fd6ff', '#ffd23f', '#a58bff']);
      P.push(part(cyl(0.035, 0.035, 1.2, 8), '#ffffff', V(0, 0.6, 0)));
      P.push(part(cyl(0.34, 0.34, 0.1, 28), c, V(0, 1.35, 0), [Math.PI / 2, 0, 0]));
      P.push(part(new THREE.TorusGeometry(0.22, 0.04, 8, 28), '#ffffff', V(0, 1.35, 0.055)));
      P.push(part(new THREE.TorusGeometry(0.1, 0.035, 8, 20), '#ffffff', V(0, 1.35, 0.055)));
      break;
    }
    case 'candy_cane': {
      const c = pick(['#ff5c7a', '#5cc85c', '#5c9cff']);
      for (let i = 0; i < 8; i++) P.push(part(cyl(0.07, 0.07, 0.15, 12), i % 2 ? '#ffffff' : c, V(0, 0.075 + i * 0.15, 0)));
      const arc = new THREE.TorusGeometry(0.2, 0.07, 10, 20, Math.PI);
      P.push(part(arc, c, V(0.2, 1.2, 0)));
      break;
    }
    case 'gumdrop': {
      const c = pick(['#ff7fb8', '#7fe0a8', '#ffb35c', '#9f8fff', '#ffe066']);
      P.push(part(new THREE.LatheGeometry([0, 0.3, 0.32, 0.3, 0.2, 0].map((x, i) => new THREE.Vector2(x, [0, 0, 0.1, 0.3, 0.42, 0.46][i])), 24), c));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; P.push(part(sph(0.03, 6, 4), '#ffffff', V(Math.cos(a) * 0.22, 0.3, Math.sin(a) * 0.22))); }
      break;
    }
    case 'candy_tree': {
      P.push(part(cyl(0.07, 0.1, 1.0, 10), '#f2c6a0', V(0, 0.5, 0)));
      const c = pick(['#ffc2e0', '#c9e8ff', '#e2c9ff']);
      for (let i = 0; i < 6; i++) { const a = i * 1.1; P.push(part(blobGeometry(0.32, i, 0.08, 2), c, V(Math.cos(a) * 0.25, 1.15 + (i % 3) * 0.12, Math.sin(a) * 0.25))); }
      P.push(part(blobGeometry(0.36, 9, 0.08, 2), c, V(0, 1.45, 0)));
      break;
    }
    case 'ice_cream': {
      P.push(part(cone(0.18, 0.5, 16), '#e8b070', V(0, 0.25, 0), [Math.PI, 0, 0]));
      const c = pick(['#ffb3d1', '#b3e6c9', '#fff0a3', '#c9b3ff']);
      P.push(part(sph(0.22, 18, 14), c, V(0, 0.58, 0)));
      P.push(part(sph(0.18, 16, 12), pick(['#ffffff', '#ffd6e8', '#d6f0ff']), V(0, 0.82, 0)));
      P.push(part(sph(0.05, 10, 8), '#ff4d6d', V(0, 1.0, 0)));
      break;
    }
    case 'cupcake': {
      P.push(part(new THREE.CylinderGeometry(0.28, 0.22, 0.3, 16), pick(['#ff9ec4', '#9ed8ff', '#ffe08a']), V(0, 0.15, 0)));
      P.push(part(blobGeometry(0.3, 2, 0.12, 2), '#fff6fb', V(0, 0.38, 0), [0, 0, 0], V(1, 0.7, 1)));
      P.push(part(blobGeometry(0.2, 4, 0.12, 2), '#fff6fb', V(0, 0.55, 0), [0, 0, 0], V(1, 0.8, 1)));
      P.push(part(sph(0.06, 10, 8), '#ff4d6d', V(0, 0.7, 0)));
      break;
    }
    // ---------- 海底 ----------
    case 'coral': {
      const c = pick(['#ff8fa3', '#ffb06b', '#c38bff', '#ff6fb5']);
      const branch = (x, y, z, rx, rz, l, r) => P.push(part(cyl(r * 0.7, r, l, 8), c, V(x, y, z), [rx, 0, rz]));
      branch(0, 0.3, 0, 0, 0, 0.6, 0.08);
      branch(0.15, 0.6, 0, 0, -0.6, 0.45, 0.06); branch(-0.15, 0.62, 0.05, 0.2, 0.6, 0.45, 0.06); branch(0, 0.7, -0.15, -0.6, 0, 0.4, 0.05);
      for (const [x, y, z] of [[0.3, 0.8, 0], [-0.3, 0.82, 0.08], [0, 0.9, -0.3], [0, 0.65, 0]]) P.push(part(sph(0.08, 10, 8), c, V(x, y, z)));
      break;
    }
    case 'kelp': {
      for (let i = 0; i < 3; i++) P.push(part(new THREE.BoxGeometry(0.1, 1.6, 0.03, 1, 8, 1), pick(['#3fbf7f', '#5fd38f', '#2fa86f']), V((i - 1) * 0.15, 0.8, 0), [0, i * 0.8, 0]));
      anim = 'sway';
      break;
    }
    case 'sea_rock': {
      P.push(part(blobGeometry(0.45, rng.int(1, 9), 0.2, 1), pick(['#8fa3b8', '#a3b3c4', '#9a8fb8']), V(0, 0.2, 0), [0, 0, 0], V(1.2, 0.7, 1)));
      P.push(part(blobGeometry(0.2, 3, 0.2, 1), '#7fb37f', V(0.15, 0.48, 0.1), [0, 0, 0], V(1, 0.4, 1)));
      break;
    }
    case 'anemone': {
      P.push(part(cyl(0.18, 0.22, 0.25, 14), '#ff9ec4', V(0, 0.12, 0)));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; P.push(part(new THREE.CapsuleGeometry(0.03, 0.25, 2, 6), '#ffd1e8', V(Math.cos(a) * 0.14, 0.38, Math.sin(a) * 0.14), [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4])); }
      break;
    }
    case 'big_shell': {
      P.push(part(scallopGeometry(0.55, 0.08), pick(['#ffd6e0', '#ffe8c9', '#f0dcff']), V(0, 0.12, 0)));
      P.push(part(sph(0.1, 16, 12), '#ffffff', V(0, 0.1, 0.3)));
      break;
    }
    case 'coral_fan': {
      const c = pick(['#c38bff', '#ff8fa3', '#6fd0ff']);
      P.push(part(new THREE.CircleGeometry(0.5, 20, 0, Math.PI), c, V(0, 0.15, 0)));
      P.push(part(cyl(0.04, 0.05, 0.3, 6), c, V(0, 0.15, 0)));
      break;
    }
    // ---------- 雪国 ----------
    case 'pine_snow': {
      P.push(part(cyl(0.08, 0.1, 0.4, 8), '#8a5a36', V(0, 0.2, 0)));
      for (let i = 0; i < 3; i++) {
        P.push(part(cone(0.62 - i * 0.15, 0.6, 14), '#4fa86f', V(0, 0.55 + i * 0.38, 0)));
        P.push(part(cone(0.5 - i * 0.13, 0.25, 14), '#ffffff', V(0, 0.75 + i * 0.38, 0)));
      }
      break;
    }
    case 'snowman': {
      P.push(part(blobGeometry(0.4, 1, 0.03, 3), '#ffffff', V(0, 0.38, 0)));
      P.push(part(blobGeometry(0.28, 2, 0.03, 3), '#ffffff', V(0, 0.95, 0)));
      P.push(part(cone(0.05, 0.2, 10), '#ff8a3d', V(0, 0.97, 0.3), [Math.PI / 2, 0, 0]));
      P.push(part(sph(0.035, 8, 6), '#2a1830', V(-0.1, 1.05, 0.24))); P.push(part(sph(0.035, 8, 6), '#2a1830', V(0.1, 1.05, 0.24)));
      P.push(part(new THREE.TorusGeometry(0.24, 0.06, 8, 20), '#ff6b6b', V(0, 0.75, 0), [Math.PI / 2, 0, 0]));
      P.push(part(cyl(0.18, 0.18, 0.25, 16), '#4a6bff', V(0, 1.3, 0)));
      break;
    }
    case 'ice_crystal': {
      const geo = new THREE.OctahedronGeometry(0.25, 0); geo.scale(0.6, 2.4, 0.6);
      for (let i = 0; i < 3; i++) GS.push({ geo: geo.clone().rotateZ((i - 1) * 0.4).translate((i - 1) * 0.25, 0.5 + (i === 1 ? 0.2 : 0), 0), color: '#bfe8ff' });
      geo.dispose();
      break;
    }
    case 'snow_rock': {
      P.push(part(blobGeometry(0.4, rng.int(1, 9), 0.18, 1), '#a9b8cc', V(0, 0.18, 0), [0, 0, 0], V(1.2, 0.6, 1)));
      P.push(part(blobGeometry(0.36, 4, 0.1, 2), '#ffffff', V(0, 0.36, 0), [0, 0, 0], V(1.15, 0.35, 0.95)));
      break;
    }
    case 'igloo': {
      const d = new THREE.SphereGeometry(0.8, 20, 10, 0, TAU, 0, Math.PI / 2);
      P.push(part(d, '#f4f9ff'));
      P.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 16, 1, false, 0, Math.PI), '#e3edf9', V(0, 0.25, 0.7), [Math.PI / 2, 0, 0]));
      break;
    }
    // ---------- 森林 ----------
    case 'tree': {
      P.push(part(cyl(0.12, 0.18, 1.0, 10), '#a8754a', V(0, 0.5, 0)));
      const c = pick(['#6fcf6a', '#8fdc6a', '#5fbf7a', '#a8e06a']);
      P.push(part(blobGeometry(0.62, rng.int(1, 9), 0.08, 2), c, V(0, 1.45, 0)));
      P.push(part(blobGeometry(0.42, 3, 0.08, 2), c, V(0.35, 1.2, 0.15)));
      P.push(part(blobGeometry(0.4, 5, 0.08, 2), c, V(-0.32, 1.25, -0.1)));
      if (rng.chance(0.5)) for (let i = 0; i < 4; i++) P.push(part(sph(0.07, 8, 6), '#ff5c5c', V(Math.cos(i * 1.7) * 0.5, 1.3 + (i % 2) * 0.3, Math.sin(i * 1.7) * 0.5)));
      break;
    }
    case 'big_mushroom': {
      P.push(part(cyl(0.16, 0.22, 0.7, 14), '#fff3df', V(0, 0.35, 0)));
      const cap = new THREE.SphereGeometry(0.6, 24, 12, 0, TAU, 0, Math.PI / 2); cap.scale(1, 0.6, 1);
      const c = pick(['#ff6b6b', '#ff8fb3', '#ffb347']);
      P.push(part(cap, c, V(0, 0.65, 0)));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; P.push(part(sph(0.08, 8, 6), '#ffffff', V(Math.cos(a) * 0.35, 0.92, Math.sin(a) * 0.35), [0, 0, 0], V(1, 0.4, 1))); }
      break;
    }
    case 'bush': {
      const c = pick(['#6fcf6a', '#5fbf7a', '#7fd77a']);
      for (let i = 0; i < 4; i++) P.push(part(blobGeometry(0.3, i, 0.1, 2), c, V(Math.cos(i * 1.6) * 0.25, 0.22, Math.sin(i * 1.6) * 0.2)));
      for (let i = 0; i < 3; i++) P.push(part(sph(0.06, 8, 6), pick(['#ff8fb3', '#ffffff', '#ffd166']), V(Math.cos(i * 2) * 0.3, 0.42, Math.sin(i * 2) * 0.3)));
      break;
    }
    case 'flowers': {
      for (let k = 0; k < 4; k++) {
        const x = Math.cos(k * 1.6) * 0.25, z = Math.sin(k * 1.6) * 0.25;
        P.push(part(cyl(0.012, 0.015, 0.35, 5), '#5fae5a', V(x, 0.17, z)));
        const c = pick(['#ff8fb3', '#ffffff', '#ffd166', '#b38fff', '#7fd6ff']);
        for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; P.push(part(sph(0.05, 8, 6), c, V(x + Math.cos(a) * 0.05, 0.36, z + Math.sin(a) * 0.05), [0, 0, 0], V(1, 0.5, 1))); }
        P.push(part(sph(0.035, 8, 6), '#ffe066', V(x, 0.38, z)));
      }
      break;
    }
    case 'stump': {
      P.push(part(cyl(0.3, 0.36, 0.4, 16), '#a8754a', V(0, 0.2, 0)));
      P.push(part(cyl(0.29, 0.29, 0.02, 16), '#e8c79a', V(0, 0.41, 0)));
      break;
    }
    case 'rock': {
      P.push(part(blobGeometry(0.35, rng.int(1, 9), 0.2, 1), pick(['#b8b0a8', '#a8a49c', '#c4bcb0']), V(0, 0.15, 0), [0, 0, 0], V(1.2, 0.7, 1)));
      break;
    }
    // ---------- 烘焙屋 ----------
    case 'cake': {
      const c1 = pick(['#ffb3d1', '#fff0d6', '#c9e8ff']);
      P.push(part(cyl(0.55, 0.55, 0.4, 28), c1, V(0, 0.2, 0)));
      P.push(part(cyl(0.4, 0.4, 0.35, 28), '#fffaf2', V(0, 0.57, 0)));
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; P.push(part(sph(0.07, 10, 8), '#ffffff', V(Math.cos(a) * 0.5, 0.42, Math.sin(a) * 0.5))); }
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; P.push(part(sph(0.06, 10, 8), '#ff4d6d', V(Math.cos(a) * 0.28, 0.8, Math.sin(a) * 0.28))); }
      P.push(part(cyl(0.025, 0.025, 0.22, 8), '#7fd6ff', V(0, 0.86, 0)));
      GL.push({ geo: sph(0.04, 8, 6).translate(0, 1.0, 0), color: '#ffd166' });
      break;
    }
    case 'cookie_stack': {
      for (let i = 0; i < 4; i++) {
        P.push(part(cyl(0.3, 0.3, 0.08, 20), i % 2 ? '#7a4524' : '#e0a560', V(rng.range(-0.03, 0.03), 0.04 + i * 0.085, rng.range(-0.03, 0.03))));
      }
      break;
    }
    case 'big_donut': {
      P.push(part(new THREE.TorusGeometry(0.42, 0.2, 14, 28), '#e8a25c', V(0, 0.55, 0)));
      const f = new THREE.TorusGeometry(0.42, 0.17, 10, 28, Math.PI * 1.1);
      P.push(part(f, pick(['#ff9ec4', '#a3d8ff', '#c9a0ff']), V(0, 0.58, 0.04), [0, 0, 0.2]));
      break;
    }
    case 'teapot': {
      const c = pick(['#9ed8ff', '#ffb3d1', '#fff0a3']);
      P.push(part(sph(0.4, 20, 14), c, V(0, 0.38, 0), [0, 0, 0], V(1, 0.85, 1)));
      P.push(part(cyl(0.18, 0.22, 0.1, 16), c, V(0, 0.72, 0)));
      P.push(part(sph(0.07, 10, 8), '#ffffff', V(0, 0.82, 0)));
      P.push(part(cyl(0.05, 0.08, 0.4, 10), c, V(0.45, 0.45, 0), [0, 0, -0.9]));
      P.push(part(new THREE.TorusGeometry(0.16, 0.04, 8, 16), c, V(-0.4, 0.42, 0)));
      break;
    }
    case 'jar': {
      GS.push({ geo: cyl(0.3, 0.3, 0.55, 20).translate(0, 0.28, 0), color: '#e6f6ff' });
      P.push(part(cyl(0.32, 0.32, 0.1, 20), '#ff8fb3', V(0, 0.6, 0)));
      for (let i = 0; i < 9; i++) P.push(part(sph(0.07, 8, 6), RAINBOW[i % 7], V(rng.range(-0.15, 0.15), 0.1 + rng.range(0, 0.3), rng.range(-0.15, 0.15))));
      break;
    }
    // ---------- 天空 ----------
    case 'cloud_big': {
      for (let i = 0; i < 6; i++) P.push(part(blobGeometry(0.4 + (i % 3) * 0.1, i, 0.06, 2), '#ffffff', V(Math.cos(i * 1.05) * 0.5, 0.35 + (i % 2) * 0.15, Math.sin(i * 1.05) * 0.4)));
      anim = 'bob';
      break;
    }
    case 'star_big': {
      GL.push({ geo: starGeometry(0.4, 0.18, 0.12).translate(0, 1.2, 0), color: '#ffd84d' });
      P.push(part(cyl(0.02, 0.02, 1.0, 6), '#ffffff', V(0, 0.5, 0)));
      anim = 'spin';
      break;
    }
    case 'rainbow_arch': {
      for (let i = 0; i < 6; i++) P.push(part(new THREE.TorusGeometry(1.2 - i * 0.12, 0.06, 8, 32, Math.PI), RAINBOW[i], V(0, 0, 0)));
      P.push(part(blobGeometry(0.35, 1, 0.06, 2), '#ffffff', V(-1.0, 0.1, 0))); P.push(part(blobGeometry(0.35, 2, 0.06, 2), '#ffffff', V(1.0, 0.1, 0)));
      break;
    }
    case 'balloon': {
      P.push(part(sph(0.3, 18, 14), pick(['#ff8fb3', '#7fd6ff', '#ffd166', '#b38fff']), V(0, 1.6, 0), [0, 0, 0], V(1, 1.15, 1)));
      P.push(part(cyl(0.006, 0.006, 1.3, 4), '#ffffff', V(0, 0.75, 0)));
      anim = 'bob';
      break;
    }
    case 'moon': {
      GL.push({ geo: new THREE.TorusGeometry(0.4, 0.16, 12, 24, Math.PI * 1.2).rotateZ(-0.6).translate(0, 1.4, 0), color: '#fff3b0' });
      anim = 'bob';
      break;
    }
    // ---------- 玩具屋 ----------
    case 'block_stack': {
      const b = roundedBox(0.4, 0.4, 0.4, 0.05, 2);
      for (let i = 0; i < 3; i++) P.push(part(b.clone(), RAINBOW[(i * 2 + rng.int(0, 6)) % 7], V(rng.range(-0.05, 0.05), 0.2 + i * 0.4, rng.range(-0.05, 0.05)), [0, rng.range(0, 1), 0]));
      b.dispose();
      break;
    }
    case 'toy_ball': {
      for (let i = 0; i < 6; i++) P.push(part(new THREE.SphereGeometry(0.35, 16, 12, (i / 6) * TAU, TAU / 6), RAINBOW[i], V(0, 0.35, 0)));
      break;
    }
    case 'rubber_duck': {
      P.push(part(blobGeometry(0.3, 2, 0.03, 3), '#ffd84d', V(0, 0.25, 0), [0, 0, 0], V(1.2, 0.85, 1)));
      P.push(part(sph(0.2, 16, 12), '#ffd84d', V(0.15, 0.55, 0)));
      P.push(part(sph(0.08, 10, 8), '#ff8a3d', V(0.36, 0.52, 0), [0, 0, 0], V(1.3, 0.6, 1.1)));
      P.push(part(sph(0.03, 8, 6), '#2a1830', V(0.28, 0.62, 0.11))); P.push(part(sph(0.03, 8, 6), '#2a1830', V(0.28, 0.62, -0.11)));
      break;
    }
    case 'pencil': {
      const c = pick(['#ff8fb3', '#7fd6ff', '#9be89b']);
      P.push(part(cyl(0.08, 0.08, 1.2, 6), c, V(0, 0.6, 0)));
      P.push(part(cone(0.08, 0.2, 6), '#f2d2a8', V(0, 1.3, 0)));
      P.push(part(cone(0.025, 0.06, 6), '#444444', V(0, 1.38, 0)));
      P.push(part(cyl(0.085, 0.085, 0.12, 12), '#ffb3d1', V(0, 0.04, 0)));
      break;
    }
    case 'teddy': {
      const c = pick(['#d9a477', '#f2c6a0', '#c9a0ff']);
      P.push(part(blobGeometry(0.32, 3, 0.03, 3), c, V(0, 0.3, 0)));
      P.push(part(sph(0.25, 18, 14), c, V(0, 0.75, 0)));
      P.push(part(sph(0.09, 10, 8), c, V(-0.18, 0.95, 0))); P.push(part(sph(0.09, 10, 8), c, V(0.18, 0.95, 0)));
      P.push(part(sph(0.1, 12, 10), '#fff1e6', V(0, 0.7, 0.2), [0, 0, 0], V(1, 0.8, 0.8)));
      P.push(part(sph(0.03, 8, 6), '#2a1830', V(-0.08, 0.8, 0.22))); P.push(part(sph(0.03, 8, 6), '#2a1830', V(0.08, 0.8, 0.22)));
      P.push(part(sph(0.11, 10, 8), c, V(-0.3, 0.35, 0.1))); P.push(part(sph(0.11, 10, 8), c, V(0.3, 0.35, 0.1)));
      break;
    }
    // ---------- 水晶洞 ----------
    case 'crystal_cluster': {
      const c = pick(['#9fe8ff', '#e7b3ff', '#ffb3e6', '#b3ffd9']);
      for (let i = 0; i < 4; i++) {
        const h = 0.5 + rng.range(0, 0.7);
        const geo = new THREE.CylinderGeometry(0.08, 0.12, h, 6);
        const top = new THREE.ConeGeometry(0.08, 0.2, 6).translate(0, h / 2 + 0.1, 0);
        const m = mergeGeometries([geo.toNonIndexed(), top.toNonIndexed()]);
        geo.dispose(); top.dispose();
        const a = (i / 4) * TAU;
        m.rotateZ(Math.cos(a) * 0.4); m.rotateX(Math.sin(a) * 0.4);
        m.translate(Math.cos(a) * 0.15, h / 2, Math.sin(a) * 0.15);
        GL.push({ geo: m, color: c });
      }
      P.push(part(blobGeometry(0.3, 4, 0.2, 1), '#5d4f8f', V(0, 0.05, 0), [0, 0, 0], V(1.3, 0.4, 1.3)));
      break;
    }
    case 'stalagmite': {
      P.push(part(cone(0.25, 1.2, 8), '#7a6bb3', V(0, 0.6, 0)));
      P.push(part(cone(0.15, 0.6, 8), '#8a7bc3', V(0.25, 0.3, 0.1)));
      break;
    }
    case 'glow_mushroom_big': {
      P.push(part(cyl(0.08, 0.12, 0.6, 10), '#e6f7ff', V(0, 0.3, 0)));
      const cap = new THREE.SphereGeometry(0.4, 20, 10, 0, TAU, 0, Math.PI / 2); cap.scale(1, 0.55, 1);
      GL.push({ geo: cap.translate(0, 0.58, 0), color: pick(['#5ff0ff', '#c38bff', '#7dffc8']) });
      break;
    }
    case 'cave_rock': {
      P.push(part(blobGeometry(0.4, rng.int(1, 9), 0.25, 1), '#4f4280', V(0, 0.18, 0), [0, 0, 0], V(1.2, 0.7, 1)));
      break;
    }
    case 'gem_pile': {
      for (let i = 0; i < 5; i++) GL.push({ geo: new THREE.OctahedronGeometry(0.1, 0).translate(Math.cos(i * 1.3) * 0.18, 0.1, Math.sin(i * 1.3) * 0.18), color: RAINBOW[(i * 3) % 7] });
      break;
    }
    default:
      P.push(part(sph(0.2), '#ffffff', V(0, 0.2, 0)));
  }
  const parts = [];
  if (P.length) parts.push({ geo: bake(P), mat: 'vc' });
  for (const p of GL) parts.push({ geo: p.geo, mat: 'glow', color: p.color });
  for (const p of GS) parts.push({ geo: p.geo, mat: 'glossy', color: p.color });
  return { parts, anim };
}
