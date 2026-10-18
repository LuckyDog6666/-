// 糯糯的"小脑袋"：不需要大模型的自主闯关 AI。
// 采用"目标规划 + 效用打分 + 情绪状态"的经典游戏 AI 做法：
//   1. 规划：沿主路前进，经过支路口时判断要不要进去（星星/钥匙必去，好玩的物件看心情）
//   2. 效用：对"重复踩喜欢的东西 / 停下来张望 / 坐下休息 / 继续赶路"等行为打分，按分数随机选择
//   3. 情绪：精力、好奇心、开心值随时间变化，影响步伐快慢和行为偏好
//   4. 记忆：记住最近听过的声音，偏爱没听过的（让 ASMR 声音尽量多样）
//   5. 兜底：卡住检测、关卡超时自动完成，保证 24 小时无人值守不会停摆
import { buildGraph, findPath, edgeBetween } from '../world/levelGen.js';
import { ITEM_META } from '../world/itemMeta.js';
import { Rng, clamp } from '../core/util.js';

export class Brain {
  constructor(level, rng = new Rng(level.seed + 7), opts = {}) {
    this.level = level;
    this.rng = rng;
    this.graph = buildGraph(level);
    this.opts = Object.assign({ budget: 200 }, opts); // 每关期望时长（秒）
    this.cur = level.main[0];
    this.goal = level.main[level.main.length - 1];
    this.hasKey = false;
    this.gateOpen = level.gateId == null;
    this.stars = new Set(level.stars);
    this.visited = new Set([this.cur]);
    this.recentSounds = [];
    this.mood = { energy: rng.range(0.6, 1), curiosity: rng.range(0.4, 0.9), joy: 0.6 };
    this.hopsSinceIdle = 0;
    this.hopsSinceRepeat = 3;
    this.plan = [];
    this.target = null;
    this.forgotKey = rng.chance(0.22); // 偶尔"忘了"拿钥匙，走到门前才想起来（更有戏剧性）
    this.knowsGateLocked = false;
    this.exploredBranches = new Set();
    this.branchByRoot = new Map();
    for (const br of level.branches) {
      if (!this.branchByRoot.has(br.root)) this.branchByRoot.set(br.root, []);
      this.branchByRoot.get(br.root).push(br);
    }
    this.mainIndex = new Map(level.main.map((id, i) => [id, i]));
    this.elapsed = 0;
  }

  blocked(id) { return id === this.level.gateId && !this.gateOpen; }

  // ---------------- 记忆与情绪 ----------------
  heard(sound) {
    this.recentSounds.push(sound);
    if (this.recentSounds.length > 10) this.recentSounds.shift();
  }
  novelty(sound) {
    const i = this.recentSounds.lastIndexOf(sound);
    return i < 0 ? 1 : 0.15 + 0.85 * (1 - (i + 1) / this.recentSounds.length);
  }
  tick(dt) {
    this.elapsed += dt;
    // 精力慢慢下降，休息会恢复；好奇心随机漂移
    this.mood.energy = clamp(this.mood.energy - dt * 0.0016, 0.15, 1);
    this.mood.curiosity = clamp(this.mood.curiosity + (this.rng.next() - 0.5) * dt * 0.02, 0.2, 1);
    this.mood.joy = clamp(this.mood.joy - dt * 0.002, 0.2, 1);
  }
  rest(amount) { this.mood.energy = clamp(this.mood.energy + amount, 0, 1); }
  cheer(amount) { this.mood.joy = clamp(this.mood.joy + amount, 0, 1); }

  get overBudget() { return this.elapsed > this.opts.budget; }
  get wayOverBudget() { return this.elapsed > this.opts.budget * 1.6; }

  // ---------------- 目标选择 ----------------
  _branchValue(br) {
    const cells = br.cells.map((id) => this.level.cells[id]);
    let v = 0;
    for (const c of cells) {
      if (c.key && !this.hasKey && (!this.forgotKey || this.knowsGateLocked)) v += 100;
      if (c.star && this.stars.has(c.id)) v += this.overBudget ? (this.wayOverBudget ? 0 : 8) : 40;
      if (c.item && !this.visited.has(c.id)) v += 4 * this.mood.curiosity * this.novelty(ITEM_META[c.item]?.sound);
    }
    return v - br.cells.length * (this.overBudget ? 4 : 1.2);
  }

  _chooseTarget() {
    const lv = this.level;
    // 需要钥匙：如果已经知道门锁着（或没有忘记），就去拿
    if (!this.hasKey && lv.keyId != null && (!this.forgotKey || this.knowsGateLocked)) {
      const ki = lv.keyId;
      const br = lv.branches.find((b) => b.cells.includes(ki));
      const rootIdx = br ? this.mainIndex.get(br.root) : 0;
      const curIdx = this._progressIdx();
      // 只有走到钥匙支路附近（或已经知道门锁着）才去拿，路线更自然
      if (this.knowsGateLocked || curIdx >= rootIdx) return { cell: ki, why: 'key' };
    }
    // 经过支路口：值不值得进去看看
    const curIdx = this._progressIdx();
    const atRoot = this.branchByRoot.get(this.cur);
    if (atRoot) {
      for (const br of atRoot) {
        if (this.exploredBranches.has(br)) continue;
        const v = this._branchValue(br);
        this.exploredBranches.add(br);
        if (v > 3 + this.rng.range(0, 6)) return { cell: br.cells[br.cells.length - 1], why: 'branch', branch: br };
      }
    }
    // 主路上下一个还没拿的星星
    for (const sid of this.stars) {
      const c = lv.cells[sid];
      if (c.kind === 'main' && this.mainIndex.get(sid) > curIdx) return { cell: this._nextMainStop(curIdx), why: 'forward' };
    }
    return { cell: this._nextMainStop(curIdx), why: 'forward' };
  }

  // 前方下一个"停靠点"：最近的支路口或终点（让支路决策在路口发生）
  _nextMainStop(curIdx) {
    const main = this.level.main;
    for (let i = curIdx + 1; i < main.length; i++) {
      const id = main[i];
      if (this.branchByRoot.has(id) && this.branchByRoot.get(id).some((br) => !this.exploredBranches.has(br))) return id;
    }
    return this.goal;
  }

  _progressIdx() {
    if (this.mainIndex.has(this.cur)) return this.mainIndex.get(this.cur);
    const br = this.level.branches.find((b) => b.cells.includes(this.cur));
    return br ? this.mainIndex.get(br.root) : 0;
  }

  // ---------------- 每一步的决策 ----------------
  /**
   * 返回下一个动作：
   *  { type:'move', to, edge }       走/跳到相邻格
   *  { type:'repeat', times }        在当前喜欢的物件上多踩几下
   *  { type:'idle', kind, secs }     停下来做点小动作
   *  { type:'gateLocked' }           到了门前但没有钥匙
   *  { type:'openGate' }             用钥匙开门
   *  { type:'finish' }               到达终点
   */
  decide() {
    const lv = this.level;
    if (this.cur === this.goal) return { type: 'finish' };

    // 1) 在喜欢的物件上重复踩（ASMR 的"再来一次"）
    const here = lv.cells[this.cur];
    if (here.item && !this.overBudget) {
      const meta = ITEM_META[here.item];
      const love = meta?.love ?? 0.3;
      const p = love * 0.55 * this.mood.joy * (this.hopsSinceRepeat >= 3 ? 1 : 0.15);
      if (meta && meta.react !== 'multipop' && meta.react !== 'slide' && this.rng.chance(p)) {
        this.hopsSinceRepeat = 0;
        return { type: 'repeat', times: this.rng.int(1, love > 0.65 ? 3 : 2) };
      }
    }

    // 2) 小动作：越久没休息越可能停下
    const idleP = this.overBudget ? 0.02 : clamp((this.hopsSinceIdle - 6) * 0.03, 0, 0.35) * (1.2 - this.mood.energy * 0.4);
    if (this.rng.chance(idleP)) {
      this.hopsSinceIdle = 0;
      const tired = this.mood.energy < 0.4;
      const opts = [
        { kind: 'look', secs: this.rng.range(1.6, 2.6), weight: 3 },
        { kind: 'sniff', secs: this.rng.range(1.2, 2.0), weight: here.item ? 2.5 : 1 },
        { kind: 'wiggle', secs: this.rng.range(1.0, 1.6), weight: 1.5 * this.mood.joy },
        { kind: 'stretch', secs: 1.6, weight: 1 },
        { kind: 'tilt', secs: 1.2, weight: 1 },
        { kind: 'sit', secs: this.rng.range(2.5, 4), weight: tired ? 3 : 0.6 },
        { kind: 'yawn', secs: 1.8, weight: tired ? 2 : 0.2 },
      ];
      const pick = this.rng.weighted(opts);
      if (pick.kind === 'sit' || pick.kind === 'yawn') this.rest(0.35);
      return { type: 'idle', kind: pick.kind, secs: pick.secs };
    }

    // 3) 规划路线
    if (!this.plan.length || this.plan[this.plan.length - 1] !== this.target?.cell || this.plan[0] !== this.cur) {
      this.target = this._chooseTarget();
      const path = findPath(this.graph, this.cur, this.target.cell, (id) => this.blocked(id));
      if (!path) {
        // 被门挡住了
        const pathThroughGate = findPath(this.graph, this.cur, this.target.cell);
        if (pathThroughGate && pathThroughGate[1] === lv.gateId) return this.hasKey ? { type: 'openGate' } : { type: 'gateLocked' };
        if (pathThroughGate) {
          // 沿着路走到门前
          const gi = pathThroughGate.indexOf(lv.gateId);
          this.plan = pathThroughGate.slice(0, gi);
        } else {
          this.plan = [];
          return { type: 'idle', kind: 'look', secs: 1.5 };
        }
      } else this.plan = path;
    }
    if (this.plan.length < 2) {
      // 到了当前目标：刷新目标
      this.plan = [];
      const next = this._chooseTarget();
      if (next.cell === this.cur) return { type: 'idle', kind: 'look', secs: 1.0 };
      this.target = next;
      const path = findPath(this.graph, this.cur, next.cell, (id) => this.blocked(id));
      if (!path) {
        const through = findPath(this.graph, this.cur, next.cell);
        if (through && through[1] === lv.gateId) return this.hasKey ? { type: 'openGate' } : { type: 'gateLocked' };
        if (through) { const gi = through.indexOf(lv.gateId); this.plan = through.slice(0, Math.max(1, gi)); }
        if (this.plan.length < 2) return { type: 'idle', kind: 'look', secs: 1.0 };
      } else this.plan = path;
    }
    const to = this.plan[1];
    if (to === lv.gateId && !this.gateOpen) return this.hasKey ? { type: 'openGate' } : { type: 'gateLocked' };
    const edge = edgeBetween(this.graph, this.cur, to);
    return { type: 'move', to, edge };
  }

  // 动作完成后的状态更新
  arrived(id) {
    this.cur = id;
    this.visited.add(id);
    this.hopsSinceIdle++;
    this.hopsSinceRepeat++;
    if (this.plan[0] !== id) {
      const i = this.plan.indexOf(id);
      this.plan = i >= 0 ? this.plan.slice(i) : [];
    }
    const c = this.level.cells[id];
    if (c.star) this.stars.delete(id);
    if (c.key) this.hasKey = true;
  }
  onGateLocked() { this.knowsGateLocked = true; this.plan = []; }
  onGateOpened() { this.gateOpen = true; this.plan = []; }

  // 闯关进度（0~1），用于进度条
  progress() {
    const idx = this._progressIdx();
    return clamp(idx / (this.level.main.length - 1), 0, 1);
  }
}
