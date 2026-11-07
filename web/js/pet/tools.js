// 糯糯拿在小手里的道具（全部程序化建模，圆润可爱、玩具一样的配色）。
// 原点在"握把"处，道具沿局部 -y 方向伸出（和小手臂下垂的方向一致）。
import * as THREE from 'three';
import { roundedBox } from '../world/geo.js';
import { TAU } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 道具的世界朝向：dir = 握把→尖端的方向（道具局部 -y），side = 道具局部 +x 大致朝向。
 * 手上拿着的道具（IK）和放在台面上的道具共用同一种描述，拿起/放下时位置朝向完全衔接。
 */
export function toolQuat(dir, side, out = new THREE.Quaternion()) {
  const y = dir.clone().normalize().negate();
  const x = (side ? side.clone() : V(1, 0, 0));
  x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-6) { x.set(0, 0, 1).addScaledVector(y, -y.z); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); }
  x.normalize();
  const z = V(0, 0, 0).crossVectors(x, y).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function buildTool(type, M) {
  const g = new THREE.Group();
  g.name = 'tool:' + type;
  const add = (geo, mat, pos = V(0, 0, 0), rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos); m.rotation.set(...rot); m.castShadow = true;
    g.add(m);
    return m;
  };
  const handle = (color = '#ff9ec4', len = 0.12) => add(new THREE.CapsuleGeometry(0.022, len, 4, 10), M.soft(color, { rough: 0.5, rim: 0.3 }), V(0, -len / 2, 0));
  switch (type) {
    case 'knife': { // 圆头玩具小刀：粉色握把 + 淡蓝圆润刀身
      handle('#ff8fb8', 0.1);
      const s = new THREE.Shape();
      s.moveTo(0, 0); s.lineTo(0.05, 0); s.quadraticCurveTo(0.075, -0.14, 0.035, -0.2); s.quadraticCurveTo(0.0, -0.215, -0.012, -0.18); s.lineTo(0, 0);
      // 胖乎乎的玩具刀身（够厚，正面看过去也认得出来）
      const blade = new THREE.ExtrudeGeometry(s, { depth: 0.024, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 3, curveSegments: 10 });
      blade.translate(-0.02, -0.12, -0.012);
      add(blade, M.soft('#a9d8ff', { rough: 0.25, rim: 0.7, rimColor: '#ffffff' }));
      g.userData.tip = V(0.012, -0.33, 0); // 刀刃最下面（落到砧板上的那一点）
      break;
    }
    case 'whisk': { // 打蛋器
      handle('#ffd166', 0.11);
      const wire = M.soft('#e8eef7', { rough: 0.25, rim: 0.5 });
      for (let i = 0; i < 4; i++) {
        const loop = new THREE.TorusGeometry(0.05, 0.004, 5, 20, Math.PI);
        loop.scale(1, 2.0, 1);
        add(loop, wire, V(0, -0.13, 0), [0, (i / 4) * Math.PI, Math.PI]);
      }
      g.userData.tip = V(0, -0.24, 0);
      break;
    }
    case 'spatula': { // 锅铲：铲面和把手成 45°——把手斜着朝下前方时，铲面正好是平的，可以铲到松饼底下
      handle('#7fd6ff', 0.12);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), M.soft('#fff4e6', { rough: 0.4 }), V(0, -0.165, 0));
      const blade = roundedBox(0.11, 0.01, 0.12, 0.005, 2);
      add(blade, M.soft('#fff4e6', { rough: 0.4, rim: 0.4 }), V(0, -0.2025, 0.042), [Math.PI / 4, 0, 0]);
      g.userData.tip = V(0, -0.245, 0.085); // 铲面前缘
      g.userData.blade = V(0, -0.2025, 0.042); // 铲面中心
      break;
    }
    case 'broom': { // 小扫帚：握在把手上端，刷头（扁扁的一排软毛）在最下面贴着地面
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.56, 8).translate(0, -0.22, 0), M.soft('#e8b07a', { rough: 0.6 }));
      add(new THREE.SphereGeometry(0.024, 10, 8), M.soft('#ff7fae', { rough: 0.5 }), V(0, 0.07, 0));
      add(roundedBox(0.05, 0.04, 0.05, 0.015, 2), M.soft('#ff7fae', { rough: 0.5, rim: 0.3 }), V(0, -0.5, 0));
      // 刷毛：底部扁平、略呈扇形
      const bristle = new THREE.CylinderGeometry(0.035, 0.07, 0.11, 16, 1); bristle.scale(1, 1, 0.45);
      add(bristle, M.soft('#ffd98a', { rough: 0.95, rim: 0.2 }), V(0, -0.575, 0));
      g.userData.tip = V(0, -0.63, 0);
      break;
    }
    case 'cloth': { // 软软的小抹布 / 拖把头
      add(roundedBox(0.12, 0.05, 0.1, 0.024, 3), M.soft('#9fd8ff', { rough: 0.95, rim: 0.3 }), V(0, -0.05, 0.02));
      add(roundedBox(0.122, 0.012, 0.102, 0.006, 2), M.soft('#ffffff', { rough: 0.95 }), V(0, -0.03, 0.02));
      g.userData.tip = V(0, -0.08, 0.02);
      break;
    }
    case 'sponge': { // 洗碗海绵
      add(roundedBox(0.12, 0.06, 0.08, 0.02, 3), M.soft('#ffe066', { rough: 0.95, rim: 0.25 }), V(0, -0.05, 0.02));
      add(roundedBox(0.122, 0.02, 0.082, 0.008, 2), M.soft('#7fdc8a', { rough: 0.95 }), V(0, -0.088, 0.02));
      g.userData.tip = V(0, -0.1, 0.02);
      break;
    }
    case 'piping': { // 裱花袋
      const bag = new THREE.ConeGeometry(0.06, 0.2, 18, 1, true);
      bag.rotateX(Math.PI);
      add(bag, M.soft('#ffffff', { rough: 0.5, rim: 0.4, side: THREE.DoubleSide }), V(0, -0.08, 0));
      add(new THREE.ConeGeometry(0.018, 0.045, 8), M.soft('#ffb3d1', { rough: 0.35 }), V(0, -0.2, 0), [Math.PI, 0, 0]);
      add(new THREE.SphereGeometry(0.058, 14, 8, 0, TAU, 0, Math.PI / 2), M.soft('#ffd6e8', { rough: 0.7 }), V(0, 0.02, 0));
      g.userData.tip = V(0, -0.23, 0);
      break;
    }
    case 'egg': { // 鸡蛋
      const e = new THREE.SphereGeometry(0.05, 16, 12); e.scale(0.85, 1.1, 0.85);
      add(e, M.soft('#fff3e0', { rough: 0.55, rim: 0.3 }), V(0, -0.05, 0.03));
      g.userData.tip = V(0, -0.1, 0.03);
      break;
    }
    case 'jug': { // 装面糊的小量杯：杯口朝上（局部 +y），握把在杯子后面，杯嘴朝前（局部 +z）
      const glass = M.soft('#c9e8ff', { rough: 0.2, rim: 0.6, side: THREE.DoubleSide });
      add(new THREE.CylinderGeometry(0.062, 0.052, 0.13, 20, 1, true), glass, V(0, -0.02, 0.075));
      add(new THREE.CircleGeometry(0.052, 20).rotateX(-Math.PI / 2), glass, V(0, -0.085, 0.075));
      g.userData.batter = add(new THREE.CircleGeometry(0.058, 20).rotateX(-Math.PI / 2), M.soft('#ffe2a6', { rough: 0.35 }), V(0, 0.02, 0.075));
      add(new THREE.ConeGeometry(0.022, 0.04, 10, 1, true).rotateX(Math.PI / 2), glass, V(0, 0.04, 0.142));
      add(new THREE.TorusGeometry(0.035, 0.011, 8, 14, Math.PI), M.soft('#9fd0f5', { rough: 0.3 }), V(0, -0.02, 0.008), [0, Math.PI / 2, Math.PI / 2]);
      g.userData.tip = V(0, 0.045, 0.15); // 杯嘴
      break;
    }
    case 'balloon': { // 三个气球（飘飘）
      const cols = ['#ff8fb3', '#7fd6ff', '#ffd166'];
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.42;
        // 整串气球往身体外侧偏一点：绳子从小手往上、往外散开，不会贴着身体侧面穿过去
        const top = V(Math.sin(a) * 0.32 + 0.22, 0.78 + (i === 1 ? 0.12 : 0), Math.cos(a) * 0.05);
        const b = new THREE.SphereGeometry(0.17, 20, 16); b.scale(1, 1.15, 1);
        add(b, M.soft(cols[i], { rough: 0.25, rim: 0.7, rimColor: '#ffffff' }), top);
        add(new THREE.ConeGeometry(0.03, 0.04, 8), M.soft(cols[i], { rough: 0.3 }), top.clone().add(V(0, -0.2, 0)), [Math.PI, 0, 0]);
        const len = top.length();
        const str = new THREE.CylinderGeometry(0.003, 0.003, len, 4);
        str.translate(0, len / 2, 0);
        const m = add(str, M.soft('#ffffff', { rough: 0.8 }));
        m.quaternion.setFromUnitVectors(V(0, 1, 0), top.clone().normalize());
      }
      g.userData.up = true; // 往上举着
      break;
    }
    case 'umbrella': { // 小雨伞（伞面朝上）
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6), M.soft('#ffffff', { rough: 0.5 }), V(0, 0.3, 0));
      const canopy = new THREE.SphereGeometry(0.36, 24, 8, 0, TAU, 0, Math.PI * 0.42);
      add(canopy, M.soft('#ff8fb3', { rough: 0.45, rim: 0.5, side: THREE.DoubleSide, map: null }), V(0, 0.48, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; add(new THREE.SphereGeometry(0.02, 8, 6), M.soft('#ffffff'), V(Math.cos(a) * 0.33, 0.55, Math.sin(a) * 0.33)); }
      add(new THREE.SphereGeometry(0.025, 8, 6), M.soft('#ffd166'), V(0, 0.84, 0));
      add(new THREE.TorusGeometry(0.03, 0.008, 6, 12, Math.PI), M.soft('#ffffff'), V(0.03, 0.0, 0), [0, 0, Math.PI]);
      g.userData.up = true;
      break;
    }
    case 'mop': { // 小拖把：握在把手上端，软软的拖把头在最下面贴着地面
      add(new THREE.CylinderGeometry(0.013, 0.013, 0.54, 8).translate(0, -0.21, 0), M.soft('#7fd6ff', { rough: 0.5 }));
      add(new THREE.SphereGeometry(0.022, 10, 8), M.soft('#ff7fae', { rough: 0.5 }), V(0, 0.07, 0));
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), M.soft('#7fd6ff', { rough: 0.5 }), V(0, -0.49, 0));
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU;
        add(new THREE.CapsuleGeometry(0.015, 0.075, 3, 6), M.soft('#ffffff', { rough: 0.95 }), V(Math.cos(a) * 0.04, -0.55, Math.sin(a) * 0.04), [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55]);
      }
      g.userData.tip = V(0, -0.6, 0);
      break;
    }
    default:
      return null;
  }
  const AIM = { knife: 0, whisk: 0.1, piping: 0.15, spatula: 0.65, broom: 0.55, mop: 0.5, jug: 0.9, egg: 0.2, cloth: 0.3, sponge: 0.3 };
  if (AIM[type] != null) g.userData.aim = AIM[type];
  if (type === 'knife') g.userData.scale = 1.15;
  return g;
}
