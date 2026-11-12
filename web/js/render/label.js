// 3D 画面里的文字（永远正对镜头的小牌子）：烦恼泡泡上的字、礼盒上的号码、"左 / 右"。
// 字体和界面一致（站酷快乐体），白字 + 彩色描边，手机小屏上也认得清。
import * as THREE from 'three';

let fontReady = null;
// 画文字之前先等字体加载好（否则第一次画出来的是系统默认字体）
export function ensureFont() {
  if (!fontReady) fontReady = document.fonts && document.fonts.load ? document.fonts.load('64px KuaiLe', '糯').catch(() => {}) : Promise.resolve();
  return fontReady;
}

/**
 * o: { size(贴图字号像素), color, stroke, plate(底板颜色，不给就没有底板), plateStroke }
 * 返回的贴图带 userData.aspect（宽 / 高）
 */
export function textTexture(text, o = {}) {
  const size = o.size || 96;
  const font = `${size}px KuaiLe, "Microsoft YaHei", "PingFang SC", sans-serif`;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const padX = size * (o.plate ? 0.5 : 0.28), padY = size * (o.plate ? 0.28 : 0.2);
  const w = Math.ceil(g.measureText(text).width + padX * 2), h = Math.ceil(size * 1.15 + padY * 2);
  c.width = w; c.height = h;
  if (o.plate) {
    const r = h * 0.42;
    g.beginPath();
    g.roundRect(size * 0.08, size * 0.08, w - size * 0.16, h - size * 0.16, r);
    g.fillStyle = o.plate; g.fill();
    g.lineWidth = size * 0.08; g.strokeStyle = o.plateStroke || '#ffffff'; g.stroke();
  }
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const y = h / 2 + size * 0.05;
  if (o.stroke !== null) { g.lineWidth = size * (o.strokeWidth || 0.17); g.strokeStyle = o.stroke || '#d6467f'; g.strokeText(text, w / 2, y); }
  g.fillStyle = o.color || '#ffffff';
  g.fillText(text, w / 2, y);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.aspect = w / h;
  return t;
}

// 永远正对镜头的文字牌。height：牌子在世界里的高度（米）。用完调用 userData.dispose()
export function textSprite(text, o = {}) {
  const tex = textTexture(text, o);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: o.depthTest ?? true, fog: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  const hgt = o.height || 0.22;
  s.scale.set(hgt * tex.userData.aspect, hgt, 1);
  s.userData.baseScale = s.scale.clone();
  s.userData.dispose = () => { tex.dispose(); mat.dispose(); };
  s.renderOrder = 5;
  return s;
}

// 换一行字（保持高度不变）
export function setSpriteText(sprite, text, o = {}) {
  const old = sprite.material.map;
  const tex = textTexture(text, o);
  sprite.material.map = tex;
  sprite.material.needsUpdate = true;
  const hgt = o.height || sprite.userData.baseScale.y;
  sprite.scale.set(hgt * tex.userData.aspect, hgt, 1);
  sprite.userData.baseScale = sprite.scale.clone();
  sprite.userData.dispose = () => { tex.dispose(); sprite.material.dispose(); };
  if (old) old.dispose();
}
