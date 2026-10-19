// 可变形表面（高度场）：太空沙、雪、奶油、花泥、史莱姆……每一脚都会留下真实的脚印。
// 顶面是细分网格，在 CPU 上"盖章"压出脚印（带隆起的边缘），并用顶点色把压过的地方变深；
// 黏稠材质（史莱姆、慢回弹海绵）会慢慢恢复原状。
import * as THREE from 'three';

export class Heightfield {
  /**
   * @param {object} o { length, width, thickness, seg (每单位细分), color, colorPressed, bumps, rim(边缘隆起比例), recover(每秒恢复比例), noise }
   */
  constructor(o) {
    this.o = Object.assign({ length: 2.4, width: 1.3, thickness: 0.18, seg: 22, bumps: 0.012, rim: 0.35, recover: 0, edgeRound: 0.06 }, o);
    const { length: L, width: W, seg } = this.o;
    this.nx = Math.max(8, Math.round(L * seg));
    this.nz = Math.max(6, Math.round(W * seg));
    const g = new THREE.PlaneGeometry(L, W, this.nx, this.nz);
    g.rotateX(-Math.PI / 2);
    g.translate(L / 2, 0, 0); // 局部坐标：x ∈ [0, L]，z ∈ [-W/2, W/2]
    this.geo = g;
    const pos = g.attributes.position;
    this.count = pos.count;
    this.rest = new Float32Array(this.count);
    this.h = new Float32Array(this.count);
    this.press = new Float32Array(this.count); // 0..1 被压过的程度（决定颜色）
    const col = new Float32Array(this.count * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.c0 = new THREE.Color(this.o.color || '#ffd0e6');
    this.c1 = new THREE.Color(this.o.colorPressed || this.c0.clone().multiplyScalar(0.82));
    const seed = (this.o.seed || 1) * 1.37;
    for (let i = 0; i < this.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // 边缘圆角：靠近四周的地方往下收，像一块软软的"饼"
      const ex = Math.min(x, L - x), ez = W / 2 - Math.abs(z);
      const e = Math.min(ex, ez);
      const r = this.o.edgeRound;
      const edge = e < r ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - e / r, 2))) : 1;
      // 自然起伏：几层不同方向、不同频率的柔和波叠加（不会出现规则的条纹）
      const n = this.o.bumps * (0.55 * Math.sin(x * 5.3 + z * 2.1 + seed) * Math.cos(z * 6.7 - x * 1.3 + seed * 2)
        + 0.3 * Math.sin(x * 11.7 - z * 8.9 + seed * 3) + 0.15 * Math.sin(x * 23.1 + z * 19.7 + seed * 5));
      this.rest[i] = this.o.thickness * edge + n * edge;
      this.h[i] = this.rest[i];
    }
    this._write(true);
    // 侧面裙边（让整块材料有厚度）
    this.skirt = this._skirt();
    if (this.o.detail !== false) this._initDetail();
  }

  // ---------------- 高清细节层：脚趾、边缘、颗粒都清清楚楚 ----------------
  // 网格负责整体的凹陷（真实的坑），细节贴图负责精细的形状：
  //  bump（凹凸贴图，灰度=高度）+ shade（颜色贴图，乘到材质颜色上）
  _initDetail() {
    const { length: L, width: W } = this.o;
    const px = this.o.detailRes || 220; // 每米像素
    const cw = Math.min(1024, Math.round(L * px)), ch = Math.min(512, Math.round(W * px));
    this.dpx = cw / L;
    const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
    this.bumpCv = mk(); this.shadeCv = mk();
    this.bg = this.bumpCv.getContext('2d');
    this.sg = this.shadeCv.getContext('2d');
    this.bg.fillStyle = 'rgb(128,128,128)'; this.bg.fillRect(0, 0, cw, ch);
    this.sg.fillStyle = '#ffffff'; this.sg.fillRect(0, 0, cw, ch);
    // 材质颗粒（沙子、雪、泥的细小起伏与斑点）
    const grain = this.o.grain ?? 0.5;
    if (grain > 0) {
      const n = Math.round(cw * ch * 0.02 * grain);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * cw, y = Math.random() * ch, r = 0.6 + Math.random() * 1.4;
        const v = 128 + (Math.random() - 0.5) * 70;
        this.bg.fillStyle = `rgb(${v},${v},${v})`;
        this.bg.beginPath(); this.bg.arc(x, y, r, 0, Math.PI * 2); this.bg.fill();
        if (Math.random() < 0.35) { const sv = 255 - Math.random() * 22 * grain; this.sg.fillStyle = `rgb(${sv},${sv},${Math.min(255, sv + 4)})`; this.sg.fillRect(x, y, r, r); }
      }
    }
    const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
    this.bumpTex = tex(this.bumpCv);
    this.bumpTex.colorSpace = THREE.NoColorSpace;
    this.shadeTex = tex(this.shadeCv);
    this.shadeTex.colorSpace = THREE.SRGBColorSpace;
    const pc = new THREE.Color(this.o.colorPressed || this.c1);
    const base = new THREE.Color(this.o.color || '#ffffff');
    // 压实色相对原色的比例（乘法贴图里画的颜色）
    this.inkRGB = [pc.r / Math.max(0.01, base.r), pc.g / Math.max(0.01, base.g), pc.b / Math.max(0.01, base.b)].map((v) => Math.round(Math.min(1, v) * 255));
    this.recoverAcc = 0;
  }

  // 把一只（或一组）椭圆印子画进细节层
  _detailPrint(prints, rimK) {
    if (!this.bg) return;
    const W = this.o.width;
    const k = this.dpx;
    const [ir, ig, ib] = this.inkRGB;
    for (const [x, z, ax, az, dp, ux = 1, uz = 0] of prints) {
      const cx = x * k, cy = (z + W / 2) * k, rx = Math.max(1.5, ax * k), ry = Math.max(1.5, az * k);
      const ang = Math.atan2(uz, ux);
      const depth = Math.min(1, dp / 0.08);
      // 边缘隆起（亮）
      if (rimK > 0) {
        const g1 = this.bg.createRadialGradient(0, 0, 0.8, 0, 0, 1.45);
        g1.addColorStop(0, `rgba(170,170,170,${0.55 * rimK})`); g1.addColorStop(1, 'rgba(170,170,170,0)');
        this._ellipse(this.bg, cx, cy, rx, ry, g1, 1.45, ang);
      }
      // 坑（暗），中心最深，边缘陡（脚印的轮廓很清楚）
      const g2 = this.bg.createRadialGradient(0, 0, 0, 0, 0, 1);
      const v = Math.round(128 - 96 * depth);
      g2.addColorStop(0, `rgba(${v},${v},${v},1)`); g2.addColorStop(0.72, `rgba(${v + 10},${v + 10},${v + 10},0.95)`); g2.addColorStop(1, 'rgba(128,128,128,0)');
      this._ellipse(this.bg, cx, cy, rx, ry, g2, 1, ang);
      const g3 = this.sg.createRadialGradient(0, 0, 0, 0, 0, 1);
      g3.addColorStop(0, `rgba(${ir},${ig},${ib},${0.75 * depth + 0.2})`); g3.addColorStop(0.8, `rgba(${ir},${ig},${ib},${0.55 * depth + 0.1})`); g3.addColorStop(1, `rgba(${ir},${ig},${ib},0)`);
      this._ellipse(this.sg, cx, cy, rx, ry, g3, 1, ang);
    }
    this.bumpTex.needsUpdate = true;
    this.shadeTex.needsUpdate = true;
    this.healTicks = 40; // 有新印子：接下来一段时间慢慢"愈合"
  }
  _ellipse(g, cx, cy, rx, ry, fill, r, ang = 0) {
    g.save(); g.translate(cx, cy); if (ang) g.rotate(ang); g.scale(rx, ry);
    g.fillStyle = fill; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  _skirt() {
    const { length: L, width: W, thickness: T } = this.o;
    const g = new THREE.BoxGeometry(L - 0.02, T * 0.9, W - 0.02);
    g.translate(L / 2, T * 0.45, 0);
    return g;
  }

  // 局部坐标 (x,z) 处的表面高度（双线性插值）
  heightAt(x, z) {
    const { length: L, width: W } = this.o;
    const fx = Math.min(this.nx - 1e-4, Math.max(0, (x / L) * this.nx));
    const fz = Math.min(this.nz - 1e-4, Math.max(0, ((z + W / 2) / W) * this.nz));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const row = this.nx + 1;
    const a = this.h[iz * row + ix], b = this.h[iz * row + ix + 1], c = this.h[(iz + 1) * row + ix], d = this.h[(iz + 1) * row + ix + 1];
    return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
  }

  /**
   * 压出脚印：椭圆形（脚掌），depth 下陷深度，rim 边缘隆起
   * shape: 'paw' 带三个小脚趾印 | 'round'
   */
  stamp(x, z, { rx = 0.1, rz = 0.08, depth = 0.05, rim = this.o.rim, shape = 'paw', strength = 1, dir = null } = {}) {
    const pos = this.geo.attributes.position;
    const pr = Math.max(rx, rz) * 1.9;
    // 脚掌朝向（前进方向），默认 +x
    let hx = 1, hz = 0;
    if (dir) { const l = Math.hypot(dir[0], dir[1]) || 1; hx = dir[0] / l; hz = dir[1] / l; }
    const prints = [[x, z, rx, rz, depth, hx, hz]];
    if (shape === 'paw') {
      // 三个小脚趾（在前进方向的前方）
      for (const dz of [-0.55, 0, 0.55]) prints.push([x + hx * rx * 1.15 - hz * dz * rz * 1.1, z + hz * rx * 1.15 + hx * dz * rz * 1.1, rx * 0.32, rz * 0.32, depth * 0.85, hx, hz]);
    }
    this._detailPrint(prints, rim);
    for (let i = 0; i < this.count; i++) {
      const vx = pos.getX(i), vz = pos.getZ(i);
      if (Math.abs(vx - x) > pr + 0.1 || Math.abs(vz - z) > pr + 0.1) continue;
      let target = this.h[i];
      let pressed = 0;
      for (const [px, pz, ax, az, dp, ux, uz] of prints) {
        const dx = vx - px, dz = vz - pz;
        const d = Math.sqrt(((dx * ux + dz * uz) / ax) ** 2 + ((-dx * uz + dz * ux) / az) ** 2);
        if (d < 1) {
          const prof = Math.pow(1 - d * d, 1.2);
          target = Math.min(target, this.rest[i] - dp * strength * prof);
          pressed = Math.max(pressed, prof);
        } else if (rim > 0 && d < 1.7) {
          const k = Math.exp(-Math.pow((d - 1.15) / 0.28, 2));
          target = Math.max(target, Math.min(this.h[i] + dp * rim * k * 0.5, this.rest[i] + dp * rim * k));
        }
      }
      this.h[i] = target;
      this.press[i] = Math.min(1, Math.max(this.press[i], pressed * strength));
    }
    this._write();
  }

  // 一条被切开/划过的沟（切太空沙、切肥皂）
  groove(x0, z0, x1, z1, { width = 0.05, depth = 0.08 } = {}) {
    if (this.bg) {
      const W = this.o.width, k = this.dpx, [ir, ig, ib] = this.inkRGB;
      for (const [g, col, w] of [[this.bg, 'rgb(40,40,40)', 1], [this.sg, `rgb(${ir},${ig},${ib})`, 0.9]]) {
        g.save(); g.lineCap = 'round'; g.strokeStyle = col; g.lineWidth = width * k * 2 * w;
        g.beginPath(); g.moveTo(x0 * k, (z0 + W / 2) * k); g.lineTo(x1 * k, (z1 + W / 2) * k); g.stroke(); g.restore();
      }
      this.bumpTex.needsUpdate = true; this.shadeTex.needsUpdate = true;
      this.healTicks = 40;
    }
    const pos = this.geo.attributes.position;
    const dx = x1 - x0, dz = z1 - z0, len2 = dx * dx + dz * dz || 1;
    for (let i = 0; i < this.count; i++) {
      const vx = pos.getX(i), vz = pos.getZ(i);
      const t = Math.max(0, Math.min(1, ((vx - x0) * dx + (vz - z0) * dz) / len2));
      const px = x0 + dx * t, pz = z0 + dz * t;
      const d = Math.hypot(vx - px, vz - pz) / width;
      if (d < 1) {
        this.h[i] = Math.min(this.h[i], this.rest[i] - depth * (1 - d * d));
        this.press[i] = Math.max(this.press[i], 1 - d);
      }
    }
    this._write();
  }

  // 黏稠/慢回弹材质：慢慢恢复
  update(dt) {
    const k = this.o.recover;
    if (!k) return;
    // 细节层也慢慢"愈合"（史莱姆、泥巴会慢慢流平）
    if (this.bg && this.healTicks > 0) {
      this.recoverAcc += dt;
      if (this.recoverAcc > 0.25) {
        this.healTicks--; // 愈合够久就停（没有新印子时不再每秒重传贴图）
        const a = Math.min(0.5, (1 - Math.exp(-k * this.recoverAcc)) * 0.9);
        this.recoverAcc = 0;
        this.bg.globalAlpha = a; this.bg.fillStyle = 'rgb(128,128,128)'; this.bg.fillRect(0, 0, this.bumpCv.width, this.bumpCv.height); this.bg.globalAlpha = 1;
        this.sg.globalAlpha = a; this.sg.fillStyle = '#ffffff'; this.sg.fillRect(0, 0, this.shadeCv.width, this.shadeCv.height); this.sg.globalAlpha = 1;
        this.bumpTex.needsUpdate = true; this.shadeTex.needsUpdate = true;
      }
    }
    let moved = false;
    const f = 1 - Math.exp(-k * dt);
    for (let i = 0; i < this.count; i++) {
      const d = this.rest[i] - this.h[i];
      if (Math.abs(d) > 1e-4) { this.h[i] += d * f; moved = true; }
      if (this.press[i] > 0.001) { this.press[i] *= 1 - f * 0.8; moved = true; }
    }
    if (moved) this._write();
  }

  reset() {
    this.h.set(this.rest);
    this.press.fill(0);
    this._write();
  }

  _write(first = false) {
    const pos = this.geo.attributes.position;
    const col = this.geo.attributes.color;
    const c = new THREE.Color();
    const deep = this.o.depthShade || 0.05;
    for (let i = 0; i < this.count; i++) {
      pos.setY(i, this.h[i]);
      // 颜色：被压过的地方变成"压实色"，越深越暗（像真的坑底），被挤起来的边缘略微提亮
      const dd = this.rest[i] - this.h[i];
      const k = Math.min(1, Math.max(this.press[i] * 0.8, dd / deep));
      c.copy(this.c0).lerp(this.c1, k);
      if (dd < -0.004) c.offsetHSL(0, 0, Math.min(0.06, -dd * 3));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
    if (!first) this.geo.computeBoundingSphere();
  }

  dispose() {
    this.geo.dispose(); this.skirt.dispose();
    if (this.bumpTex) { this.bumpTex.dispose(); this.shadeTex.dispose(); }
  }
}
