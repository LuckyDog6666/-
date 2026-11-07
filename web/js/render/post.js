// "电影感"后期：动画电影常见的柔光（亮的地方——阳光下的雪、亮片、果冻高光——轻轻晕开）
// + 轻微的调色（颜色更饱满一点，亮部偏暖、暗部偏冷）。
// 实现很省：场景先画到一张多重采样的浮点纹理，再缩成 1/4 大小生成 mipmap，
// 最后一遍全屏合成时从 mipmap 里取几层模糊的亮光叠上去，顺便做色调映射和 sRGB 输出。
// 掉帧时由主循环自动关闭（setEnabled(false)），也可以在 config.json 里关掉（"post": false）。
import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COPY = `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

const COMPOSITE = `
uniform sampler2D tScene;
uniform sampler2D tSmall;
uniform float uGlow;
uniform float uThresh;
uniform float uSat;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 b = textureLod(tSmall, vUv, 1.0).rgb * 0.45 + textureLod(tSmall, vUv, 2.5).rgb * 0.35 + textureLod(tSmall, vUv, 4.0).rgb * 0.3;
  c += max(b - uThresh, 0.0) * uGlow;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c *= mix(vec3(0.975, 0.985, 1.035), vec3(1.025, 1.0, 0.965), smoothstep(0.12, 0.85, l));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class FilmLook {
  constructor(renderer, o = {}) {
    this.renderer = renderer;
    this.enabled = o.enabled !== false;
    const caps = renderer.capabilities;
    if (!caps.isWebGL2) this.enabled = false;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    this.small = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.copyMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } }, vertexShader: VERT, fragmentShader: COPY, depthTest: false, depthWrite: false, toneMapped: false });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tSmall: { value: null }, uGlow: { value: o.glow ?? 0.55 }, uThresh: { value: o.threshold ?? 0.82 }, uSat: { value: o.saturation ?? 1.07 } },
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
    });
    this.base = { glow: o.glow ?? 0.55, threshold: o.threshold ?? 0.82, saturation: o.saturation ?? 1.07 };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.w = 0; this.h = 0;
  }
  setSize(w, h) {
    w = Math.max(4, Math.floor(w)); h = Math.max(4, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.rt.setSize(w, h);
    this.small.setSize(Math.max(4, w >> 2), Math.max(4, h >> 2));
  }
  setEnabled(v) { this.enabled = !!v; }
  // 每个世界可以微调：雪地这种本来就很亮的场景少晕一点，不然发灰
  configure(o = {}) {
    const u = this.compMat.uniforms;
    u.uGlow.value = o.glow ?? this.base.glow;
    u.uThresh.value = o.threshold ?? this.base.threshold;
    u.uSat.value = o.saturation ?? this.base.saturation;
  }
  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) { r.render(scene, camera); return; }
    const size = r.getDrawingBufferSize(_v2);
    this.setSize(size.x, size.y);
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    this.quad.material = this.copyMat;
    this.copyMat.uniforms.tSrc.value = this.rt.texture;
    r.setRenderTarget(this.small);
    r.render(this.scene, this.cam);
    this.quad.material = this.compMat;
    this.compMat.uniforms.tScene.value = this.rt.texture;
    this.compMat.uniforms.tSmall.value = this.small.texture;
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
  dispose() {
    this.rt.dispose(); this.small.dispose();
    this.copyMat.dispose(); this.compMat.dispose();
    this.quad.geometry.dispose();
  }
}
const _v2 = new THREE.Vector2();
