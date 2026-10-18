// 可踩物件的 3D 模型与互动表现。全部程序化建模，同类物件共享几何体与材质。
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';
import { ITEM_META } from './itemMeta.js';
import { roundedBox, starGeometry, heartGeometry, blobGeometry, scallopGeometry } from './geo.js';
import { Spring, Rng, TAU, ease } from '../core/util.js';
import { Tex } from '../render/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RAINBOW = ['#ff7f9e', '#ffa86b', '#ffd95c', '#8fe07a', '#6fd0ff', '#8f9bff', '#c58fff', '#ff8fd8', '#7fe8d0', '#ffc2a8'];

// 把多个带颜色的零件合并成一个网格（一次绘制，五颜六色）
function colored(parts) {
  const geos = [];
  const col = new THREE.Color();
  for (const p of parts) {
    let g = p.geo.clone();
    if (g.index) g = g.toNonIndexed();
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const m = new THREE.Matrix4().compose(
      p.pos || V(0, 0, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot || [0, 0, 0]))),
      p.scale ? (typeof p.scale === 'number' ? V(p.scale, p.scale, p.scale) : p.scale) : V(1, 1, 1),
    );
    g.applyMatrix4(m);
    col.set(p.color);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

function lathe(points, seg = 28) { return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg); }

/** 建造物件模型。返回 { obj, glow?:Material[], domes?:Mesh[], float?:{y,amp,speed}, sway?:Object3D[] } */
export function buildItem(type, ctx, rng, cell) {
  const { M, G } = ctx;
  const g = new THREE.Group();
  const res = { obj: g, glow: [], sway: [] };
  const mesh = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = false;
    g.add(m);
    return m;
  };
  const vc = (o = {}) => M.soft('#ffffff', { vc: true, ...o });
  const glowMat = (color, ei = 0.25, o = {}) => { const m = M.softUnique(color, { emissive: color, ei, rim: 0.5, ...o }); res.glow.push(m); return m; };
  const R = rng;

  switch (type) {
    // ---------------- 糖果森林 ----------------
    case 'marshmallow': {
      const geo = G.get('marsh', () => lathe([[0, 0], [0.28, 0], [0.33, 0.035], [0.35, 0.12], [0.33, 0.21], [0.28, 0.245], [0, 0.25]]));
      const c = R.pick(['#fff7fb', '#ffd6e8', '#d9f0ff', '#fff0c9']);
      mesh(geo, M.soft(c, { rough: 0.85, rim: 0.5, rimColor: '#ffffff' }));
      break;
    }
    case 'jelly': {
      const geo = G.get('jelly', () => roundedBox(0.52, 0.38, 0.52, 0.12, 4).translate(0, 0.19, 0));
      const c = R.pick(['#ff7fb8', '#7fe0a8', '#ffb35c', '#9f8fff']);
      mesh(geo, M.glossy(c, { opacity: 0.78, ei: 0.22 }));
      const core = G.get('jellyCore', () => roundedBox(0.3, 0.2, 0.3, 0.08, 3).translate(0, 0.17, 0));
      mesh(core, M.soft(c, { emissive: c, ei: 0.35, rim: 0.4 }));
      break;
    }
    case 'candy_wrapper': {
      const geo = G.get('wrapper', () => colored([
        { geo: new THREE.SphereGeometry(0.16, 16, 12), color: '#ffffff', scale: V(1.3, 0.75, 1), pos: V(0, 0.1, 0) },
        { geo: new THREE.ConeGeometry(0.12, 0.2, 8), color: '#ffffff', pos: V(-0.3, 0.1, 0), rot: [0, 0, -Math.PI / 2] },
        { geo: new THREE.ConeGeometry(0.12, 0.2, 8), color: '#ffffff', pos: V(0.3, 0.1, 0), rot: [0, 0, Math.PI / 2] },
      ]));
      const c = R.pick(['#ff6fa3', '#5cc8ff', '#ffd23f', '#8be07a']);
      mesh(geo, M.soft(c, { vc: true, rough: 0.18, rim: 0.7, map: Tex.stripes('#ffffff', c), flat: true }), 0, 0, 0, 1, 1, 1, 0, R.range(0, TAU), 0);
      break;
    }
    case 'chocolate': {
      const base = G.get('chocoBase', () => roundedBox(0.72, 0.07, 0.5, 0.03, 2).translate(0, 0.035, 0));
      const piece = G.get('chocoPiece', () => roundedBox(0.2, 0.06, 0.2, 0.03, 2));
      const mat = M.soft('#7a4524', { rough: 0.35, rim: 0.25, rimColor: '#ffcf9e' });
      mesh(base, mat);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) mesh(piece, mat, -0.23 + i * 0.23, 0.09, -0.11 + j * 0.22);
      g.rotation.y = R.range(-0.4, 0.4);
      break;
    }
    case 'popping_candy': {
      const geo = G.get('popping', () => {
        const parts = [{ geo: roundedBox(0.36, 0.06, 0.36, 0.02, 2), color: '#ffffff', pos: V(0, 0.03, 0) }];
        const rr = new Rng(77);
        for (let i = 0; i < 26; i++) parts.push({ geo: new THREE.SphereGeometry(0.035, 8, 6), color: RAINBOW[i % 7], pos: V(rr.range(-0.15, 0.15), 0.07 + rr.range(0, 0.04), rr.range(-0.15, 0.15)) });
        return colored(parts);
      });
      mesh(geo, vc({ rough: 0.3, rim: 0.4 }));
      break;
    }
    case 'gummy': {
      const geo = G.get('gummy', () => colored([
        { geo: blobGeometry(0.15, 2, 0.04, 2), color: '#ffffff', scale: V(1, 1.15, 0.75), pos: V(0, 0.17, 0) },
        { geo: new THREE.SphereGeometry(0.11, 16, 12), color: '#ffffff', pos: V(0, 0.36, 0) },
        { geo: new THREE.SphereGeometry(0.045, 10, 8), color: '#ffffff', pos: V(-0.08, 0.45, 0) },
        { geo: new THREE.SphereGeometry(0.045, 10, 8), color: '#ffffff', pos: V(0.08, 0.45, 0) },
        { geo: new THREE.SphereGeometry(0.05, 10, 8), color: '#ffffff', pos: V(-0.11, 0.07, 0.03) },
        { geo: new THREE.SphereGeometry(0.05, 10, 8), color: '#ffffff', pos: V(0.11, 0.07, 0.03) },
      ]));
      const c = R.pick(['#ff5c7a', '#ffb13b', '#5fd36b', '#ffe14d']);
      mesh(geo, M.glossy(c, { opacity: 0.85, ei: 0.25 }), 0, -0.02, 0, 0.8, 0.8, 0.8, -1.25, R.range(0, TAU), 0);
      break;
    }
    case 'cotton_candy': {
      const geo = G.get('cotton', () => colored([0, 1, 2, 3, 4, 5].map((i) => ({ geo: blobGeometry(0.14 + (i % 3) * 0.03, i, 0.1, 2), color: i % 2 ? '#ffc2e0' : '#c9e8ff', pos: V(Math.cos(i) * 0.15, 0.13 + (i % 2) * 0.08, Math.sin(i * 1.7) * 0.15) }))));
      mesh(geo, vc({ rough: 0.95, rim: 0.7, rimColor: '#ffffff' }));
      break;
    }
    // ---------------- 海底 ----------------
    case 'bubble': {
      const geo = G.get('bubble', () => new THREE.SphereGeometry(0.3, 28, 20));
      const m = mesh(geo, M.glossy('#bfefff', { opacity: 0.32, ei: 0.2, rim: 1.4, rimColor: '#ffe6ff', rough: 0.05 }), 0, 0.42, 0);
      m.castShadow = false;
      const hl = mesh(G.get('bubHL', () => new THREE.SphereGeometry(0.06, 10, 8)), M.basic('#ffffff', { opacity: 0.85 }), -0.1, 0.55, 0.2, 1, 0.7, 0.5);
      hl.castShadow = false;
      res.float = { y: 0, amp: 0.06, speed: 1.6 };
      break;
    }
    case 'seashell': {
      const geo = G.get('shell', () => scallopGeometry(0.26, 0.05).translate(0, 0.06, 0));
      const c = R.pick(['#ffc8d6', '#ffe0c2', '#f5d9ff']);
      mesh(geo, M.soft(c, { rough: 0.4, rim: 0.5 }), 0, 0, 0, 1, 1, 1, 0, R.range(0, TAU), 0);
      break;
    }
    case 'pearl': {
      const half = G.get('clamHalf', () => { const s = new THREE.SphereGeometry(0.3, 14, 8, 0, TAU, 0, Math.PI / 2); s.scale(1, 0.35, 1); return s; });
      const shellMat = M.soft('#d9c7ff', { flat: true, rough: 0.4, rim: 0.5, side: THREE.DoubleSide });
      mesh(half, shellMat, 0, 0.0, 0, 1, -1, 1).position.y = 0.1;
      const top = mesh(half, shellMat, 0, 0.12, -0.25, 1, 1, 1, -0.9, 0, 0);
      top.castShadow = true;
      mesh(G.get('pearl', () => new THREE.SphereGeometry(0.1, 20, 14)), glowMat('#fff7ff', 0.15, { rough: 0.15, rim: 1.0, rimColor: '#ffd6f5' }), 0, 0.17, 0.02);
      break;
    }
    case 'seaweed': {
      const blade = G.get('blade', () => { const b = new THREE.BoxGeometry(0.06, 0.6, 0.02, 1, 6, 1); b.translate(0, 0.3, 0); return b; });
      const mat = M.soft('#4fcf8f', { rough: 0.6, rim: 0.4 });
      for (let i = 0; i < 4; i++) {
        const piv = new THREE.Group(); piv.position.set(R.range(-0.25, 0.25), 0, R.range(-0.25, 0.25)); g.add(piv);
        const b = new THREE.Mesh(blade, mat); b.castShadow = true; b.rotation.y = R.range(0, TAU); piv.add(b);
        piv.userData.ph = R.range(0, TAU);
        res.sway.push(piv);
      }
      break;
    }
    case 'starfish': {
      const geo = G.get('starfish', () => { const s = starGeometry(0.3, 0.13, 0.05); s.rotateX(-Math.PI / 2); s.translate(0, 0.06, 0); return s; });
      const c = R.pick(['#ff8f6b', '#ff9ec4', '#ffbf5c']);
      mesh(geo, M.soft(c, { rough: 0.7, rim: 0.3 }), 0, 0, 0, 1, 1, 1, 0, R.range(0, TAU), 0);
      break;
    }
    case 'jellyfish': {
      const dome = G.get('jfDome', () => { const s = new THREE.SphereGeometry(0.3, 24, 12, 0, TAU, 0, Math.PI / 2); s.scale(1, 0.8, 1); return s; });
      const c = R.pick(['#ffb3ec', '#b3d9ff', '#d8b3ff']);
      mesh(dome, M.glossy(c, { opacity: 0.7, ei: 0.35 }), 0, 0.28, 0);
      const ten = G.get('jfTen', () => new THREE.CylinderGeometry(0.015, 0.008, 0.26, 6).translate(0, -0.13, 0));
      const tm = M.glossy(c, { opacity: 0.6, ei: 0.3 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; const t = mesh(ten, tm, Math.cos(a) * 0.18, 0.3, Math.sin(a) * 0.18); t.userData.ph = a; res.sway.push(t); }
      res.float = { y: 0, amp: 0.05, speed: 1.2 };
      break;
    }
    case 'tide_pool': {
      const geo = G.get('pool', () => { const c = new THREE.CircleGeometry(0.42, 24); c.rotateX(-Math.PI / 2); return c; });
      mesh(geo, M.glossy('#6fd0ff', { opacity: 0.8, ei: 0.25, rim: 0.6 }), 0, 0.012, 0).castShadow = false;
      const pebble = G.get('pebble', () => blobGeometry(0.06, 3, 0.15, 1));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; mesh(pebble, M.soft(R.pick(['#e8dccb', '#d0c4b4', '#f2e6d8']), { flat: true }), Math.cos(a) * 0.45, 0.03, Math.sin(a) * 0.45); }
      break;
    }
    // ---------------- 雪国 ----------------
    case 'snow_pile': {
      const geo = G.get('snowpile', () => colored([0, 1, 2, 3, 4].map((i) => ({ geo: blobGeometry(0.17 + (i % 2) * 0.05, i * 3, 0.12, 2), color: '#ffffff', pos: V(Math.cos(i * 1.3) * 0.15, 0.06, Math.sin(i * 1.3) * 0.15), scale: V(1, 0.65, 1) }))));
      mesh(geo, vc({ rough: 0.9, rim: 0.6, rimColor: '#d8ecff' }));
      break;
    }
    case 'ice_sheet': {
      const geo = G.get('icesheet', () => roundedBox(1.0, 0.04, 1.0, 0.02, 2).translate(0, 0.02, 0));
      mesh(geo, M.glossy('#cfefff', { opacity: 0.75, ei: 0.2, rim: 1.0, rough: 0.05 })).castShadow = false;
      break;
    }
    case 'icicle': {
      const cr = G.get('icicleCr', () => { const o = new THREE.OctahedronGeometry(0.12, 0); o.scale(0.6, 2.2, 0.6); o.translate(0, 0.26, 0); return o; });
      const mat = glowMat('#bfe8ff', 0.25, { opacity: 1, rough: 0.1, rim: 1.2 });
      for (let i = 0; i < 3; i++) mesh(cr, mat, 0.38 * Math.cos(i * 2.1 + 0.5), 0, 0.38 * Math.sin(i * 2.1 + 0.5), 1, 0.6 + i * 0.25, 1, 0, 0, R.range(-0.2, 0.2));
      const disc = G.get('frostDisc', () => { const c = new THREE.CircleGeometry(0.34, 6); c.rotateX(-Math.PI / 2); return c; });
      mesh(disc, M.glossy('#e6f6ff', { opacity: 0.7, ei: 0.2 }), 0, 0.01, 0).castShadow = false;
      break;
    }
    case 'snowball': {
      mesh(G.get('snowball', () => blobGeometry(0.26, 5, 0.05, 3).translate(0, 0.24, 0)), M.soft('#ffffff', { rough: 0.9, rim: 0.6, rimColor: '#d8ecff' }));
      break;
    }
    case 'frost_flower': {
      const petal = G.get('frostPetal', () => { const o = new THREE.OctahedronGeometry(0.1, 0); o.scale(0.5, 0.2, 2.0); o.translate(0, 0.04, 0.18); return o; });
      const mat = glowMat('#a8dcff', 0.3, { rough: 0.1, rim: 1.0 });
      for (let i = 0; i < 6; i++) mesh(petal, mat, 0, 0, 0, 1, 1, 1, 0, (i / 6) * TAU, 0);
      mesh(G.get('frostCore', () => new THREE.IcosahedronGeometry(0.08, 0)), mat, 0, 0.07, 0);
      break;
    }
    case 'ice_crack': {
      mesh(G.get('thinIce', () => roundedBox(0.8, 0.03, 0.8, 0.015, 2).translate(0, 0.015, 0)), M.glossy('#e3f5ff', { opacity: 0.65, ei: 0.15, rim: 0.8 })).castShadow = false;
      const crack = G.get('crack', () => new THREE.BoxGeometry(0.4, 0.005, 0.012));
      const cm = M.basic('#ffffff', { opacity: 0.9 });
      for (let i = 0; i < 4; i++) mesh(crack, cm, 0, 0.034, 0, R.range(0.6, 1.2), 1, 1, 0, R.range(0, TAU), 0).castShadow = false;
      break;
    }
    // ---------------- 森林 ----------------
    case 'mushroom': {
      const stem = G.get('mStem', () => lathe([[0, 0], [0.13, 0], [0.11, 0.12], [0.1, 0.22], [0, 0.22]], 20));
      const cap = G.get('mCap', () => { const s = new THREE.SphereGeometry(0.32, 28, 14, 0, TAU, 0, Math.PI / 2); s.scale(1, 0.62, 1); s.translate(0, 0.2, 0); return s; });
      const spot = G.get('mSpot', () => new THREE.SphereGeometry(0.05, 10, 8));
      const c = R.pick(['#ff6b6b', '#ff8fb3', '#ffb347', '#b38fff']);
      mesh(stem, M.soft('#fff3df', { rim: 0.4 }));
      mesh(cap, M.soft(c, { rough: 0.45, rim: 0.4 }));
      const sm = M.soft('#ffffff', { rough: 0.6 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; const r = i % 2 ? 0.2 : 0.14; mesh(spot, sm, Math.cos(a) * r, 0.36 - r * 0.45, Math.sin(a) * r, 1, 0.45, 1); }
      break;
    }
    case 'leaf_pile': {
      const geo = G.get('leafpile', () => {
        const parts = [];
        const rr = new Rng(11);
        const cols = ['#f2a03d', '#e2703a', '#f6c445', '#c9d65a', '#d9572e'];
        for (let i = 0; i < 22; i++) parts.push({ geo: new THREE.SphereGeometry(0.09, 8, 4), color: cols[i % cols.length], scale: V(1, 0.18, 0.55), pos: V(rr.range(-0.3, 0.3), 0.02 + rr.range(0, 0.08), rr.range(-0.3, 0.3)), rot: [rr.range(-0.4, 0.4), rr.range(0, TAU), rr.range(-0.4, 0.4)] });
        return colored(parts);
      });
      mesh(geo, vc({ rough: 0.8, rim: 0.3 }));
      break;
    }
    case 'twig': {
      const st = G.get('twig', () => new THREE.CylinderGeometry(0.025, 0.03, 0.62, 6).rotateZ(Math.PI / 2));
      const mat = M.soft('#8a5a36', { rough: 0.9, rim: 0.2 });
      mesh(st, mat, 0, 0.03, 0, 1, 1, 1, 0, R.range(0, TAU), 0);
      mesh(st, mat, 0, 0.05, 0, 0.7, 1, 1, 0, R.range(0, TAU), 0);
      break;
    }
    case 'puddle': {
      const geo = G.get('puddle', () => { const c = new THREE.CircleGeometry(0.42, 28); c.rotateX(-Math.PI / 2); return c; });
      mesh(geo, M.glossy('#7fd0f5', { opacity: 0.78, ei: 0.25, rim: 0.7, rough: 0.05 }), 0, 0.012, 0, 1, 1, R.range(0.7, 0.95), 0, R.range(0, TAU), 0).castShadow = false;
      break;
    }
    case 'acorn': {
      const geo = G.get('acorn', () => colored([
        { geo: new THREE.SphereGeometry(0.1, 14, 10), color: '#c98a45', scale: V(1, 1.25, 1), pos: V(0, 0.11, 0) },
        { geo: new THREE.SphereGeometry(0.11, 14, 8, 0, TAU, 0, Math.PI / 2), color: '#8a5a36', pos: V(0, 0.15, 0) },
        { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), color: '#6b4426', pos: V(0, 0.27, 0) },
      ]));
      const m = vc({ rough: 0.55, rim: 0.3 });
      mesh(geo, m, -0.12, 0, 0.05, 1, 1, 1, 0, 0, 0.3);
      mesh(geo, m, 0.14, 0, -0.06, 0.85, 0.85, 0.85, 0.4, 1, -0.6);
      break;
    }
    case 'log': {
      const body = G.get('log', () => new THREE.CylinderGeometry(0.2, 0.2, 0.62, 18).rotateZ(Math.PI / 2).translate(0, 0.2, 0));
      const ring = G.get('logRing', () => new THREE.CircleGeometry(0.18, 18).rotateY(Math.PI / 2));
      mesh(body, M.soft('#a8754a', { rough: 0.9, rim: 0.2 }), 0, 0, 0, 1, 1, 1, 0, R.range(-0.4, 0.4), 0);
      const rm = M.soft('#e8c79a', { rough: 0.8 });
      const rot = g.children[0].rotation.y;
      mesh(ring, rm, Math.cos(rot) * 0.312, 0.2, -Math.sin(rot) * 0.312, 1, 1, 1, 0, rot, 0);
      mesh(ring, rm, -Math.cos(rot) * 0.312, 0.2, Math.sin(rot) * 0.312, 1, 1, 1, 0, rot + Math.PI, 0);
      break;
    }
    case 'lily_pad': {
      mesh(G.get('pond', () => new THREE.CircleGeometry(0.46, 24).rotateX(-Math.PI / 2)), M.glossy('#6fc8e8', { opacity: 0.8, ei: 0.2 }), 0, 0.01, 0).castShadow = false;
      mesh(G.get('pad', () => new THREE.CircleGeometry(0.3, 24, 0.3, TAU - 0.6).rotateX(-Math.PI / 2)), M.soft('#5fbf5f', { side: THREE.DoubleSide, rim: 0.3 }), 0, 0.025, 0, 1, 1, 1, 0, R.range(0, TAU), 0);
      mesh(G.get('lotus', () => colored([0, 1, 2, 3, 4].map((i) => ({ geo: new THREE.SphereGeometry(0.05, 8, 6), color: '#ffb3d1', scale: V(0.6, 1.2, 0.6), pos: V(Math.cos(i * 1.26) * 0.04, 0.05, Math.sin(i * 1.26) * 0.04), rot: [Math.cos(i * 1.26) * 0.5, 0, Math.sin(i * 1.26) * 0.5] })))), vc(), 0.16, 0.02, 0.1);
      break;
    }
    case 'flower_bell': {
      mesh(G.get('leafBase', () => new THREE.CircleGeometry(0.34, 7).rotateX(-Math.PI / 2)), M.soft('#7fcf6a', { rim: 0.3, side: THREE.DoubleSide }), 0, 0.012, 0).castShadow = false;
      const stem = G.get('bellStem', () => new THREE.CylinderGeometry(0.012, 0.015, 0.5, 6).translate(0, 0.25, 0));
      mesh(stem, M.soft('#5fae5a'), 0.36, 0, -0.2, 1, 1, 1, 0, 0, -0.25);
      const bell = G.get('bell', () => { const c = new THREE.ConeGeometry(0.07, 0.11, 12, 1, true); c.translate(0, -0.05, 0); return c; });
      const c = R.pick(['#8fa8ff', '#c38fff', '#ff9ec4']);
      const bm = glowMat(c, 0.1, { side: THREE.DoubleSide });
      mesh(bell, bm, 0.42, 0.45, -0.2); mesh(bell, bm, 0.3, 0.38, -0.16); mesh(bell, bm, 0.48, 0.32, -0.26);
      break;
    }
    // ---------------- 烘焙屋 ----------------
    case 'macaron': {
      const shell = G.get('macShell', () => { const s = new THREE.SphereGeometry(0.22, 24, 12); s.scale(1, 0.32, 1); return s; });
      const fill = G.get('macFill', () => new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24));
      const c = R.pick(['#ffb3d1', '#b3e6c9', '#c9b3ff', '#ffe0a3', '#a3d8ff']);
      const sm = M.soft(c, { rough: 0.7, rim: 0.4 });
      mesh(shell, sm, 0, 0.06, 0); mesh(fill, M.soft('#fffaf2', { rough: 0.9 }), 0, 0.11, 0); mesh(shell, sm, 0, 0.16, 0);
      break;
    }
    case 'biscuit': {
      const base = G.get('biscuit', () => new THREE.CylinderGeometry(0.3, 0.3, 0.07, 26).translate(0, 0.035, 0));
      const chip = G.get('chip', () => new THREE.SphereGeometry(0.035, 8, 6));
      mesh(base, M.soft('#e0a560', { rough: 0.85, rim: 0.3 }));
      const cm = M.soft('#5c321a', { rough: 0.5 });
      for (let i = 0; i < 7; i++) { const a = R.range(0, TAU), r = R.range(0.05, 0.22); mesh(chip, cm, Math.cos(a) * r, 0.075, Math.sin(a) * r, 1, 0.6, 1); }
      break;
    }
    case 'cream_puff': {
      mesh(G.get('puff', () => blobGeometry(0.24, 4, 0.08, 3).scale(1, 0.7, 1).translate(0, 0.14, 0)), M.soft('#f2c27c', { rough: 0.8, rim: 0.3 }));
      mesh(G.get('cream', () => blobGeometry(0.15, 7, 0.15, 2).scale(1, 0.8, 1)), M.soft('#fffdf8', { rough: 0.9, rim: 0.5 }), 0, 0.3, 0);
      mesh(G.get('cherry', () => new THREE.SphereGeometry(0.05, 12, 10)), M.soft('#ff4d6d', { rough: 0.25 }), 0, 0.41, 0);
      break;
    }
    case 'pudding': {
      const body = G.get('pudding', () => lathe([[0, 0], [0.3, 0], [0.31, 0.02], [0.26, 0.24], [0.22, 0.27], [0, 0.27]]));
      mesh(body, M.glossy('#ffd86b', { opacity: 0.95, ei: 0.15, rim: 0.6, rough: 0.2 }));
      mesh(G.get('caramel', () => new THREE.CylinderGeometry(0.22, 0.235, 0.04, 24).translate(0, 0.28, 0)), M.soft('#9a5418', { rough: 0.2, rim: 0.4 }));
      mesh(G.get('cherry', () => new THREE.SphereGeometry(0.05, 12, 10)), M.soft('#ff4d6d', { rough: 0.25 }), 0, 0.35, 0);
      break;
    }
    case 'sugar_cube': {
      const cube = G.get('sugar', () => roundedBox(0.18, 0.18, 0.18, 0.03, 2));
      const m = M.soft('#ffffff', { rough: 0.95, rim: 0.4, flat: false });
      mesh(cube, m, -0.1, 0.09, 0.05, 1, 1, 1, 0, 0.3, 0); mesh(cube, m, 0.11, 0.09, -0.04, 1, 1, 1, 0, -0.2, 0); mesh(cube, m, 0.0, 0.27, 0.0, 1, 1, 1, 0, 0.7, 0);
      break;
    }
    case 'honey': {
      mesh(G.get('honeyPool', () => blobGeometry(0.36, 9, 0.12, 2).scale(1, 0.06, 1).translate(0, 0.012, 0)), M.glossy('#ffb627', { opacity: 0.9, ei: 0.3, rim: 0.8, rough: 0.1 })).castShadow = false;
      break;
    }
    case 'donut': {
      mesh(G.get('donut', () => new THREE.TorusGeometry(0.2, 0.1, 14, 28).rotateX(Math.PI / 2).translate(0, 0.1, 0)), M.soft('#e8a25c', { rough: 0.8 }));
      mesh(G.get('frost', () => { const t = new THREE.TorusGeometry(0.2, 0.085, 10, 28, TAU); t.rotateX(Math.PI / 2); t.scale(1, 0.6, 1); t.translate(0, 0.15, 0); return t; }), M.soft(R.pick(['#ff9ec4', '#a3d8ff', '#c9a0ff', '#fff0a3']), { rough: 0.3, rim: 0.4 }));
      const sp = G.get('sprinkle', () => new THREE.CapsuleGeometry(0.01, 0.035, 2, 6));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + R.range(0, 0.4); mesh(sp, M.soft(RAINBOW[i % 7]), Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2, 1, 1, 1, Math.PI / 2, 0, a); }
      break;
    }
    case 'sprinkles': {
      mesh(G.get('icing', () => blobGeometry(0.34, 3, 0.1, 2).scale(1, 0.05, 1).translate(0, 0.01, 0)), M.soft('#fff6fb', { rough: 0.6 })).castShadow = false;
      const geo = G.get('sprinkleField', () => { const rr = new Rng(5); const parts = []; for (let i = 0; i < 30; i++) { const a = rr.range(0, TAU), r = rr.range(0, 0.3); parts.push({ geo: new THREE.CapsuleGeometry(0.012, 0.04, 2, 6), color: RAINBOW[i % 8], pos: V(Math.cos(a) * r, 0.03, Math.sin(a) * r), rot: [Math.PI / 2, 0, rr.range(0, TAU)] }); } return colored(parts); });
      mesh(geo, vc({ rough: 0.4 })).castShadow = false;
      break;
    }
    // ---------------- 天空 ----------------
    case 'cloud': {
      mesh(G.get('cloudItem', () => colored([0, 1, 2, 3, 4, 5].map((i) => ({ geo: blobGeometry(0.17 + (i % 3) * 0.04, i * 2, 0.05, 2), color: '#ffffff', pos: V(Math.cos(i * 1.05) * 0.2, 0.1 + (i % 2) * 0.05, Math.sin(i * 1.05) * 0.2), scale: V(1, 0.7, 1) })))), vc({ rough: 0.95, rim: 0.7, rimColor: '#dbeeff' }));
      break;
    }
    case 'star_tile': {
      mesh(G.get('starTile', () => { const s = starGeometry(0.36, 0.17, 0.03); s.rotateX(-Math.PI / 2); s.translate(0, 0.03, 0); return s; }), glowMat('#ffd84d', 0.35, { rim: 0.5 })).castShadow = false;
      break;
    }
    case 'rainbow': {
      const c = RAINBOW[(cell?.note ?? R.int(0, 9)) % RAINBOW.length];
      mesh(G.get('rbKey', () => roundedBox(0.9, 0.05, 0.9, 0.04, 2).translate(0, 0.025, 0)), glowMat(c, 0.25, { rim: 0.5 })).castShadow = false;
      break;
    }
    case 'wind_chime': {
      mesh(G.get('chimePost', () => new THREE.CylinderGeometry(0.02, 0.025, 0.7, 6).translate(0, 0.35, 0)), M.soft('#e8c79a'), 0.38, 0, -0.3);
      mesh(G.get('chimeBar', () => new THREE.CylinderGeometry(0.015, 0.015, 0.36, 6).rotateZ(Math.PI / 2)), M.soft('#e8c79a'), 0.38, 0.68, -0.3);
      const tube = G.get('chimeTube', () => new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8).translate(0, -0.1, 0));
      const tm = glowMat('#cfe8ff', 0.15, { rough: 0.2, rim: 0.8 });
      for (let i = 0; i < 4; i++) { const t = mesh(tube, tm, 0.24 + i * 0.09, 0.66, -0.3, 1, 0.7 + (i % 2) * 0.4, 1); t.userData.ph = i; res.sway.push(t); }
      mesh(G.get('chimeDisc', () => new THREE.CircleGeometry(0.3, 20).rotateX(-Math.PI / 2)), M.soft('#f0f7ff', { rim: 0.4 }), 0, 0.01, 0).castShadow = false;
      break;
    }
    case 'feather': {
      const geo = G.get('feather', () => { const s = new THREE.SphereGeometry(0.1, 16, 8); s.scale(1.0, 0.15, 3.2); return s; });
      mesh(geo, M.soft('#ffffff', { rough: 0.9, rim: 0.7, rimColor: '#ffd6ec' }), 0, 0.03, 0, 1, 1, 1, 0, R.range(0, TAU), 0.1);
      break;
    }
    case 'sky_bounce': {
      mesh(G.get('skyBounce', () => colored([0, 1, 2, 3, 4, 5, 6].map((i) => ({ geo: blobGeometry(0.18, i * 4, 0.05, 2), color: i === 6 ? '#ffffff' : (i % 2 ? '#ffd6ec' : '#ffffff'), pos: i === 6 ? V(0, 0.18, 0) : V(Math.cos(i * 1.05) * 0.24, 0.12, Math.sin(i * 1.05) * 0.24), scale: V(1, 0.75, 1) })))), vc({ rough: 0.9, rim: 0.7 }));
      break;
    }
    // ---------------- 玩具屋 ----------------
    case 'bubble_wrap': {
      mesh(G.get('wrapSheet', () => roundedBox(0.92, 0.02, 0.92, 0.01, 1).translate(0, 0.01, 0)), M.glossy('#e6f6ff', { opacity: 0.55, ei: 0.1 })).castShadow = false;
      const dome = G.get('wrapDome', () => new THREE.SphereGeometry(0.11, 14, 8, 0, TAU, 0, Math.PI / 2));
      const dm = M.glossy('#f2fbff', { opacity: 0.6, ei: 0.15, rim: 1.2, rough: 0.05 });
      res.domes = [];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const d = mesh(dome, dm, -0.28 + i * 0.28, 0.02, -0.28 + j * 0.28); d.castShadow = false; res.domes.push(d); }
      break;
    }
    case 'keycap': {
      const cap = G.get('keycap', () => { const b = roundedBox(0.5, 0.2, 0.5, 0.07, 3); const p = b.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 - (y + 0.1) * 0.35; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } b.computeVertexNormals(); b.translate(0, 0.1, 0); return b; });
      const c = R.pick(['#ffd6e8', '#d6ecff', '#fff3c2', '#dcf7d6', '#e6dcff']);
      mesh(cap, M.soft(c, { rough: 0.5, rim: 0.4 }));
      mesh(G.get('paw', () => new THREE.CircleGeometry(0.06, 16).rotateX(-Math.PI / 2)), M.basic('#ffffff', { opacity: 0.85 }), 0, 0.205, 0.02).castShadow = false;
      break;
    }
    case 'wood_block': {
      const c = R.pick(['#ff9e9e', '#9ed8ff', '#ffe08a', '#a8e6a1']);
      mesh(G.get('block', () => roundedBox(0.44, 0.44, 0.44, 0.05, 2).translate(0, 0.22, 0)), M.soft('#f6e2c4', { rough: 0.7, rim: 0.3 }), 0, 0, 0, 1, 0.6, 1, 0, R.range(-0.3, 0.3), 0);
      mesh(G.get('blockFace', () => roundedBox(0.3, 0.02, 0.3, 0.01, 1)), M.soft(c, { rough: 0.6 }), 0, 0.27, 0, 1, 1, 1, 0, g.children[0].rotation.y, 0).castShadow = false;
      break;
    }
    case 'plush': {
      mesh(G.get('plushHeart', () => { const h = heartGeometry(0.28, 0.12); h.rotateX(-Math.PI / 2); h.translate(0, 0.1, 0); return h; }), M.soft(R.pick(['#ffb3d1', '#c9b3ff', '#b3e0ff']), { rough: 0.95, rim: 0.6, rimColor: '#ffffff' }), 0, 0, 0, 1, 1, 1, 0, R.range(-0.5, 0.5), 0);
      break;
    }
    case 'slime': {
      const c = R.pick(['#8ff5c0', '#c9a0ff', '#ff9ed1', '#9fe0ff']);
      mesh(G.get('slime', () => blobGeometry(0.34, 6, 0.1, 3).scale(1, 0.32, 1).translate(0, 0.06, 0)), M.glossy(c, { opacity: 0.88, ei: 0.25, rim: 1.0, rough: 0.08 }));
      const bub = G.get('slimeBub', () => new THREE.SphereGeometry(0.03, 8, 6));
      for (let i = 0; i < 4; i++) mesh(bub, M.basic('#ffffff', { opacity: 0.6 }), R.range(-0.18, 0.18), 0.1, R.range(-0.18, 0.18)).castShadow = false;
      break;
    }
    case 'piano_key': {
      const white = M.soft('#ffffff', { rough: 0.3, rim: 0.4 });
      mesh(G.get('pKey', () => roundedBox(0.9, 0.08, 0.9, 0.03, 2).translate(0, 0.04, 0)), white).castShadow = false;
      const c = RAINBOW[(cell?.note ?? 0) % RAINBOW.length];
      mesh(G.get('pKeyTop', () => roundedBox(0.3, 0.05, 0.5, 0.02, 1)), glowMat(c, 0.2), 0, 0.1, -0.18).castShadow = false;
      break;
    }
    case 'kinetic_sand': {
      const c = R.pick(['#ffb3d1', '#b3d9ff', '#d6c2ff']);
      mesh(G.get('ksand', () => blobGeometry(0.34, 8, 0.06, 2).scale(1, 0.25, 1).translate(0, 0.05, 0)), M.soft(c, { rough: 1, rim: 0.2, flat: false }));
      break;
    }
    case 'soap': {
      const c = R.pick(['#c9f0ff', '#ffe0f0', '#e8ffd6']);
      mesh(G.get('soap', () => roundedBox(0.44, 0.14, 0.3, 0.06, 3).translate(0, 0.07, 0)), M.soft(c, { rough: 0.35, rim: 0.6 }), 0, 0, 0, 1, 1, 1, 0, R.range(0, TAU), 0);
      const bub = G.get('soapBub', () => new THREE.SphereGeometry(0.04, 10, 8));
      for (let i = 0; i < 3; i++) mesh(bub, M.glossy('#ffffff', { opacity: 0.5 }), R.range(-0.12, 0.12), 0.17, R.range(-0.08, 0.08));
      break;
    }
    // ---------------- 水晶洞 ----------------
    case 'crystal': {
      const cr = G.get('crystal', () => { const c = new THREE.CylinderGeometry(0.07, 0.09, 0.4, 6); const top = new THREE.ConeGeometry(0.07, 0.14, 6).translate(0, 0.27, 0); const m = mergeGeometries([c.toNonIndexed(), top.toNonIndexed()]); m.translate(0, 0.2, 0); return m; });
      const c = R.pick(['#9fe8ff', '#e7b3ff', '#ffb3e6', '#b3ffd9']);
      const mat = glowMat(c, 0.6, { rough: 0.15, rim: 1.0, flat: true });
      const n = R.int(3, 4);
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU + R.range(0, 0.5); mesh(cr, mat, Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36, 1, R.range(0.6, 1.2), 1, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25); }
      break;
    }
    case 'cave_drip': {
      mesh(G.get('cavePool', () => new THREE.CircleGeometry(0.36, 24).rotateX(-Math.PI / 2)), M.glossy('#5fb3ff', { opacity: 0.8, ei: 0.4 }), 0, 0.012, 0).castShadow = false;
      const drop = mesh(G.get('drop', () => new THREE.SphereGeometry(0.035, 10, 8).scale(1, 1.4, 1)), M.glossy('#bfe6ff', { opacity: 0.9, ei: 0.6 }), 0, 2.5, 0);
      drop.castShadow = false;
      res.drop = drop;
      break;
    }
    case 'gem': {
      const geo = G.get('gem', () => new THREE.OctahedronGeometry(0.17, 0).scale(1, 1.3, 1).translate(0, 0.25, 0));
      const c = R.pick(['#ff7fd8', '#7fd8ff', '#ffe066', '#9dff7f']);
      mesh(G.get('gemRock', () => blobGeometry(0.17, 4, 0.2, 1).scale(1.3, 0.5, 1.3).translate(0, 0.05, 0)), M.soft('#6c5ca0', { flat: true, rough: 0.9 }));
      mesh(geo, glowMat(c, 0.5, { flat: true, rough: 0.15, rim: 0.8 }));
      res.spin = 0.6;
      break;
    }
    case 'rock_sugar': {
      const lump = G.get('rsugar', () => new THREE.IcosahedronGeometry(0.11, 0));
      const mat = M.glossy('#f2f6ff', { opacity: 0.85, ei: 0.25, rim: 1.0, rough: 0.1 });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; mesh(lump, mat, Math.cos(a) * 0.18, 0.08, Math.sin(a) * 0.18, 1, R.range(0.8, 1.4), 1, R.range(0, 3), R.range(0, 3), 0); }
      break;
    }
    case 'glow_mushroom': {
      mesh(G.get('gmStem', () => lathe([[0, 0], [0.1, 0], [0.08, 0.2], [0, 0.2]], 16)), M.soft('#e6f7ff', { emissive: '#9fe8ff', ei: 0.2 }));
      const cap = G.get('gmCap', () => { const s = new THREE.SphereGeometry(0.3, 24, 12, 0, TAU, 0, Math.PI / 2); s.scale(1, 0.55, 1); s.translate(0, 0.18, 0); return s; });
      mesh(cap, glowMat(R.pick(['#5ff0ff', '#c38bff', '#7dffc8']), 0.8, { rim: 0.8 }));
      break;
    }
    case 'stone_tile': {
      mesh(G.get('slab', () => roundedBox(0.7, 0.08, 0.7, 0.04, 2).translate(0, 0.04, 0)), M.soft('#8f82c0', { rough: 0.9, rim: 0.2 }), 0, 0, 0, 1, 1, 1, 0, R.range(0, TAU), 0);
      mesh(G.get('rune', () => new THREE.RingGeometry(0.1, 0.14, 6).rotateX(-Math.PI / 2)), glowMat('#9fe8ff', 1.0), 0, 0.085, 0).castShadow = false;
      break;
    }
    default: {
      mesh(G.get('fallback', () => new THREE.SphereGeometry(0.2, 12, 10).translate(0, 0.2, 0)), M.soft('#ffffff'));
    }
  }
  return res;
}

// ---------------- 物件实例：状态与动画 ----------------
export class ItemInstance {
  constructor(type, cell, built, basePos) {
    this.type = type;
    this.meta = ITEM_META[type] || { label: type, sound: 'step_candy', react: 'squish', h: 0.05 };
    this.cell = cell;
    this.obj = built.obj;
    this.built = built;
    this.base = basePos.clone();
    this.obj.position.copy(basePos);
    this.squash = new Spring(220, 9, 1);
    this.state = 'idle';
    this.timer = 0;
    this.glow = 0;
    this.t = Math.random() * 10;
    this.popped = 0;
    this.stepCount = 0;
    this.restScaleY = 1;
    this.baseRotY = this.obj.rotation.y;
  }

  // 是否可以触发（被踩破/踩碎后还没长回来时不触发声音）
  get available() { return this.state === 'idle'; }

  /** 被糯糯踩到：更新外观状态，返回给游戏的反馈 */
  step() {
    const m = this.meta;
    this.stepCount++;
    if (!this.available) return null;
    switch (m.react) {
      case 'squish': this.squash.x = 0.55; this.squash.v = 0; break;
      case 'bounce': this.squash.x = 0.5; this.squash.v = -2; break;
      case 'chime': this.glow = 1; this.squash.x = 0.85; break;
      case 'crinkle': this.squash.x = 0.6; break;
      case 'fizz': this.glow = 1; this.squash.x = 0.85; break;
      case 'sticky': this.squash.x = 0.7; break;
      case 'splash': this.squash.x = 0.9; break;
      case 'slide': this.glow = 1; break;
      case 'crunch':
        this.squash.x = 0.4;
        if ((m.respawn || 0) > 0.05) { this.state = 'broken'; this.timer = m.respawn; }
        break;
      case 'pop':
        this.state = 'popping'; this.timer = 0.12;
        break;
      case 'multipop': this.squash.x = 0.85; break;
      default: this.squash.x = 0.7;
    }
    return { sound: m.sound, note: this.cell.note, react: m.react, fx: m.fx, label: m.label };
  }

  // 气泡膜：踩爆其中一个泡泡（返回是否还有）
  popDome() {
    const domes = this.built.domes;
    if (!domes) return false;
    const left = domes.filter((d) => !d.userData.popped);
    if (!left.length) return false;
    const d = left[Math.floor(Math.random() * left.length)];
    d.userData.popped = true;
    d.scale.set(1.05, 0.15, 1.05);
    this.popped++;
    if (left.length === 1) { this.state = 'broken'; this.timer = 10; }
    return true;
  }

  update(dt) {
    this.t += dt;
    const sq = this.squash.update(dt);
    const o = this.obj;
    if (this.state === 'broken') {
      this.timer -= dt;
      // 踩碎后保持扁扁的，过一会儿慢慢长回来
      const sy = 0.38;
      o.scale.set(1.15, sy, 1.15);
      if (this.timer <= 0) {
        this.state = 'regrow'; this.timer = 0;
        if (this.built.domes) for (const d of this.built.domes) { d.userData.popped = false; d.scale.set(1, 1, 1); }
      }
    } else if (this.state === 'regrow') {
      this.timer += dt * 1.6;
      const s = ease.outBack(Math.min(1, this.timer));
      o.scale.set(1.15 - 0.15 * s, 0.38 + 0.62 * s, 1.15 - 0.15 * s);
      if (this.timer >= 1) { this.state = 'idle'; o.scale.set(1, 1, 1); this.squash.x = 1; this.onRegrow && this.onRegrow(this); }
    } else if (this.state === 'popping') {
      this.timer -= dt;
      const s = 1 + (0.12 - Math.max(0, this.timer)) * 3;
      o.scale.setScalar(s);
      if (this.timer <= 0) { this.state = 'gone'; this.timer = this.meta.respawn || 6; o.visible = false; }
    } else if (this.state === 'gone') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'regrowPop'; this.timer = 0; o.visible = true; o.scale.setScalar(0.01); }
    } else if (this.state === 'regrowPop') {
      this.timer += dt * 1.8;
      o.scale.setScalar(Math.max(0.01, ease.outBack(Math.min(1, this.timer))));
      if (this.timer >= 1) { this.state = 'idle'; o.scale.setScalar(1); this.onRegrow && this.onRegrow(this); }
    } else {
      const sy = Math.max(0.3, sq);
      const sxz = 1 / Math.sqrt(sy);
      o.scale.set(sxz, sy, sxz);
    }
    // 漂浮、旋转、摇摆
    const b = this.built;
    if (b.float) o.position.y = this.base.y + Math.sin(this.t * b.float.speed) * b.float.amp;
    if (b.spin) o.rotation.y = this.baseRotY + this.t * b.spin;
    if (b.sway) for (const s of b.sway) { s.rotation.z = Math.sin(this.t * 1.6 + (s.userData.ph || 0)) * 0.18; s.rotation.x = Math.cos(this.t * 1.2 + (s.userData.ph || 0)) * 0.08; }
    if (b.drop) {
      const cyc = (this.t % 3.2) / 3.2;
      b.drop.position.y = 2.5 - cyc * cyc * 2.5;
      b.drop.visible = cyc < 0.98;
    }
    // 发光脉冲
    if (b.glow.length) {
      this.glow = Math.max(0, this.glow - dt * 1.5);
      for (const m of b.glow) {
        if (m.userData.baseEI == null) m.userData.baseEI = m.emissiveIntensity;
        m.emissiveIntensity = m.userData.baseEI + this.glow * 1.4;
      }
    }
  }
}
