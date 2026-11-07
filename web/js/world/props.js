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

// 动画电影式的"手绘体积感"：每个零件底部（贴近地面、缝隙里）暗一点、偏冷，
// 朝上被阳光照到的地方亮一点、偏暖。简单的圆润造型这样一画就很有分量，所有世界的质感统一。
const _cool = new THREE.Color('#8a7fb8'), _warm = new THREE.Color('#fff1d6');
export function shadeColor(out, base, y, ny, o = {}) {
  const ao = o.ao ?? 0.3;
  const k = 1 - ao * (1 - THREE.MathUtils.smoothstep(y - (o.aoBase || 0), 0, o.aoH ?? 0.45));   // 贴地的地方暗一点
  out.copy(base).multiplyScalar(k);
  out.lerp(_cool, (1 - k) * 0.35);                                            // 暗部带一点冷紫，阴影更通透
  const top = THREE.MathUtils.clamp(ny, 0, 1) * (o.light ?? 0.1);              // 朝上的面带一点暖色高光
  out.lerp(_warm, top);
  return out;
}
export function bake(parts, o = {}) {
  const geos = [];
  const col = new THREE.Color(), tmp = new THREE.Color();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const s = p.scale == null ? V(1, 1, 1) : typeof p.scale === 'number' ? V(p.scale, p.scale, p.scale) : p.scale;
    g.applyMatrix4(new THREE.Matrix4().compose(p.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rot)), s));
    if (!g.attributes.normal) g.computeVertexNormals();
    col.set(p.color);
    const pa = g.attributes.position, na = g.attributes.normal;
    const c = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      if (o.flat) tmp.copy(col); else shadeColor(tmp, col, pa.getY(i), na.getY(i), o);
      c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
    }
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
  const extra = []; // 单独动的零件
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
    case 'kelp': { // 软软弯弯的海草（胶囊状叶片，一根根往上卷）
      for (let i = 0; i < 3; i++) {
        const c = pick(['#3fbf7f', '#5fd38f', '#2fa86f']);
        const pts = [V(0, 0, 0), V(0.05, 0.5, 0), V(-0.06, 1.0, 0.02), V(0.04, 1.45, 0)];
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.05, 8, false);
        tube.scale(1, 1, 0.55);
        P.push(part(tube, c, V((i - 1) * 0.16, 0, 0), [0, i * 0.8, 0]));
        P.push(part(sph(0.06, 10, 8), c, V((i - 1) * 0.16 + 0.04, 1.45, 0), [0, 0, 0], V(1, 1.3, 0.6)));
      }
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
    case 'coral_fan': { // 胖乎乎的扇形珊瑚（一圈小圆球组成，有厚度）
      const c = pick(['#c38bff', '#ff8fa3', '#6fd0ff']);
      P.push(part(cyl(0.05, 0.07, 0.3, 10), c, V(0, 0.15, 0)));
      for (let ring = 0; ring < 3; ring++) {
        const r = 0.18 + ring * 0.14, n = 5 + ring * 3;
        for (let i = 0; i < n; i++) { const a = Math.PI * (0.08 + 0.84 * (i / (n - 1))); P.push(part(sph(0.075 - ring * 0.01, 12, 8), c, V(Math.cos(a) * r, 0.3 + Math.sin(a) * r, 0), [0, 0, 0], V(1, 1, 0.7))); }
      }
      break;
    }
    // ---------- 雪国 ----------
    case 'pine_snow': { // 圆润的雪松：一层层鼓鼓的"裙摆"，每层顶上盖着软软下垂的雪
      P.push(part(cyl(0.08, 0.11, 0.4, 10), '#8a5a36', V(0, 0.2, 0)));
      const green = pick(['#4fa86f', '#58b07a', '#479e6a']);
      for (let i = 0; i < 3; i++) {
        const r = 0.6 - i * 0.15, h = 0.62 - i * 0.08, y = 0.42 + i * 0.36;
        // 外轮廓是向外鼓的曲线（不是直直的圆锥）
        const prof = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8; prof.push(new THREE.Vector2(Math.max(0.001, r * (1 - t) * (1 + 0.18 * Math.sin(t * Math.PI))), h * t)); }
        P.push(part(new THREE.LatheGeometry(prof, 18), green, V(0, y, 0)));
        // 雪：一圈圆鼓鼓的雪团，边缘往下垂
        const snow = blobGeometry(r * 0.78, 3 + i, 0.06, 2); snow.scale(1, 0.32, 1);
        P.push(part(snow, '#ffffff', V(0, y + h * 0.48, 0)));
      }
      P.push(part(sph(0.07, 10, 8), '#ffffff', V(0, 0.42 + 2 * 0.36 + 0.5, 0)));
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
    case 'ice_crystal': { // 圆润的冰晶（像冰糖一样光滑的胶囊形，不再是尖锐的八面体）
      for (let i = 0; i < 3; i++) {
        const g = new THREE.CapsuleGeometry(0.11 - Math.abs(i - 1) * 0.02, 0.5 + (i === 1 ? 0.25 : 0), 4, 10);
        GS.push({ geo: g.rotateZ((i - 1) * 0.35).translate((i - 1) * 0.2, 0.42 + (i === 1 ? 0.14 : 0), 0), color: '#bfe8ff' });
      }
      P.push(part(blobGeometry(0.32, 5, 0.08, 2), '#ffffff', V(0, 0.05, 0), [0, 0, 0], V(1.1, 0.3, 0.9)));
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
    case 'tree': case 'tree_autumn': {
      P.push(part(cyl(0.12, 0.18, 1.0, 10), '#a8754a', V(0, 0.5, 0)));
      // 秋天的树：橙、金、枫红为主，偶尔一棵还带点绿（动画电影里秋天的配色）
      const c = type === 'tree_autumn' ? pick(['#f29b4b', '#e9783b', '#f7c548', '#e2593f', '#f0a84a', '#b8c95a']) : pick(['#6fcf6a', '#8fdc6a', '#5fbf7a', '#a8e06a']);
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
    case 'bush': case 'bush_autumn': {
      const c = type === 'bush_autumn' ? pick(['#e9783b', '#f2a54b', '#d9573b', '#c9b04a']) : pick(['#6fcf6a', '#5fbf7a', '#7fd77a']);
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
    // ---------- 厨房 ----------
    case 'toaster': {
      const c = pick(['#ffb3d1', '#9fe0d0', '#ffe08a']);
      P.push(part(roundedBox(0.7, 0.5, 0.45, 0.14, 3), c, V(0, 0.25, 0)));
      P.push(part(roundedBox(0.5, 0.03, 0.08, 0.015, 2), '#5a5470', V(0, 0.5, -0.08)));
      P.push(part(roundedBox(0.5, 0.03, 0.08, 0.015, 2), '#5a5470', V(0, 0.5, 0.08)));
      P.push(part(roundedBox(0.4, 0.16, 0.06, 0.03, 2), '#f0b45a', V(0, 0.56, -0.08)));
      P.push(part(cyl(0.04, 0.04, 0.06, 10), '#ffffff', V(0.36, 0.3, 0), [0, 0, Math.PI / 2]));
      break;
    }
    case 'kettle': {
      const c = pick(['#7fd6ff', '#ff9ec4', '#c9a0ff']);
      P.push(part(sph(0.32, 20, 14), c, V(0, 0.3, 0), [0, 0, 0], V(1, 0.85, 1)));
      P.push(part(cyl(0.14, 0.2, 0.08, 16), c, V(0, 0.56, 0)));
      P.push(part(sph(0.06, 10, 8), '#ffffff', V(0, 0.62, 0)));
      P.push(part(cyl(0.035, 0.06, 0.32, 10), c, V(0.33, 0.36, 0), [0, 0, -1.0]));
      P.push(part(new THREE.TorusGeometry(0.2, 0.035, 8, 16, Math.PI), '#ffffff', V(0, 0.6, 0), [0, Math.PI / 2, 0]));
      break;
    }
    case 'fruit_bowl': {
      P.push(part(new THREE.SphereGeometry(0.35, 20, 10, 0, TAU, Math.PI / 2, Math.PI / 2), '#ffffff', V(0, 0.32, 0)));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; P.push(part(sph(0.12, 12, 10), ['#ff5c5c', '#ffd166', '#ff9f43', '#9be89b', '#ff8fb3'][i], V(Math.cos(a) * 0.14, 0.34 + (i % 2) * 0.06, Math.sin(a) * 0.14))); }
      break;
    }
    case 'herb_pot': {
      P.push(part(cyl(0.18, 0.14, 0.28, 16), pick(['#ffb3d1', '#ffd98a', '#9fd8ff']), V(0, 0.14, 0)));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.push(part(blobGeometry(0.11, i, 0.1, 1), '#6fcf6a', V(Math.cos(a) * 0.08, 0.38 + (i % 2) * 0.08, Math.sin(a) * 0.08))); }
      break;
    }
    case 'mixer': {
      const c = pick(['#ff9ec4', '#7fdcc0']);
      P.push(part(roundedBox(0.55, 0.12, 0.35, 0.05, 2), c, V(0, 0.06, 0)));
      P.push(part(roundedBox(0.16, 0.6, 0.3, 0.06, 2), c, V(-0.2, 0.4, 0)));
      P.push(part(roundedBox(0.5, 0.22, 0.32, 0.1, 3), c, V(0.02, 0.72, 0)));
      P.push(part(new THREE.SphereGeometry(0.2, 18, 10, 0, TAU, Math.PI / 2, Math.PI / 2), '#e8eef7', V(0.1, 0.32, 0)));
      break;
    }
    // ---------- 卧室 ----------
    case 'plant': {
      P.push(part(cyl(0.22, 0.17, 0.4, 16), pick(['#ffffff', '#ffd6e8', '#c9e8ff']), V(0, 0.2, 0)));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; P.push(part(new THREE.SphereGeometry(0.14, 10, 8).scale(0.5, 1.6, 0.25), '#5fbf7a', V(Math.cos(a) * 0.1, 0.65, Math.sin(a) * 0.1), [Math.sin(a) * 0.5, a, -Math.cos(a) * 0.5])); }
      break;
    }
    case 'plush': { // 小兔玩偶
      const c = pick(['#ffd6e8', '#e1f3ff', '#fff0c2', '#eae1ff']);
      P.push(part(blobGeometry(0.22, 2, 0.03, 3), c, V(0, 0.22, 0), [0, 0, 0], V(1, 0.9, 0.9)));
      P.push(part(sph(0.18, 16, 12), c, V(0, 0.52, 0)));
      for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 2.6, 0.8), c, V(s * 0.08, 0.78, 0), [0, 0, -s * 0.2]));
      P.push(part(sph(0.025, 8, 6), '#2a1830', V(-0.06, 0.55, 0.16))); P.push(part(sph(0.025, 8, 6), '#2a1830', V(0.06, 0.55, 0.16)));
      P.push(part(sph(0.03, 8, 6), '#ff8fb3', V(0, 0.5, 0.17)));
      break;
    }
    case 'toy_chest': {
      P.push(part(roundedBox(0.9, 0.5, 0.55, 0.06, 2), pick(['#7fd6ff', '#ffb3d1', '#ffd98a']), V(0, 0.25, 0)));
      P.push(part(roundedBox(0.94, 0.08, 0.59, 0.04, 2), '#ffffff', V(0, 0.52, 0)));
      P.push(part(sph(0.08, 12, 10), '#ff8fb3', V(0, 0.32, 0.29), [0, 0, 0], V(1, 1, 0.4)));
      break;
    }
    case 'cushion_pile': {
      for (let i = 0; i < 3; i++) P.push(part(roundedBox(0.5, 0.14, 0.5, 0.06, 3), pick(['#ffc2d8', '#c9e8ff', '#fff0a8', '#d7c9ff']), V(i * 0.03, 0.07 + i * 0.14, 0), [0, i * 0.4, 0]));
      break;
    }
    case 'floor_lamp': {
      P.push(part(cyl(0.18, 0.2, 0.04, 16), '#ffffff', V(0, 0.02, 0)));
      P.push(part(cyl(0.02, 0.02, 1.3, 8), '#ffffff', V(0, 0.66, 0)));
      GL.push({ geo: new THREE.CylinderGeometry(0.16, 0.26, 0.3, 18, 1, true).translate(0, 1.4, 0), color: '#fff3c2' });
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
    // ---------- 沙滩 ----------
    case 'palm': { // 弯弯的椰子树：一节一节的树干、垂下来的大叶子、一串椰子
      const lean = rng.range(0.1, 0.18) * (rng.chance(0.5) ? 1 : -1);
      let x = 0, y = 0;
      for (let k = 0; k < 7; k++) {
        const r0 = 0.13 - k * 0.006;
        P.push(part(cyl(r0 - 0.012, r0, 0.32, 10), k % 2 ? '#c8955f' : '#b9844f', V(x, y + 0.16, 0), [0, 0, -lean * k * 0.25]));
        x += Math.sin(lean * k * 0.25) * 0.32; y += Math.cos(lean * k * 0.25) * 0.31;
      }
      const top = V(x, y, 0);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU + rng.range(-0.2, 0.2);
        const leaf = new THREE.SphereGeometry(1, 14, 8); leaf.scale(0.62, 0.05, 0.15); leaf.translate(0.55, 0, 0);
        leaf.rotateZ(-0.55 - rng.range(0, 0.25)); leaf.rotateY(a);
        P.push(part(leaf, pick(['#5fbf6a', '#6fcf6a', '#4fae63']), top.clone().add(V(0, 0.04, 0))));
      }
      for (let k = 0; k < 3; k++) P.push(part(sph(0.085, 10, 8), '#8a5a3c', top.clone().add(V(Math.cos(k * 2.1) * 0.09, -0.09, Math.sin(k * 2.1) * 0.09))));
      break;
    }
    case 'sand_castle': {
      const sand = '#f2d39b', dark = '#e2bd7f';
      P.push(part(roundedBox(0.95, 0.32, 0.95, 0.08, 2), sand, V(0, 0.16, 0)));
      for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
        P.push(part(cyl(0.14, 0.16, 0.55, 14), sand, V(x, 0.27, z)));
        for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; P.push(part(roundedBox(0.07, 0.08, 0.07, 0.02, 1), dark, V(x + Math.cos(a) * 0.1, 0.58, z + Math.sin(a) * 0.1))); }
      }
      P.push(part(cyl(0.2, 0.24, 0.8, 16), sand, V(0, 0.4, 0)));
      P.push(part(cyl(0.21, 0.21, 0.05, 16), dark, V(0, 0.82, 0)));
      P.push(part(cyl(0.012, 0.012, 0.35, 6), '#ffffff', V(0, 1.0, 0)));
      P.push(part(cone(0.07, 0.16, 3).rotateZ(-Math.PI / 2), '#ff8fb3', V(0.08, 1.12, 0)));
      P.push(part(roundedBox(0.18, 0.22, 0.05, 0.06, 2), dark, V(0, 0.15, 0.48)));
      for (let k = 0; k < 3; k++) P.push(part(new THREE.SphereGeometry(0.05, 10, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.4, 0.85), pick(['#ffd6e0', '#ffffff', '#f0dcff']), V(-0.3 + k * 0.3, 0.32, 0.47)));
      break;
    }
    case 'beach_umbrella': { // 彩色条纹的沙滩伞
      const tilt = rng.range(-0.25, 0.25);
      P.push(part(cyl(0.025, 0.025, 1.6, 8), '#ffffff', V(0, 0.8, 0), [tilt, 0, 0]));
      const c1 = pick(['#ff8fb3', '#7fd6ff', '#ffb37a', '#9be89b']);
      const top = V(0, 1.6 * Math.cos(tilt), 1.6 * Math.sin(tilt));
      for (let k = 0; k < 8; k++) {
        const w = new THREE.SphereGeometry(0.85, 6, 6, (k / 8) * TAU, TAU / 8, 0, Math.PI / 2.4); w.scale(1, 0.45, 1);
        P.push(part(w, k % 2 ? '#ffffff' : c1, top.clone().add(V(0, -0.3, 0)), [tilt, 0, 0]));
      }
      P.push(part(sph(0.06, 8, 6), c1, top.clone().add(V(0, 0.1, 0))));
      break;
    }
    case 'beach_ball': {
      for (let k = 0; k < 6; k++) P.push(part(new THREE.SphereGeometry(0.28, 8, 12, (k / 6) * TAU, TAU / 6), RAINBOW[k], V(0, 0.27, 0)));
      P.push(part(sph(0.05, 8, 6), '#ffffff', V(0, 0.55, 0)));
      break;
    }
    // ---------- 远景地标（每个世界一个"故事书里的房子"：暖暖发光的窗户是冷暖对比的焦点） ----------
    case 'cottage': case 'cottage_snow': case 'cottage_forest': {
      const snow = type === 'cottage_snow', forest = type === 'cottage_forest';
      const wall = snow ? '#ffe9d6' : forest ? '#ffe3c2' : '#fff1dc';
      const roofC = snow ? '#e8645a' : forest ? '#c96f4a' : '#ff8f8f';
      P.push(part(roundedBox(2.0, 1.5, 1.6, 0.22, 3), wall, V(0, 0.75, 0)));
      // 圆圆的拱形屋顶（像面包一样鼓鼓的）
      const roof = new THREE.CylinderGeometry(1.18, 1.18, 2.35, 20, 1, false, 0, Math.PI); roof.rotateZ(Math.PI / 2); roof.rotateY(Math.PI / 2); roof.scale(1, 0.8, 1);
      P.push(part(roof, roofC, V(0, 1.45, 0)));
      if (snow) { const cap = new THREE.CylinderGeometry(1.2, 1.2, 2.2, 20, 1, false, Math.PI * 0.2, Math.PI * 0.6); cap.rotateZ(Math.PI / 2); cap.rotateY(Math.PI / 2); cap.scale(1, 0.84, 1.02); P.push(part(cap, '#ffffff', V(0, 1.47, 0))); }
      P.push(part(roundedBox(0.32, 0.75, 0.32, 0.08, 2), '#c98b6a', V(0.62, 2.3, -0.2)));
      for (let k = 0; k < 3; k++) P.push(part(blobGeometry(0.16 + k * 0.05, k + 2, 0.1, 2), '#ffffff', V(0.68 + k * 0.18, 2.85 + k * 0.32, -0.25)));
      // 门 + 门把手 + 门前小台阶
      P.push(part(roundedBox(0.5, 0.86, 0.1, 0.2, 3), '#b07a4f', V(-0.35, 0.47, 0.8)));
      P.push(part(sph(0.04, 8, 6), '#ffd166', V(-0.2, 0.47, 0.86)));
      P.push(part(roundedBox(0.7, 0.1, 0.32, 0.05, 2), '#d9c7b4', V(-0.35, 0.05, 0.96)));
      // 窗户：白色窗框 + 暖黄的光
      P.push(part(roundedBox(0.52, 0.52, 0.08, 0.12, 2), '#ffffff', V(0.45, 0.92, 0.79)));
      GL.push({ geo: roundedBox(0.4, 0.4, 0.04, 0.1, 2).translate(0.45, 0.92, 0.83), color: '#ffd98a' });
      P.push(part(roundedBox(0.04, 0.4, 0.03, 0.01, 1), '#ffffff', V(0.45, 0.92, 0.86)));
      P.push(part(roundedBox(0.4, 0.04, 0.03, 0.01, 1), '#ffffff', V(0.45, 0.92, 0.86)));
      // 窗台花箱
      P.push(part(roundedBox(0.6, 0.12, 0.16, 0.04, 2), '#a8754a', V(0.45, 0.6, 0.86)));
      for (let k = 0; k < 5; k++) P.push(part(sph(0.06, 8, 6), snow ? '#ff8fb3' : pick(['#ff8fb3', '#ffd166', '#ffffff']), V(0.25 + k * 0.1, 0.7, 0.88)));
      if (snow) for (let k = 0; k < 4; k++) P.push(part(blobGeometry(0.3, k + 1, 0.15, 2), '#ffffff', V(-1 + k * 0.65, 0.05, 0.85 - (k % 2) * 0.2), [0, 0, 0], V(1.2, 0.35, 0.8)));
      break;
    }
    case 'lighthouse': {
      for (let k = 0; k < 5; k++) P.push(part(blobGeometry(0.5, k + 3, 0.2, 2), pick(['#d9c3a0', '#c9b391', '#e6d4b4']), V(Math.cos(k * 1.3) * 0.7, 0.12, Math.sin(k * 1.3) * 0.6), [0, 0, 0], V(1, 0.5, 1)));
      P.push(part(cyl(0.5, 0.72, 3.0, 24), '#ffffff', V(0, 1.6, 0)));
      // 红白条纹：比塔身略粗一点点（塔身半径从底部 0.72 收到顶部 0.5）
      const R = (h) => 0.72 - (h - 0.1) / 3.0 * 0.22;
      for (let k = 0; k < 3; k++) { const y = 0.55 + k * 0.95; P.push(part(cyl(R(y + 0.38) + 0.015, R(y) + 0.015, 0.38, 24), '#ff6b6b', V(0, y + 0.19, 0))); }
      P.push(part(cyl(0.72, 0.72, 0.08, 24), '#5a8fa8', V(0, 3.12, 0)));
      GL.push({ geo: new THREE.CylinderGeometry(0.4, 0.4, 0.5, 18).translate(0, 3.42, 0), color: '#fff1a8' });
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; P.push(part(cyl(0.025, 0.025, 0.5, 6), '#5a8fa8', V(Math.cos(a) * 0.41, 3.42, Math.sin(a) * 0.41))); }
      P.push(part(cone(0.58, 0.5, 20), '#ff6b6b', V(0, 3.92, 0)));
      P.push(part(sph(0.08, 10, 8), '#ffd166', V(0, 4.22, 0)));
      P.push(part(roundedBox(0.36, 0.6, 0.1, 0.15, 2), '#5a8fa8', V(0, 0.55, 0.7)));
      GL.push({ geo: roundedBox(0.2, 0.26, 0.04, 0.08, 2).translate(0, 1.9, 0.62), color: '#ffe08a' });
      break;
    }
    case 'candy_castle': {
      P.push(part(roundedBox(1.8, 1.4, 1.2, 0.18, 3), '#ffc2d8', V(0, 0.7, 0)));
      // 一圈白色"糖霜"
      P.push(part(roundedBox(1.86, 0.12, 1.26, 0.06, 2), '#ffffff', V(0, 1.38, 0)));
      for (let k = 0; k < 7; k++) P.push(part(new THREE.SphereGeometry(0.13, 12, 8, 0, TAU, 0, Math.PI / 2).scale(1, 1.2, 1), RAINBOW[k % RAINBOW.length], V(-0.78 + k * 0.26, 1.44, 0.5)));
      const towers = [[-1.05, 0, 2.4, '#d7c9ff', '#c9a0ff'], [1.05, 0, 2.1, '#c8f5e0', '#ff8fb3'], [0, -0.45, 2.9, '#fff0a8', '#ff8fb3']];
      for (const [x, z, h, c, rc] of towers) {
        P.push(part(cyl(0.36, 0.4, h, 18), c, V(x, h / 2, z)));
        P.push(part(roundedBox(0.84, 0.1, 0.84, 0.05, 2).scale(1, 1, 1), '#ffffff', V(x, h, z), [0, 0, 0], V(0.95, 1, 0.95)));
        P.push(part(cone(0.48, 0.8, 18), rc, V(x, h + 0.42, z)));
        P.push(part(sph(0.08, 8, 6), '#ffd166', V(x, h + 0.86, z)));
        GL.push({ geo: new THREE.CircleGeometry(0.12, 16).translate(x, h * 0.7, z + 0.405), color: '#fff1c2' });
      }
      P.push(part(roundedBox(0.5, 0.75, 0.1, 0.22, 3), '#8a5a44', V(0, 0.38, 0.61)));
      P.push(part(cyl(0.025, 0.025, 1.0, 6), '#ffffff', V(1.4, 0.5, 0.5)));
      P.push(part(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 24).rotateX(Math.PI / 2), '#ff8fb3', V(1.4, 1.1, 0.5)));
      P.push(part(new THREE.TorusGeometry(0.17, 0.035, 8, 24), '#ffffff', V(1.4, 1.1, 0.55)));
      break;
    }
    case 'windmill': {
      P.push(part(cyl(0.52, 0.78, 2.4, 20), '#fff4e0', V(0, 1.2, 0)));
      P.push(part(cone(0.72, 0.85, 20), '#c96f4a', V(0, 2.82, 0)));
      P.push(part(roundedBox(0.42, 0.7, 0.1, 0.18, 2), '#b07a4f', V(0, 0.36, 0.72)));
      GL.push({ geo: roundedBox(0.3, 0.3, 0.04, 0.1, 2).translate(0, 1.45, 0.6), color: '#ffd98a' });
      P.push(part(cyl(0.12, 0.12, 0.2, 12), '#a8754a', V(0, 2.3, 0.62), [Math.PI / 2, 0, 0]));
      for (let k = 0; k < 4; k++) P.push(part(sph(0.07, 8, 6), pick(['#ff8fb3', '#ffd166', '#ffffff']), V(-0.6 + k * 0.4, 0.06, 0.85)));
      // 风车叶（单独一个零件，绕着轮毂慢慢转）
      const S = [];
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        const blade = roundedBox(0.3, 1.25, 0.05, 0.05, 2).translate(0.06, 0.75, 0);
        blade.rotateZ(a);
        S.push(part(blade, k % 2 ? '#ffffff' : '#cfe8ff'));
        const arm = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6).translate(0, 0.4, 0); arm.rotateZ(a);
        S.push(part(arm, '#a8754a'));
      }
      S.push(part(sph(0.12, 12, 8), '#ff8fb3'));
      extra.push({ geo: bake(S), mat: 'vc', pos: V(0, 2.3, 0.75), spin: true });
      anim = 'windmill';
      break;
    }
    case 'toy_castle': {
      const cols = ['#ff8fb3', '#7fd6ff', '#ffd166', '#9be89b', '#c9a0ff'];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) P.push(part(roundedBox(0.6, 0.6, 0.6, 0.08, 2), cols[(i + j * 2) % cols.length], V(-0.65 + i * 0.65, 0.3 + j * 0.62, 0)));
      for (const x of [-1.3, 1.3]) {
        for (let j = 0; j < 4; j++) P.push(part(roundedBox(0.6, 0.6, 0.6, 0.08, 2), cols[(j + (x > 0 ? 2 : 0)) % cols.length], V(x, 0.3 + j * 0.62, 0)));
        P.push(part(cone(0.5, 0.75, 4), x > 0 ? '#ff8fb3' : '#7fd6ff', V(x, 2.85, 0), [0, Math.PI / 4, 0]));
        GL.push({ geo: new THREE.CircleGeometry(0.12, 16).translate(x, 1.9, 0.31), color: '#fff1c2' });
      }
      // 积木拱门 + 小旗
      P.push(part(new THREE.CylinderGeometry(0.33, 0.33, 0.6, 20, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), '#ffffff', V(0, 1.22, 0)));
      P.push(part(cyl(0.02, 0.02, 0.8, 6), '#ffffff', V(0, 2.2, 0)));
      P.push(part(cone(0.16, 0.3, 3).rotateZ(-Math.PI / 2), '#ff6b6b', V(0.15, 2.48, 0)));
      break;
    }
    default:
      P.push(part(sph(0.2), '#ffffff', V(0, 0.2, 0)));
  }
  const parts = [];
  if (P.length) parts.push({ geo: bake(P), mat: 'vc' });
  for (const p of GL) parts.push({ geo: p.geo, mat: 'glow', color: p.color });
  for (const p of GS) parts.push({ geo: p.geo, mat: 'glossy', color: p.color });
  for (const p of extra) parts.push(p); // 需要单独动起来的零件（风车叶等）：{ geo, mat, pos, spin }
  return { parts, anim };
}
