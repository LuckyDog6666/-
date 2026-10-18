// 材质工厂：柔和的"黏土/软糖"质感 + 菲涅尔边缘光（让所有东西都毛茸茸、亮晶晶的）。
import * as THREE from 'three';

const RIM_CHUNK = `
#include <emissivemap_fragment>
{
  vec3 vDirRim = normalize(vViewPosition);
  float rimF = pow(1.0 - clamp(dot(normalize(normal), vDirRim), 0.0, 1.0), rimPower);
  totalEmissiveRadiance += rimColor * rimF * rimStrength;
}
`;

function addRim(mat, color, strength, power) {
  mat.userData.rim = { rimColor: { value: new THREE.Color(color) }, rimStrength: { value: strength }, rimPower: { value: power } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.rim);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimPower;')
      .replace('#include <emissivemap_fragment>', RIM_CHUNK);
  };
  mat.customProgramCacheKey = () => 'rim-v1';
  return mat;
}

/**
 * 每个关卡一个 MaterialBank，关卡结束时统一释放，避免长时间直播内存增长。
 */
export class MaterialBank {
  constructor() { this.map = new Map(); this.extra = []; }

  // 软糯质感（默认）
  soft(color, o = {}) {
    const key = `soft|${color}|${o.rough ?? 0.62}|${o.rim ?? 0.35}|${o.emissive ?? ''}|${o.ei ?? 0}|${o.opacity ?? 1}|${o.flat ? 1 : 0}|${o.vc ? 1 : 0}|${o.side ?? 0}|${o.map ? o.map.uuid : ''}|${o.rimColor || ''}|${o.rimPower ?? ''}`;
    let m = this.map.get(key);
    if (m) return m;
    m = this._makeSoft(color, o);
    this.map.set(key, m);
    return m;
  }

  // 不共享的软糯材质（需要单独调节发光强度的物件用）
  softUnique(color, o = {}) {
    const m = this._makeSoft(color, o);
    this.extra.push(m);
    return m;
  }

  _makeSoft(color, o) {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: o.rough ?? 0.62,
      metalness: 0,
      emissive: o.emissive ? new THREE.Color(o.emissive) : new THREE.Color(0),
      emissiveIntensity: o.ei ?? 0,
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      flatShading: !!o.flat,
      vertexColors: !!o.vc,
      side: o.side ?? THREE.FrontSide,
      map: o.map || null,
      depthWrite: (o.opacity ?? 1) >= 1 || !!o.depthWrite,
    });
    const rimColor = new THREE.Color(o.rimColor || '#ffffff');
    addRim(m, rimColor, o.rim ?? 0.35, o.rimPower ?? 2.6);
    return m;
  }

  // 晶莹剔透（果冻、泡泡、水晶、冰）
  glossy(color, o = {}) {
    const key = `glossy|${color}|${o.opacity ?? 0.75}|${o.ei ?? 0.15}|${o.rim ?? 0.8}|${o.rough ?? ''}|${o.rimColor || ''}`;
    let m = this.map.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: o.rough ?? 0.12,
      metalness: 0.0,
      transparent: true,
      opacity: o.opacity ?? 0.75,
      emissive: new THREE.Color(color),
      emissiveIntensity: o.ei ?? 0.15,
      depthWrite: false,
    });
    addRim(m, o.rimColor || '#ffffff', o.rim ?? 0.8, o.rimPower ?? 2.0);
    this.map.set(key, m);
    return m;
  }

  // 自发光（星星、宝石、灯）
  glow(color, intensity = 1.2) {
    const key = `glow|${color}|${intensity}`;
    let m = this.map.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.4 });
    this.map.set(key, m);
    return m;
  }

  basic(color, o = {}) {
    const key = `basic|${color}|${o.opacity ?? 1}|${o.side ?? 0}|${o.blending ?? 0}|${o.map ? o.map.uuid : ''}`;
    let m = this.map.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: (o.opacity ?? 1) < 1 || !!o.map, opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide, depthWrite: !!o.depthWrite, blending: o.blending ?? THREE.NormalBlending, map: o.map || null, fog: o.fog ?? true,
    });
    this.map.set(key, m);
    return m;
  }

  track(m) { this.extra.push(m); return m; }

  dispose() {
    for (const m of this.map.values()) m.dispose();
    for (const m of this.extra) m.dispose();
    this.map.clear();
    this.extra = [];
  }
}

// 描边（反向外壳法）：给糯糯一圈可爱的"贴纸"轮廓
export function outlineMaterial(color = '#5a3a4a', thickness = 0.03) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineW = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineW;');
  };
  m.customProgramCacheKey = () => 'outline-v1-' + thickness;
  return m;
}

export { addRim };
