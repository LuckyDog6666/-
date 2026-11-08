// 糯糯的五官（Disney / Pixar 式的"活"眼睛）
//
// 动画电影里可爱角色的眼睛有几层结构，这里都做出来了：
//  - 白白的眼白（上方被眼皮投下一点阴影，越靠边越偏冷）；
//  - 大大的虹膜：一圈深色的"角膜缘"、放射状的细纹、下半部分透出暖暖的光（光穿过角膜在眼底聚起来）；
//  - 大瞳孔（显得天真）；
//  - 柔边高光：一大一小 + 一颗会闪的小星光，贴在角膜上、位置固定（转眼珠时高光不跟着跑）；
//  - 真正的上眼皮：眨眼、眯眼、睡着都是眼皮合上来（不是把整只眼睛压扁），眼皮边缘有睫毛线，外眼角更粗；
//  - 眼皮跟着视线走：往下看时眼皮也跟着低一点（迪士尼动画的常用技巧，眼神更真）。
// 全部画在一个着色器里：虹膜按视线在眼眶里移动，永远不会跑出眼睛的轮廓。
import * as THREE from 'three';

const TAU = Math.PI * 2;

// 虹膜贴图：暖棕色，放射状细纹 + 瞳孔周围一圈浅金色的"花环" + 少量斑点
export function irisTexture(pal = {}) {
  const s = 256, cx = s / 2, cy = s / 2, R = s * 0.5;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const base = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  base.addColorStop(0, pal.inner || '#5a2c16');
  base.addColorStop(0.45, pal.mid || '#9c5a2c');
  base.addColorStop(0.8, pal.outer || '#7a401d');
  base.addColorStop(1, pal.rim || '#40200f');
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  // 放射状的细纹（亮的焦糖色 + 暗的深棕色交替）
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 150; i++) {
    const a = rnd() * TAU, r0 = R * (0.4 + rnd() * 0.1), r1 = R * (0.75 + rnd() * 0.22);
    const light = rnd() < 0.55;
    g.strokeStyle = light ? `rgba(${214 + rnd() * 30},${150 + rnd() * 40},${90 + rnd() * 30},${0.05 + rnd() * 0.09})` : `rgba(50,22,10,${0.05 + rnd() * 0.08})`;
    g.lineWidth = 1.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    const a2 = a + (rnd() - 0.5) * 0.08;
    g.lineTo(cx + Math.cos(a2) * r1, cy + Math.sin(a2) * r1);
    g.stroke();
  }
  // 瞳孔周围的浅金色"花环"
  const col = g.createRadialGradient(cx, cy, R * 0.38, cx, cy, R * 0.62);
  col.addColorStop(0, 'rgba(240,190,110,0)'); col.addColorStop(0.45, pal.ring || 'rgba(240,185,105,0.42)'); col.addColorStop(1, 'rgba(240,190,110,0)');
  g.fillStyle = col; g.beginPath(); g.arc(cx, cy, R * 0.62, 0, TAU); g.fill();
  // 小斑点
  for (let i = 0; i < 10; i++) {
    const a = rnd() * TAU, r = R * (0.5 + rnd() * 0.38);
    g.fillStyle = rnd() < 0.5 ? 'rgba(250,210,150,0.25)' : 'rgba(45,20,10,0.25)';
    g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1 + rnd() * 2.2, 0, TAU); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const EYE_GLSL = /* glsl */`
uniform vec2 uLook;      // 视线：虹膜中心相对眼睛中心的偏移（眼睛半高为 1）
uniform float uLid;      // 上眼皮边缘的高度：1.15 全睁开，0.82 自然，0.2 困了，-0.9 闭上
uniform float uSide;     // -1 左眼 / +1 右眼（外眼角方向）
uniform float uAspect;   // 眼睛宽高比（半宽 / 半高）
uniform float uPupil;    // 瞳孔半径（占虹膜半径的比例）
uniform float uTw;       // 小星光闪烁
uniform vec3 uSkin;
uniform vec3 uSclera;
uniform vec3 uLash;
uniform vec3 uGlow;
vec3 eyeEmit = vec3(0.0);
float eyeSkin = 0.0;
float softEllipse(vec2 p, vec2 c, vec2 r, float rot) {
  vec2 d = p - c;
  float cs = cos(rot), sn = sin(rot);
  d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y) / r;
  return smoothstep(1.0, 0.72, length(d));
}
vec3 eyeColor(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;                 // 眼睛的椭圆轮廓 = 半径 1
  float e = length(p);
  vec2 pa = vec2(p.x * uAspect, p.y);      // 换成"圆"的坐标（单位：眼睛半高）
  // ---- 上眼皮：睁开、半睁时都是向上拱的圆弧（眼皮圆圆地盖下来，困困的也可爱；
  //      平直的眼皮线会显得"无语 / 不耐烦"），快合上时才变成向下弯的弧线（︶） ----
  float k = mix(-0.3, 0.2, smoothstep(-0.8, -0.15, uLid));
  float lidY = uLid - k * p.x * p.x;
  float skin = smoothstep(lidY - 0.025, lidY + 0.025, p.y);
  // ---- 眼白：上方被眼皮投下阴影，越靠边越偏冷一点 ----
  vec3 col = uSclera;
  col *= 1.0 - 0.22 * smoothstep(0.38, 0.0, lidY - p.y);
  col = mix(col, col * vec3(0.94, 0.96, 1.0), smoothstep(0.6, 1.0, e));
  // ---- 虹膜（物体空间里是正圆）----
  float IR = 0.75;
  vec2 q = pa - vec2(uLook.x * uAspect, uLook.y) * 0.5 - vec2(0.0, -0.08);  // 虹膜大一点、平时略靠下（像小宝宝的眼睛，眼神更软萌）
  float r = length(q) / IR;
  vec3 iris = texture2D(map, clamp(q / IR * 0.5 + 0.5, 0.0, 1.0)).rgb;
  float glow = smoothstep(0.05, 0.9, -q.y / IR) * smoothstep(1.02, 0.42, r);   // 眼底透出来的暖光
  iris = iris * (1.0 + glow * 1.1) + uGlow * glow * 0.32;
  iris *= 1.0 - 0.55 * smoothstep(0.74, 1.0, r);                                // 角膜缘：外圈一圈深色
  float pupil = smoothstep(uPupil + 0.03, uPupil - 0.03, r);
  iris = mix(iris, vec3(0.018, 0.010, 0.008), pupil);
  iris *= 1.0 - 0.4 * smoothstep(0.42, 0.0, lidY - p.y);                        // 眼皮的阴影也落在虹膜上
  col = mix(col, iris, smoothstep(1.0, 0.95, r));
  // ---- 眼眶的描线：上面粗（像睫毛），下面细 ----
  float w = mix(0.035, 0.14, smoothstep(-0.4, 0.8, p.y));
  col = mix(col, uLash, smoothstep(1.0 - w, 1.0 - w + 0.05, e) * mix(0.28, 1.0, smoothstep(-0.5, 0.5, p.y)));
  // ---- 眼皮边缘的睫毛线（外眼角更粗）----
  float lw = 0.065 + 0.07 * smoothstep(0.15, 0.95, p.x * uSide);
  float lash = 1.0 - smoothstep(lw * 0.45, lw, abs(p.y - (lidY + lw * 0.25)));
  // ---- 眼皮（皮肤）----
  // 眼皮：贴近睫毛线的地方带一点粉色的褶子阴影，眼皮看起来是圆鼓鼓地盖下来的
  vec3 lidCol = mix(uSkin, uSkin * vec3(0.95, 0.83, 0.83), smoothstep(0.32, 0.0, p.y - lidY));
  col = mix(col, lidCol, skin);
  col = mix(col, uLash, lash * step(-1.2, lidY));
  // ---- 高光：贴在角膜上，固定在左上 / 右下（不跟着眼珠跑），被眼皮盖住的部分不显示 ----
  float h = softEllipse(pa, vec2(-0.24, 0.3), vec2(0.2, 0.25), -0.35);
  h += 0.9 * softEllipse(pa, vec2(0.3, -0.34), vec2(0.085, 0.085), 0.0);
  h += uTw * softEllipse(pa, vec2(0.06, 0.52), vec2(0.045, 0.045), 0.0);
  float open = (1.0 - skin) * (1.0 - lash);
  eyeEmit = vec3(1.0) * h * open * 1.15;
  col = mix(col, vec3(1.0), clamp(h * open, 0.0, 1.0) * 0.85);
  eyeSkin = skin;
  return col;
}
`;

// 眼睛材质：MeshPhysicalMaterial（清漆层让眼珠水汪汪的）+ 程序化眼睛
export function eyeMaterial({ side, aspect, skin, sclera = '#fbf8f6', lash = '#3b2229', glow = '#ffb46b', map }) {
  const mat = new THREE.MeshPhysicalMaterial({ map, color: '#ffffff', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9 });
  const u = {
    uLook: { value: new THREE.Vector2() },
    uLid: { value: 0.82 },
    uSide: { value: side },
    uAspect: { value: aspect },
    uPupil: { value: 0.5 },
    uTw: { value: 1 },
    uSkin: { value: new THREE.Color(skin) },
    uSclera: { value: new THREE.Color(sclera) },
    uLash: { value: new THREE.Color(lash) },
    uGlow: { value: new THREE.Color(glow) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\n' + EYE_GLSL)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = eyeColor(vMapUv);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, eyeSkin);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += eyeEmit;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - eyeSkin;\n#endif');
  };
  mat.customProgramCacheKey = () => 'nuonuo-eye-v3';
  mat.userData.eye = u;
  return mat;
}

// 手绘线条的材质（睫毛线、闭眼线、眉毛、嘴巴）：哑光、几乎不反射环境，像一笔墨线。
// 有光泽的细管子在雪地 / 阳光下会反出一道亮边，看起来像塑料，不像画出来的线条
export function inkMaterial(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: o.rough ?? 0.92, metalness: 0, envMapIntensity: o.env ?? 0.1 });
}

// 粗细变化的线（中间粗、两头细）：眉毛、嘴巴、闭眼线、睫毛都用它，像手绘的线条
export function taperedTube(points, radius, taper = (u) => Math.sin(Math.PI * u), segs = 24, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, P = curve.getPointAt(u);
    const r = radius * Math.max(0.12, taper(u));
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      pos.push(P.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), P.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), P.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z));
    }
  }
  // 三角形的绕序要让法线朝外（T × B = −N 朝里，所以这里是 a → a+1 → b）。
  // 绕反了的话看到的是管子"里面"的后壁：贴着脸的那一段后壁埋进皮肤里，线条中间就会透出一道肤色
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 小鼻头：圆圆的倒三角（兔子的鼻子），稍微鼓起来
export function noseGeometry(w = 0.026, h = 0.019, d = 0.01) {
  const s = new THREE.Shape();
  s.moveTo(-w, h * 0.45);
  s.quadraticCurveTo(0, h * 0.75, w, h * 0.45);
  s.quadraticCurveTo(w * 1.02, h * 0.05, w * 0.22, -h * 0.62);
  s.quadraticCurveTo(0, -h * 0.8, -w * 0.22, -h * 0.62);
  s.quadraticCurveTo(-w * 1.02, h * 0.05, -w, h * 0.45);
  const g = new THREE.ExtrudeGeometry(s, { depth: d * 0.4, bevelEnabled: true, bevelThickness: d * 0.6, bevelSize: Math.min(w, h) * 0.35, bevelSegments: 4, curveSegments: 12 });
  g.translate(0, 0, -d * 0.2);
  g.computeVertexNormals();
  return g;
}
