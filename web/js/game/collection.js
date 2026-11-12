// 盲盒图鉴：糯糯开盲盒开出来的小摆件。
//
// 盲盒是成年观众很熟悉、很上头的玩法（"这次能开出什么？""就差一个就集齐了"），而且完全不花钱：
// 应援条攒满、闯关路上遇到、挑战成功都会开一个。稀有度看运气，也看直播间的热度——大家点赞越多，越容易出稀有款。
//  - 7 个系列 × 5 个 = 35 款；普通 / 稀有 / 史诗 / 传说
//  - 集齐一个系列：全屏庆祝；35 款全部集齐：开启下一轮图鉴
//  - 进度存在浏览器里（刷新页面、重启程序都不丢）
import * as THREE from 'three';
import { buildProp } from '../world/props.js';

export const RARITY = {
  n: { name: '普通', cls: '', color: '#8fb8ff', w: 58 },
  r: { name: '稀有', cls: 'r', color: '#b48cff', w: 30 },
  sr: { name: '史诗', cls: 'sr', color: '#ffae3c', w: 10 },
  ssr: { name: '传说', cls: 'ssr', color: '#ffe066', w: 2 },
};

// prop：world/props.js 里的摆件造型（缩成手办大小）
export const CATALOG = [
  { id: 'cake', name: '草莓小蛋糕', set: '甜品', r: 'n', prop: 'cake' },
  { id: 'cupcake', name: '纸杯蛋糕', set: '甜品', r: 'n', prop: 'cupcake' },
  { id: 'donut', name: '甜甜圈', set: '甜品', r: 'r', prop: 'big_donut' },
  { id: 'lollipop', name: '波板糖', set: '甜品', r: 'r', prop: 'lollipop' },
  { id: 'icecream', name: '三球冰淇淋', set: '甜品', r: 'sr', prop: 'ice_cream' },

  { id: 'ball', name: '小皮球', set: '玩具', r: 'n', prop: 'toy_ball' },
  { id: 'blocks', name: '积木塔', set: '玩具', r: 'n', prop: 'block_stack' },
  { id: 'duck', name: '小黄鸭', set: '玩具', r: 'r', prop: 'rubber_duck' },
  { id: 'bunny', name: '兔兔玩偶', set: '玩具', r: 'r', prop: 'plush' },
  { id: 'teddy', name: '泰迪熊', set: '玩具', r: 'sr', prop: 'teddy' },

  { id: 'shell', name: '大贝壳', set: '海边', r: 'n', prop: 'big_shell' },
  { id: 'beachball', name: '沙滩球', set: '海边', r: 'n', prop: 'beach_ball' },
  { id: 'coral', name: '小珊瑚', set: '海边', r: 'r', prop: 'coral' },
  { id: 'parasol', name: '遮阳伞', set: '海边', r: 'r', prop: 'beach_umbrella' },
  { id: 'castle', name: '沙堡', set: '海边', r: 'sr', prop: 'sand_castle' },

  { id: 'flowers', name: '小花丛', set: '森林', r: 'n', prop: 'flowers' },
  { id: 'stump', name: '小树桩', set: '森林', r: 'n', prop: 'stump' },
  { id: 'mushroom', name: '大蘑菇', set: '森林', r: 'r', prop: 'big_mushroom' },
  { id: 'maple', name: '小枫树', set: '森林', r: 'r', prop: 'tree_autumn' },
  { id: 'glowshroom', name: '夜光蘑菇', set: '森林', r: 'sr', prop: 'glow_mushroom_big' },

  { id: 'pine', name: '小雪松', set: '冬日', r: 'n', prop: 'pine_snow' },
  { id: 'icecrystal', name: '冰糖冰晶', set: '冬日', r: 'n', prop: 'ice_crystal' },
  { id: 'snowman', name: '小雪人', set: '冬日', r: 'r', prop: 'snowman' },
  { id: 'igloo', name: '小雪屋', set: '冬日', r: 'r', prop: 'igloo' },
  { id: 'crystal', name: '水晶簇', set: '冬日', r: 'sr', prop: 'crystal_cluster' },

  { id: 'cookies', name: '曲奇塔', set: '厨房', r: 'n', prop: 'cookie_stack' },
  { id: 'fruit', name: '水果碗', set: '厨房', r: 'n', prop: 'fruit_bowl' },
  { id: 'teapot', name: '小茶壶', set: '厨房', r: 'r', prop: 'teapot' },
  { id: 'toaster', name: '吐司机', set: '厨房', r: 'r', prop: 'toaster' },
  { id: 'mixer', name: '搅拌机', set: '厨房', r: 'sr', prop: 'mixer' },

  { id: 'star', name: '许愿星', set: '传说', r: 'ssr', prop: 'star_big' },
  { id: 'moon', name: '小月亮', set: '传说', r: 'ssr', prop: 'moon' },
  { id: 'rainbow', name: '彩虹桥', set: '传说', r: 'ssr', prop: 'rainbow_arch' },
  { id: 'gems', name: '宝石堆', set: '传说', r: 'ssr', prop: 'gem_pile' },
  { id: 'candycastle', name: '糖果城堡', set: '传说', r: 'ssr', prop: 'candy_castle' },
];
export const SETS = [...new Set(CATALOG.map((c) => c.set))];
const KEY = 'nuonuo.collection.v1';

export class Collection {
  constructor(rng) {
    this.rng = rng;
    this.round = 1;
    this.owned = {};   // id → 开到过几次
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.owned && typeof d.owned === 'object') { this.round = Math.max(1, Number(d.round) || 1); for (const c of CATALOG) if (d.owned[c.id] > 0) this.owned[c.id] = Number(d.owned[c.id]) || 1; }
    } catch {}
  }
  get count() { return Object.keys(this.owned).length; }
  get total() { return CATALOG.length; }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ round: this.round, owned: this.owned })); } catch {} }

  // 开一个盲盒。boost 0..1：直播间越热、越容易出稀有款；minRarity：保底（挑战成功至少稀有）
  draw(boost = 0, minRarity = 'n') {
    const b = Math.max(0, Math.min(1, boost));
    const w = { n: RARITY.n.w - 30 * b, r: RARITY.r.w + 12 * b, sr: RARITY.sr.w + 11 * b, ssr: RARITY.ssr.w + 7 * b };
    const order = ['n', 'r', 'sr', 'ssr'];
    for (const k of order.slice(0, order.indexOf(minRarity))) w[k] = 0;
    let x = this.rng.next() * order.reduce((s, k) => s + w[k], 0), rar = order[order.length - 1];
    for (const k of order) { x -= w[k]; if (x <= 0) { rar = k; break; } }
    const pool = CATALOG.filter((c) => c.r === rar);
    const fresh = pool.filter((c) => !this.owned[c.id]);
    // 还没开到过的款有四分之三的机会优先出：图鉴看得到一点点被填满
    const item = fresh.length && this.rng.next() < 0.75 ? this.rng.pick(fresh) : this.rng.pick(pool);
    const isNew = !this.owned[item.id];
    this.owned[item.id] = (this.owned[item.id] || 0) + 1;
    const setDone = isNew && CATALOG.filter((c) => c.set === item.set).every((c) => this.owned[c.id]);
    const allDone = isNew && this.count >= CATALOG.length;
    const res = { item, rarity: RARITY[item.r], isNew, times: this.owned[item.id], setDone, allDone, count: this.count, total: CATALOG.length, round: this.round };
    if (allDone) { this.round++; this.owned = {}; } // 全部集齐：开启下一轮
    this.save();
    return res;
  }
}

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
