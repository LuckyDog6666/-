// 场景环境：户外（天空、远山、云朵、草地/雪地、装饰物）、厨房（台面、瓷砖墙、吊柜、窗户、冰箱）、卧室（木地板、壁纸、雨窗、书架、沙发）。
// 美术方向：像动画电影一样的圆润造型、饱和的糖果色、暖色主光 + 冷色补光、远近层次分明。
// 静态物体按材质合批（顶点色），几十上百个装饰物只需要几次绘制调用，长时间直播也不卡。
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';
import { Tex } from '../render/textures.js';
import { roundedBox, blobGeometry } from './geo.js';
import { buildProp, bake } from './props.js';
import { TAU } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const part = (geo, color, pos = V(0, 0, 0), rot = [0, 0, 0], scale = null) => ({ geo, color, pos, rot, scale });

const SKY_VERT = `
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; uniform vec3 cSun; uniform vec3 sunDir; uniform float uTime;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(cMid, cTop, smoothstep(0.0, 0.6, h)) : mix(cMid, cBot, smoothstep(0.0, -0.3, h));
  float s = max(0.0, dot(normalize(vDir), normalize(sunDir)));
  c += cSun * (pow(s, 24.0) * 0.55 + pow(s, 4.0) * 0.12);
  c += 0.015 * sin(vDir.x * 6.0 + uTime * 0.05) * (1.0 - abs(h));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export function buildEnvironment(course) {
  const kind = course.stage.env || 'outdoor';
  if (kind === 'kitchen') return buildKitchen(course);
  if (kind === 'room') return buildRoom(course);
  return buildOutdoor(course);
}

// 把一组带颜色的零件合并成一个网格
function addBaked(course, parts, opts = {}) {
  if (!parts.length) return null;
  const geo = course.G.track(bake(parts, opts));
  const m = new THREE.Mesh(geo, course.vcMat(opts));
  m.castShadow = opts.shadow !== false; m.receiveShadow = true;
  course.group.add(m);
  return m;
}

function canvasTex(course, w, h, draw, repeat = null) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  course.M.track(t);
  return t;
}

function sky(course, colors, sunDir = V(-0.5, 0.35, -0.8), sunColor = '#fff3d6') {
  const geo = course.G.track(new THREE.SphereGeometry(140, 32, 16));
  const mat = course.M.track(new THREE.ShaderMaterial({
    uniforms: { cTop: { value: new THREE.Color(colors[0]) }, cMid: { value: new THREE.Color(colors[1]) }, cBot: { value: new THREE.Color(colors[2]) }, cSun: { value: new THREE.Color(sunColor) }, sunDir: { value: sunDir.normalize() }, uTime: { value: 0 } },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  course.uniforms.push(mat.uniforms);
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  course.group.add(m);
  course.sky = m;
}


// ---------------- 动画电影里常见的"氛围小件" ----------------
// 窗外的手绘天空：渐变的蓝天、几朵软软的云、远处的小山坡（不受灯光影响，永远亮亮的）
function paintedSky(course, w, h, o = {}) {
  return canvasTex(course, 512, Math.round(512 * h / w), (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, o.top || '#8fcfff'); gr.addColorStop(0.7, o.mid || '#d4eeff'); gr.addColorStop(1, o.bot || '#fff4e0');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // 太阳的光晕
    const sg = g.createRadialGradient(W * 0.2, H * 0.18, 0, W * 0.2, H * 0.18, W * 0.35);
    sg.addColorStop(0, 'rgba(255,250,225,0.95)'); sg.addColorStop(0.25, 'rgba(255,244,210,0.45)'); sg.addColorStop(1, 'rgba(255,244,210,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    // 云：一团团圆，底部带一点淡紫的影子
    const cloud = (cx, cy, s) => {
      for (const [dx, dy, r] of [[-0.9, 0.15, 0.55], [-0.35, -0.15, 0.75], [0.3, -0.25, 0.85], [0.95, 0.1, 0.6], [0.2, 0.2, 0.7]]) {
        g.fillStyle = 'rgba(205,210,240,0.55)'; g.beginPath(); g.arc(cx + dx * s, cy + dy * s + s * 0.12, r * s, 0, TAU); g.fill();
      }
      for (const [dx, dy, r] of [[-0.9, 0.15, 0.55], [-0.35, -0.15, 0.75], [0.3, -0.25, 0.85], [0.95, 0.1, 0.6], [0.2, 0.2, 0.7]]) {
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx + dx * s, cy + dy * s, r * s, 0, TAU); g.fill();
      }
    };
    cloud(W * 0.62, H * 0.3, W * 0.07); cloud(W * 0.25, H * 0.55, W * 0.05); cloud(W * 0.88, H * 0.62, W * 0.045);
    if (o.hills !== false) {
      g.fillStyle = o.hill2 || '#bfe8b0'; g.beginPath(); g.ellipse(W * 0.25, H * 1.05, W * 0.5, H * 0.22, 0, 0, TAU); g.fill();
      g.fillStyle = o.hill || '#a6dd98'; g.beginPath(); g.ellipse(W * 0.85, H * 1.08, W * 0.55, H * 0.2, 0, 0, TAU); g.fill();
    }
    if (o.rain) {
      for (let i = 0; i < 60; i++) { const x = Math.random() * W, y = Math.random() * H, r = 2 + Math.random() * 5; g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(x, y, r * 0.7, r, 0, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y + r); g.lineTo(x + Math.random() * 2, y + r + 8 + Math.random() * 20); g.stroke(); }
    }
  });
}
function windowGlass(course, tex, w, h, pos) {
  const m = new THREE.Mesh(course.G.track(new THREE.PlaneGeometry(w, h)), course.M.track(new THREE.MeshBasicMaterial({ map: tex, fog: false })));
  m.position.copy(pos);
  course.group.add(m);
  return m;
}
// 从窗户斜照进来的几束柔光（加色混合、两端都淡出；只是"空气里的光"，不挡任何东西）
function sunbeams(course, origin, ww, wh, dir, o = {}) {
  const tex = canvasTex(course, 64, 256, (g, W, H) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5, v = y / (H - 1);
      const across = Math.exp(-u * u * 14);
      const along = Math.pow(1 - v, 1.4) * Math.min(1, v * 10 + 0.15);
      const a = across * along;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(255 * a);
    }
    g.putImageData(img, 0, 0);
  });
  tex.colorSpace = THREE.NoColorSpace;
  const mat = course.M.track(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(o.color || '#fff0c8'), transparent: true, opacity: o.opacity ?? 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  const d = dir.clone().normalize();
  const side = new THREE.Vector3().crossVectors(d, V(0, 0, 1)).normalize();
  const rng = course.rng;
  const n = o.count || 4;
  for (let k = 0; k < n; k++) {
    const start = origin.clone().add(V((k / (n - 1 || 1) - 0.5) * ww * 0.8 + rng.range(-0.08, 0.08), rng.range(-0.25, 0.25) * wh, 0));
    const len = rng.range(2.2, 3.0) * (o.len || 1), w = rng.range(0.22, 0.42) * (o.width || 1);
    const end = start.clone().addScaledVector(d, len);
    const a = start.clone().addScaledVector(side, w / 2), b = start.clone().addScaledVector(side, -w / 2);
    const c = end.clone().addScaledVector(side, -w * 0.9), e = end.clone().addScaledVector(side, w * 0.9);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, e.x, e.y, e.z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(course.G.track(g), mat);
    m.renderOrder = 5;
    m.userData.light = true; // 只是空气里的光，不是实体（穿过去是正常的）
    course.group.add(m);
  }
}
// 墙根 / 墙和台面相接处的柔和接触阴影（动画里的"角落暗一点"，让场景更有体积感）
function contactShade(course, w, h, pos, rotX = 0, o = {}) {
  const tex = canvasTex(course, 4, 128, (g, W, H) => {
    // 默认下深上浅（竖着贴在墙上）；flip：上深下浅（平放在地上时深的一边朝墙）
    const gr = o.flip ? g.createLinearGradient(0, 0, 0, H) : g.createLinearGradient(0, H, 0, 0);
    gr.addColorStop(0, `rgba(255,255,255,${o.strength ?? 0.5})`); gr.addColorStop(0.45, `rgba(255,255,255,${(o.strength ?? 0.5) * 0.3})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  });
  const m = new THREE.Mesh(course.G.track(new THREE.PlaneGeometry(w, h)), course.M.track(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(o.color || '#6e4f72'), transparent: true, depthWrite: false })));
  m.position.copy(pos); m.rotation.x = rotX;
  m.renderOrder = 1;
  course.group.add(m);
  return m;
}
// 手绘瓷砖：每块砖有上亮下暗的渐变、顶边一道高光、底边一点阴影，砖缝凹下去（凹凸贴图）
function tileTextures(course, colors, repeat) {
  const N = 4, S = 512;
  const draw = (g, W, H, bump) => {
    const s = W / N;
    g.fillStyle = bump ? 'rgb(30,30,30)' : '#eadbd0'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = i * s + 5, y = j * s + 5, w = s - 10, r = 14;
      const path = () => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + w, r); g.arcTo(x + w, y + w, x, y + w, r); g.arcTo(x, y + w, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
      if (bump) {
        const gr = g.createRadialGradient(x + w / 2, y + w / 2, w * 0.25, x + w / 2, y + w / 2, w * 0.75);
        gr.addColorStop(0, 'rgb(235,235,235)'); gr.addColorStop(1, 'rgb(150,150,150)');
        g.fillStyle = gr; path(); g.fill();
        continue;
      }
      const base = new THREE.Color(colors[(i + j) % colors.length]);
      const hi = base.clone().lerp(new THREE.Color('#ffffff'), 0.45), lo = base.clone().lerp(new THREE.Color('#d9b9c9'), 0.25);
      const gr = g.createLinearGradient(0, y, 0, y + w);
      gr.addColorStop(0, '#' + hi.getHexString()); gr.addColorStop(0.55, '#' + base.getHexString()); gr.addColorStop(1, '#' + lo.getHexString());
      g.fillStyle = gr; path(); g.fill();
      // 顶边高光 + 左上角一小块反光
      g.save(); path(); g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 5; g.beginPath(); g.moveTo(x + r, y + 3); g.lineTo(x + w - r, y + 3); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x + w * 0.28, y + w * 0.22, w * 0.16, w * 0.07, -0.5, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(150,100,130,0.18)'; g.lineWidth = 6; g.beginPath(); g.moveTo(x + r, y + w - 3); g.lineTo(x + w - r, y + w - 3); g.stroke();
      g.restore();
    }
  };
  const map = canvasTex(course, S, S, (g, W, H) => draw(g, W, H, false), repeat);
  const bump = canvasTex(course, S / 2, S / 2, (g, W, H) => draw(g, W, H, true), repeat);
  bump.colorSpace = THREE.NoColorSpace;
  return { map, bump };
}

// ======================= 户外 =======================
function buildOutdoor(course) {
  const st = course.stage, rng = course.rng, L = course.length;
  sky(course, st.sky);
  // 地面：大圆盘 + 柔和斑驳
  const cx = L / 2, R = L * 0.6 + 34;
  const geo = course.G.track(new THREE.CircleGeometry(R, 72));
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
  const tex = course.M.track(Tex.groundNoise().clone());
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(R / 3, R / 3);
  const ground = new THREE.Mesh(geo, course.M.soft('#ffffff', { vc: true, rough: 0.95, rim: 0.05, map: tex }));
  ground.position.set(cx, -0.02, 0);
  ground.receiveShadow = true;
  course.group.add(ground);
  // 远山：圆润的小山丘一层层叠在地平线上（镜头主要朝 -x / -z 看）
  const hills = [];
  const hc = st.hills || [st.groundAlt, st.ground];
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * 0.05 - (i / 15) * Math.PI * 0.95; // 从 -x 方向绕到 -z 方向
    const d = rng.range(30, 46);
    const s = rng.range(5, 10);
    hills.push(part(new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2), hc[i % hc.length], V(cx * 0.4 + Math.cos(a) * d, -0.5, Math.sin(a) * d * 0.8), [0, rng.range(0, TAU), 0], V(s * rng.range(1.2, 2), s * rng.range(0.45, 0.8), s)));
  }
  addBaked(course, hills, { rough: 0.95, rim: 0.15, shadow: false });
  // 云朵（一朵朵软软的白色棉花，慢慢飘）
  const clouds = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const parts = [];
    const n = rng.int(4, 6);
    for (let k = 0; k < n; k++) parts.push(part(blobGeometry(1, k + i, 0.08, 2), '#ffffff', V((k - n / 2) * 1.1, rng.range(0, 0.6), rng.range(-0.4, 0.4)), [0, 0, 0], V(rng.range(0.9, 1.5), rng.range(0.7, 1.1), 1)));
    const m = new THREE.Mesh(course.G.track(bake(parts)), course.M.soft('#ffffff', { vc: true, rough: 1, rim: 0.4, rimColor: '#fff4fa', emissive: '#ffffff', ei: 0.25 }));
    m.position.set(cx * 0.5 + rng.range(-40, 30), rng.range(9, 15), -rng.range(28, 55));
    m.scale.setScalar(rng.range(0.9, 1.6));
    m.userData.drift = rng.range(0.05, 0.15);
    clouds.add(m);
  }
  course.group.add(clouds);
  course.anims.push({ obj: clouds, kind: 'clouds' });
  // 起点拱门（气球拱门）
  const arch = [];
  const ac = st.archColors || ['#ff8fb3', '#ffffff', '#7fd6ff', '#ffd166'];
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI * (i / 18);
    arch.push(part(new THREE.SphereGeometry(0.17, 14, 10), ac[i % ac.length], V(0.35, Math.sin(a) * 1.9 + 0.1, Math.cos(a) * 1.25)));
  }
  addBaked(course, arch, { rough: 0.3, rim: 0.6 });
  // 装饰物：背景一侧（-z）大而密；镜头一侧（+z）远、少、小，绝不挡住糯糯
  const list = [];
  for (let x = -14; x < L + 6; x += rng.range(1.5, 2.6)) {
    list.push({ type: rng.pick(st.props), x: x + rng.range(-0.5, 0.5), z: -rng.range(2.6, 4.4), s: rng.range(0.75, 1.2), rot: rng.range(0, TAU) });
    if (rng.next() < 0.75) list.push({ type: rng.pick(st.props), x: x + rng.range(-0.8, 0.8), z: -rng.range(5.5, 10), s: rng.range(1.0, 1.6), rot: rng.range(0, TAU) });
    if (rng.next() < 0.5) list.push({ type: rng.pick(st.props), x: x + rng.range(-0.8, 0.8), z: rng.range(3.4, 6.5), s: rng.range(0.55, 0.9), rot: rng.range(0, TAU) });
    if (x < 0 && rng.next() < 0.8) list.push({ type: rng.pick(st.props), x: x + rng.range(-1, 1), z: rng.range(-2.2, 2.2), s: rng.range(0.8, 1.4), rot: rng.range(0, TAU) });
  }
  // 远景地标：每个世界一座"故事书里的房子"，窗户暖暖地亮着（冷暖对比的视觉焦点），沿着路线每隔一段出现一次
  const LANDMARK = { snow: 'cottage_snow', forest: 'cottage_forest', rain: 'windmill', beach: 'lighthouse', slime: 'candy_castle', toy: 'toy_castle' };
  const lm = st.landmark || LANDMARK[st.id];
  const marks = [];
  if (lm) for (let x = 4 + rng.range(0, 4); x < L + 6; x += rng.range(15, 21)) marks.push({ type: lm, x, z: -rng.range(8.5, 11), s: rng.range(1.05, 1.3), rot: rng.range(-0.35, 0.35) });
  placeProps(course, marks.concat(list)); // 地标先放，周围的小装饰给它让位
  dressGround(course);
  if (st.sea) {
    // 彩虹沙滩：远处一片会动的大海
    const sea = new THREE.Mesh(course.G.track(new THREE.PlaneGeometry(220, 60).rotateX(-Math.PI / 2)), course.M.soft('#5cc8e8', { rough: 0.2, rim: 0.6, rimColor: '#e8fbff' }));
    sea.position.set(cx, -0.05, -40);
    course.group.add(sea);
  }
  course.scene.fog = new THREE.Fog(new THREE.Color(st.fog), st.fogRange[0], st.fogRange[1]);
  course.scene.background = new THREE.Color(st.sky[1]);
}

// 每种装饰物大致占地半径（scale = 1 时）：用来避免装饰物互相穿插
const PROP_R = {
  cottage: 1.7, cottage_snow: 1.7, cottage_forest: 1.7, lighthouse: 1.2, candy_castle: 1.8, windmill: 1.6, toy_castle: 1.8,
  tree: 0.75, tree_autumn: 0.75, bush_autumn: 0.5, palm: 0.75, sand_castle: 0.65, beach_umbrella: 0.85, beach_ball: 0.3, pine_snow: 0.65, big_mushroom: 0.62, igloo: 0.95, snowman: 0.45, cake: 0.62, big_donut: 0.62, cookie_stack: 0.4,
  rainbow_arch: 1.1, cloud_big: 0.9, candy_tree: 0.6, coral_fan: 0.5, big_shell: 0.58, sea_rock: 0.55, rock: 0.42, snow_rock: 0.48,
  bush: 0.5, flowers: 0.35, stump: 0.4, teddy: 0.45, toy_chest: 0.5, floor_lamp: 0.35, plant: 0.35, cushion_pile: 0.5,
};
// 去掉互相穿插的装饰物：和已经放好的离得太近就往旁边挪一挪，挪不开就不放；也不能挡在赛道上
function declutter(course, list) {
  const L = course.length;
  const keep = [];
  const r = (p) => (PROP_R[p.type] ?? 0.45) * p.s;
  for (const p of list) {
    if (p.y && p.y > 0.2) { keep.push(p); continue; } // 架子上的小摆件
    const inCourse = (q) => q.x > -0.8 && q.x < L + 0.8 && Math.abs(q.z) < 1.45 + r(q);
    let ok = false;
    for (let k = 0; k < 4 && !ok; k++) {
      if (k) p.x += (k % 2 ? 1 : -1) * k * 0.45;
      ok = !inCourse(p) && keep.every((q) => (q.y && q.y > 0.2) || Math.hypot(q.x - p.x, q.z - p.z) > r(p) + r(q) + 0.05);
    }
    if (ok) keep.push(p);
  }
  return keep;
}

// ---------- 地面小细节（草丛、落叶、小石子、贝壳、糖粒……）：让地面像动画电影的布景一样丰富 ----------
const DRESS = {
  snow: [['mound', ['#ffffff', '#f2f7ff'], 70], ['pebble', ['#b9c8dc', '#a8b9d0', '#cfdcec'], 60], ['sparkle', ['#e6f4ff', '#ffffff'], 50]],
  forest: [['leaf', ['#f29b4b', '#e9603b', '#f7c548', '#d77a3a'], 170], ['tuft', ['#8fbf5a', '#a4c96a', '#7cae4f'], 90], ['pebble', ['#c4b4a0', '#b3a28e'], 40]],
  slime: [['sprinkle', ['#ff8fb3', '#7fd6ff', '#ffd166', '#9be89b', '#c9a0ff', '#ffffff'], 200], ['gumdrop', ['#ffb3d1', '#c9a0ff', '#9fe0ff', '#ffe08a'], 45]],
  rain: [['tuft', ['#7cc46a', '#8fd47a', '#6ab35a'], 130], ['flower', ['#ffffff', '#ffb3d1', '#ffe066', '#c9b3ff'], 70], ['pebble', ['#b8c4b0', '#a9b7a2'], 40]],
  beach: [['shell', ['#ffd6e0', '#ffe8c9', '#f0dcff', '#ffffff'], 70], ['pebble', ['#e8d4b4', '#d9c39e', '#f2e2c4'], 80], ['starfish', ['#ff9e7a', '#ffb3c7', '#ffcf6b'], 22]],
  toy: [['marble', ['#ff8fb3', '#7fd6ff', '#ffd166', '#9be89b', '#c9a0ff'], 70], ['tinyblock', ['#ffb3d1', '#9fe0ff', '#ffe08a', '#b8f0b0'], 45], ['sprinkle', ['#ff8fb3', '#7fd6ff', '#ffd166', '#ffffff'], 80]],
};
function dressGeo(type) {
  switch (type) {
    case 'tuft': { // 一小撮草：几片细细的叶子
      const parts = [];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; const c = new THREE.ConeGeometry(0.018, 0.16 + (i % 2) * 0.05, 5); c.translate(0, 0.08, 0); c.rotateZ(Math.cos(a) * 0.35); c.rotateX(Math.sin(a) * 0.35); c.translate(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03); parts.push(c); }
      return mergeOr(parts);
    }
    case 'leaf': { const g = new THREE.SphereGeometry(0.06, 10, 6); g.scale(1, 0.14, 0.55); g.translate(0, 0.01, 0); return g; }
    case 'pebble': { const g = new THREE.IcosahedronGeometry(0.05, 1); g.scale(1.2, 0.55, 1); g.translate(0, 0.02, 0); return g; }
    case 'mound': { const g = new THREE.SphereGeometry(0.2, 14, 8, 0, TAU, 0, Math.PI / 2); g.scale(1, 0.35, 0.8); return g; }
    case 'sparkle': { const g = new THREE.OctahedronGeometry(0.03, 0); g.scale(1, 1.6, 1); g.translate(0, 0.05, 0); return g; }
    case 'sprinkle': { const g = new THREE.CapsuleGeometry(0.011, 0.04, 2, 6); g.rotateZ(Math.PI / 2); g.translate(0, 0.012, 0); return g; }
    case 'gumdrop': { const g = new THREE.SphereGeometry(0.06, 12, 8, 0, TAU, 0, Math.PI / 2); g.scale(1, 1.25, 1); return g; }
    case 'flower': {
      const parts = [new THREE.CylinderGeometry(0.006, 0.008, 0.12, 5).translate(0, 0.06, 0)];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; parts.push(new THREE.SphereGeometry(0.022, 8, 6).scale(1, 0.45, 1).translate(Math.cos(a) * 0.024, 0.125, Math.sin(a) * 0.024)); }
      return mergeOr(parts);
    }
    case 'shell': { const g = new THREE.SphereGeometry(0.05, 12, 6, 0, TAU, 0, Math.PI / 2); g.scale(1, 0.4, 0.85); return g; }
    case 'starfish': {
      const parts = [];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; parts.push(new THREE.CapsuleGeometry(0.016, 0.05, 2, 6).rotateZ(Math.PI / 2).rotateY(-a).translate(Math.cos(a) * 0.035, 0.012, Math.sin(a) * 0.035)); }
      return mergeOr(parts);
    }
    case 'marble': return new THREE.SphereGeometry(0.035, 12, 8).translate(0, 0.035, 0);
    case 'tinyblock': return roundedBox(0.07, 0.07, 0.07, 0.015, 2).translate(0, 0.035, 0);
    default: return new THREE.SphereGeometry(0.04, 8, 6);
  }
}
function mergeOr(parts) {
  for (const g of parts) { for (const n of Object.keys(g.attributes)) if (!['position', 'normal'].includes(n)) g.deleteAttribute(n); }
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  for (const g of parts) g.dispose();
  return m;
}
function dressGround(course) {
  const st = course.stage, rng = course.rng, L = course.length;
  const spec = DRESS[st.id];
  if (!spec) return;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  for (const [type, colors, perLen] of spec) {
    const n = Math.round(perLen * (L + 16) / 22);
    const geo = course.G.track(dressGeo(type));
    const mat = course.M.soft('#ffffff', { rough: type === 'marble' || type === 'gumdrop' ? 0.3 : 0.85, rim: 0.25 });
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.receiveShadow = true;
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const x = rng.range(-8, L + 8);
      // 主要撒在赛道两侧（不挡路）：背景一侧多、镜头一侧少一点
      const side = rng.next() < 0.68 ? -1 : 1;
      const z = side * rng.range(1.55, side < 0 ? 7.5 : 5.5);
      if (x > -0.6 && x < L + 0.6 && Math.abs(z) < 1.55) continue;
      const s = rng.range(0.7, 1.35) * (type === 'mound' ? rng.range(0.8, 1.8) : 1);
      q.setFromEuler(new THREE.Euler(0, rng.range(0, TAU), 0));
      m4.compose(new THREE.Vector3(x, -0.01, z), q, new THREE.Vector3(s, s, s));
      im.setMatrixAt(k, m4);
      col.set(rng.pick(colors));
      im.setColorAt(k, col);
      k++;
    }
    im.count = k;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    course.group.add(im);
  }
}

function placeProps(course, list) {
  const rng = course.rng;
  list = declutter(course, list);
  const buckets = { vc: [], glow: [], glossy: [] };
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const vcMat = course.vcMat();
  for (const p of list) {
    const { parts, anim } = buildProp(p.type, rng);
    m4.compose(new THREE.Vector3(p.x, p.y || 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(p.s, p.s, p.s));
    if (anim) {
      const g = new THREE.Group();
      for (const pt of parts) {
        const mat = pt.mat === 'vc' ? vcMat : pt.mat === 'glow' ? course.M.basic(pt.color, { fog: true }) : course.M.glossy(pt.color, { opacity: 0.6 });
        const mesh = new THREE.Mesh(course.G.track(pt.geo), mat);
        mesh.castShadow = true;
        if (pt.pos) mesh.position.copy(pt.pos);
        if (pt.spin) mesh.userData.spin = true;
        g.add(mesh);
      }
      g.position.set(p.x, p.y || 0, p.z); g.rotation.y = p.rot; g.scale.setScalar(p.s);
      g.userData.ph = rng.range(0, TAU);
      course.anims.push({ obj: g, kind: anim });
      course.group.add(g);
      continue;
    }
    for (const pt of parts) {
      const g = pt.geo;
      g.applyMatrix4(m4);
      if (pt.mat !== 'vc') {
        col.set(pt.color);
        let gg = g.index ? g.toNonIndexed() : g;
        if (gg !== g) g.dispose();
        for (const n of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(n)) gg.deleteAttribute(n);
        if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
        const c = new Float32Array(gg.attributes.position.count * 3);
        for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
        gg.setAttribute('color', new THREE.BufferAttribute(c, 3));
        buckets[pt.mat].push(gg);
      } else buckets.vc.push(g);
    }
  }
  const make = (lst, mat, shadow) => {
    if (!lst.length) return;
    const merged = mergeGeometries(lst, false);
    for (const g of lst) g.dispose();
    if (!merged) return;
    course.G.track(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow; mesh.receiveShadow = shadow;
    course.group.add(mesh);
  };
  make(buckets.vc, vcMat, true);
  make(buckets.glow, course.M.track(new THREE.MeshBasicMaterial({ vertexColors: true })), false);
  make(buckets.glossy, course.M.track(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.62, roughness: 0.1, depthWrite: false })), false);
}

// ======================= 厨房 =======================
function buildKitchen(course) {
  const st = course.stage, rng = course.rng, L = course.length;
  const x0 = -5, x1 = L + 4, W = x1 - x0, cx = (x0 + x1) / 2;
  course.scene.background = new THREE.Color(st.sky[1]);
  sky(course, st.sky);
  const BACK = -1.75, FRONT = 1.45, FLOOR = -0.95;
  // 台面（暖木色 + 细微木纹）
  const wood = canvasTex(course, 512, 128, (g, w, h) => {
    g.fillStyle = '#f6dfc2'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${200 + Math.random() * 30},${160 + Math.random() * 30},${120 + Math.random() * 20},0.35)`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + Math.random() * 4); g.stroke(); }
  }, [W / 3, 1]);
  const top = new THREE.Mesh(course.G.track(roundedBox(W, 0.12, FRONT - BACK, 0.04, 3)), course.M.soft('#ffffff', { rough: 0.55, rim: 0.15, map: wood }));
  top.position.set(cx, 0.035 - 0.06, (BACK + FRONT) / 2);
  top.receiveShadow = true;
  course.group.add(top);
  // 台面下的柜门（薄荷绿 + 小圆把手）
  const cab = [];
  cab.push(part(new THREE.BoxGeometry(W, -FLOOR - 0.12, 0.6), '#bfe8d8', V(cx, (FLOOR - 0.12) / 2 + 0.0, FRONT - 0.35)));
  for (let x = x0 + 0.6; x < x1; x += 0.9) {
    cab.push(part(roundedBox(0.84, -FLOOR - 0.3, 0.04, 0.03, 2), '#d6f2e7', V(x + 0.45, (FLOOR - 0.12) / 2, FRONT - 0.04)));
    cab.push(part(new THREE.SphereGeometry(0.035, 10, 8), '#ffd166', V(x + 0.8, -0.25, FRONT)));
  }
  // 地板
  cab.push(part(new THREE.BoxGeometry(W + 10, 0.05, 14), '#e8c7a4', V(cx, FLOOR - 0.03, 4)));
  // 后墙 + 侧墙
  const wallC = st.wall || '#fff1e6';
  cab.push(part(new THREE.BoxGeometry(W + 4, 4.6, 0.1), wallC, V(cx, 2.0, BACK - 0.05)));
  cab.push(part(new THREE.BoxGeometry(0.1, 4.6, 10), wallC, V(x0 - 0.05, 2.0, 2.6)));
  // 吊柜
  for (let x = x0 + 0.4; x < x1 - 0.8; x += 1.25) {
    if (Math.abs(x - (L * 0.45)) < 1.4) continue; // 窗户的位置空出来
    cab.push(part(roundedBox(1.15, 0.8, 0.45, 0.05, 2), st.cabinet || '#ffd6e2', V(x + 0.6, 2.05, BACK + 0.25)));
    cab.push(part(new THREE.SphereGeometry(0.035, 10, 8), '#ffffff', V(x + 0.6, 1.75, BACK + 0.49)));
  }
  // 窗户（亮亮的天空 + 白色窗框 + 窗帘）
  const wx = L * 0.45;
  cab.push(part(roundedBox(1.9, 0.08, 0.16, 0.03, 2), '#ffffff', V(wx, 1.2, BACK + 0.07)));
  cab.push(part(roundedBox(1.9, 0.08, 0.16, 0.03, 2), '#ffffff', V(wx, 2.45, BACK + 0.07)));
  cab.push(part(roundedBox(0.08, 1.33, 0.16, 0.03, 2), '#ffffff', V(wx - 0.91, 1.83, BACK + 0.07)));
  cab.push(part(roundedBox(0.08, 1.33, 0.16, 0.03, 2), '#ffffff', V(wx + 0.91, 1.83, BACK + 0.07)));
  cab.push(part(roundedBox(0.05, 1.3, 0.1, 0.02, 2), '#ffffff', V(wx, 1.83, BACK + 0.06)));
  for (const s of [-1, 1]) cab.push(part(roundedBox(0.42, 1.5, 0.06, 0.03, 3), '#ff9ec4', V(wx + s * 1.15, 1.85, BACK + 0.2)));
  // 架子 + 罐子
  cab.push(part(roundedBox(2.4, 0.05, 0.3, 0.02, 2), '#f2c99c', V(wx + 2.8, 1.3, BACK + 0.15)));
  addBaked(course, cab, { rough: 0.6, rim: 0.2, aoBase: FLOOR - 0.05 });
  windowGlass(course, paintedSky(course, 1.8, 1.25), 1.8, 1.25, V(wx, 1.83, BACK + 0.01));
  sunbeams(course, V(wx, 1.83, BACK + 0.05), 1.7, 1.1, V(0.22, -0.55, 1), { count: 4, opacity: 0.13 });
  // 瓷砖墙（台面到吊柜之间）
  const tiles = tileTextures(course, ['#ffffff', st.tile || '#ffe1ec'], [W / 1.2, 1]);
  const back = new THREE.Mesh(course.G.track(new THREE.PlaneGeometry(W, 1.2)), course.M.track(new THREE.MeshStandardMaterial({ map: tiles.map, bumpMap: tiles.bump, bumpScale: 2.2, roughness: 0.26, metalness: 0 })));
  back.position.set(cx, 0.6, BACK + 0.005);
  back.receiveShadow = true;
  course.group.add(back);
  // 墙和台面相接处暗一点（接触阴影）
  contactShade(course, W, 0.42, V(cx, 0.035 + 0.21, BACK + 0.012), 0, { strength: 0.42 });
  contactShade(course, W, 0.5, V(cx, 0.037, BACK + 0.25), -Math.PI / 2, { strength: 0.3, flip: true });
  // 冰箱（起点一侧，大大的、圆圆的，贴着冰箱贴）
  const fr = [];
  fr.push(part(roundedBox(1.3, 3.0, 1.2, 0.15, 3), '#c9f0ff', V(x0 + 1.0, 0.55, BACK + 1.0)));
  fr.push(part(roundedBox(0.06, 0.6, 0.06, 0.03, 2), '#ffffff', V(x0 + 1.6, 0.9, BACK + 1.62)));
  for (let i = 0; i < 6; i++) fr.push(part(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 14).rotateX(Math.PI / 2), ['#ff8fb3', '#ffd166', '#9be89b', '#7fd6ff', '#c9a0ff', '#ffb37a'][i], V(x0 + 0.7 + (i % 3) * 0.22, 1.2 + Math.floor(i / 3) * 0.3, BACK + 1.61)));
  addBaked(course, fr, { rough: 0.35, rim: 0.4, aoBase: FLOOR - 0.05 });
  // 台面后侧的小物件
  const list = [];
  for (let x = x0 + 2.2; x < x1 - 0.5; x += rng.range(0.9, 1.5)) list.push({ type: rng.pick(st.props), x, y: 0.035, z: BACK + rng.range(0.32, 0.6), s: rng.range(0.42, 0.62), rot: rng.range(-0.6, 0.6) });
  for (let i = 0; i < 5; i++) list.push({ type: 'jar', x: wx + 1.85 + i * 0.48, y: 1.33, z: BACK + 0.15, s: rng.range(0.28, 0.36), rot: 0 });
  placeProps(course, list);
  course.scene.fog = new THREE.Fog(new THREE.Color(st.fog), st.fogRange[0], st.fogRange[1]);
}

// ======================= 卧室（打扫房间） =======================
function buildRoom(course) {
  const st = course.stage, rng = course.rng, L = course.length;
  const x0 = -5, x1 = L + 5, W = x1 - x0, cx = (x0 + x1) / 2;
  const BACK = -3.0;
  course.scene.background = new THREE.Color(st.sky[1]);
  sky(course, st.sky);
  // 木地板
  const floorTex = canvasTex(course, 512, 512, (g, w, h) => {
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      let x = -((r * 97) % 140);
      while (x < w) {
        const len = 140 + Math.random() * 120;
        const v = 225 + Math.random() * 18;
        g.fillStyle = `rgb(${v},${v - 32},${v - 62})`; g.fillRect(x, r * (h / rows), len, h / rows);
        g.strokeStyle = 'rgba(160,110,70,0.35)'; g.lineWidth = 2; g.strokeRect(x, r * (h / rows), len, h / rows);
        x += len;
      }
    }
  }, [W / 4, 3]);
  const floor = new THREE.Mesh(course.G.track(new THREE.PlaneGeometry(W, 12).rotateX(-Math.PI / 2)), course.M.soft('#ffffff', { rough: 0.6, rim: 0.1, map: floorTex }));
  floor.position.set(cx, 0.0, 2.6);
  floor.receiveShadow = true;
  course.group.add(floor);
  // 壁纸（竖条纹 + 小星星）
  const paper = canvasTex(course, 256, 256, (g, w, h) => {
    g.fillStyle = st.wall || '#fff0f5'; g.fillRect(0, 0, w, h);
    g.fillStyle = st.wall2 || '#ffe1ec';
    for (let i = 0; i < 4; i++) g.fillRect(i * w / 4, 0, w / 8, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc((i * 47) % w, (i * 83) % h, 5, 0, TAU); g.fill(); }
  }, [W / 1.6, 2]);
  const wall = new THREE.Mesh(course.G.track(new THREE.PlaneGeometry(W, 4.2)), course.M.soft('#ffffff', { rough: 0.85, rim: 0.05, map: paper }));
  wall.position.set(cx, 2.1, BACK);
  wall.receiveShadow = true;
  course.group.add(wall);
  const side = new THREE.Mesh(course.G.track(new THREE.PlaneGeometry(9, 4.2).rotateY(Math.PI / 2)), course.M.soft('#ffffff', { rough: 0.85, rim: 0.05, map: paper }));
  side.position.set(x0, 2.1, 1.5);
  course.group.add(side);
  const P = [];
  // 踢脚线
  P.push(part(new THREE.BoxGeometry(W, 0.14, 0.05), '#ffffff', V(cx, 0.07, BACK + 0.03)));
  // 窗户（窗外下着小雨）+ 窗帘
  const wx = L * 0.35;
  for (const [w, h, x, y] of [[2.0, 0.09, wx, 0.95], [2.0, 0.09, wx, 2.55], [0.09, 1.69, wx - 0.95, 1.75], [0.09, 1.69, wx + 0.95, 1.75], [0.05, 1.6, wx, 1.75], [1.9, 0.05, wx, 1.75]]) P.push(part(roundedBox(w, h, 0.14, 0.02, 2), '#ffffff', V(x, y, BACK + 0.07)));
  P.push(part(roundedBox(2.3, 0.1, 0.3, 0.03, 2), '#ffffff', V(wx, 0.9, BACK + 0.15)));
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) P.push(part(new THREE.CylinderGeometry(0.1, 0.13, 2.2, 10), st.curtain || '#c9e8ff', V(wx + s * (1.2 + k * 0.12), 1.7, BACK + 0.25)));
  P.push(part(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 8).rotateZ(Math.PI / 2), '#e8b07a', V(wx, 2.85, BACK + 0.25)));
  // 书架
  const bx = L * 0.7;
  P.push(part(roundedBox(1.4, 1.8, 0.4, 0.04, 2), '#f2c99c', V(bx, 0.9, BACK + 0.22)));
  for (let r = 0; r < 3; r++) {
    P.push(part(new THREE.BoxGeometry(1.28, 0.03, 0.36), '#e3b07e', V(bx, 0.35 + r * 0.55, BACK + 0.25)));
    let x = bx - 0.58;
    while (x < bx + 0.55) { const w = 0.06 + rng.next() * 0.06, h = 0.3 + rng.next() * 0.15; P.push(part(roundedBox(w, h, 0.26, 0.01, 1), rng.pick(['#ff8fb3', '#7fd6ff', '#ffd166', '#9be89b', '#c9a0ff', '#ffb37a']), V(x + w / 2, 0.37 + r * 0.55 + h / 2, BACK + 0.25))); x += w + 0.01; }
  }
  // 墙上的画框 + 圆钟
  for (const [x, c] of [[L * 0.12, '#ffd166'], [L * 0.55, '#7fd6ff'], [L * 0.9, '#ff8fb3']]) {
    P.push(part(roundedBox(0.7, 0.55, 0.04, 0.03, 2), '#ffffff', V(x, 2.2, BACK + 0.03)));
    P.push(part(roundedBox(0.58, 0.43, 0.02, 0.02, 2), c, V(x, 2.2, BACK + 0.06)));
    P.push(part(new THREE.SphereGeometry(0.09, 12, 10).scale(1, 1, 0.3), '#ffffff', V(x, 2.2, BACK + 0.08)));
  }
  P.push(part(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 28).rotateX(Math.PI / 2), '#ffffff', V(L * 0.45 + 1.6, 2.6, BACK + 0.04)));
  P.push(part(new THREE.TorusGeometry(0.28, 0.035, 8, 28), '#ff8fb3', V(L * 0.45 + 1.6, 2.6, BACK + 0.06)));
  // 沙发、台灯、盆栽（背景）
  const sx = L * 0.2 - 2.2;
  P.push(part(roundedBox(2.0, 0.42, 0.85, 0.15, 3), st.sofa || '#ffc2d8', V(sx, 0.32, BACK + 0.65)));
  P.push(part(roundedBox(2.0, 0.6, 0.25, 0.12, 3), st.sofa || '#ffc2d8', V(sx, 0.75, BACK + 0.3)));
  for (const s of [-1, 1]) P.push(part(roundedBox(0.25, 0.55, 0.85, 0.12, 3), st.sofa || '#ffc2d8', V(sx + s * 1.0, 0.5, BACK + 0.65)));
  for (const s of [-0.45, 0.45]) P.push(part(blobGeometry(0.22, 3, 0.05, 2).scale(1, 0.75, 0.5), rng.pick(['#fff0a8', '#c9e8ff', '#ffffff']), V(sx + s, 0.72, BACK + 0.5)));
  P.push(part(new THREE.CylinderGeometry(0.025, 0.03, 1.5, 8), '#ffffff', V(L * 0.55 - 1, 0.75, BACK + 0.4)));
  P.push(part(new THREE.CylinderGeometry(0.18, 0.28, 0.32, 18, 1, true), '#fff1a8', V(L * 0.55 - 1, 1.6, BACK + 0.4)));
  addBaked(course, P, { rough: 0.7, rim: 0.2 });
  // 窗玻璃：淡蓝的天，玻璃上有雨滴
  // 窗外：刚下过小雨、云缝里透出太阳（玻璃上还挂着雨滴），一束束柔光照进房间
  windowGlass(course, paintedSky(course, 1.85, 1.6, { top: '#a9d4f2', mid: '#dcefff', bot: '#fff6e6', rain: true }), 1.85, 1.6, V(wx, 1.75, BACK + 0.01));
  sunbeams(course, V(wx, 1.75, BACK + 0.05), 1.75, 1.4, V(-0.18, -0.52, 1), { count: 4, opacity: 0.12, len: 1.25 });
  // 墙根的接触阴影（墙上 + 地板上）
  contactShade(course, W, 0.6, V(cx, 0.3, BACK + 0.062), 0, { strength: 0.38 });
  contactShade(course, W, 0.8, V(cx, 0.004, BACK + 0.45), -Math.PI / 2, { strength: 0.32, flip: true });
  // 圆形小地毯 + 散落的装饰
  const list = [];
  for (let x = x0 + 1.5; x < x1 - 1; x += rng.range(1.8, 3.0)) {
    list.push({ type: rng.pick(st.props), x, z: BACK + rng.range(0.4, 1.0), s: rng.range(0.55, 0.85), rot: rng.range(0, TAU) });
    if (rng.next() < 0.45) list.push({ type: rng.pick(st.props), x: x + rng.range(-0.8, 0.8), z: rng.range(2.6, 4.2), s: rng.range(0.45, 0.7), rot: rng.range(0, TAU) });
  }
  placeProps(course, list);
  const rugs = [];
  for (let x = x0 + 1; x < x1; x += rng.range(3, 5)) rugs.push(part(new THREE.CylinderGeometry(1, 1, 0.012, 36), rng.pick(['#ffe1ec', '#e1f3ff', '#fff6cc', '#eae1ff']), V(x, 0.006, rng.range(-1.9, -1.2)), [0, 0, 0], V(rng.range(0.9, 1.4), 1, rng.range(0.6, 0.9))));
  addBaked(course, rugs, { rough: 1, rim: 0.2, shadow: false, flat: true });
  course.scene.fog = new THREE.Fog(new THREE.Color(st.fog), st.fogRange[0], st.fogRange[1]);
}
