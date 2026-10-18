// 礼物答谢调度：把直播间里的礼物整理成"答谢舞蹈"事件。
// 智能规则（不需要大模型）：
//  - 连击合并：同一个人连续送同一种礼物，合并成一次答谢（显示 ×N）
//  - 价值分级：抖币越多，跳得越久、特效越大（大礼物戴皇冠、撒彩带）
//  - 防刷屏：小礼物刷屏时，先弹出感谢提示，攒一会儿再一起跳舞答谢
//  - 保证闯关进度：最近跳舞太久时，小礼物先排队，糯糯先往前走几步；大礼物永远优先
//  - 队列过长时自动合并成"集体答谢"
import { escapeText } from '../core/util.js';

export const TIERS = [
  { min: 0, dances: 1, secs: 5.5, name: 'small' },
  { min: 10, dances: 1, secs: 7.5, name: 'mid' },
  { min: 100, dances: 2, secs: 6.5, name: 'big', crown: true, confetti: true },
  { min: 1000, dances: 3, secs: 6.5, name: 'super', crown: true, confetti: true, superBanner: true },
];

export function tierOf(value, cfg) {
  const th = cfg?.tierThresholds || [10, 100, 1000];
  if (value >= th[2]) return 3;
  if (value >= th[1]) return 2;
  if (value >= th[0]) return 1;
  return 0;
}

export class GiftManager {
  constructor(cfg = {}) {
    this.cfg = Object.assign({
      comboWindow: 2.2,       // 连击合并窗口（秒）
      smallCooldown: 14,      // 小礼物跳舞冷却（秒）
      maxDanceShare: 0.65,    // 最近 60 秒内跳舞时间占比上限（保证闯关进度）
      minAdventure: 8,        // 跳完舞至少闯关几秒（小礼物）
      tierThresholds: [10, 100, 1000],
      giftValues: {},         // 礼物名 -> 抖币（当消息里没有价格时使用）
    }, cfg);
    this.pending = new Map(); // key -> 聚合中的礼物
    this.ready = [];          // 待答谢事件
    this.danceLog = [];       // [start, end]
    this.lastSmallDance = -1e9;
    this.lastDanceEnd = -1e9;
    this.now = 0;
  }

  // 收到一条礼物（来自服务器的标准化事件）
  add(ev) {
    const g = ev.gift || {};
    const u = ev.user || {};
    const name = escapeText(u.name || u.nickname, 12);
    const giftName = escapeText(g.name || '礼物', 8);
    const count = Math.max(1, Math.min(9999, Number(g.count) || 1));
    let diamond = Number(g.diamond);
    if (!Number.isFinite(diamond) || diamond <= 0) diamond = Number(this.cfg.giftValues[giftName]) || 1;
    const key = `${u.id || name}|${g.id || giftName}`;
    let p = this.pending.get(key);
    if (!p) {
      p = { key, user: name, userId: u.id || name, avatar: u.avatar || '', gift: giftName, giftId: g.id, count: 0, diamond, first: this.now, last: this.now };
      this.pending.set(key, p);
    }
    p.count += count;
    p.last = this.now;
    p.diamond = diamond;
    return { name, giftName, count: p.count, value: diamond * count };
  }

  update(dt) {
    this.now += dt;
    for (const [k, p] of this.pending) {
      if (this.now - p.last >= this.cfg.comboWindow || this.now - p.first > 8) {
        this.pending.delete(k);
        const value = p.diamond * p.count;
        this.ready.push({ users: [p.user], user: p.user, gift: p.gift, count: p.count, value, tier: tierOf(value, this.cfg), at: this.now });
      }
    }
    // 队列太长：把小礼物合并成集体答谢
    if (this.ready.length > 3) {
      const small = this.ready.filter((e) => e.tier <= 1);
      if (small.length >= 2) {
        const big = this.ready.filter((e) => e.tier > 1);
        const users = [...new Set(small.flatMap((e) => e.users))];
        const value = small.reduce((a, e) => a + e.value, 0);
        const group = { users, user: users[0], gift: small[0].gift, count: small.reduce((a, e) => a + e.count, 0), value, tier: Math.min(2, tierOf(value, this.cfg)), group: true, at: small[0].at };
        this.ready = [...big, group];
      }
    }
    // 大礼物插队
    this.ready.sort((a, b) => (b.tier >= 2) - (a.tier >= 2) || a.at - b.at);
  }

  // 最近 60 秒跳舞占比
  danceShare() {
    const from = this.now - 60;
    let s = 0;
    for (const [a, b] of this.danceLog) s += Math.max(0, Math.min(b, this.now) - Math.max(a, from));
    this.danceLog = this.danceLog.filter(([, b]) => b > from);
    return s / 60;
  }

  // 现在要不要停下来跳舞？返回答谢事件或 null
  next() {
    if (!this.ready.length) return null;
    const ev = this.ready[0];
    const sinceDance = this.now - this.lastDanceEnd;
    if (ev.tier < 2) {
      if (this.danceShare() > this.cfg.maxDanceShare && sinceDance < 30) return null;
      if (sinceDance < this.cfg.minAdventure && this.ready.length < 3) return null;
      if (ev.tier === 0 && this.now - this.lastSmallDance < this.cfg.smallCooldown) {
        // 冷却中：把后面的小礼物也攒起来，等冷却结束一起答谢
        return null;
      }
    }
    this.ready.shift();
    // 冷却期间攒下的小礼物：合并到这次答谢里
    if (ev.tier < 2) {
      const extra = this.ready.filter((e) => e.tier < 2 && e !== ev);
      if (extra.length) {
        this.ready = this.ready.filter((e) => !extra.includes(e));
        ev.users = [...new Set([...ev.users, ...extra.flatMap((e) => e.users)])];
        ev.value += extra.reduce((a, e) => a + e.value, 0);
        ev.count += extra.reduce((a, e) => a + (e.gift === ev.gift ? e.count : 0), 0);
        ev.group = ev.users.length > 1;
      }
    }
    if (ev.tier === 0) this.lastSmallDance = this.now;
    return ev;
  }

  danceStarted() { this._ds = this.now; }
  danceEnded() { this.danceLog.push([this._ds ?? this.now, this.now]); this.lastDanceEnd = this.now; }

  get queued() { return this.ready.length + this.pending.size; }
}
