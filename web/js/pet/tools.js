// 糯糯拿在小手里的道具（全部程序化建模，圆润可爱、玩具一样的配色）。
// 原点在"握把"处，道具沿局部 -y 方向伸出（和小手臂下垂的方向一致）。
import * as THREE from 'three';
import { roundedBox } from '../world/geo.js';
import { TAU } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

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
      const blade = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 10 });
      blade.translate(-0.02, -0.12, -0.006);
      add(blade, M.soft('#dbe9ff', { rough: 0.22, rim: 0.6, rimColor: '#ffffff' }));
      g.userData.tip = V(0.01, -0.3, 0);
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
    case 'spatula': { // 锅铲
      handle('#7fd6ff', 0.12);
      add(roundedBox(0.1, 0.012, 0.12, 0.006, 2).translate(0, 0, 0), M.soft('#fff4e6', { rough: 0.4, rim: 0.4 }), V(0, -0.2, 0.03), [0.25, 0, 0]);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), M.soft('#fff4e6', { rough: 0.4 }), V(0, -0.15, 0.01), [0.25, 0, 0]);
      g.userData.tip = V(0, -0.22, 0.05);
      break;
    }
    case 'broom': { // 小扫帚：握在中间，上面露出一截把手，刷头正好贴着地面
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.66, 8), M.soft('#e8b07a', { rough: 0.6 }), V(0, 0.1, 0));
      add(new THREE.CylinderGeometry(0.03, 0.08, 0.14, 12), M.soft('#ffd98a', { rough: 0.9, rim: 0.2 }), V(0, -0.27, 0));
      add(new THREE.TorusGeometry(0.032, 0.008, 6, 14), M.soft('#ff7fae', { rough: 0.5 }), V(0, -0.2, 0), [Math.PI / 2, 0, 0]);
      add(new THREE.SphereGeometry(0.022, 8, 6), M.soft('#ff7fae', { rough: 0.5 }), V(0, 0.44, 0));
      g.userData.tip = V(0, -0.34, 0);
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
    case 'jug': { // 装面糊的小量杯
      const cup = new THREE.CylinderGeometry(0.06, 0.05, 0.12, 18, 1, true);
      add(cup, M.soft('#c9e8ff', { rough: 0.25, rim: 0.6, side: THREE.DoubleSide }), V(0, -0.1, 0.05));
      add(new THREE.CircleGeometry(0.055, 18).rotateX(-Math.PI / 2), M.soft('#ffe8b8', { rough: 0.5 }), V(0, -0.07, 0.05));
      add(new THREE.TorusGeometry(0.035, 0.01, 6, 12, Math.PI), M.soft('#c9e8ff', { rough: 0.3 }), V(0, -0.1, -0.01), [0, Math.PI / 2, Math.PI / 2]);
      g.userData.tip = V(0, -0.04, 0.1);
      break;
    }
    case 'balloon': { // 三个气球（飘飘）
      const cols = ['#ff8fb3', '#7fd6ff', '#ffd166'];
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.42;
        const top = V(Math.sin(a) * 0.32, 0.78 + (i === 1 ? 0.12 : 0), Math.cos(a) * 0.05);
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
    case 'mop': { // 小拖把：握在中间，拖把头正好贴着地面
      add(new THREE.CylinderGeometry(0.013, 0.013, 0.62, 8), M.soft('#7fd6ff', { rough: 0.5 }), V(0, 0.08, 0));
      add(new THREE.SphereGeometry(0.02, 8, 6), M.soft('#ff7fae', { rough: 0.5 }), V(0, 0.4, 0));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        add(new THREE.CapsuleGeometry(0.014, 0.07, 3, 6), M.soft('#ffffff', { rough: 0.95 }), V(Math.cos(a) * 0.035, -0.28, Math.sin(a) * 0.035), [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4]);
      }
      g.userData.tip = V(0, -0.33, 0);
      break;
    }
    default:
      return null;
  }
  const AIM = { knife: 0, whisk: 0.1, piping: 0.15, spatula: 0.65, broom: 0.55, mop: 0.5, jug: 0.9, egg: 0.2, cloth: 0.3, sponge: 0.3 };
  if (AIM[type] != null) g.userData.aim = AIM[type];
  if (type === 'knife') g.userData.scale = 1.35;
  if (type === 'broom' || type === 'mop') g.userData.scale = 1.1;
  return g;
}
