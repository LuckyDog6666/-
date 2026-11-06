// 任务站：厨房做饭 & 打扫房间。
// 设计参考：
//  - Cooking Mama：一道菜 = 一串每个不到 10 秒的小任务（切菜 → 打蛋搅拌 → 煎饼翻面 → 裱花装饰）
//  - PowerWash Simulator：脏东西一擦就亮，进度看得见，"没有失败、只有满足"
//  - Unpacking / A Little to the Left：东西"啪"地放进属于它的位置，配上恰到好处的放置声
// 机位像美食节目：糯糯站在操作台后面、面朝观众，小手和食物/物件都在画面正中。
// 每个"接触"的瞬间（刀落到砧板、锅铲挑起松饼、抹布擦过）都由动画帧回调触发声音和特效，声画严格同步。
import * as THREE from 'three';
import { Station } from './station.js';
import { roundedBox, blobGeometry } from '../world/geo.js';
import { Spring, TAU, clamp, lerp, ease } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RAINBOW = ['#ff8fb3', '#ffb37a', '#ffe27a', '#9be89b', '#7fd6ff', '#a99bff', '#e39bff'];
const WORK_Z = -0.52; // 糯糯干活时站的位置（在操作台后面）
const FACE = 0.34;    // 干活时面朝镜头的角度

class TaskStation extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.kind = 'task';
    this.tweens = [];
    this.prog = 0;
  }
  W(x, y, z) { return V(this.x0 + x, this.group.position.y + y, z); }
  topY() { return 0.02; }
  progress() { return this.done ? 1 : this.prog; }
  footstep() { return {}; }
  // 简单补间：返回 Promise，u 从 0 到 1
  tween(dur, fn) {
    return new Promise((res) => { this.tweens.push({ t: 0, dur, fn, res }); fn(0); });
  }
  update(dt) {
    super.update(dt);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur);
      tw.fn(u);
      if (u >= 1) { this.tweens.splice(i, 1); tw.res(); }
    }
  }
  // 走到 (x, z)。如果是往远离镜头的方向走（绕到操作台后面、玩具后面），
  // 就面朝观众小碎步挪过去，不把后背对着镜头
  async stepTo(G, x, z, o = {}) {
    const p = G.pet.root.position, t = this.W(x, 0, z);
    const dx = t.x - p.x, dz = t.z - p.z;
    const away = dz < -0.12 && -dz > Math.abs(dx) * 0.4;
    if (away) G.pet.face(FACE);
    await G.walkTo(t, { stepDur: away ? 0.32 : o.stepDur || 0.4, stride: away ? 0.16 : o.stride || 0.22, keepFace: away });
  }
  async goTo(G, x, z = WORK_Z) {
    await this.stepTo(G, x, z);
    G.pet.face(FACE);
  }
  mesh(geo, mat, x = 0, y = 0, z = 0, parent = this.group) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  dispose() { this.tweens = []; }
}

// 弧线抛物：从 a 飞到 b（局部坐标），带一点旋转
function arc(obj, a, b, h, u) {
  obj.position.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u) + 4 * h * u * (1 - u), lerp(a.z, b.z, u));
}

// ================= 厨房 1. 切切蔬菜 =================
export class ChopStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    const L = this.length;
    this.mesh(G.track(roundedBox(1.95, 0.05, 0.62, 0.022, 3)), M.soft('#f2c99c', { rough: 0.7, rim: 0.25 }), L / 2, 0.025, 0.1);
    this.mesh(G.track(roundedBox(1.7, 0.004, 0.5, 0.002, 1)), M.soft('#f7d6b0', { rough: 0.8 }), L / 2, 0.051, 0.1);
    this.veg = [];
    const kinds = this.def.veg || ['carrot', 'cucumber'];
    const T = 0.05;
    kinds.forEach((kind, vi) => {
      const n = 7;
      const x0 = L / 2 - 0.75 + vi * 0.8;
      const skin = M.soft(kind === 'carrot' ? '#ff9a3d' : '#5fb35c', { rough: 0.5, rim: 0.3 });
      const flesh = M.soft(kind === 'carrot' ? '#ffb86b' : '#d9f5b8', { rough: 0.6, rim: 0.1 });
      const slices = [];
      for (let i = 0; i < n; i++) {
        const r = kind === 'carrot' ? 0.066 - i * 0.004 : 0.06;
        const geo = G.track(new THREE.CylinderGeometry(r, r, T * 0.97, 22).rotateZ(Math.PI / 2));
        const m = this.mesh(geo, [skin, flesh, flesh], x0 + (i + 0.5) * T, 0.05 + r, 0.1);
        slices.push({ m, r, x: x0 + (i + 0.5) * T, cut: false });
      }
      // 两头：胡萝卜尖 + 绿叶；黄瓜圆头
      const xe = x0 + n * T;
      if (kind === 'carrot') {
        this.mesh(G.track(new THREE.ConeGeometry(0.036, 0.16, 18).rotateZ(-Math.PI / 2)), skin, xe + 0.08, 0.05 + 0.036, 0.1);
        for (let k = 0; k < 3; k++) { const lf = this.mesh(G.get('chop|leaf', () => new THREE.ConeGeometry(0.025, 0.16, 8)), M.soft('#6fcf6a', { rough: 0.6 }), x0 - 0.05, 0.05 + 0.08, 0.1 + (k - 1) * 0.03); lf.rotation.z = Math.PI / 2 + (k - 1) * 0.35; }
      } else {
        const cap = this.mesh(G.track(new THREE.SphereGeometry(0.064, 18, 12, 0, TAU, 0, Math.PI / 2).rotateZ(-Math.PI / 2)), skin, xe, 0.05 + 0.064, 0.1);
        void cap;
        this.mesh(G.track(new THREE.SphereGeometry(0.064, 18, 12, 0, TAU, 0, Math.PI / 2).rotateZ(Math.PI / 2)), skin, x0, 0.05 + 0.064, 0.1);
      }
      this.veg.push({ kind, slices, color: kind === 'carrot' ? ['#ffb86b', '#ff9a3d'] : ['#d9f5b8', '#5fb35c'] });
    });
    this.total = this.veg.reduce((n, v) => n + v.slices.length, 0);
    this.cutN = 0;
    return this;
  }
  async run(G) {
    const pet = G.pet, L = this.length;
    G.label(this.label);
    G.cam('task', { at: this.W(L / 2, 0.05, 0.1), lookY: 0.22, dist: 1.1 });
    await this.goTo(G, L / 2 - 0.8);
    pet.hold('knife');
    G.sfx('place', pet.root.position, { gain: -12, main: false });
    G.say(this.def.say || '切切切～');
    let fan = 0;
    // 刀口相对糯糯身体中心的横向偏移：先估一个，第一刀落下后按刀尖的实际位置校准，之后每一刀都正好落在切口上
    let knifeDX = 0.36;
    for (const v of this.veg) {
      for (let i = 0; i < v.slices.length; i++) {
        const s = v.slices[i];
        const tx = s.x + 0.012 - knifeDX;
        if (Math.abs(pet.root.position.x - this.x0 - tx) > 0.03) await G.walkTo(this.W(tx, 0, WORK_Z), { stepDur: 0.3, stride: 0.14, keepFace: true });
        pet.face(FACE);
        await pet.act('chop', {
          dur: 0.56,
          onHit: () => {
            const tip = pet.toolTipWorld();
            knifeDX = clamp(tip.x - pet.root.position.x, 0.15, 0.6);
            s.cut = true;
            this.cutN++;
            this.prog = this.cutN / this.total;
            G.sfx('chop', this.W(s.x, 0.06, 0.1), { gain: -1 + G.rng() * 2 });
            G.burst('crumbs', this.W(s.x, 0.08, 0.1), { colors: v.color, count: 5, scale: 0.35 });
            G.countStep();
            // 切下来的一片：先分开一点，再翻倒平躺，排成整齐的一扇
            const k = fan++;
            const from = s.m.position.clone();
            const to = V(s.x + 0.012, 0.05 + 0.026 + 0.003 * (k % 3), 0.34 + (k % 2) * 0.01);
            this.tween(0.36, (u) => {
              const e = ease.outBack(u);
              s.m.position.set(lerp(from.x, to.x, e), lerp(from.y, to.y, u) + Math.sin(u * Math.PI) * 0.05, lerp(from.z, to.z, e));
              s.m.rotation.z = (Math.PI / 2) * ease.inOutQuad(u);
              s.m.rotation.x = 0.18 * u;
            });
          },
        });
        if (i === 2 && v === this.veg[0]) { G.unsay(); pet.expr('happy', 'smile', 1); }
      }
      await G.wait(0.25);
    }
    pet.hold(null);
    pet.face(FACE);
    G.burst('sparkles', this.W(L / 2, 0.15, 0.36), { colors: ['#ffffff', '#fff2a8'], count: 14 });
    pet.expr('happy', 'open', 1.2);
    await pet.idleAction('proud', 0.9);
    G.unsay();
  }
}

// ================= 厨房 2. 打蛋 + 搅拌面糊 =================
export class WhiskStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    const L = this.length;
    this.bowlX = L / 2;
    const bowl = new THREE.Group();
    bowl.position.set(this.bowlX, 0, 0.1);
    this.group.add(bowl);
    const bm = M.soft(this.def.bowlColor || '#9fd8ff', { rough: 0.22, rim: 0.55, rimColor: '#ffffff', side: THREE.DoubleSide });
    this.mesh(G.track(new THREE.CylinderGeometry(0.38, 0.24, 0.28, 40, 1, true).translate(0, 0.14, 0)), bm, 0, 0, 0, bowl);
    this.mesh(G.track(new THREE.CircleGeometry(0.24, 32).rotateX(-Math.PI / 2)), bm, 0, 0.005, 0, bowl);
    this.mesh(G.track(new THREE.TorusGeometry(0.38, 0.022, 10, 48).rotateX(Math.PI / 2)), M.soft('#ffffff', { rough: 0.3, rim: 0.4 }), 0, 0.28, 0, bowl);
    // 碗里的面糊：画布贴图（打蛋、搅拌的纹路都画在上面）
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    this.cv = c; this.g2 = c.getContext('2d');
    this.g2.fillStyle = '#fff8ee'; this.g2.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) { this.g2.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.5})`; this.g2.beginPath(); this.g2.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 0, TAU); this.g2.fill(); }
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.ctx.M.track({ dispose: () => this.tex.dispose() });
    this.batter = this.mesh(G.track(new THREE.CircleGeometry(0.335, 48).rotateX(-Math.PI / 2)), M.track(new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.35 })), 0, 0.19, 0, bowl);
    this.flour = this.mesh(G.track(blobGeometry(0.17, 4, 0.08, 2).scale(1, 0.5, 1)), M.soft('#ffffff', { rough: 0.95, rim: 0.3 }), -0.05, 0.22, 0.02, bowl);
    this.bowl = bowl;
    this.bowlSq = new Spring(200, 8, 1);
    this.mix = 0;
    this.yolks = [];
    return this;
  }
  _paintYolk(x, z) {
    const g = this.g2, px = (x / 0.67 + 0.5) * 256, py = (z / 0.67 + 0.5) * 256;
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.arc(px, py, 26, 0, TAU); g.fill();
    g.fillStyle = '#ffc93c'; g.beginPath(); g.arc(px, py, 13, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(px - 4, py - 4, 4, 0, TAU); g.fill();
    this.tex.needsUpdate = true;
  }
  update(dt) {
    super.update(dt);
    const s = this.bowlSq.update(dt);
    this.bowl.scale.set(1 + (1 - s) * 0.4, s, 1 + (1 - s) * 0.4);
    if (this.whisking) {
      // 搅拌：一圈圈的纹路，颜色慢慢混成均匀的奶油色
      this.wa = (this.wa || 0) + dt * 7.5;
      const g = this.g2, k = this.mix;
      const col = `rgb(${Math.round(lerp(255, 255, k))},${Math.round(lerp(214, 226, k))},${Math.round(lerp(110, 168, k))})`;
      g.lineCap = 'round';
      for (let j = 0; j < 3; j++) {
        const r = 30 + ((this.wa * 9 + j * 31) % 80);
        const a = this.wa + j * 2.1;
        g.strokeStyle = col; g.globalAlpha = 0.5; g.lineWidth = 7;
        g.beginPath(); g.arc(128, 128, r, a, a + 0.9); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2;
        g.beginPath(); g.arc(128, 128, r + 4, a + 0.2, a + 0.7); g.stroke();
      }
      g.globalAlpha = 0.05 + k * 0.08; g.fillStyle = '#ffe2a6'; g.fillRect(0, 0, 256, 256); g.globalAlpha = 1;
      this.tex.needsUpdate = true;
      this.batter.rotation.y += dt * 0.8;
    }
  }
  async run(G) {
    const pet = G.pet, L = this.length;
    G.label(this.label);
    G.cam('task', { at: this.W(this.bowlX, 0.15, 0.1), lookY: 0.2, dist: 1.08 });
    await this.goTo(G, this.bowlX - 0.2);
    G.say(this.def.say || '先打两个蛋～');
    for (let e = 0; e < 2; e++) {
      pet.hold('egg');
      await pet.act('crack', {
        dur: 0.8,
        onHit: () => {
          G.sfx('ice_crack', this.W(this.bowlX, 0.3, 0.1), { gain: -9 });
          const yolk = this.mesh(this.ctx.G.get('whisk|yolk', () => new THREE.SphereGeometry(0.045, 14, 10)), this.ctx.M.soft('#ffc93c', { rough: 0.2, rim: 0.4 }), 0, 0.5, 0, this.bowl);
          const tx = (e ? 0.1 : -0.08), tz = (e ? -0.06 : 0.07);
          const from = V(0.02, 0.48, -0.05);
          pet.hold(null);
          this.tween(0.32, (u) => { yolk.position.set(lerp(from.x, tx, u), lerp(from.y, 0.21, u * u), lerp(from.z, tz, u)); }).then(() => {
            this.bowl.remove(yolk);
            this._paintYolk(tx, tz);
            G.sfx('plop', this.W(this.bowlX, 0.2, 0.1), { gain: -5 });
            G.burst('water', this.W(this.bowlX + tx, 0.22, 0.1 + tz), { colors: ['#ffe9a8', '#ffffff'], count: 5, scale: 0.35 });
            this.bowlSq.x = 0.92;
          });
        },
      });
      await G.wait(0.45);
    }
    G.unsay();
    this.prog = 0.3;
    // 搅拌：面粉慢慢消失，蛋黄和面粉混成顺滑的面糊
    pet.hold('whisk');
    G.say('搅呀搅～');
    this.whisking = true;
    const reps = 8;
    await pet.act('whisk', {
      reps, dur: 0.66,
      onHit: (i) => {
        this.mix = Math.min(1, (i + 1) / reps);
        this.prog = 0.3 + 0.7 * this.mix;
        this.flour.scale.setScalar(Math.max(0.05, 1 - this.mix * 1.1));
        if (i % 2 === 0) G.sfx('slime_squish', this.W(this.bowlX, 0.2, 0.1), { gain: -5, maxDur: 1.3 });
        G.countStep();
      },
    });
    this.whisking = false;
    this.flour.visible = false;
    // 最后一圈：顺滑有光泽的面糊
    this.g2.fillStyle = '#ffe2a6'; this.g2.globalAlpha = 0.85; this.g2.fillRect(0, 0, 256, 256); this.g2.globalAlpha = 1;
    this.g2.strokeStyle = 'rgba(255,255,255,0.7)'; this.g2.lineWidth = 3;
    for (let r = 20; r < 120; r += 14) { this.g2.beginPath(); this.g2.arc(128, 128, r, r * 0.05, r * 0.05 + 4.2); this.g2.stroke(); }
    this.tex.needsUpdate = true;
    pet.hold(null);
    G.unsay();
    G.burst('sparkles', this.W(this.bowlX, 0.3, 0.1), { colors: ['#ffffff', '#fff2a8'], count: 14 });
    pet.expr('happy', 'open', 1.2);
    await pet.idleAction('celebrate', 0.8);
    void L;
  }
}

// ================= 厨房 3. 煎松饼（倒面糊 → 冒泡 → 翻面 → 叠到盘子上） =================
export class PanStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    const L = this.length;
    this.panX = L / 2 - 0.38; this.plateX = L / 2 + 0.5;
    this.mesh(G.track(roundedBox(0.92, 0.08, 0.74, 0.03, 3)), M.soft('#ffffff', { rough: 0.4, rim: 0.3 }), this.panX, 0.04, 0.1);
    this.mesh(G.track(new THREE.TorusGeometry(0.25, 0.018, 8, 40).rotateX(Math.PI / 2)), M.soft('#5a5470', { rough: 0.5 }), this.panX, 0.085, 0.1);
    const pan = new THREE.Group();
    pan.position.set(this.panX, 0.09, 0.1);
    this.group.add(pan);
    this.mesh(G.track(new THREE.CylinderGeometry(0.31, 0.27, 0.05, 40).translate(0, 0.025, 0)), M.soft(this.def.panColor || '#5fb8c9', { rough: 0.35, rim: 0.4 }), 0, 0, 0, pan);
    this.mesh(G.track(new THREE.CylinderGeometry(0.28, 0.28, 0.006, 40)), M.soft('#3d4a5c', { rough: 0.3 }), 0, 0.052, 0, pan);
    this.mesh(G.track(new THREE.TorusGeometry(0.305, 0.018, 8, 48).rotateX(Math.PI / 2)), M.soft(this.def.panColor || '#5fb8c9', { rough: 0.35 }), 0, 0.05, 0, pan);
    const handle = this.mesh(G.track(new THREE.CapsuleGeometry(0.03, 0.26, 4, 10).rotateZ(Math.PI / 2)), M.soft('#ffb3d1', { rough: 0.5, rim: 0.3 }), -0.47, 0.05, 0, pan);
    void handle;
    this.pan = pan;
    // 盘子
    this.mesh(G.track(new THREE.CylinderGeometry(0.28, 0.24, 0.03, 36).translate(0, 0.015, 0)), M.soft('#ffffff', { rough: 0.3, rim: 0.35 }), this.plateX, 0, 0.12);
    // 三张松饼（侧面金黄、上面是生面糊色、下面是煎好的金黄色）
    const side = M.soft('#f0b45a', { rough: 0.6 }), raw = M.soft('#ffe9b8', { rough: 0.5 }), gold = M.soft('#e9a043', { rough: 0.55, rim: 0.2 });
    const geo = G.get('pancake', () => new THREE.CylinderGeometry(0.2, 0.2, 0.034, 32));
    this.cakes = [0, 1, 2].map(() => { const m = this.mesh(geo, [side, raw, gold], 0, 0.075, 0, pan); m.visible = false; return m; });
    // 面糊上的小气泡
    this.bub = new THREE.InstancedMesh(G.get('pancake|bub', () => new THREE.SphereGeometry(0.011, 6, 4)), M.soft('#fff7e0', { rough: 0.3 }), 14);
    this.bub.count = 0;
    pan.add(this.bub);
    this.bubbles = [];
    this.stack = 0;
    this.panSq = new Spring(220, 9, 1);
    return this;
  }
  update(dt) {
    super.update(dt);
    const s = this.panSq.update(dt);
    this.pan.scale.set(1, s, 1);
    if (this.bubbles.length) {
      const m4 = new THREE.Matrix4();
      let n = 0;
      for (const b of this.bubbles) {
        b.t += dt;
        if (b.t < 0 || b.t > b.life) continue;
        const k = Math.sin(Math.min(1, b.t / b.life) * Math.PI);
        m4.compose(V(b.x, 0.094, b.z), new THREE.Quaternion(), V(k, k * 0.6, k));
        this.bub.setMatrixAt(n++, m4);
      }
      this.bub.count = n;
      this.bub.instanceMatrix.needsUpdate = true;
    }
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.W((this.panX + this.plateX) / 2, 0.08, 0.1), lookY: 0.22, dist: 1.1 });
    await this.goTo(G, this.panX - 0.22);
    G.say(this.def.say || '煎松饼喽～');
    const r = G.rng;
    for (let k = 0; k < this.cakes.length; k++) {
      const cake = this.cakes[k];
      // 1) 倒面糊
      pet.hold('jug');
      await pet.act('pour', {
        dur: 0.9,
        onHit: () => {
          cake.visible = true; cake.rotation.set(0, 0, 0); cake.position.set(0, 0.072, 0);
          this.tween(0.7, (u) => { const s = 0.25 + 0.75 * ease.outCubic(u); cake.scale.set(s, 1, s); });
          G.sfx('slime_pull', this.W(this.panX, 0.1, 0.1), { gain: -7, maxDur: 1.4 });
        },
      });
      if (k === 0) G.unsay();
      pet.hold(null);
      // 2) 滋滋煎着，表面冒小泡泡
      const sizzle = G.sfx('sizzle', this.W(this.panX, 0.1, 0.1), { gain: -9, main: false });
      this.bubbles = Array.from({ length: 14 }, () => ({ x: r() * 0.3 - 0.15, z: r() * 0.3 - 0.15, t: -r() * 1.2, life: 0.5 + r() * 0.6 }));
      await G.wait(1.5);
      // 3) 翻面！
      pet.hold('spatula');
      await pet.act('flip', {
        dur: 0.85,
        onHit: () => {
          this.bubbles = [];
          G.sfx('whoosh', this.W(this.panX, 0.3, 0.1), { gain: -9, main: false });
          // 锅铲先插到松饼下面、把它往自己这边铲一点，再从锅铲上翻起来，落回锅中间
          const tip = pet.toolTipWorld();
          this.group.updateMatrixWorld(true);
          const lt = this.pan.worldToLocal(tip.clone());
          const sx = clamp(lt.x, -0.12, 0.12) * 0.6, sz = clamp(lt.z, -0.12, 0.12) * 0.6;
          const y0 = 0.072;
          this.tween(0.65, (u) => {
            if (u < 0.2) { const k = ease.outQuad(u / 0.2); cake.position.set(sx * k, y0 + 0.01 * k, sz * k); return; }
            const k = (u - 0.2) / 0.8;
            cake.position.set(lerp(sx, 0, k), y0 + 0.01 + 4 * 0.26 * k * (1 - k), lerp(sz, 0, k));
            cake.rotation.x = Math.PI * ease.inOutQuad(k);
          }).then(() => {
            cake.position.set(0, y0, 0);
            G.sfx('place', this.W(this.panX, 0.1, 0.1), { gain: -7 });
            G.burst('crumbs', this.W(this.panX, 0.12, 0.1), { colors: ['#f0b45a', '#ffe9b8'], count: 5, scale: 0.35 });
            this.panSq.x = 0.85;
            G.camBump(0.012);
          });
        },
      });
      await G.wait(0.7);
      if (sizzle) G.stopSfx(sizzle, 0.4);
      // 4) 叠到盘子上
      const from = cake.position.clone();
      const to = V(this.plateX - this.panX, 0.03 - 0.09 + 0.017 + this.stack * 0.034, 0.02);
      G.sfx('whoosh', this.W(this.panX, 0.2, 0.1), { gain: -12, main: false });
      await this.tween(0.5, (u) => arc(cake, from, to, 0.22, ease.inOutSine(u)));
      this.group.attach(cake); // 离开锅：之后锅的挤压回弹不再影响盘子里的松饼
      this.stack++;
      G.sfx('place', this.W(this.plateX, 0.05, 0.12), { gain: -5 });
      G.countStep();
      this.prog = (k + 1) / this.cakes.length;
      pet.hold(null);
      if (k === 1) { pet.expr('happy', 'smile', 1); }
    }
    // 黄油 + 草莓
    const top = 0.03 + this.stack * 0.034;
    const butter = this.mesh(this.ctx.G.track(roundedBox(0.07, 0.035, 0.07, 0.012, 2)), this.ctx.M.soft('#fff1a8', { rough: 0.3, rim: 0.4 }), this.plateX, 0.5, 0.12);
    await this.tween(0.35, (u) => { butter.position.y = lerp(0.5, top + 0.017, u * u); });
    G.sfx('plop', this.W(this.plateX, top, 0.12), { gain: -4 });
    G.burst('sparkles', this.W(this.plateX, top + 0.1, 0.12), { colors: ['#ffffff', '#fff2a8'], count: 14 });
    G.say('松饼好啦～');
    pet.expr('happy', 'open', 1.4);
    await pet.idleAction('celebrate', 0.9);
    G.unsay();
  }
}

// ================= 厨房 4. 裱花蛋糕 =================
export class CreamStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    const L = this.length;
    this.cx = L / 2;
    const stand = new THREE.Group();
    stand.position.set(this.cx, 0, 0.1);
    this.group.add(stand);
    this.mesh(G.track(new THREE.CylinderGeometry(0.1, 0.16, 0.08, 24).translate(0, 0.04, 0)), M.soft('#ffffff', { rough: 0.3, rim: 0.3 }), 0, 0, 0, stand);
    this.mesh(G.track(new THREE.CylinderGeometry(0.46, 0.44, 0.03, 40).translate(0, 0.095, 0)), M.soft('#ffffff', { rough: 0.3, rim: 0.35 }), 0, 0, 0, stand);
    this.mesh(G.track(new THREE.CylinderGeometry(0.37, 0.37, 0.12, 40).translate(0, 0.17, 0)), M.soft('#fff6fa', { rough: 0.8, rim: 0.35 }), 0, 0, 0, stand);
    this.mesh(G.track(new THREE.CylinderGeometry(0.375, 0.375, 0.035, 40).translate(0, 0.245, 0)), M.soft(this.def.layer || '#ff9ec4', { rough: 0.6 }), 0, 0, 0, stand);
    this.mesh(G.track(new THREE.CylinderGeometry(0.37, 0.37, 0.09, 40).translate(0, 0.305, 0)), M.soft('#ffffff', { rough: 0.85, rim: 0.35 }), 0, 0, 0, stand);
    this.top = 0.35;
    this.stand = stand;
    // 奶油花：三层小圈一层比一层小，像真的裱花
    const rosG = G.get('rosette', () => {
      const parts = [new THREE.TorusGeometry(0.045, 0.022, 8, 18).rotateX(Math.PI / 2).translate(0, 0.012, 0), new THREE.TorusGeometry(0.03, 0.019, 8, 16).rotateX(Math.PI / 2).translate(0, 0.036, 0), new THREE.TorusGeometry(0.016, 0.015, 8, 14).rotateX(Math.PI / 2).translate(0, 0.056, 0), new THREE.ConeGeometry(0.012, 0.03, 8).translate(0, 0.075, 0)];
      const g = mergeGeoms(parts);
      return g;
    });
    this.roses = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const m = this.mesh(rosG, M.soft(i % 2 ? '#ffd6e8' : '#ffffff', { rough: 0.75, rim: 0.35 }), 0, this.top, 0, stand);
      m.scale.setScalar(0.001);
      this.roses.push(m);
    }
    return this;
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.W(this.cx, 0.25, 0.1), lookY: 0.25, dist: 1.08 });
    await this.goTo(G, this.cx - 0.2, WORK_Z - 0.04);
    pet.hold('piping');
    G.say(this.def.say || '挤一圈奶油花～');
    // 像真的裱花一样：裱花袋不动，蛋糕转台一格一格地转，一圈奶油花就排得整整齐齐
    let base = this.stand.rotation.y;
    for (let i = 0; i < this.roses.length; i++) {
      const m = this.roses[i];
      await pet.act('pipe', {
        dur: 0.7,
        onHit: () => {
          const tip = pet.toolTipWorld();
          this.group.updateMatrixWorld(true);
          const lp = this.stand.worldToLocal(tip.clone());
          const a = Math.atan2(lp.z, lp.x);
          m.position.set(Math.cos(a) * 0.29, this.top, Math.sin(a) * 0.29);
          G.sfx('squishy_press', this.W(this.cx, this.top, 0.1), { gain: -8, maxDur: 0.9 });
          this.tween(0.42, (u) => { m.scale.setScalar(Math.max(0.001, ease.outBack(u))); m.rotation.y = -a + (1 - u) * 1.6; });
          this.prog = (i + 1) / (this.roses.length + 1);
          G.countStep();
        },
      });
      if (i === 2) G.unsay();
      if (i < this.roses.length - 1) { const b0 = base; base += TAU / this.roses.length; await this.tween(0.3, (u) => { this.stand.rotation.y = b0 + (TAU / this.roses.length) * ease.inOutSine(u); }); }
    }
    pet.hold(null);
    // 放一颗大草莓，撒彩色糖珠
    const berry = this.mesh(this.ctx.G.get('berry', () => new THREE.SphereGeometry(0.075, 16, 12).scale(1, 1.2, 1)), this.ctx.M.soft('#ff4d6d', { rough: 0.35, rim: 0.4 }), 0, 0.9, 0, this.stand);
    const leaf = this.mesh(this.ctx.G.get('berryLeaf', () => new THREE.ConeGeometry(0.05, 0.03, 6)), this.ctx.M.soft('#6fcf6a', { rough: 0.6 }), 0, 0.09, 0, berry);
    void leaf;
    await this.tween(0.4, (u) => { berry.position.y = lerp(0.9, this.top + 0.08, u * u); });
    G.sfx('plop', this.W(this.cx, this.top, 0.1), { gain: -4 });
    G.burst('confetti', this.W(this.cx, this.top + 0.2, 0.1), { colors: RAINBOW, count: 26, scale: 0.4, floor: this.top });
    G.sfx('sand_step', this.W(this.cx, this.top, 0.1), { gain: -10, main: false, delay: 0.1 });
    this.prog = 1;
    G.say('好漂亮的蛋糕～');
    pet.expr('happy', 'open', 1.4);
    await pet.idleAction('celebrate', 0.9);
    G.unsay();
  }
}

// ================= 打扫 1. 扫灰尘 =================
export class SweepStation extends TaskStation {
  build() {
    const { M, G, rng: r } = this.ctx;
    const L = this.length;
    const n = 30;
    const dustG = G.get('dust', () => blobGeometry(0.05, 6, 0.25, 2));
    this.dustIM = new THREE.InstancedMesh(dustG, M.soft('#cfc6dd', { rough: 1, rim: 0.6, rimColor: '#ffffff' }), n);
    this.dustIM.castShadow = true;
    const crumbG = G.get('crumb', () => new THREE.TetrahedronGeometry(0.025, 0));
    this.crumbIM = new THREE.InstancedMesh(crumbG, M.soft('#e8d2b0', { rough: 0.8, flat: true }), 30);
    this.items = [];
    for (let i = 0; i < n + 30; i++) {
      const x = r.range(0.35, L - 0.55), z = r.range(-0.5, 0.5);
      this.items.push({ x, z, tx: x, tz: z, s: r.range(0.7, 1.3), rot: r.range(0, TAU), dust: i < n, k: i < n ? i : i - n, gone: false });
    }
    this.group.add(this.dustIM, this.crumbIM);
    // 簸箕
    const pan = new THREE.Group();
    pan.position.set(L - 0.12, 0, 0);
    this.mesh(G.track(roundedBox(0.2, 0.02, 0.5, 0.01, 2)), M.soft('#7fd6ff', { rough: 0.4, rim: 0.4 }), 0, 0.012, 0, pan);
    this.mesh(G.track(roundedBox(0.03, 0.12, 0.5, 0.012, 2)), M.soft('#7fd6ff', { rough: 0.4 }), 0.1, 0.06, 0, pan);
    this.mesh(G.track(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 8)), M.soft('#ffd166', { rough: 0.5 }), 0.12, 0.3, 0, pan);
    this.group.add(pan);
    this.panObj = pan;
    this.panSq = new Spring(200, 8, 1);
    this._write();
    return this;
  }
  _write() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const it of this.items) {
      q.setFromAxisAngle(V(0, 1, 0), it.rot);
      const s = it.gone ? 0.0001 : it.s;
      m4.compose(V(it.x, (it.dust ? 0.035 : 0.012), it.z), q, V(s, s * (it.dust ? 0.8 : 1), s));
      (it.dust ? this.dustIM : this.crumbIM).setMatrixAt(it.k, m4);
    }
    this.dustIM.instanceMatrix.needsUpdate = true;
    this.crumbIM.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    super.update(dt);
    let moved = false;
    for (const it of this.items) {
      if (Math.abs(it.tx - it.x) + Math.abs(it.tz - it.z) > 0.002) { it.x += (it.tx - it.x) * (1 - Math.exp(-dt * 7)); it.z += (it.tz - it.z) * (1 - Math.exp(-dt * 7)); it.rot += dt * 4; moved = true; }
    }
    if (moved) this._write();
    const s = this.panSq.update(dt);
    this.panObj.scale.set(1, s, 1);
  }
  _sweep(G, px, pz) {
    let n = 0;
    for (const it of this.items) {
      if (it.gone) continue;
      if (it.tx > px - 0.08 && it.tx < px + 0.6 && Math.abs(it.tz - pz) < 0.62) {
        it.tx = Math.min(this.length - 0.3, it.tx + 0.28 + G.rng() * 0.12);
        it.tz *= 0.55;
        n++;
      }
    }
    G.sfx('fabric_swish', this.W(px + 0.3, 0.05, pz), { gain: -2 + Math.min(2, n * 0.15) });
    if (n) G.burst('fluff', this.W(px + 0.35, 0.05, pz), { colors: ['#ece6f5', '#ffffff'], count: 3 + Math.min(5, n), scale: 0.45 });
    G.countStep();
  }
  progress() { return this.done ? 1 : this.items.filter((it) => it.tx > this.length - 0.7).length / this.items.length; }
  async run(G) {
    const pet = G.pet, L = this.length;
    G.label(this.label);
    G.cam('follow', { off: V(2.6, 1.3, 1.45), lookY: 0.32, lookAhead: 0.3, lambda: 1.5 });
    pet.hold('broom');
    G.say(this.def.say || '扫扫灰尘～');
    let x = 0.15;
    while (x < L - 0.75) {
      const nx = Math.min(L - 0.75, x + 0.3);
      await G.walkTo(this.W(nx, 0, 0), { stepDur: 0.38, stride: 0.15 });
      x = nx;
      pet.face(Math.PI / 2);
      await pet.act('sweep', { reps: 2, dur: 0.5, onHit: () => this._sweep(G, pet.root.position.x - this.x0, pet.root.position.z) });
      if (x > 0.8) G.unsay();
    }
    // 全部扫进簸箕
    for (const it of this.items) { it.tx = L - 0.14 + G.rng() * 0.04; it.tz = (G.rng() - 0.5) * 0.3; }
    G.sfx('fabric_swish', this.W(L - 0.3, 0.05, 0), { gain: 0 });
    await G.wait(0.5);
    for (const it of this.items) it.gone = true;
    this._write();
    this.panSq.x = 0.8;
    G.sfx('place', this.W(L - 0.12, 0.05, 0), { gain: -4 });
    G.burst('sparkles', this.W(L - 0.6, 0.15, 0), { colors: ['#ffffff', '#fff2a8'], count: 16 });
    pet.hold(null);
    pet.expr('happy', 'open', 1.2);
    G.say('干干净净～');
    await pet.idleAction('proud', 0.9);
    G.unsay();
  }
}

// ================= 打扫 2. 擦地板（脏脚印一擦就亮） =================
export class MopStation extends TaskStation {
  build() {
    const { M, G, rng: r } = this.ctx;
    const L = this.length, W = this.width = 1.3;
    // 干净的地砖
    const tc = document.createElement('canvas'); tc.width = 512; tc.height = Math.round(512 * W / L);
    const tg = tc.getContext('2d');
    const cs = this.def.tiles || ['#fff4f8', '#e9f6ff'];
    const n = 8, sz = tc.width / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < Math.ceil(tc.height / sz); j++) { tg.fillStyle = cs[(i + j) % 2]; tg.fillRect(i * sz, j * sz, sz, sz); }
    tg.strokeStyle = 'rgba(200,180,200,0.5)'; tg.lineWidth = 2;
    for (let i = 0; i <= n; i++) { tg.beginPath(); tg.moveTo(i * sz, 0); tg.lineTo(i * sz, tc.height); tg.stroke(); }
    for (let j = 0; j <= tc.height / sz; j++) { tg.beginPath(); tg.moveTo(0, j * sz); tg.lineTo(tc.width, j * sz); tg.stroke(); }
    this.tileTex = new THREE.CanvasTexture(tc); this.tileTex.colorSpace = THREE.SRGBColorSpace;
    this.ctx.M.track({ dispose: () => this.tileTex.dispose() });
    this.mesh(G.track(roundedBox(L, 0.02, W, 0.008, 2).translate(L / 2, 0.01, 0)), M.track(new THREE.MeshStandardMaterial({ map: this.tileTex, roughness: 0.25, metalness: 0 })));
    // 一层脏脏的泥点和脚印（擦掉的地方就露出亮晶晶的地砖）
    const c = document.createElement('canvas'); c.width = tc.width; c.height = tc.height;
    this.cv = c; this.g2 = c.getContext('2d');
    const g = this.g2;
    for (let i = 0; i < 26; i++) {
      const x = r.range(0.05, 0.95) * c.width, y = r.range(0.1, 0.9) * c.height, rr = r.range(10, 30);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(150,110,80,0.75)'); gr.addColorStop(1, 'rgba(150,110,80,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    // 小泥脚印
    g.fillStyle = 'rgba(130,95,70,0.8)';
    for (let i = 0; i < 9; i++) {
      const x = (0.1 + i * 0.1) * c.width, y = (0.5 + Math.sin(i * 1.7) * 0.25) * c.height;
      g.beginPath(); g.ellipse(x, y, 9, 7, 0, 0, TAU); g.fill();
      for (const k of [-1, 0, 1]) { g.beginPath(); g.arc(x + 10, y + k * 6, 3, 0, TAU); g.fill(); }
    }
    this.dirtTex = new THREE.CanvasTexture(c); this.dirtTex.colorSpace = THREE.SRGBColorSpace;
    this.ctx.M.track({ dispose: () => this.dirtTex.dispose() });
    const dirt = this.mesh(G.track(new THREE.PlaneGeometry(L - 0.02, W - 0.02).rotateX(-Math.PI / 2).translate(L / 2, 0.022, 0)), M.track(new THREE.MeshStandardMaterial({ map: this.dirtTex, transparent: true, roughness: 0.9, depthWrite: false })));
    dirt.renderOrder = 2;
    dirt.castShadow = false;
    this.cleaned = 0;
    return this;
  }
  _erase(G, lx, lz) {
    const c = this.cv, g = this.g2;
    const px = (lx / this.length) * c.width, py = ((lz + this.width / 2) / this.width) * c.height;
    const rr = (0.24 / this.length) * c.width;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const gr = g.createRadialGradient(px, py, rr * 0.3, px, py, rr);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill();
    g.restore();
    this.dirtTex.needsUpdate = true;
    this.cleaned++;
    G.burst('sparkles', this.W(lx, 0.06, lz), { colors: ['#ffffff', '#e9f6ff'], count: 4, scale: 0.5 });
  }
  progress() { return this.done ? 1 : Math.min(1, this.cleaned / 12); }
  async run(G) {
    const pet = G.pet, L = this.length;
    G.label(this.label);
    G.cam('follow', { off: V(2.5, 1.25, 1.35), lookY: 0.3, lookAhead: 0.25, lambda: 1.5 });
    pet.hold('mop');
    G.say(this.def.say || '擦呀擦，亮晶晶～');
    let x = 0.2, k = 0;
    while (x < L - 0.3) {
      const nx = Math.min(L - 0.3, x + 0.4);
      const z = (k % 2 ? 1 : -1) * 0.12;
      await G.walkTo(this.W(nx, 0, z), { stepDur: 0.38, stride: 0.16 });
      x = nx; k++;
      // 每一下擦的方向左右稍微变一变，但身体始终偏向镜头一侧（小脸朝观众）
      pet.face(Math.PI / 2 - 0.3 + (k % 2 ? -0.15 : 0.15));
      await pet.act('wipe', {
        reps: 2, dur: 0.5,
        onHit: (i) => {
          const p = pet.toolTipWorld();
          const lx = clamp(p.x - this.x0, 0.05, L - 0.05), lz = clamp(p.z, -this.width / 2, this.width / 2);
          this._erase(G, lx, lz);
          this._erase(G, clamp(lx + 0.18, 0, L), clamp(lz + (i ? 0.12 : -0.12), -0.6, 0.6));
          G.sfx('cloth', p, { gain: -3 });
          G.countStep();
        },
      });
      if (k === 2) G.unsay();
    }
    pet.hold(null);
    G.burst('sparkles', this.W(L / 2, 0.1, 0), { colors: ['#ffffff', '#e9f6ff', '#fff2a8'], count: 22 });
    pet.expr('happy', 'open', 1.2);
    await pet.idleAction('proud', 0.9);
  }
}

// ================= 打扫 3. 叠衣服 =================
function shirtParts(G, M, color) {
  // 一件平铺的小 T 恤：左右三分之一可以翻折，下半截可以向上翻折
  const W = 0.48, H = 0.5, T = 0.008;
  const mat = M.soft(color, { rough: 0.9, rim: 0.25 });
  const box = (w, h) => G.get(`shirt|${w.toFixed(3)}|${h.toFixed(3)}`, () => roundedBox(w, T, h, 0.004, 1));
  const root = new THREE.Group();
  const top = new THREE.Group(); root.add(top);
  const bottomPivot = new THREE.Group(); root.add(bottomPivot);
  const third = W / 3;
  const mk = (parent, w, h, x, z) => { const m = new THREE.Mesh(box(w, h), mat); m.position.set(x, 0, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  mk(top, third, H / 2, 0, -H / 4);
  mk(bottomPivot, third, H / 2, 0, H / 4);
  const flaps = [];
  for (const s of [-1, 1]) {
    for (const half of [top, bottomPivot]) {
      const pv = new THREE.Group(); pv.position.set(s * third / 2, 0, 0); half.add(pv);
      mk(pv, third, H / 2, s * third / 2, half === top ? -H / 4 : H / 4);
      if (half === top) { const sl = mk(pv, 0.13, 0.12, s * (third + 0.05), -H / 2 + 0.06); sl.rotation.y = s * 0.35; }
      flaps.push({ pv, s, top: half === top });
    }
  }
  // 小爱心图案
  const heart = new THREE.Mesh(G.get('shirt|heart', () => new THREE.CircleGeometry(0.035, 16).rotateX(-Math.PI / 2)), M.soft('#ffffff', { rough: 0.8 }));
  heart.position.set(0, T / 2 + 0.001, -H / 8);
  top.add(heart);
  return { root, top, bottomPivot, flaps };
}
export class FoldStation extends TaskStation {
  build() {
    const { M, G } = this.ctx;
    const L = this.length;
    this.tx = L / 2 - 0.05;
    this.mesh(G.track(roundedBox(1.7, 0.06, 0.54, 0.025, 3)), M.soft(this.def.table || '#f6dcc0', { rough: 0.6, rim: 0.25 }), this.tx + 0.05, 0.13, 0.16);
    for (const sx of [-0.75, 0.75]) for (const sz of [-0.2, 0.2]) this.mesh(G.get('fold|leg', () => new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8)), M.soft('#e8c4a0', { rough: 0.6 }), this.tx + 0.05 + sx, 0.06, 0.16 + sz);
    this.tableY = 0.165;
    // 洗衣篮（堆着软软的衣服）
    const bx = this.tx - 0.62;
    this.basketX = bx;
    this.mesh(G.track(new THREE.CylinderGeometry(0.22, 0.18, 0.12, 24, 1, true).translate(0, 0.06, 0)), M.soft('#ffd98a', { rough: 0.8, rim: 0.3, side: THREE.DoubleSide }), bx, this.tableY, 0.16);
    for (let i = 0; i < 4; i++) this.mesh(G.get('fold|heap', () => blobGeometry(0.1, 2, 0.15, 2).scale(1.2, 0.6, 1)), M.soft(RAINBOW[(i * 2) % 7], { rough: 0.95 }), bx + (i % 2 ? 0.06 : -0.06), this.tableY + 0.1 + i * 0.015, 0.16 + (i < 2 ? -0.05 : 0.05));
    this.stackX = this.tx + 0.55;
    this.shirts = (this.def.colors || ['#ffb3d1', '#9fd8ff', '#fff0a8']).map((c) => { const s = shirtParts(G, M, c); s.root.visible = false; this.group.add(s.root); return s; });
    this.stack = 0;
    return this;
  }
  async _fold(G, s, which) {
    const pet = G.pet;
    await pet.act('fold', {
      dur: 0.62,
      onHit: () => {
        G.sfx('cloth', this.W(this.tx, this.tableY, 0.1), { gain: -2 });
        G.countStep();
        if (which === 'bottom') {
          this.tween(0.32, (u) => { s.bottomPivot.rotation.x = -Math.PI * ease.inOutQuad(u); s.bottomPivot.position.y = 0.03 * Math.sin(u * Math.PI) + 0.02 * u; });
        } else {
          const sgn = which === 'left' ? -1 : 1;
          for (const f of s.flaps) if (f.s === sgn) this.tween(0.32, (u) => { f.pv.rotation.z = sgn * Math.PI * ease.inOutQuad(u); f.pv.position.y = 0.006 * u; });
        }
      },
    });
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.W(this.tx, this.tableY, 0.1), lookY: 0.22, dist: 1.12 });
    await this.goTo(G, this.tx);
    G.say(this.def.say || '叠衣服～');
    for (let k = 0; k < this.shirts.length; k++) {
      const s = this.shirts[k];
      // 从洗衣篮里"飘"出来，铺平在桌上
      s.root.visible = true;
      const from = V(this.basketX, this.tableY + 0.15, 0.16), to = V(this.tx, this.tableY + 0.004, 0.16);
      G.sfx('cloth', this.W(this.basketX, this.tableY, 0.1), { gain: -4 });
      await this.tween(0.45, (u) => { arc(s.root, from, to, 0.15, u); const sc = 0.4 + 0.6 * ease.outBack(u); s.root.scale.set(sc, 1, sc); s.root.rotation.y = (1 - u) * 0.6; });
      await G.wait(0.15);
      await this._fold(G, s, 'left');
      await this._fold(G, s, 'right');
      await this._fold(G, s, 'bottom');
      if (k === 0) G.unsay();
      // 放到叠好的那一摞上
      const f0 = s.root.position.clone(), f1 = V(this.stackX, this.tableY + 0.004 + this.stack * 0.034, 0.16);
      await this.tween(0.42, (u) => arc(s.root, f0, f1, 0.12, ease.inOutSine(u)));
      this.stack++;
      G.sfx('place', this.W(this.stackX, this.tableY, 0.1), { gain: -5 });
      G.burst('sparkles', this.W(this.stackX, this.tableY + 0.1, 0.1), { colors: ['#ffffff', '#fff2a8'], count: 6, scale: 0.6 });
      this.prog = (k + 1) / this.shirts.length;
      if (k < this.shirts.length - 1) await G.wait(0.2);
    }
    pet.expr('happy', 'open', 1.2);
    G.say('整整齐齐～');
    await pet.idleAction('proud', 0.9);
    G.unsay();
  }
}

// ================= 打扫 4. 收纳玩具（每个玩具"啪"地回到属于它的位置） =================
export class TidyStation extends TaskStation {
  build() {
    const { M, G, rng: r } = this.ctx;
    const L = this.length;
    // 玩具箱（开口朝上，正面有颗爱心）
    const bx = L - 0.42;
    this.box = new THREE.Group();
    this.box.position.set(bx, 0, 0.05);
    this.group.add(this.box);
    const bm = M.soft(this.def.boxColor || '#ffc2d8', { rough: 0.55, rim: 0.35 });
    this.mesh(G.track(roundedBox(0.62, 0.04, 0.5, 0.015, 2).translate(0, 0.02, 0)), bm, 0, 0, 0, this.box);
    for (const [w, d, x, z] of [[0.62, 0.04, 0, 0.23], [0.62, 0.04, 0, -0.23], [0.04, 0.5, 0.29, 0], [0.04, 0.5, -0.29, 0]]) this.mesh(G.get(`box|${w}|${d}`, () => roundedBox(w, 0.26, d, 0.015, 2).translate(0, 0.13, 0)), bm, x, 0, z, this.box);
    const heart = this.mesh(G.get('box|heart', () => new THREE.CircleGeometry(0.06, 20)), M.soft('#ffffff', { rough: 0.6 }), 0, 0.14, 0.252, this.box);
    void heart;
    this.boxSq = new Spring(200, 8, 1);
    // 散落的玩具
    const toyDefs = [
      ['block', '#ff8fb3'], ['ball', '#7fd6ff'], ['star', '#ffd166'], ['block', '#9be89b'], ['duck', '#ffd84d'], ['ball', '#c9a0ff'], ['ring', '#ffb37a'],
    ];
    this.toys = toyDefs.map(([kind, col], i) => {
      const geo = G.get('toy|' + kind, () => toyGeo(kind));
      const m = this.mesh(geo, M.soft(col, { rough: 0.4, rim: 0.4 }), r.range(0.3, L - 1.05), 0, r.range(-0.4, 0.45));
      m.rotation.y = r.range(0, TAU);
      return { m, kind, slot: V((i % 3 - 1) * 0.16, 0.06 + Math.floor(i / 3) * 0.1, (i % 2 ? 0.08 : -0.08)) };
    }).sort((a, b) => a.m.position.x - b.m.position.x);
    return this;
  }
  update(dt) {
    super.update(dt);
    const s = this.boxSq.update(dt);
    this.box.scale.set(1 + (1 - s) * 0.4, s, 1 + (1 - s) * 0.4);
  }
  async run(G) {
    const pet = G.pet;
    G.label(this.label);
    G.cam('task', { at: this.W(this.length * 0.55, 0.1, 0.05), lookY: 0.2, dist: 1.25 });
    G.say(this.def.say || '玩具回家啦～');
    for (let i = 0; i < this.toys.length; i++) {
      const t = this.toys[i];
      const p = t.m.position;
      // 站到玩具后面、面朝玩具（也就是面朝镜头）轻轻一推，玩具自己"咻"地飞进玩具箱
      await this.stepTo(G, p.x - 0.12, clamp(p.z - 0.34, -0.7, 0.2), { stepDur: 0.36, stride: 0.2 });
      pet.faceTowards(this.x0 + p.x, p.z);
      await pet.act('push', {
        dur: 0.55,
        onHit: () => {
          const from = p.clone(), to = this.box.position.clone().add(t.slot);
          const r0 = t.m.rotation.y;
          G.sfx('whoosh', this.W(from.x, 0.1, from.z), { gain: -14, main: false });
          this.tween(0.55, (u) => { arc(t.m, from, to, 0.35, u); t.m.rotation.y = r0 + u * TAU; }).then(() => {
            G.sfx(i % 2 ? 'place' : 'plop', this.W(to.x, to.y, to.z), { gain: -4 });
            G.burst('sparkles', this.W(to.x, to.y + 0.1, to.z), { colors: ['#ffffff', '#fff2a8'], count: 5, scale: 0.6 });
            this.boxSq.x = 0.88;
            this.prog = (i + 1) / this.toys.length;
            G.countStep();
          });
        },
      });
      if (i === 1) G.unsay();
    }
    await G.wait(0.5);
    pet.face(FACE);
    pet.expr('happy', 'open', 1.2);
    G.say('全部收好啦～');
    await pet.idleAction('celebrate', 0.9);
    G.unsay();
  }
}
function toyGeo(kind) {
  switch (kind) {
    case 'block': return roundedBox(0.12, 0.12, 0.12, 0.025, 2).translate(0, 0.06, 0);
    case 'ball': return new THREE.SphereGeometry(0.065, 16, 12).translate(0, 0.065, 0);
    case 'ring': return new THREE.TorusGeometry(0.06, 0.028, 10, 20).rotateX(Math.PI / 2).translate(0, 0.03, 0);
    case 'duck': { const g = blobGeometry(0.07, 2, 0.02, 2).scale(1.2, 0.85, 1).translate(0, 0.06, 0); return g; }
    case 'star': {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.035 : 0.08; const a = (i / 10) * TAU + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
      g.rotateX(-Math.PI / 2); g.translate(0, 0.02, 0);
      return g;
    }
    default: return new THREE.SphereGeometry(0.06, 12, 8);
  }
}
function mergeGeoms(list) {
  const g = new THREE.BufferGeometry();
  const pos = [], nrm = [], idx = [];
  let off = 0;
  for (const p of list) {
    const q = p.index ? p : p;
    const pa = q.attributes.position, na = q.attributes.normal;
    for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); nrm.push(na.getX(i), na.getY(i), na.getZ(i)); }
    if (q.index) for (let i = 0; i < q.index.count; i++) idx.push(q.index.getX(i) + off);
    else for (let i = 0; i < pa.count; i++) idx.push(i + off);
    off += pa.count;
    p.dispose();
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export const TASK_TYPES = { chop: ChopStation, whisk: WhiskStation, pan: PanStation, cream: CreamStation, sweep: SweepStation, mop: MopStation, fold: FoldStation, tidy: TidyStation };
