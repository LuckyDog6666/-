// 几何体工具：圆角方块、星形、爱心等可爱形状，以及按关卡统一释放的几何体仓库。
import * as THREE from 'three';
import { mergeVertices } from '../../vendor/addons/BufferGeometryUtils.js';

export class GeoBank {
  constructor() { this.map = new Map(); this.list = []; }
  get(key, make) {
    let g = this.map.get(key);
    if (!g) { g = make(); this.map.set(key, g); this.list.push(g); }
    return g;
  }
  track(g) { this.list.push(g); return g; }
  dispose() { for (const g of this.list) g.dispose(); this.list = []; this.map.clear(); }
}

// 圆角方块（把方块顶点推到圆角面上）
export function roundedBox(w, h, d, r = 0.08, seg = 4) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position;
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-ix, Math.min(ix, v.x)), Math.max(-iy, Math.min(iy, v.y)), Math.max(-iz, Math.min(iz, v.z)));
    v.sub(c);
    if (v.lengthSq() > 1e-12) v.normalize().multiplyScalar(r);
    v.add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// 地砖：顶部微微隆起的圆角方块，带顶点色（顶面亮、侧面暗），配合实例颜色
export function tileGeometry(size = 1.16, h = 0.3) {
  const g = roundedBox(size, h, size, 0.12, 4);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i), z = p.getZ(i);
    if (y > h / 2 - 0.02) {
      const rr = (x * x + z * z) / (size * size * 0.5);
      p.setY(i, y + 0.03 * (1 - Math.min(1, rr)));
    }
    const top = y > h / 2 - 0.1 ? 1 : 0.8;
    col[i * 3] = top; col[i * 3 + 1] = top; col[i * 3 + 2] = top;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.translate(0, -h / 2, 0); // 顶面在 y=0
  g.computeVertexNormals();
  return g;
}

export function starShape(outer = 0.3, inner = 0.14, n = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function starGeometry(outer = 0.3, inner = 0.14, depth = 0.1) {
  const g = new THREE.ExtrudeGeometry(starShape(outer, inner), { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 });
  g.center();
  return g;
}

export function heartGeometry(s = 0.3, depth = 0.1) {
  const sh = new THREE.Shape();
  sh.moveTo(0, -s * 0.9);
  sh.bezierCurveTo(-s * 1.4, -s * 0.1, -s * 0.8, s * 0.9, 0, s * 0.35);
  sh.bezierCurveTo(s * 0.8, s * 0.9, s * 1.4, -s * 0.1, 0, -s * 0.9);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 16 });
  g.center();
  return g;
}

// 圆润的"团子"球：轻微噪声起伏
export function blobGeometry(r = 0.3, seed = 1, amt = 0.06, detail = 3) {
  // 二十面体默认是"分面"的，合并重复顶点后法线才是圆润的
  const ico = new THREE.IcosahedronGeometry(r, detail);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const g = mergeVertices(ico, 1e-5);
  ico.dispose();
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 9 + seed) * Math.sin(v.y * 7 + seed * 2) * Math.sin(v.z * 8 + seed * 3);
    v.multiplyScalar(1 + n * amt);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// 只保留 position/normal/uv，方便合批
export function normalizeAttributes(g) {
  const keep = ['position', 'normal', 'uv'];
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}

// 扇贝壳：带波浪边的扇形，挤出成有厚度的小贝壳
export function scallopGeometry(r = 0.26, depth = 0.05, bumps = 7) {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  const N = bumps * 8;
  for (let i = 0; i <= N; i++) {
    const a = Math.PI * 0.12 + (i / N) * Math.PI * 0.76;
    const rr = r * (1 + 0.06 * Math.abs(Math.sin((i / N) * bumps * Math.PI)));
    sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  sh.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, -r * 0.45, -depth / 2);
  g.rotateX(-Math.PI / 2 + 0.25);
  return g;
}
