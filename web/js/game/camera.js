// 镜头导演：以"正面 / 3/4 正面"为主，让观众一直看得到糯糯可爱的小脸。
//  - 赛道沿 +x 方向前进，默认镜头在糯糯前方（+x）偏一点侧面，随它前进不断后退跟拍
//    （参考 Crash Bandicoot 追逐关卡"角色迎着镜头跑"的机位），身后留下的脚印也在画面里
//  - 每种玩法有专门机位：踩踏特写、正脸特写、对着观众跳舞、滑梯从下往上看、蹦床仰拍、任务台"美食节目"机位……
//  - 镜头位置用"围绕目标的柱坐标"做阻尼插值：切换机位时沿弧线绕过去，不会穿过糯糯的身体
//  - 重要的大转场用"硬切"（cut），像剪辑过的解压视频一样干净
//  - 走 S 形路线时，跟拍机位会随糯糯的前进方向一起转一点，保证始终是 3/4 正面，而不是侧面
//  - 以糯糯为主体的机位有"最近距离"：按相机视角（横屏 40°、竖屏 52° 且很窄）算出来，
//    保证从耳朵尖到小脚都完整地在画面里
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FORWARD = Math.PI / 2; // 赛道前进方向（+x）
const wrap = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
// 绕 y 轴旋转（角度增大 = 方位角 atan2(x, z) 增大，和糯糯的 facing 同一个约定）
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); const x = v.x * c + v.z * s, z = -v.x * s + v.z * c; v.x = x; v.z = z; return v; };
// 糯糯（含耳朵和小芽）的大致尺寸：高约 1.3、宽约 1.25（scale = 1 时）
const PET_H = 1.3, PET_W = 1.25;

export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'front';
    this.opts = {};
    this.target = V(0, 0.4, 0);   // 看向哪里
    this.yaw = 0.4; this.radius = 3.2; this.height = 1.2; // 相对 target 的柱坐标
    this.t = 0;
    this._cut = true;
    this.shake = 0;
    this.heading = 0; this.headingTarget = 0; // 糯糯走路方向相对赛道的偏角（平滑后）
  }

  // 切换机位。o.cut = true：下一帧直接跳过去（硬切）
  set(mode, o = {}) {
    // 不做"相同参数就忽略"的判断：带函数的机位（滑梯底部、蹦床仰拍）用 JSON 比较会被误判为相同
    this.mode = mode;
    this.opts = o;
    if (o.cut) this._cut = true;
  }
  cut() { this._cut = true; }
  bump(v = 0.04) { this.shake = Math.max(this.shake, v); }

  // 每种机位：返回 { look(看向的点), off(相对 look 的偏移), lambda(跟随速度) }
  _shot(ctx) {
    const { pet, portrait } = ctx;
    const p = pet.root.position, g = pet.groundY, sc = pet.root.scale.x;
    const big = sc > 1.1 ? 1.55 : 1;
    const o = this.opts;
    const P = portrait;
    switch (this.mode) {
      case 'wide': { // 远景：看看接下来要去的地方
        const c = o.at || p;
        return { look: V(c.x, (c.y ?? g) + 0.3, c.z || 0), off: P ? V(3.4, 3.4, 6.2) : V(3.8, 2.6, 5.2), lambda: 1.2 };
      }
      case 'intro': { // 开场：从高处的远景慢慢推到糯糯
        const c = o.at || p;
        return { look: V(c.x, g + 0.4, c.z * 0.5), off: P ? V(5.5, 3.6, 5.5) : V(6.0, 2.8, 4.2), lambda: 0.9 };
      }
      case 'macro': { // 平视的正前方近景：小脚踩进材质、身后一串脚印、小脸都在画面里（ASMR 核心镜头）
        const k = this.heading * 0.65;
        const lo = rotY(V(-0.3 * sc, 0, 0), k);
        return { look: V(p.x + lo.x, g + 0.45 * sc, p.z * 0.85 + lo.z), off: rotY((P ? V(2.5, 0.85, 1.35) : V(2.45, 0.62, 1.25)).multiplyScalar(big), k), lambda: 1.6, fit: true };
      }
      case 'face': { // 小脸近景（享受、眯眼、坐下）：在糯糯面朝的方向
        const d = this._facingDir(pet);
        const s = P ? 2.9 : 2.7;
        return { look: V(p.x, g + 0.5 * sc, p.z), off: V(d.x * s + d.z * 0.45, (P ? 0.85 : 0.68) * sc, d.z * s - d.x * 0.45).multiplyScalar(sc > 1.1 ? 1.4 : 1), lambda: 1.5, fit: true };
      }
      case 'audience': { // 对着观众（跳舞、挥手、谢谢老板）：正面中景
        const d = this._facingDir(pet);
        const s = (P ? 4.2 : 3.5) * big;
        return { look: V(p.x, g + 0.62 * sc, p.z), off: V(d.x * s, (P ? 1.5 : 1.15) * big, d.z * s), lambda: 2.0, fit: true };
      }
      case 'trail': { // 看脚印：抬高机位，看清整块被踩过的材质
        const c = o.at || V(p.x - 1, g, p.z);
        const look = V((c.x + p.x) / 2, g + 0.1, (c.z + p.z) / 2);
        // reverse（反打）：从脚印的另一头拍回来——一串脚印在前景，回头看的糯糯正对镜头
        if (o.reverse) return { look, off: P ? V(-2.2, 2.6, 2.3) : V(-2.3, 1.9, 1.9), lambda: 1.2 };
        return { look, off: P ? V(1.9, 2.9, 2.4) : V(1.9, 2.1, 2.0), lambda: 1.2 };
      }
      case 'stamp': { // 看老板的名字被压进材质
        const c = o.at || p;
        return { look: V(c.x, (c.y ?? g) + 0.05, c.z || 0), off: P ? V(0.4, 2.9, 2.3) : V(0.35, 2.3, 1.9), lambda: 1.5 };
      }
      case 'task': { // 任务台（切菜、煎饼、叠衣服……）：像美食节目，在操作台正前方
        const c = o.at || p;
        const s = o.dist || 1;
        return { look: V(c.x, (c.y ?? g) + (o.lookY ?? 0.32), c.z ?? 0), off: (P ? V(0.8, 1.4, 2.95) : V(0.92, 1.08, 2.5)).multiplyScalar(s * big), lambda: 1.5 };
      }
      case 'point': { // 任意固定机位：o.pos 机位，o.look 看向（滑梯底部仰拍等）
        const look = typeof o.look === 'function' ? o.look() : o.look || p;
        const pos = typeof o.pos === 'function' ? o.pos() : o.pos;
        return { look: look.clone(), off: pos.clone().sub(look), lambda: o.lambda || 1.6 };
      }
      case 'follow': { // 跟着糯糯，但机位由玩法给出的偏移决定（同样随前进方向转一点）
        const k = this.heading * 0.6;
        const off = rotY(o.off ? o.off.clone() : V(2.4, 1.2, 1.4), k);
        // lookFromPet：看向的高度相对糯糯本身（飘在空中时也居中），否则相对地面
        const ly = o.lookY == null ? p.y + 0.4 : o.lookFromPet ? p.y + o.lookY : g + o.lookY;
        return { look: V(p.x + (o.lookAhead || 0), ly, p.z * 0.7), off: off.multiplyScalar(P ? 1.2 : 1), lambda: o.lambda || 1.6, fit: true };
      }
      default: { // front：走路时的正面跟拍（3/4 正面，脸和身后的路都看得到）
        const k = this.heading * 0.65;
        const lo = rotY(V(-0.25 * sc, 0, 0), k);
        return { look: V(p.x + lo.x, g + 0.42 * sc, p.z * 0.75 + lo.z), off: rotY((P ? V(2.8, 1.55, 1.55) : V(2.75, 1.12, 1.3)).multiplyScalar(big), k), lambda: 1.45, fit: true };
      }
    }
  }

  // 以糯糯为主体的机位最近能靠多近：糯糯最多占画面高度的 62%、宽度的 78%
  // （竖屏的水平视角很窄，主要受宽度限制）
  _minDist(sc) {
    const cam = this.camera;
    const tv = Math.tan((cam.fov * Math.PI) / 360), th = tv * (cam.aspect || 16 / 9);
    return Math.max((PET_H * sc) / (2 * tv * 0.62), (PET_W * sc) / (2 * th * 0.78));
  }

  _facingDir(pet) {
    const f = pet.facing;
    return V(Math.sin(f), 0, Math.cos(f));
  }

  update(dt, ctx) {
    this.t += dt;
    // 走路时记下前进方向（停下来做动作、转身面向镜头时保持不变，免得镜头跟着"追"）
    const pet = ctx.pet, act = pet.action;
    if (act && act.kind === 'walk') this.headingTarget = clamp(wrap(pet.facing - FORWARD), -0.6, 0.6);
    else if (this.mode !== 'macro' && this.mode !== 'follow') this.headingTarget = 0;
    this.heading = this._cut ? this.headingTarget : damp(this.heading, this.headingTarget, 2.2, dt);
    const shot = this._shot(ctx);
    const off = shot.off;
    if (shot.fit) {
      const md = this._minDist(pet.root.scale.x);
      if (off.length() < md) off.setLength(md);
    }
    // 极轻的"呼吸感"
    off.y += Math.sin(this.t * 0.09) * 0.03;
    const yaw = Math.atan2(off.x, off.z), rad = Math.hypot(off.x, off.z), h = off.y;
    if (this._cut) {
      this._cut = false;
      this.target.copy(shot.look);
      this.yaw = yaw; this.radius = rad; this.height = h;
    } else {
      const L = shot.lambda;
      this.target.x = damp(this.target.x, shot.look.x, L * 1.15, dt);
      this.target.y = damp(this.target.y, shot.look.y, L * 1.15, dt);
      this.target.z = damp(this.target.z, shot.look.z, L * 1.15, dt);
      this.yaw = dampAngle(this.yaw, yaw, L, dt);
      this.radius = damp(this.radius, rad, L, dt);
      this.height = damp(this.height, h, L, dt);
    }
    const cam = this.camera;
    cam.position.set(this.target.x + Math.sin(this.yaw) * this.radius, this.target.y + this.height, this.target.z + Math.cos(this.yaw) * this.radius);
    // 镜头不能钻到地面以下
    const floor = (ctx.floorAt ? ctx.floorAt(cam.position.x, cam.position.z) : 0) + 0.28;
    if (cam.position.y < floor) cam.position.y = floor;
    if (this.shake > 0.001) {
      this.shake *= Math.exp(-dt * 7);
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    cam.lookAt(this.target);
  }
}

