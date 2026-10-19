// "解压站"基类：赛道上一块块让人看了就舒服的东西（太空沙、史莱姆、果冻、按压泡泡……）。
// 坐标约定：站点局部坐标 x ∈ [0, length] 为前进方向，z ∈ [-width/2, width/2]，y=0 为地面。
import * as THREE from 'three';

export class Station {
  constructor(ctx, def) {
    this.ctx = ctx;           // { M, G, rng, theme }
    this.def = def;           // 定义（类型、颜色、声音、名字等）
    this.group = new THREE.Group();
    this.length = def.length || 2.4;
    this.width = def.width || 1.6;
    this.t = 0;
    this.stepsTaken = 0;
    this.label = def.label || '';
    this.sound = def.sound || {};
  }

  // 子类实现：创建模型
  build() { return this; }

  // 这一脚用哪个声音：用力踩（重踩、跳下来）时换成更厚重的那组录音（如果有）
  stepSound(power = 0.5) { return power > 0.78 && this.sound.heavy && Math.random() < 0.45 ? this.sound.heavy : this.sound.step; }

  // 局部坐标下的表面高度（糯糯脚踩的位置）
  topY(lx, lz) { return this.def.thickness ?? 0.12; }

  /**
   * 脚落在 (lx, lz)：更新外观，返回反馈 { sound, gain, rate, maxDur, fx:[{preset, x,y,z, colors, count}] }
   * power: 0..1 力度（重踩更响、更深）
   */
  footstep(lx, lz, side, power = 0.5) { this.stepsTaken++; return { sound: this.sound.step, gain: 0 }; }

  // 支持的特别动作（AI 会挑一个来做）
  get specials() { return []; }

  /** 特别动作：api 由游戏提供 { pet, walkLocal(x,z,o), stepAt(x,z,side,power), sfx(id,local,o), burst(preset,local,o), wait(s), say(t), world(local) } */
  async perform(name, api) {}

  update(dt) { this.t += dt; }

  // 世界坐标 → 局部
  toLocal(v) { return this.group.worldToLocal(v.clone()); }
  toWorld(x, y, z) { return this.group.localToWorld(new THREE.Vector3(x, y, z)); }

  dispose() {}
}

// 给材质加"果冻抖动"：从冲击点向外扩散的衰减波（顶点着色器），uniform 可随时触发
export function addJiggle(mat) {
  const u = { uImpact: { value: new THREE.Vector3() }, uJT: { value: 99 }, uJAmp: { value: 0 }, uJFreq: { value: 17 } };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uImpact; uniform float uJT; uniform float uJAmp; uniform float uJFreq;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float jd = distance(position, uImpact);
          float env = exp(-uJT * 3.2) * uJAmp;
          float w = sin(uJT * uJFreq - jd * 10.0) * exp(-jd * 1.4) * env;
          transformed += normal * w * 0.05;
          transformed.y += sin(uJT * uJFreq * 0.8) * env * 0.03 * position.y * 4.0;
          transformed.xz *= 1.0 - sin(uJT * uJFreq * 0.8) * env * 0.015;
        }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + '|jiggle';
  mat.userData.jiggle = u;
  return u;
}
export function kickJiggle(u, localPoint, amp = 1) {
  u.uImpact.value.copy(localPoint);
  u.uJT.value = 0;
  u.uJAmp.value = Math.min(1.5, amp);
}
