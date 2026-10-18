// 用 Canvas 现场绘制的贴图（无需任何外部图片素材）。
import * as THREE from 'three';

const cache = new Map();

function canvasTex(key, size, draw, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

function star(g, cx, cy, spikes, outer, inner) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  g.beginPath();
  g.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    g.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer); rot += step;
    g.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner); rot += step;
  }
  g.closePath();
}

function heart(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.35);
  g.bezierCurveTo(cx - s * 0.9, cy - s * 0.25, cx - s * 0.45, cy - s * 0.95, cx, cy - s * 0.45);
  g.bezierCurveTo(cx + s * 0.45, cy - s * 0.95, cx + s * 0.9, cy - s * 0.25, cx, cy + s * 0.35);
  g.closePath();
}

export const Tex = {
  soft: () => canvasTex('soft', 128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }),
  dot: () => canvasTex('dot', 64, (g, s) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2); g.fill();
  }),
  ring: () => canvasTex('ring', 128, (g, s) => {
    g.strokeStyle = '#fff'; g.lineWidth = s * 0.07; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2); g.stroke();
  }),
  shadow: () => canvasTex('shadow', 128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(60,30,60,0.55)');
    grd.addColorStop(0.6, 'rgba(60,30,60,0.25)');
    grd.addColorStop(1, 'rgba(60,30,60,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }),
  heart: () => canvasTex('heart', 128, (g, s) => {
    heart(g, s / 2, s * 0.55, s * 0.82);
    g.fillStyle = '#fff'; g.fill();
  }),
  star: () => canvasTex('star', 128, (g, s) => {
    star(g, s / 2, s / 2 + 4, 5, s * 0.46, s * 0.21);
    g.fillStyle = '#fff'; g.fill();
  }),
  sparkle: () => canvasTex('sparkle', 128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    star(g, s / 2, s / 2, 4, s * 0.5, s * 0.07);
    g.fillStyle = '#fff'; g.fill();
  }),
  note: () => canvasTex('note', 128, (g, s) => {
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(s * 0.36, s * 0.72, s * 0.17, s * 0.12, -0.4, 0, Math.PI * 2); g.fill();
    g.fillRect(s * 0.48, s * 0.18, s * 0.07, s * 0.55);
    g.beginPath(); g.moveTo(s * 0.55, s * 0.18); g.quadraticCurveTo(s * 0.85, s * 0.28, s * 0.78, s * 0.5); g.quadraticCurveTo(s * 0.74, s * 0.34, s * 0.55, s * 0.32); g.fill();
  }),
  leaf: () => canvasTex('leaf', 128, (g, s) => {
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(s * 0.5, s * 0.08);
    g.quadraticCurveTo(s * 0.95, s * 0.45, s * 0.5, s * 0.92);
    g.quadraticCurveTo(s * 0.05, s * 0.45, s * 0.5, s * 0.08); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 4; g.beginPath(); g.moveTo(s * 0.5, s * 0.12); g.lineTo(s * 0.5, s * 0.88); g.stroke();
  }),
  snow: () => canvasTex('snow', 128, (g, s) => {
    g.strokeStyle = '#fff'; g.lineWidth = s * 0.06; g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a), y = Math.sin(a);
      g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + x * s * 0.42, s / 2 + y * s * 0.42); g.stroke();
      g.beginPath(); g.moveTo(s / 2 + x * s * 0.25, s / 2 + y * s * 0.25);
      g.lineTo(s / 2 + Math.cos(a + 0.5) * s * 0.34, s / 2 + Math.sin(a + 0.5) * s * 0.34); g.stroke();
    }
  }),
  bubble: () => canvasTex('bubble', 128, (g, s) => {
    const grd = g.createRadialGradient(s * 0.5, s * 0.5, s * 0.3, s * 0.5, s * 0.5, s * 0.46);
    grd.addColorStop(0, 'rgba(255,255,255,0.05)'); grd.addColorStop(0.85, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(s * 0.36, s * 0.34, s * 0.09, s * 0.06, -0.6, 0, Math.PI * 2); g.fill();
  }),
  crumb: () => canvasTex('crumb', 64, (g, s) => {
    g.fillStyle = '#fff'; g.beginPath();
    g.moveTo(s * 0.2, s * 0.3); g.lineTo(s * 0.7, s * 0.15); g.lineTo(s * 0.85, s * 0.6); g.lineTo(s * 0.45, s * 0.85); g.lineTo(s * 0.15, s * 0.65); g.closePath(); g.fill();
  }),
  zzz: () => canvasTex('zzz', 128, (g, s) => {
    g.fillStyle = '#fff'; g.font = `bold ${s * 0.8}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('z', s / 2, s / 2);
  }),
  exclaim: () => canvasTex('exclaim', 128, (g, s) => {
    g.fillStyle = '#ff6b8b'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.45, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = `900 ${s * 0.7}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', s / 2, s * 0.54);
  }),
  question: () => canvasTex('question', 128, (g, s) => {
    g.fillStyle = '#7ab8ff'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.45, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = `900 ${s * 0.66}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', s / 2, s * 0.54);
  }),
  // 地面细节噪声（柔和的斑驳感，乘到地面颜色上，避免规则条纹）
  groundNoise: () => canvasTex('groundNoise', 256, (g, s) => {
    const N = 16;
    const grid = [];
    for (let i = 0; i < (N + 1) * (N + 1); i++) grid.push(Math.random());
    // 可平铺的值噪声
    const at = (x, y) => grid[(y % N) * (N + 1) + (x % N)];
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const fx = (x / s) * N, fy = (y / s) * N;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      const n = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      const v = 236 + (n - 0.5) * 22 + (Math.random() - 0.5) * 6;
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }),
  // 糖果条纹
  stripes: (a = '#ffffff', b = '#ff6b8b') => canvasTex('stripes' + a + b, 128, (g, s) => {
    g.fillStyle = a; g.fillRect(0, 0, s, s);
    g.fillStyle = b;
    for (let i = -s; i < s * 2; i += s / 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s / 8, 0); g.lineTo(i + s / 8 - s, s); g.lineTo(i - s, s); g.fill(); }
  }),
  // 波点
  dots: (bg = '#ffffff', fg = '#ff9ec4') => canvasTex('dots' + bg + fg, 128, (g, s) => {
    g.fillStyle = bg; g.fillRect(0, 0, s, s); g.fillStyle = fg;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc((x + (y % 2) * 0.5) * s / 4 + s / 8, y * s / 4 + s / 8, s / 22, 0, Math.PI * 2); g.fill(); }
  }),
};

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
