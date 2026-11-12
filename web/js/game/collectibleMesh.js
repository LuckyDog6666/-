// 盲盒手办的 3D 模型（和图鉴的纯逻辑分开放：collection.js 不依赖 three.js，自检脚本可以直接测）
import * as THREE from 'three';
import { buildProp } from '../world/props.js';

// 手办模型：把场景摆件缩成约 size 米高的小摆件，原点在底部中心。用完调用 userData.dispose()
export function collectibleMesh(item, rng, size = 0.46) {
  const { parts } = buildProp(item.prop, rng);
  const inner = new THREE.Group();
  const trash = [];
  for (const pt of parts) {
    const mat = pt.mat === 'vc' ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 })
      : pt.mat === 'glow' ? new THREE.MeshBasicMaterial({ color: pt.color })
        : new THREE.MeshStandardMaterial({ color: pt.color, transparent: true, opacity: 0.72, roughness: 0.15 });
    const m = new THREE.Mesh(pt.geo, mat);
    if (pt.pos) m.position.copy(pt.pos);
    m.castShadow = true;
    inner.add(m);
    trash.push(pt.geo, mat);
  }
  const box = new THREE.Box3().setFromObject(inner);
  const sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = size / Math.max(0.001, sz.x, sz.y, sz.z);
  inner.scale.setScalar(k);
  inner.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const root = new THREE.Group();
  root.add(inner);
  root.userData.height = sz.y * k;
  root.userData.dispose = () => { for (const d of trash) d.dispose(); };
  return root;
}
