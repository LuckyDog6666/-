// 各种解压站的实现。每一种都有：可持续保留的形变（脚印、压扁、踩破、碎裂……）+ 对应的真实 ASMR 录音。
import * as THREE from 'three';
import { Station, addJiggle, kickJiggle } from './station.js';
import { Heightfield } from './heightfield.js';
import { roundedBox, blobGeometry, scallopGeometry } from '../world/geo.js';
import { Spring, TAU, clamp, ease } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RAINBOW = ['#ff8fb3', '#ffb37a', '#ffe27a', '#9be89b', '#7fd6ff', '#a99bff', '#e39bff'];

// ---------------- 托盘/底座（所有站都放在一个圆润的托盘里，看起来像一组精致的解压道具） ----------------
function tray(st, color, h = 0.08, inset = 0.06) {
  const { M, G } = st.ctx;
  const L = st.length, W = st.width;
  const geo = G.get(`tray|${L.toFixed(2)}|${W.toFixed(2)}|${h}`, () => roundedBox(L + inset * 2, h, W + inset * 2, Math.min(0.08, h * 0.45), 3).translate(L / 2, h / 2 - 0.02, 0));
  const m = new THREE.Mesh(geo, M.soft(color, { rough: 0.55, rim: 0.25 }));
  m.receiveShadow = true; m.castShadow = true;
  st.group.add(m);
  return m;
}

// ================= 1. 软软的可塑表面：太空沙 / 雪 / 奶油 / 花泥 / 面粉 / 记忆海绵 =================
export class SoftSlab extends Station {
  build() {
    const d = this.def;
    tray(this, d.trayColor || '#ffffff', 0.06);
    this.hf = new Heightfield({
      length: this.length, width: this.width, thickness: d.thickness ?? 0.16, color: d.color, colorPressed: d.colorPressed,
      bumps: d.bumps ?? 0.01, rim: d.rim ?? 0.35, recover: d.recover || 0, seed: this.ctx.rng.int(1, 999), seg: d.seg || 30,
      grain: d.grainAmt ?? (d.grain ? 0.9 : 0.45),
    });
    this.ctx.M.track(this.hf);
    const mat = d.shiny
      ? this.ctx.M.track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.35, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 800], clearcoat: 0.6, envMapIntensity: 1.6 }))
      : d.wet
        ? this.ctx.M.track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.25, envMapIntensity: 0.9 }))
        : this.ctx.M.softUnique('#ffffff', { vc: true, rough: d.rough ?? 0.92, rim: d.rimLight ?? 0.18, rimColor: d.rimColor || '#ffffff' });
    // 高清细节：凹凸贴图 + 压实色贴图（每块材料一份，互不影响）
    mat.bumpMap = this.hf.bumpTex; mat.bumpScale = d.bumpScale ?? 3;
    mat.map = this.hf.shadeTex;
    mat.needsUpdate = true;
    this.top = new THREE.Mesh(this.hf.geo, mat);
    this.top.receiveShadow = true;
    this.top.castShadow = true; // 自阴影：脚印边缘的小隆起会在坑里投下阴影
    this.group.add(this.top);
    const sk = new THREE.Mesh(this.hf.skirt, this.ctx.M.soft(d.colorSide || d.colorPressed || d.color, { rough: 0.9, rim: 0.1 }));
    sk.receiveShadow = true;
    this.group.add(sk);
    // 表面闪粉（雪、太空沙的亮晶晶）
    if (d.glitter) {
      const n = 160;
      const gg = this.ctx.G.get('glitterDot', () => new THREE.SphereGeometry(0.008, 4, 3));
      const im = new THREE.InstancedMesh(gg, this.ctx.M.basic(d.glitter), n);
      const m4 = new THREE.Matrix4();
      this.glitterPos = [];
      for (let i = 0; i < n; i++) {
        const x = this.ctx.rng.range(0.05, this.length - 0.05), z = this.ctx.rng.range(-this.width / 2 + 0.05, this.width / 2 - 0.05);
        this.glitterPos.push([x, z]);
        m4.makeTranslation(x, this.hf.heightAt(x, z) + 0.004, z);
        im.setMatrixAt(i, m4);
      }
      this.glitter = im;
      this.group.add(im);
    }
    return this;
  }
  topY(x, z) { return this.hf.heightAt(x, z); }
  _refreshGlitter() {
    if (!this.glitter) return;
    const m4 = new THREE.Matrix4();
    this.glitterPos.forEach(([x, z], i) => { m4.makeTranslation(x, this.hf.heightAt(x, z) + 0.004, z); this.glitter.setMatrixAt(i, m4); });
    this.glitter.instanceMatrix.needsUpdate = true;
  }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    const d = this.def;
    this.hf.stamp(x, z, { rx: 0.1, rz: 0.075, depth: (d.depth ?? 0.06) * (0.75 + power * 0.6), shape: 'paw' });
    this._refreshGlitter();
    const fx = [];
    if (d.fx) fx.push({ preset: d.fx, x, y: this.hf.heightAt(x, z), z, colors: d.fxColors || [d.color], count: d.fxCount || 10, scale: 0.7 });
    return { sound: this.stepSound(power), gain: (power - 0.5) * 3, maxDur: d.maxDur || 2.2 };
  }
  get specials() { return this.def.specials || ['sit', 'press']; }
  progress() { return Math.min(1, coverage(this.hf) / 0.32); }
  // 踩奶时的小脚印（比走路的浅一点、圆一点）
  knead(x, z, power = 0.5) {
    this.hf.stamp(x, z, { rx: 0.085, rz: 0.07, depth: (this.def.depth ?? 0.06) * (0.6 + power * 0.5), shape: 'paw' });
    this._refreshGlitter();
    return { sound: this.sound.step, gain: -3 + power * 2, maxDur: 1.6 };
  }
  // 把文字（老板的名字）一个点一个点地压进表面
  stampText(points) {
    for (const [x, z] of points) this.hf.stamp(x, z, { rx: 0.035, rz: 0.035, depth: (this.def.depth ?? 0.06) * 0.9, shape: 'round', rim: 0.3 });
    this._refreshGlitter();
  }
  async perform(name, api) {
    const d = this.def;
    if (name === 'sit') {
      // 一屁股坐下去：压出一个大大的圆坑（屁股印！）
      const p = api.localPos();
      const x = clamp(p.x, 0.4, this.length - 0.4), z = clamp(p.z, -this.width / 2 + 0.3, this.width / 2 - 0.3);
      const pose = api.pose('sit', 2.3);
      await api.wait(0.3);
      this.hf.stamp(x - 0.05, z, { rx: 0.3, rz: 0.26, depth: (d.depth ?? 0.06) * 1.6, shape: 'round' });
      this._refreshGlitter();
      api.sfx(this.sound.special || this.sound.step, { gain: 2, maxDur: 3 });
      if (d.fx) api.burst(d.fx, x, this.hf.heightAt(x, z), z, { colors: d.fxColors || [d.color], count: 18 });
      api.sink(0.06);
      await pose;
      api.sink(0);
    } else if (name === 'press') {
      // 俯身用小手按一按：两个小手印
      const p = api.localPos();
      const x = clamp(p.x + 0.35, 0.3, this.length - 0.3);
      const pose = api.pose('reach', 2.2);
      await api.wait(0.45);
      for (const zz of [-0.12, 0.12]) {
        this.hf.stamp(x, clamp(p.z + zz, -this.width / 2 + 0.1, this.width / 2 - 0.1), { rx: 0.07, rz: 0.06, depth: (d.depth ?? 0.06) * 1.1, shape: 'paw' });
        this._refreshGlitter();
        api.sfx(this.sound.special || this.sound.step, { gain: 0, maxDur: 2 });
        await api.wait(0.7);
      }
      await pose;
    } else if (name === 'cut') {
      // 用小手划出一道沟（太空沙最经典的"切一刀"画面）
      const p = api.localPos();
      const x = clamp(p.x + 0.4, 0.3, this.length - 0.3);
      const pose = api.pose('reach', 2.3);
      await api.wait(0.35);
      api.sfx(this.sound.special || this.sound.step, { gain: 1, maxDur: 3 });
      for (let k = 0; k <= 10; k++) {
        this.hf.groove(x, -this.width / 2 + 0.08, x, -this.width / 2 + 0.08 + (this.width - 0.16) * (k / 10), { width: 0.035, depth: 0.12 });
        if (k === 5) api.sfx(this.sound.step, { gain: -2, maxDur: 1.5 });
        await api.wait(0.12);
      }
      if (d.fx) api.burst(d.fx, x, this.hf.heightAt(x, 0), 0, { colors: d.fxColors || [d.color], count: 16 });
      this._refreshGlitter();
      await pose;
    }
  }
  update(dt) { super.update(dt); this.hf.update(dt); }
}

// ================= 2. 史莱姆：踩下去黏黏的，抬脚会拉出丝 =================
export class SlimeStation extends Station {
  build() {
    const d = this.def;
    tray(this, d.trayColor || '#ffffff', 0.07);
    this.hf = new Heightfield({ length: this.length, width: this.width, thickness: 0.13, color: d.color, colorPressed: d.colorPressed || d.color, bumps: 0.012, rim: 0.55, recover: 0.55, seed: this.ctx.rng.int(1, 999), seg: 26, edgeRound: 0.16, grain: 0 });
    this.ctx.M.track(this.hf);
    const mat = this.ctx.M.track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'), envMapIntensity: 1.2 }));
    mat.bumpMap = this.hf.bumpTex; mat.bumpScale = 2; mat.map = this.hf.shadeTex;
    this.top = new THREE.Mesh(this.hf.geo, mat);
    this.top.receiveShadow = true;
    this.group.add(this.top);
    // 闪粉
    const n = 120, gg = this.ctx.G.get('glitterFlake', () => new THREE.PlaneGeometry(0.018, 0.018));
    this.glitter = new THREE.InstancedMesh(gg, this.ctx.M.basic(d.glitter || '#ffffff', { opacity: 0.9, side: THREE.DoubleSide }), n);
    this.glitterPos = [];
    for (let i = 0; i < n; i++) this.glitterPos.push([this.ctx.rng.range(0.1, this.length - 0.1), this.ctx.rng.range(-this.width / 2 + 0.1, this.width / 2 - 0.1), this.ctx.rng.range(0, TAU)]);
    this.group.add(this.glitter);
    this._glit();
    // 拉丝（抬脚时连着脚和史莱姆的细丝）
    const sg = this.ctx.G.get('slimeStrand', () => new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0));
    this.strands = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(sg, this.ctx.M.track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(d.color), roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85 })));
      m.visible = false; m.castShadow = false;
      this.group.add(m);
      this.strands.push({ m, life: 0, x: 0, z: 0, foot: null });
    }
    return this;
  }
  _glit() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.glitterPos.forEach(([x, z, r], i) => { q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, r)); m4.compose(V(x, this.hf.heightAt(x, z) + 0.003, z), q, V(1, 1, 1)); this.glitter.setMatrixAt(i, m4); });
    this.glitter.instanceMatrix.needsUpdate = true;
  }
  topY(x, z) { return this.hf.heightAt(x, z) - 0.02; }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    this.hf.stamp(x, z, { rx: 0.12, rz: 0.09, depth: 0.07 + power * 0.03, shape: 'round', rim: 0.7 });
    // 上一只脚抬起来时拉丝
    const s = this.strands.find((q) => q.life <= 0) || this.strands[0];
    s.life = 0.9; s.x = x; s.z = z; s.side = side;
    return { sound: this.sound.step, gain: (power - 0.5) * 2, maxDur: 2.6, sink: 0.05 };
  }
  get specials() { return this.def.specials || ['sit', 'press']; }
  progress() { return Math.min(1, this.stepsTaken / 9); }
  knead(x, z, power = 0.5) {
    this.hf.stamp(x, z, { rx: 0.1, rz: 0.08, depth: 0.06 + power * 0.02, shape: 'round', rim: 0.7 });
    return { sound: this.sound.step, gain: -2, maxDur: 2.0, sink: 0.04 };
  }
  async perform(name, api) {
    const x = clamp(api.localPos().x, 0.4, this.length - 0.4);
    const z0 = clamp(api.localPos().z, -this.width / 2 + 0.3, this.width / 2 - 0.3);
    if (name === 'sit') {
      // 坐进史莱姆：慢慢陷下去，起身时拉出好多丝
      const pose = api.pose('sit', 2.6);
      await api.wait(0.3);
      this.hf.stamp(x, z0, { rx: 0.32, rz: 0.27, depth: 0.12, shape: 'round', rim: 0.8 });
      api.sfx(this.sound.special || this.sound.step, { gain: 1, maxDur: 2.6 });
      api.sink(0.09);
      await api.wait(1.6);
      api.sfx(this.sound.pull || this.sound.special || this.sound.step, { gain: 0, maxDur: 3.4 });
      api.sink(0);
      for (const s of this.strands) { s.life = 1.2; s.x = x + (Math.random() - 0.5) * 0.3; s.z = z0 + (Math.random() - 0.5) * 0.3; s.side = 0; }
      await pose;
      await api.pose('stretch', 1.0);
    } else {
      // 俯身用小手戳三下
      const pose = api.pose('reach', 3.0);
      await api.wait(0.4);
      for (let k = 0; k < 3; k++) {
        const zz = clamp(z0 + (k - 1) * 0.15, -this.width / 2 + 0.1, this.width / 2 - 0.1);
        this.hf.stamp(x + 0.35, zz, { rx: 0.09, rz: 0.08, depth: 0.09, shape: 'round', rim: 0.8 });
        api.sfx(k === 2 && this.sound.special ? this.sound.special : this.sound.step, { gain: 0, maxDur: 2.2 });
        await api.wait(0.85);
      }
      await pose;
    }
  }
  update(dt) {
    super.update(dt);
    this.hf.update(dt);
    if (Math.floor(this.t * 10) !== Math.floor((this.t - dt) * 10)) this._glit();
    for (const s of this.strands) {
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.life -= dt;
      const u = 1 - s.life / 0.9; // 0→1 越拉越长越细
      const h = 0.05 + u * 0.22;
      const r = 0.03 * (1 - u) + 0.003;
      s.m.visible = true;
      s.m.position.set(s.x, this.hf.heightAt(s.x, s.z) - 0.01, s.z);
      s.m.scale.set(r, h, r);
      s.m.material.opacity = 0.85 * (1 - u * 0.6);
    }
  }
}

// ================= 3. 果冻：Q 弹抖动，糯糯会在上面弹跳 =================
export class JellyStation extends Station {
  build() {
    const d = this.def;
    const n = d.count || 3;
    this.blocks = [];
    const size = Math.min(0.72, (this.length - 0.2) / n - 0.06);
    const geo = this.ctx.G.get(`jelly|${size.toFixed(2)}`, () => roundedBox(size, size * 0.7, size, size * 0.18, 5).translate(0, size * 0.35, 0));
    for (let i = 0; i < n; i++) {
      const color = d.colors ? d.colors[i % d.colors.length] : d.color;
      const mat = this.ctx.M.track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.82, emissive: new THREE.Color(color), emissiveIntensity: 0.18, envMapIntensity: 1.3 }));
      const ju = addJiggle(mat);
      const m = new THREE.Mesh(geo, mat);
      const x = 0.1 + size / 2 + i * (size + 0.06);
      m.position.set(x, 0, 0);
      m.castShadow = true;
      this.group.add(m);
      // 果冻里的小果粒
      const core = new THREE.Mesh(this.ctx.G.get('jellyFruit', () => blobGeometry(0.08, 3, 0.15, 2)), this.ctx.M.soft(d.fruit || '#ffffff', { rim: 0.3 }));
      core.position.set(0, size * 0.35, 0);
      m.add(core);
      this.blocks.push({ m, ju, x, size, sq: new Spring(140, 5, 1), top: size * 0.7 });
    }
    return this;
  }
  _blockAt(x) { return this.blocks.reduce((b, c) => (Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b), this.blocks[0]); }
  topY(x, z) {
    const b = this._blockAt(x);
    return Math.abs(b.x - x) < b.size / 2 + 0.02 ? b.top * b.m.scale.y : 0.02;
  }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    const b = this._blockAt(x);
    kickJiggle(b.ju, V(x - b.x, b.top, z), 0.8 + power * 0.6);
    b.sq.x = 0.82 - power * 0.1;
    return { sound: this.sound.step, gain: (power - 0.5) * 2, maxDur: 2 };
  }
  get specials() { return ['bounce']; }
  progress() { return Math.min(1, this.stepsTaken / 8); }
  async perform(name, api) {
    // 在果冻上连续弹跳
    const b = this._blockAt(api.localPos().x);
    for (let k = 0; k < 3; k++) {
      await api.hopLocal(b.x, 0, { height: 0.35 + k * 0.08, dur: 0.5 });
      kickJiggle(b.ju, V(0, b.top, 0), 1.3);
      b.sq.x = 0.7;
      api.sfx(this.sound.special || this.sound.step, { gain: 1, maxDur: 2 });
    }
  }
  update(dt) {
    super.update(dt);
    for (const b of this.blocks) {
      b.ju.uJT.value += dt;
      const s = b.sq.update(dt);
      b.m.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    }
  }
}

// ================= 4. 按压泡泡（Pop-it）：一颗颗按下去 =================
export class PopItStation extends Station {
  build() {
    const d = this.def;
    const pitch = d.big ? 0.27 : 0.2;
    this.pitch = pitch;
    const cols = Math.floor((this.length - 0.16) / pitch), rows = Math.floor((this.width - 0.16) / pitch);
    tray(this, d.base || '#ffffff', 0.05, 0.02);
    const base = this.ctx.G.get(`popitBase|${this.length}|${this.width}`, () => roundedBox(this.length, 0.05, this.width, 0.05, 3).translate(this.length / 2, 0.05, 0));
    this.baseMesh = new THREE.Mesh(base, this.ctx.M.soft('#ffffff', { rough: 0.5, rim: 0.3 }));
    this.baseMesh.receiveShadow = true;
    this.group.add(this.baseMesh);
    const dome = this.ctx.G.get('popDome|' + pitch, () => new THREE.SphereGeometry(pitch * 0.4, 18, 10, 0, TAU, 0, Math.PI / 2));
    this.n = cols * rows;
    this.im = new THREE.InstancedMesh(dome, this.ctx.M.soft('#ffffff', { rough: 0.35, rim: 0.4 }), this.n);
    this.im.castShadow = true;
    this.cells = [];
    const c = new THREE.Color();
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = 0.08 + pitch / 2 + i * ((this.length - 0.16 - pitch) / Math.max(1, cols - 1));
      const z = -this.width / 2 + 0.08 + pitch / 2 + j * ((this.width - 0.16 - pitch) / Math.max(1, rows - 1));
      const k = this.cells.length;
      this.cells.push({ x, z, popped: false, anim: 1, sp: 0 });
      c.set(d.rainbow === false ? d.color : RAINBOW[(j + (d.shift || 0)) % RAINBOW.length]);
      this.im.setColorAt(k, c);
      this._mat(k);
    }
    this.baseMesh.material = this.ctx.M.soft(d.rainbow === false ? d.color : '#fff3fa', { rough: 0.5, rim: 0.3 });
    this.group.add(this.im);
    return this;
  }
  _mat(k) {
    const c = this.cells[k];
    // 按下去：圆顶翻转成凹坑（1 → -0.55），带一点回弹
    const u = c.popped ? 1 - c.anim : 0;
    const sy = c.popped ? 1 + (-0.55 - 1) * ease.outBack(u) : 1;
    this.im.setMatrixAt(k, new THREE.Matrix4().compose(V(c.x, 0.075, c.z), new THREE.Quaternion(), V(1, sy, 1)));
  }
  topY() { return 0.12; }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    // 按下脚底附近最近的 1~2 颗
    const near = this.cells.map((c, k) => [k, Math.hypot(c.x - x, c.z - z)]).filter(([k, dd]) => !this.cells[k].popped && dd < this.pitch * 0.85).sort((a, b) => a[1] - b[1]).slice(0, power > 0.6 ? 2 : 1);
    if (!near.length) return { sound: null };
    for (const [k] of near) { const c = this.cells[k]; c.popped = true; c.anim = 1; }
    this.im.instanceMatrix.needsUpdate = true;
    return { sound: this.sound.step, gain: 0, maxDur: 1.2, repeat: near.length };
  }
  get specials() { return ['tapdance']; }
  progress() { return Math.min(1, this.cells.filter((c) => c.popped).length / this.cells.length / 0.55); }
  remaining() { return this.cells.filter((c) => !c.popped); }
  // 连锁反应：剩下的泡泡从前往后一波按下去
  async chain(api) {
    const rest = this.remaining().sort((a, b) => a.x - b.x || a.z - b.z);
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]; c.popped = true; c.anim = 1;
      if (i % 3 === 0) api.sfx(this.sound.step, { gain: -4, maxDur: 0.8, main: false });
      await api.wait(0.06);
    }
    this.im.instanceMatrix.needsUpdate = true;
  }
  async perform(name, api) {
    // 小碎步把附近的泡泡一颗一颗按掉
    const x0 = api.localPos().x;
    const targets = this.cells.filter((c) => !c.popped && Math.abs(c.x - x0) < 0.5).sort((a, b) => a.x - b.x || a.z - b.z).slice(0, 8);
    for (const c of targets) {
      await api.tapAt(c.x, c.z);
      c.popped = true; c.anim = 1;
      this.im.instanceMatrix.needsUpdate = true;
      api.sfx(this.sound.special || this.sound.step, { gain: -1, maxDur: 1 });
      await api.wait(0.28 + Math.random() * 0.2);
    }
  }
  update(dt) {
    super.update(dt);
    let dirty = false;
    this.cells.forEach((c, k) => { if (c.popped && c.anim > 0) { c.anim = Math.max(0, c.anim - dt * 5); this._mat(k); dirty = true; } });
    if (dirty) this.im.instanceMatrix.needsUpdate = true;
  }
}

// ================= 5. 气泡膜：一脚踩爆一片 =================
export class BubbleWrapStation extends Station {
  build() {
    const soap = !!this.def.soap;
    tray(this, this.def.trayColor || '#e8f6ff', 0.04, 0.02);
    const sheet = this.ctx.G.get(`wrapSheet|${this.length}|${this.width}`, () => roundedBox(this.length, 0.012, this.width, 0.006, 1).translate(this.length / 2, 0.045, 0));
    const sm = new THREE.Mesh(sheet, soap ? this.ctx.M.soft('#ffffff', { rough: 0.3, rim: 0.5, rimColor: '#e3f6ff' }) : this.ctx.M.glossy('#f2fbff', { opacity: 0.5, ei: 0.08, rim: 0.8 }));
    this.group.add(sm);
    // 肥皂泡：更大、更圆、带彩虹光泽
    const R = soap ? 0.07 : 0.045;
    const dome = this.ctx.G.get('wrapDome|' + R, () => new THREE.SphereGeometry(R, 18, 10, 0, TAU, 0, soap ? Math.PI * 0.62 : Math.PI / 2));
    const step = soap ? 0.15 : 0.105;
    const cols = Math.floor((this.length - 0.06) / step), rows = Math.floor((this.width - 0.06) / step);
    this.cells = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) this.cells.push({ x: 0.06 + i * step + (j % 2) * step * 0.5, z: -this.width / 2 + 0.06 + j * step, popped: false });
    const mat = soap
      ? this.ctx.M.track(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.62, iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [200, 700], envMapIntensity: 2.2, emissive: '#ffffff', emissiveIntensity: 0.06, depthWrite: false }))
      : this.ctx.M.track(new THREE.MeshPhysicalMaterial({ color: '#f6fcff', roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 1.6 }));
    this.soap = soap;
    this.im = new THREE.InstancedMesh(dome, mat, this.cells.length);
    this.cells.forEach((c, k) => this._mat(k));
    if (soap) {
      const pal = ['#ffb3dc', '#a8dcff', '#cdb8ff', '#a8f0c8', '#ffe39a'];
      const col = new THREE.Color();
      this.cells.forEach((c, k) => this.im.setColorAt(k, col.set(pal[(k * 7) % pal.length])));
    }
    this.group.add(this.im);
    return this;
  }
  _mat(k) {
    const c = this.cells[k];
    // 气泡膜：瘪成皱皱的小圆片；肥皂泡：直接消失
    const sc = c.popped ? (this.soap ? V(0.001, 0.001, 0.001) : V(1.15, 0.12, 0.9)) : V(1, 1, 1);
    const m4 = new THREE.Matrix4().compose(V(c.x, 0.05, c.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), c.popped ? k : 0), sc);
    this.im.setMatrixAt(k, m4);
  }
  topY() { return 0.07; }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    let n = 0;
    const r = (this.soap ? 0.13 : 0.11) + power * 0.03;
    this.cells.forEach((c, k) => { if (!c.popped && Math.hypot((c.x - x) / 1.2, c.z - z) < r) { c.popped = true; this._mat(k); n++; } });
    this.im.instanceMatrix.needsUpdate = true;
    if (!n) return { sound: null };
    const fx = this.soap ? [{ preset: 'bubbles', x, y: 0.12, z, colors: ['#ffffff', '#e3f6ff', '#ffe3f6'], count: 4 + n * 2, scale: 0.6 }] : [];
    return { sound: this.sound.step, gain: Math.min(2, (n - 2) * 0.6), maxDur: 1.4, fx };
  }
  get specials() { return ['tapdance']; }
  progress() { return Math.min(1, this.cells.filter((c) => c.popped).length / this.cells.length / 0.5); }
  async chain(api) {
    const rest = this.cells.map((c, k) => [c, k]).filter(([c]) => !c.popped).sort((a, b) => a[0].x - b[0].x);
    for (let i = 0; i < rest.length; i++) {
      const [c, k] = rest[i]; c.popped = true; this._mat(k);
      if (i % 4 === 0) { this.im.instanceMatrix.needsUpdate = true; api.sfx(this.sound.step, { gain: -5, maxDur: 0.6, main: false }); await api.wait(0.05); }
    }
    this.im.instanceMatrix.needsUpdate = true;
  }
  async perform(name, api) {
    const x0 = api.localPos().x;
    const targets = this.cells.filter((c) => !c.popped && Math.abs(c.x - x0) < 0.45).sort(() => Math.random() - 0.5).slice(0, 9);
    for (const c of targets) {
      await api.tapAt(c.x, c.z);
      this.cells.forEach((q, k) => { if (!q.popped && Math.hypot(q.x - c.x, q.z - c.z) < 0.06) { q.popped = true; this._mat(k); } });
      this.im.instanceMatrix.needsUpdate = true;
      api.sfx(this.sound.special || this.sound.step, { gain: -1, maxDur: 1 });
      await api.wait(0.22 + Math.random() * 0.25);
    }
  }
}

// ================= 6. 酥脆碎块：威化、麦片、薯片、蜂巢糖、落叶、冰糖 =================
const PIECE_GEOS = {
  wafer: () => { const g = roundedBox(0.14, 0.05, 0.1, 0.012, 2); return g; },
  cereal: () => new THREE.TorusGeometry(0.035, 0.016, 8, 14).rotateX(Math.PI / 2),
  chip: () => { const g = new THREE.SphereGeometry(0.07, 12, 6, 0, TAU, 0, 0.7); g.scale(1, 0.4, 0.8); return g; },
  honeycomb: () => new THREE.CylinderGeometry(0.06, 0.06, 0.07, 6),
  leaf: () => { const g = new THREE.SphereGeometry(0.085, 10, 4); g.scale(1, 0.12, 0.55); return g; },
  crystal: () => new THREE.IcosahedronGeometry(0.05, 0),
  cracker: () => roundedBox(0.1, 0.03, 0.1, 0.01, 2),
  snowball: () => blobGeometry(0.07, 7, 0.12, 2),
  pebble: () => blobGeometry(0.045, 3, 0.2, 1).scale(1.2, 0.55, 1),
  shell: () => scallopGeometry(0.06, 0.025, 7),
};
export class CrunchStation extends Station {
  build() {
    const d = this.def;
    tray(this, d.trayColor || '#ffffff', 0.07);
    const kind = d.piece || 'wafer';
    const geo = this.ctx.G.get('piece|' + kind, PIECE_GEOS[kind] || PIECE_GEOS.wafer);
    const count = d.count || 70;
    const colors = d.colors || [d.color || '#e8b070'];
    this.pieces = [];
    const r = this.ctx.rng;
    for (let i = 0; i < count; i++) {
      const x = r.range(0.06, this.length - 0.06), z = r.range(-this.width / 2 + 0.06, this.width / 2 - 0.06);
      // 落叶山：中间高、四周低的一大堆
      const hump = d.pile ? 0.3 * Math.max(0, 1 - Math.hypot((x - this.length / 2) / (this.length * 0.5), z / (this.width * 0.5))) : 0;
      this.pieces.push({ x, z, y: 0.06 + r.range(0, 0.06) + hump * r.range(0.4, 1), ry: r.range(0, TAU), rx: r.range(-0.4, 0.4), rz: r.range(-0.4, 0.4), s: r.range(0.8, 1.25), crushed: 0 });
    }
    this.im = new THREE.InstancedMesh(geo, this.ctx.M.soft('#ffffff', { rough: d.rough ?? 0.6, rim: 0.25, flat: kind === 'crystal' || kind === 'honeycomb' }), count);
    this.im.castShadow = true; this.im.receiveShadow = true;
    const c = new THREE.Color();
    this.pieces.forEach((p, k) => { c.set(colors[k % colors.length]); this.im.setColorAt(k, c); this._mat(k); });
    this.group.add(this.im);
    // 被压碎后留下的碎屑（越踩越多，很解压）
    this.crumbGeo = this.ctx.G.get('crumbBit', () => new THREE.TetrahedronGeometry(0.018, 0));
    this.crumbs = new THREE.InstancedMesh(this.crumbGeo, this.ctx.M.soft(colors[0], { rough: 0.8, flat: true }), 400);
    this.crumbs.count = 0;
    this.group.add(this.crumbs);
    return this;
  }
  _mat(k) {
    const p = this.pieces[k];
    const m4 = new THREE.Matrix4().compose(V(p.x, p.y * (1 - p.crushed * 0.7), p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx * (1 - p.crushed), p.ry, p.rz * (1 - p.crushed))), V(p.s * (1 + p.crushed * 0.35), p.s * (1 - p.crushed * 0.75), p.s * (1 + p.crushed * 0.3)));
    this.im.setMatrixAt(k, m4);
  }
  _addCrumbs(x, z, n) {
    const m4 = new THREE.Matrix4(), r = this.ctx.rng;
    for (let i = 0; i < n && this.crumbs.count < 400; i++) {
      m4.compose(V(x + r.range(-0.12, 0.12), 0.06, z + r.range(-0.1, 0.1)), new THREE.Quaternion().setFromEuler(new THREE.Euler(r.range(0, 3), r.range(0, 3), 0)), V(1, 1, 1).multiplyScalar(r.range(0.6, 1.4)));
      this.crumbs.setMatrixAt(this.crumbs.count++, m4);
    }
    this.crumbs.instanceMatrix.needsUpdate = true;
  }
  topY(x, z) {
    let h = 0.07;
    for (const p of this.pieces) if (Math.abs(p.x - x) < 0.08 && Math.abs(p.z - z) < 0.08) h = Math.max(h, p.y * (1 - p.crushed * 0.7) + 0.03);
    return h;
  }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    let n = 0;
    this.pieces.forEach((p, k) => { const dd = Math.hypot(p.x - x, p.z - z); if (dd < 0.13 + power * 0.04 && p.crushed < 1) { p.crushed = Math.min(1, p.crushed + 0.7 + power * 0.3); this._mat(k); n++; } });
    this.im.instanceMatrix.needsUpdate = true;
    this._addCrumbs(x, z, 4 + n * 2);
    return { sound: this.stepSound(power), gain: (power - 0.5) * 3 + Math.min(1.5, n * 0.3), maxDur: 1.8, fx: [{ preset: 'crumbs', x, y: 0.08, z, colors: this.def.colors || [this.def.color], count: 8 + n * 2, scale: 0.6 }] };
  }
  get specials() { return ['stomp']; }
  progress() { return Math.min(1, this.pieces.filter((p) => p.crushed > 0.5).length / this.pieces.length / 0.45); }
  async perform(name, api) {
    // 跳起来重重一踩！
    const p = api.localPos();
    await api.hopLocal(p.x + 0.25, 0, { height: 0.45, dur: 0.55 });
    const fb = this.footstep(p.x + 0.25, 0, 1, 1);
    this.footstep(p.x + 0.25, 0.12, -1, 1); this.footstep(p.x + 0.25, -0.12, 1, 1);
    api.sfx(this.sound.special || this.sound.step, { gain: 3, maxDur: 2.5 });
    api.burst('crumbs', p.x + 0.25, 0.1, 0, { colors: this.def.colors || [this.def.color], count: 26 });
    void fb;
    await api.wait(0.8);
  }
}

// ================= 7. 薄冰：一步一道裂纹 =================
export class IceStation extends Station {
  build() {
    tray(this, this.def.trayColor || '#dff1ff', 0.05);
    const c = document.createElement('canvas');
    c.width = 512; c.height = Math.round(512 * this.width / this.length);
    this.cv = c; this.g2 = c.getContext('2d');
    this.g2.fillStyle = 'rgba(0,0,0,0)'; this.g2.clearRect(0, 0, c.width, c.height);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.ctx.M.track({ dispose: () => this.tex.dispose() });
    const geo = this.ctx.G.get(`ice|${this.length}|${this.width}`, () => roundedBox(this.length, 0.05, this.width, 0.02, 2).translate(this.length / 2, 0.06, 0));
    const ice = new THREE.Mesh(geo, this.ctx.M.track(new THREE.MeshPhysicalMaterial({ color: '#cfeeff', roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.78, envMapIntensity: 1.6 })));
    ice.receiveShadow = true;
    this.group.add(ice);
    const crackPlane = new THREE.Mesh(this.ctx.G.get(`icePlane|${this.length}|${this.width}`, () => new THREE.PlaneGeometry(this.length, this.width).rotateX(-Math.PI / 2).translate(this.length / 2, 0.087, 0)), this.ctx.M.track(new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false })));
    crackPlane.renderOrder = 3;
    this.group.add(crackPlane);
    return this;
  }
  topY() { return 0.09; }
  _crack(x, z, power) {
    const g = this.g2, W = this.cv.width, H = this.cv.height;
    const px = (x / this.length) * W, pz = ((z + this.width / 2) / this.width) * H;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineCap = 'round';
    const branches = 5 + Math.floor(power * 4);
    for (let b = 0; b < branches; b++) {
      let a = Math.random() * TAU, cx = px, cz = pz, len = 30 + Math.random() * 60 * (0.6 + power);
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(cx, cz);
      for (let s = 0; s < 6; s++) { a += (Math.random() - 0.5) * 0.9; cx += Math.cos(a) * len / 6; cz += Math.sin(a) * len / 6; g.lineTo(cx, cz); g.lineWidth *= 0.85; }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(px, pz, 6 + power * 6, 0, TAU); g.fill();
    this.tex.needsUpdate = true;
  }
  progress() { return Math.min(1, this.stepsTaken / 9); }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    this._crack(x, z, power);
    return { sound: this.sound.step, gain: (power - 0.5) * 3, maxDur: 2, fx: [{ preset: 'sparkles', x, y: 0.1, z, colors: ['#e6f6ff', '#ffffff'], count: 6, scale: 0.5 }] };
  }
  get specials() { return ['stomp']; }
  async perform(name, api) {
    const p = api.localPos();
    await api.hopLocal(p.x + 0.2, 0, { height: 0.4, dur: 0.5 });
    for (let k = 0; k < 3; k++) this._crack(p.x + 0.2 + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3, 1);
    api.sfx(this.sound.special || this.sound.step, { gain: 3, maxDur: 2.5 });
    api.burst('sparkles', p.x + 0.2, 0.1, 0, { colors: ['#e6f6ff', '#ffffff'], count: 16 });
    await api.wait(0.8);
  }
}

// ================= 8. 肥皂方块：踩碎成一颗颗小方块 =================
export class SoapStation extends Station {
  build() {
    const d = this.def;
    tray(this, d.trayColor || '#ffffff', 0.05);
    const s = 0.085, gap = 0.006;
    const cols = Math.floor((this.length - 0.1) / (s + gap)), rows = Math.floor((this.width - 0.1) / (s + gap)), layers = 2;
    const geo = this.ctx.G.get('soapCube', () => roundedBox(s, s, s, 0.012, 2));
    this.cubes = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) for (let l = 0; l < layers; l++) {
      this.cubes.push({ x: 0.05 + s / 2 + i * (s + gap), z: -this.width / 2 + 0.05 + s / 2 + j * (s + gap), y: 0.045 + s / 2 + l * (s + gap), l, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, loose: false, rest: true });
    }
    this.im = new THREE.InstancedMesh(geo, this.ctx.M.soft('#ffffff', { rough: 0.35, rim: 0.4 }), this.cubes.length);
    this.im.castShadow = true; this.im.receiveShadow = true;
    const c = new THREE.Color();
    const cols2 = d.colors || ['#c9f0ff', '#ffe0f0', '#e8ffd6'];
    this.cubes.forEach((q, k) => { c.set(cols2[Math.floor(q.x / 0.6) % cols2.length]); this.im.setColorAt(k, c); this._mat(k); });
    this.group.add(this.im);
    return this;
  }
  _mat(k) {
    const q = this.cubes[k];
    this.im.setMatrixAt(k, new THREE.Matrix4().compose(V(q.x, q.y, q.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(q.rx, q.ry, q.rz)), V(1, 1, 1)));
  }
  topY(x, z) {
    let h = 0.05;
    for (const q of this.cubes) if (!q.loose && Math.abs(q.x - x) < 0.05 && Math.abs(q.z - z) < 0.05) h = Math.max(h, q.y + 0.045);
    return h;
  }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    let n = 0;
    const r = this.ctx.rng;
    for (const q of this.cubes) {
      const dd = Math.hypot(q.x - x, q.z - z);
      if (dd < 0.1 + power * 0.03 && !q.loose && q.l === 1) {
        q.loose = true; q.rest = false; n++;
        const a = Math.atan2(q.z - z, q.x - x) + r.range(-0.6, 0.6);
        const sp = r.range(0.4, 0.9) * (0.6 + power);
        q.vx = Math.cos(a) * sp; q.vz = Math.sin(a) * sp; q.vy = r.range(0.6, 1.4);
        q.wx = r.range(-8, 8); q.wz = r.range(-8, 8);
      }
    }
    return { sound: this.sound.step, gain: (power - 0.5) * 2 + Math.min(1.5, n * 0.25), maxDur: 2.2, fx: [{ preset: 'crumbs', x, y: 0.15, z, colors: this.def.colors || ['#c9f0ff', '#ffe0f0'], count: 6, scale: 0.5 }] };
  }
  get specials() { return ['stomp']; }
  async perform(name, api) {
    const p = api.localPos();
    await api.hopLocal(p.x + 0.25, 0, { height: 0.45, dur: 0.55 });
    this.footstep(p.x + 0.25, 0, 1, 1); this.footstep(p.x + 0.25, 0.13, 1, 1); this.footstep(p.x + 0.25, -0.13, 1, 1);
    api.sfx(this.sound.special || this.sound.step, { gain: 3, maxDur: 2.6 });
    await api.wait(0.9);
  }
  update(dt) {
    super.update(dt);
    let dirty = false;
    this.cubes.forEach((q, k) => {
      if (q.rest) return;
      q.vy -= 9 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rx += (q.wx || 0) * dt; q.rz += (q.wz || 0) * dt;
      const floor = 0.045 + 0.0425;
      if (q.y < floor) { q.y = floor; q.vy *= -0.25; q.vx *= 0.5; q.vz *= 0.5; q.wx = (q.wx || 0) * 0.5; q.wz = (q.wz || 0) * 0.5; if (Math.abs(q.vy) < 0.15 && Math.hypot(q.vx, q.vz) < 0.05) { q.rest = true; q.rx = Math.round(q.rx / (Math.PI / 2)) * (Math.PI / 2); q.rz = Math.round(q.rz / (Math.PI / 2)) * (Math.PI / 2); } }
      q.x = clamp(q.x, 0.03, this.length - 0.03); q.z = clamp(q.z, -this.width / 2 + 0.03, this.width / 2 - 0.03);
      this._mat(k); dirty = true;
    });
    if (dirty) this.im.instanceMatrix.needsUpdate = true;
  }
}

// ================= 9. 浅水：一步一圈涟漪 =================
const WATER_VERT = `
varying vec2 vUv; varying vec3 vPos;
void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const WATER_FRAG = `
uniform vec3 uColor; uniform float uTime; uniform vec4 uDrops[6];
varying vec2 vUv; varying vec3 vPos;
void main(){
  float h = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 d = uDrops[i];
    float age = uTime - d.z;
    if (age < 0.0 || age > 3.0) continue;
    float r = distance(vPos.xz, d.xy);
    float front = age * 0.45;
    h += sin((r - front) * 40.0) * exp(-abs(r - front) * 14.0) * exp(-age * 1.4) * d.w;
  }
  vec3 c = uColor * (0.88 + 0.12 * sin(vPos.x * 7.0 + uTime) * sin(vPos.z * 9.0 - uTime * 0.7));
  c += vec3(1.0) * clamp(h, 0.0, 1.0) * 0.55;
  gl_FragColor = vec4(c, 0.82);
  #include <colorspace_fragment>
}`;
export class WaterStation extends Station {
  build() {
    tray(this, this.def.trayColor || '#e6f4ff', 0.06);
    this.u = { uColor: { value: new THREE.Color(this.def.color || '#7fd0f5') }, uTime: { value: 0 }, uDrops: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) } };
    const mat = this.ctx.M.track(new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false }));
    const geo = this.ctx.G.get(`water|${this.length}|${this.width}`, () => new THREE.PlaneGeometry(this.length - 0.04, this.width - 0.04).rotateX(-Math.PI / 2).translate(this.length / 2, 0.075, 0));
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 3;
    this.group.add(m);
    this.di = 0;
    // 水底的小石子
    const peb = this.ctx.G.get('pebble2', () => blobGeometry(0.035, 2, 0.25, 1));
    const im = new THREE.InstancedMesh(peb, this.ctx.M.soft('#ffffff', { rough: 0.7 }), 40);
    const r = this.ctx.rng, c = new THREE.Color(), m4 = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) { m4.compose(V(r.range(0.05, this.length - 0.05), 0.04, r.range(-this.width / 2 + 0.05, this.width / 2 - 0.05)), new THREE.Quaternion(), V(1, 0.5, 1).multiplyScalar(r.range(0.7, 1.4))); im.setMatrixAt(i, m4); im.setColorAt(i, c.set(r.pick(['#e8dccb', '#d0c4b4', '#f2e6d8', '#cfe3e8']))); }
    this.group.add(im);
    return this;
  }
  topY() { return 0.045; }
  progress() { return Math.min(1, this.stepsTaken / 9); }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    this.u.uDrops.value[this.di++ % 6].set(x, z, this.t, 0.7 + power * 0.5);
    return { sound: this.sound.step, gain: (power - 0.5) * 3, maxDur: 2, fx: [{ preset: 'water', x, y: 0.08, z, colors: ['#d8f5ff', '#ffffff'], count: 10, scale: 0.6 }] };
  }
  get specials() { return ['stomp']; }
  async perform(name, api) {
    const p = api.localPos();
    await api.hopLocal(p.x + 0.25, 0, { height: 0.4, dur: 0.5 });
    this.footstep(p.x + 0.25, 0, 1, 1);
    api.sfx(this.sound.special || this.sound.step, { gain: 2, maxDur: 2.4 });
    api.burst('water', p.x + 0.25, 0.08, 0, { colors: ['#d8f5ff', '#ffffff'], count: 24 });
    await api.wait(0.8);
  }
  update(dt) { super.update(dt); this.u.uTime.value = this.t; }
}

// ================= 10. 大键帽：机械键盘的"咔哒" =================
export class KeysStation extends Station {
  build() {
    tray(this, this.def.trayColor || '#3a3550', 0.06, 0.03);
    const size = 0.27;
    const cols = Math.floor((this.length - 0.04) / (size + 0.02)), rows = Math.floor((this.width - 0.04) / (size + 0.02));
    const geo = this.ctx.G.get('bigKeycap', () => { const b = roundedBox(size, 0.13, size, 0.04, 3); const p = b.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 - (p.getY(i) + 0.065) * 0.6; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } b.computeVertexNormals(); b.translate(0, 0.065, 0); return b; });
    this.keys = [];
    const colors = this.def.colors || ['#ffd6e8', '#d6ecff', '#fff3c2', '#dcf7d6', '#e6dcff'];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const m = new THREE.Mesh(geo, this.ctx.M.soft(colors[(i + j) % colors.length], { rough: 0.45, rim: 0.35 }));
      m.position.set(0.02 + size / 2 + i * (size + 0.02), 0.06, -this.width / 2 + 0.02 + size / 2 + j * (size + 0.02));
      m.castShadow = true;
      this.group.add(m);
      this.keys.push({ m, sp: new Spring(500, 14, 0), x: m.position.x, z: m.position.z });
    }
    return this;
  }
  _key(x, z) { return this.keys.reduce((b, k) => (Math.hypot(k.x - x, k.z - z) < Math.hypot(b.x - x, b.z - z) ? k : b), this.keys[0]); }
  topY(x, z) { const k = this._key(x, z); return 0.19 + k.m.position.y - 0.06; }
  progress() { return Math.min(1, this.keys.filter((k) => k.hit).length / this.keys.length / 0.7); }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    const k = this._key(x, z);
    k.sp.x = -0.035; k.hit = true;
    return { sound: this.sound.step, gain: (power - 0.5) * 2, maxDur: 0.9 };
  }
  get specials() { return ['tapdance']; }
  async perform(name, api) {
    const order = this.keys.slice().sort(() => Math.random() - 0.5).slice(0, 7);
    for (const k of order) {
      await api.tapAt(k.x, k.z);
      k.sp.x = -0.035; k.hit = true;
      api.sfx(this.sound.special || this.sound.step, { gain: -1, maxDur: 0.8 });
      await api.wait(0.18 + Math.random() * 0.25);
    }
  }
  update(dt) { super.update(dt); for (const k of this.keys) k.m.position.y = 0.06 + k.sp.update(dt); }
}

// ================= 11. 慢回弹捏捏（面包/蛋糕/星星形状）：压下去慢慢鼓回来 =================
export class SquishyStation extends Station {
  build() {
    const d = this.def;
    const n = d.count || 2;
    this.items = [];
    const shape = d.shape || 'bread';
    const size = Math.min(d.finale ? 1.7 : 0.95, (this.length - 0.1) / n - 0.08, d.finale ? this.width - 0.1 : 9);
    const geo = this.ctx.G.get(`squishy|${shape}|${size.toFixed(2)}`, () => {
      if (shape === 'bread') { const g = roundedBox(size, size * 0.42, size * 0.85, size * 0.2, 5); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) p.setY(i, y + 0.06 * Math.cos(p.getX(i) / size * Math.PI)); } g.computeVertexNormals(); return g.translate(0, size * 0.21, 0); }
      return blobGeometry(size * 0.5, 5, 0.04, 4).scale(1, 0.5, 0.85).translate(0, size * 0.25, 0);
    });
    for (let i = 0; i < n; i++) {
      const color = (d.colors || ['#ffe0b3', '#ffd6e8'])[i % (d.colors || [1, 1]).length];
      const m = new THREE.Mesh(geo, this.ctx.M.soft(color, { rough: 0.85, rim: 0.4, rimColor: '#ffffff' }));
      const x = 0.05 + size / 2 + i * (size + 0.08);
      m.position.set(x, 0, 0);
      m.castShadow = true;
      this.group.add(m);
      this.items.push({ m, x, size, s: 1, target: 1, top: size * 0.42 + 0.03 });
    }
    return this;
  }
  _item(x) { return this.items.reduce((b, c) => (Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b), this.items[0]); }
  topY(x) { const it = this._item(x); return Math.abs(it.x - x) < it.size / 2 ? it.top * it.s : 0.02; }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    const it = this._item(x);
    it.s = Math.max(0.45, it.s - 0.22 - power * 0.12); // 压扁
    return { sound: this.sound.step, gain: (power - 0.5) * 2, maxDur: 2.5 };
  }
  get specials() { return this.def.specials || ['sit']; }
  progress() { return Math.min(1, this.stepsTaken / 7); }
  knead(x, z, power = 0.5) {
    this.stepsTaken++;
    const it = this._item(x);
    it.s = Math.max(0.55, it.s - 0.1 - power * 0.06);
    return { sound: this.sound.step, gain: -2, maxDur: 2.2 };
  }
  async perform(name, api) {
    const it = this._item(api.localPos().x);
    const pose = api.pose('sit', 2.4);
    await api.wait(0.3);
    it.s = 0.42;
    api.sfx(this.sound.special || this.sound.step, { gain: 1, maxDur: 3.2 });
    api.sink(0.05);
    await pose;
    api.sink(0);
  }
  update(dt) {
    super.update(dt);
    for (const it of this.items) {
      it.s += (1 - it.s) * (1 - Math.exp(-0.9 * dt)); // 慢慢回弹
      it.m.scale.set(1 + (1 - it.s) * 0.25, it.s, 1 + (1 - it.s) * 0.2);
    }
  }
}

// ================= 12. 玻璃/水晶砖：敲一敲 =================
export class GlassStation extends Station {
  build() {
    tray(this, this.def.trayColor || '#eef3ff', 0.05);
    const n = Math.max(3, Math.round(this.length / 0.45));
    const w = (this.length - 0.1) / n - 0.04;
    const geo = this.ctx.G.get(`glassTile|${w.toFixed(2)}|${this.width}`, () => roundedBox(w, 0.07, this.width - 0.14, 0.025, 2).translate(0, 0.035, 0));
    this.tiles = [];
    const colors = this.def.colors || RAINBOW;
    for (let i = 0; i < n; i++) {
      const mat = this.ctx.M.track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(colors[i % colors.length]), roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.7, emissive: new THREE.Color(colors[i % colors.length]), emissiveIntensity: 0.1, envMapIntensity: 1.6 }));
      const m = new THREE.Mesh(geo, mat);
      const x = 0.05 + w / 2 + i * (w + 0.04);
      m.position.set(x, 0.045, 0);
      this.group.add(m);
      this.tiles.push({ m, mat, x, w, glow: 0 });
    }
    return this;
  }
  topY() { return 0.12; }
  footstep(x, z, side, power = 0.5) {
    this.stepsTaken++;
    const t = this.tiles.reduce((b, c) => (Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b), this.tiles[0]);
    t.glow = 1;
    return { sound: this.sound.step, gain: (power - 0.5) * 2, maxDur: 2.4 };
  }
  update(dt) {
    super.update(dt);
    for (const t of this.tiles) { t.glow = Math.max(0, t.glow - dt * 1.2); t.mat.emissiveIntensity = 0.1 + t.glow * 0.9; }
  }
}

// 高度场被压过的面积占比（只算托盘内部）
function coverage(hf) {
  let n = 0;
  for (let i = 0; i < hf.press.length; i++) if (hf.press[i] > 0.35) n++;
  return n / hf.press.length;
}

export const STATION_TYPES = {
  soft: SoftSlab, slime: SlimeStation, jelly: JellyStation, popit: PopItStation, bubblewrap: BubbleWrapStation,
  crunch: CrunchStation, ice: IceStation, soap: SoapStation, water: WaterStation, keys: KeysStation, squishy: SquishyStation, glass: GlassStation,
};

export function createStation(ctx, def) {
  const C = STATION_TYPES[def.type];
  if (!C) throw new Error('未知解压站类型 ' + def.type);
  return new C(ctx, def).build();
}
