// 关卡程序化生成（纯数据，不依赖 three.js，可在 Node 中单元测试）。
// 每一关都是独一无二的蜿蜒小路：主路 + 支路（藏着星星和钥匙）+ 需要跳过的小河 + 锁着的小门 + 终点传送门。

import { Rng } from '../core/util.js';
import { ITEM_META } from './itemMeta.js';

export const CELL = 1.3; // 每格世界尺寸

const key = (x, z) => `${x},${z}`;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * @param {object} theme 主题
 * @param {object} o { seed, length:[min,max], zMax, branches:[min,max], gaps:[min,max] }
 */
export function generateLevel(theme, o = {}) {
  const seed = o.seed ?? Math.floor(Math.random() * 1e9);
  const rng = new Rng(seed);
  for (let attempt = 0; attempt < 40; attempt++) {
    const lvl = tryGenerate(theme, rng, o, seed);
    if (lvl && validateLevel(lvl).ok) return lvl;
  }
  // 理论上不会走到这里；兜底生成一条无机关的直路
  return tryGenerate(theme, rng, { ...o, gaps: [0, 0], branches: [0, 0], noGate: true }, seed);
}

function tryGenerate(theme, rng, o, seed) {
  const [lmin, lmax] = o.length || [34, 46];
  const L = rng.int(lmin, lmax);
  const zMax = o.zMax ?? 3;
  const occupied = new Map(); // key -> cell
  const main = [];
  let x = 0, z = 0;
  const add = (cx, cz, kind) => {
    const c = { id: occupied.size, gx: cx, gz: cz, kind, surface: null, item: null };
    occupied.set(key(cx, cz), c);
    return c;
  };
  main.push(add(0, 0, 'main'));
  let dir = [1, 0];
  let run = rng.int(2, 4);
  let guard = 0;
  while (main.length < L && guard++ < 2000) {
    if (run <= 0) {
      // 转弯：主方向 +X，侧向 ±Z
      if (dir[0] === 1) {
        const opts = [];
        if (z < zMax) opts.push([0, 1]);
        if (z > -zMax) opts.push([0, -1]);
        dir = opts.length && rng.chance(0.75) ? rng.pick(opts) : [1, 0];
        run = dir[0] === 1 ? rng.int(2, 5) : rng.int(1, 3);
      } else {
        dir = [1, 0];
        run = rng.int(2, 5);
      }
    }
    const nx = x + dir[0], nz = z + dir[1];
    if (Math.abs(nz) > zMax || !freeFor(occupied, nx, nz, x, z)) { run = 0; if (dir[0] === 1) return null; continue; }
    x = nx; z = nz;
    main.push(add(x, z, 'main'));
    run--;
  }
  if (main.length < L) return null;
  main.forEach((c, i) => { c.idx = i; });
  main[0].start = true;
  main[main.length - 1].goal = true;

  // ---- 小河（需要跳过去的缺口） ----
  const gaps = [];
  const [gmin, gmax] = o.gaps || [1, 3];
  const gapCount = rng.int(gmin, gmax);
  const isStraightX = (i, span) => {
    for (let k = i - 1; k <= i + span; k++) {
      if (!main[k] || !main[k + 1]) return false;
      if (main[k + 1].gx - main[k].gx !== 1 || main[k + 1].gz !== main[k].gz) return false;
    }
    return true;
  };
  const used = new Set();
  for (let g = 0; g < gapCount; g++) {
    for (let tries = 0; tries < 30; tries++) {
      const span = rng.chance(0.35) ? 2 : 1;
      const i = rng.int(5, main.length - 6 - span);
      if (!isStraightX(i, span)) continue;
      let ok = true;
      for (let k = i - 3; k <= i + span + 2; k++) if (used.has(k)) ok = false;
      if (!ok) continue;
      for (let k = i; k < i + span; k++) { main[k].gap = true; used.add(k); }
      used.add(i - 1); used.add(i + span);
      if (span === 2) main[i - 1].spring = true;
      gaps.push({ from: main[i - 1].id, to: main[i + span].id, span, cells: main.slice(i, i + span).map((c) => c.id) });
      break;
    }
  }

  // ---- 支路 ----
  const branches = [];
  const [bmin, bmax] = o.branches || [2, 4];
  const bCount = rng.int(bmin, bmax);
  for (let b = 0; b < bCount; b++) {
    for (let tries = 0; tries < 40; tries++) {
      const root = main[rng.int(3, main.length - 4)];
      if (root.gap || root.spring || used.has(root.idx)) continue;
      const free = DIRS.filter(([dx, dz]) => {
        const nx = root.gx + dx, nz = root.gz + dz;
        return Math.abs(nz) <= zMax + 1 && freeFor(occupied, nx, nz, root.gx, root.gz) && dx !== 1;
      });
      if (!free.length) continue;
      const [dx, dz] = rng.pick(free);
      const len = rng.int(2, 4);
      const cells = [];
      let cx = root.gx, cz = root.gz;
      for (let k = 0; k < len; k++) {
        const nx = cx + dx, nz = cz + dz;
        if (Math.abs(nz) > zMax + 1 || !freeFor(occupied, nx, nz, cx, cz)) break;
        cx = nx; cz = nz;
        const c = add(cx, cz, 'branch');
        c.branch = branches.length;
        cells.push(c);
      }
      if (cells.length >= 2) {
        branches.push({ root: root.id, rootIdx: root.idx, cells: cells.map((c) => c.id) });
        break;
      }
      // 太短：撤销
      for (const c of cells) occupied.delete(key(c.gx, c.gz));
    }
  }

  const all = [...occupied.values()].sort((a, b) => a.id - b.id);
  // 重新编号（撤销支路可能造成空洞）
  const remap = new Map();
  all.forEach((c, i) => { remap.set(c.id, i); });
  all.forEach((c) => { c.id = remap.get(c.id); });
  for (const g of gaps) { g.from = remap.get(g.from); g.to = remap.get(g.to); g.cells = g.cells.map((id) => remap.get(id)); }
  for (const br of branches) { br.root = remap.get(br.root); br.cells = br.cells.map((id) => remap.get(id)); }

  // ---- 小门与钥匙 ----
  let gateId = null, keyId = null;
  if (!o.noGate && branches.length) {
    const gi = Math.floor(main.length * rng.range(0.6, 0.75));
    for (let d = 0; d < 8; d++) {
      const cand = main[gi + d];
      if (!cand || cand.gap || cand.spring || cand.goal || used.has(cand.idx)) continue;
      const keyBranch = branches.filter((br) => br.rootIdx < cand.idx - 2);
      if (!keyBranch.length) break;
      const br = rng.pick(keyBranch);
      const kc = all[br.cells[br.cells.length - 1]];
      kc.key = true; keyId = kc.id;
      cand.gate = true; gateId = cand.id;
      break;
    }
  }

  // ---- 星星（每关 3 颗） ----
  const starCands = [];
  for (const br of branches) { const end = all[br.cells[br.cells.length - 1]]; if (!end.key) starCands.push(end); }
  for (const g of gaps) starCands.push(all[g.to]);
  const mainCands = main.filter((c) => !c.start && !c.goal && !c.gap && !c.gate && !c.spring && c.idx > 3);
  rng.shuffle(starCands);
  const stars = [];
  for (const c of starCands) { if (stars.length >= 3) break; if (!c.star && !c.key) { c.star = true; stars.push(c.id); } }
  while (stars.length < 3 && mainCands.length) {
    const c = mainCands.splice(rng.int(0, mainCands.length - 1), 1)[0];
    if (!c.star && !c.key) { c.star = true; stars.push(c.id); }
  }

  // ---- 路面材质（成片出现，更自然） ----
  let surf = rng.weighted(theme.surfaces);
  for (const c of all.filter((c) => c.kind === 'main')) {
    if (rng.chance(0.22)) surf = rng.weighted(theme.surfaces);
    c.surface = surf.id;
  }
  for (const c of all.filter((c) => c.kind === 'branch')) c.surface = all[branches[c.branch]?.root ?? 0]?.surface || theme.surfaces[0].id;

  // ---- 可踩物件（ASMR 触发点） ----
  const itemDefs = theme.items;
  const blocked = (c) => c.start || c.goal || c.gap || c.gate || c.spring || c.key;
  // 保证每种物件至少出现一次，其余按权重
  const pool = all.filter((c) => !blocked(c));
  const want = Math.round(pool.length * 0.62);
  const order = rng.shuffle(pool.slice());
  const guaranteed = rng.shuffle(itemDefs.map((d) => d.type));
  let placed = 0;
  for (const c of order) {
    if (placed >= want) break;
    // 避免相邻格子是同一种物件
    const neighborTypes = DIRS.map(([dx, dz]) => occupied.get(key(c.gx + dx, c.gz + dz))).filter(Boolean).map((n) => n.item);
    let type = guaranteed.length ? guaranteed.pop() : rng.weighted(itemDefs).type;
    for (let k = 0; k < 4 && neighborTypes.includes(type); k++) type = rng.weighted(itemDefs).type;
    c.item = type;
    placed++;
  }
  // 旋律类物件连成一串，按五声音阶写一小段旋律
  const melodic = itemDefs.filter((d) => ITEM_META[d.type]?.note).map((d) => d.type);
  if (melodic.length) {
    const runCount = rng.int(1, 2);
    for (let r = 0; r < runCount; r++) {
      const type = rng.pick(melodic);
      const len = rng.int(4, 6);
      const startIdx = rng.int(4, Math.max(5, main.length - len - 4));
      const seq = main.slice(startIdx, startIdx + len);
      if (seq.some((c) => blocked(c) || c.star)) continue;
      const contour = rng.pick([[0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0], [0, 2, 1, 3, 2, 4], [2, 3, 4, 5, 4, 3], [0, 1, 2, 4, 3, 5]]);
      const base = rng.int(0, 3);
      seq.forEach((c, k) => { c.item = type; c.note = base + contour[k % contour.length]; });
    }
  }
  for (const c of all) if (c.item && ITEM_META[c.item]?.note && c.note == null) c.note = rng.int(0, 7);

  // ---- 装饰物 ----
  const props = [];
  const near = new Map();
  for (const c of all) {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const k = key(c.gx + dx, c.gz + dz);
      if (occupied.has(k)) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (!near.has(k) || near.get(k).d > d) near.set(k, { gx: c.gx + dx, gz: c.gz + dz, d });
    }
  }
  const gapCells = new Set(gaps.flatMap((g) => g.cells));
  const pathKeys = new Set(all.map((c) => key(c.gx, c.gz)));
  // 镜头在小路的 +Z 一侧往下看：小路"前方"(靠近镜头) 2 格内不放高大的装饰，避免挡住糯糯
  const frontOfPath = (gx, gz) => {
    for (let dz = 1; dz <= 2; dz++) for (let dx = -1; dx <= 1; dx++) if (pathKeys.has(key(gx + dx, gz - dz))) return dz;
    return 0;
  };
  for (const n of near.values()) {
    // 小河两侧留出水道
    const gapLane = gaps.some((g) => g.cells.some((id) => all[id].gx === n.gx));
    if (gapLane && n.d <= 3) continue;
    const front = frontOfPath(n.gx, n.gz);
    if (front === 1) continue;
    const p = n.d === 1 ? 0.18 : n.d === 2 ? 0.32 : n.d === 3 ? 0.3 : 0.18;
    if (!rng.chance(p)) continue;
    const big = n.d >= 2 && front === 0;
    props.push({
      type: rng.pick(theme.props),
      x: (n.gx + rng.range(-0.3, 0.3)) * CELL,
      z: (n.gz + rng.range(-0.3, 0.3)) * CELL,
      s: (big ? rng.range(0.9, 1.4) : front ? rng.range(0.35, 0.5) : rng.range(0.45, 0.7)),
      rot: rng.range(0, Math.PI * 2),
      d: n.d,
    });
  }

  return {
    seed, theme: theme.id, cells: all, main: main.map((c) => c.id), gaps, branches,
    gateId, keyId, stars, props, gapCells: [...gapCells],
    bounds: bounds(all),
  };
}

// 新格子不能贴着别的路（除了来源格），保证小路清晰不打结
function freeFor(occ, x, z, fromX, fromZ) {
  if (occ.has(key(x, z))) return false;
  for (const [dx, dz] of DIRS) {
    const nx = x + dx, nz = z + dz;
    if (nx === fromX && nz === fromZ) continue;
    if (occ.has(key(nx, nz))) return false;
  }
  return true;
}

function bounds(cells) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of cells) { x0 = Math.min(x0, c.gx); x1 = Math.max(x1, c.gx); z0 = Math.min(z0, c.gz); z1 = Math.max(z1, c.gz); }
  return { x0, x1, z0, z1 };
}

// ---------------- 图与寻路 ----------------
export function buildGraph(level) {
  const byKey = new Map(level.cells.map((c) => [key(c.gx, c.gz), c]));
  const adj = level.cells.map(() => []);
  for (const c of level.cells) {
    if (c.gap) continue;
    for (const [dx, dz] of DIRS) {
      const n = byKey.get(key(c.gx + dx, c.gz + dz));
      if (n && !n.gap) adj[c.id].push({ to: n.id, cost: 1, jump: 0 });
    }
  }
  for (const g of level.gaps) {
    adj[g.from].push({ to: g.to, cost: 2, jump: g.span });
    adj[g.to].push({ to: g.from, cost: 2, jump: g.span });
  }
  return { adj, byKey };
}

/** Dijkstra（格子数很少，足够快）。blocked(id) 返回 true 的格子不可通行 */
export function findPath(graph, from, to, blocked = () => false) {
  if (from === to) return [from];
  const n = graph.adj.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (u === to) break;
    done[u] = 1;
    for (const e of graph.adj[u]) {
      if (done[e.to] || (blocked(e.to) && e.to !== to)) continue;
      const nd = dist[u] + e.cost;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
    }
  }
  const path = [];
  for (let v = to; v !== -1; v = prev[v]) path.unshift(v);
  return path[0] === from ? path : null;
}

export function edgeBetween(graph, a, b) { return graph.adj[a].find((e) => e.to === b) || null; }

/** 关卡可解性校验：钥匙、全部星星、终点均可达，门在拿到钥匙前确实挡路 */
export function validateLevel(level) {
  const g = buildGraph(level);
  const start = level.main[0];
  const goal = level.main[level.main.length - 1];
  const gate = level.gateId;
  const blockedNoKey = (id) => id === gate;
  const problems = [];
  if (level.keyId != null && !findPath(g, start, level.keyId, blockedNoKey)) problems.push('钥匙不可达');
  for (const s of level.stars) if (!findPath(g, start, s)) problems.push('星星不可达 ' + s);
  if (!findPath(g, start, goal)) problems.push('终点不可达');
  if (gate != null && findPath(g, start, goal, blockedNoKey)) problems.push('小门没有挡住去路');
  if (level.stars.length !== 3) problems.push('星星数量 ' + level.stars.length);
  return { ok: problems.length === 0, problems };
}

export function cellPos(c) { return { x: c.gx * CELL, z: c.gz * CELL }; }
