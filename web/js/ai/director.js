// 糯糯的"小脑袋"（不需要大模型）：在每个解压站上决定怎么玩，让画面自然、耐看、不重复。
//  - 喜新：优先踩还没被踩过的地方（新鲜的雪、没按过的泡泡），留下整齐好看的脚印轨迹
//  - 懂材质：脆的东西重重踩（stomp），泡泡和键帽踮脚轻踩（tiptoe），史莱姆和捏捏慢慢压
//  - 有节奏：按本关剩余时间调整步速和来回次数，既不拖沓也不赶
//  - 有情绪：精力/开心值随时间、礼物、点赞变化；累了会伸懒腰，开心了会踩奶、眯眼享受
//  - 会互动：观众弹幕可以点播动作（踩一脚、坐下、踩奶、跳一跳），也可以投票下一关
import { clamp } from '../core/util.js';

const CHAT_ACTIONS = [
  { re: /踩奶|按按|揉揉/, act: 'knead', say: '收到～给你踩奶奶！' },
  { re: /坐|屁股|蹲/, act: 'sit', say: '好嘞，一屁股坐下去～' },
  { re: /跳|蹦|弹/, act: 'bounce', say: '蹦蹦跳跳～' },
  { re: /踩|跺|用力/, act: 'stomp', say: '看我重重一脚！' },
  { re: /转圈|转转|旋转/, act: 'spin', say: '转个圈圈给你看～' },
  { re: /摸摸|抱抱|贴贴|可爱|喜欢/, act: 'love', say: '贴贴～最喜欢你啦' },
  { re: /快|冲|加速/, act: 'faster', say: '冲鸭！' },
  { re: /慢|睡|困/, act: 'slower', say: '慢慢来～' },
];

export class Director {
  constructor(rng, opts = {}) {
    this.rng = rng;
    this.opts = Object.assign({ stageSeconds: 210 }, opts);
    this.mood = { energy: 0.85, joy: 0.6 };
    this.recentSpecials = [];
    this.requests = [];       // 弹幕点播的动作（排队，在安全点执行）
    this.votes = new Map();   // 下一关投票 stageId -> 票数
    this.pace = 1;            // 步速倍率（弹幕"快/慢"可调）
    this.paceUntil = 0;
    this.t = 0;
    this.stageT = 0;
    this.stageTarget = this.opts.stageSeconds;
  }

  beginStage(stage, stations) {
    this.stage = stage;
    this.requests = []; // 上一关没来得及做的点播不带到新世界
    this.stageT = 0;
    this.stationCount = stations.length;
    this.stationIdx = 0;
    this.votes.clear();
    this.recentSpecials = [];
  }

  tick(dt) {
    this.t += dt;
    this.stageT += dt;
    // 精力慢慢下降、开心慢慢回落到平静
    this.mood.energy = clamp(this.mood.energy - dt * 0.0016, 0.25, 1);
    this.mood.joy = clamp(this.mood.joy + (0.55 - this.mood.joy) * dt * 0.01, 0, 1);
    if (this.paceUntil && this.t > this.paceUntil) { this.pace = 1; this.paceUntil = 0; }
  }

  cheer(amount = 0.2) {
    this.mood.joy = clamp(this.mood.joy + amount, 0, 1);
    this.mood.energy = clamp(this.mood.energy + amount * 0.6, 0, 1);
  }

  // 本关时间是否充裕（>1 表示比计划快，可以多玩一会儿）
  slack() {
    const remainingStations = Math.max(0.5, this.stationCount - this.stationIdx);
    const remainingT = this.stageTarget - this.stageT;
    return clamp(remainingT / (remainingStations * (this.stageTarget / this.stationCount)), 0.4, 1.8);
  }

  /**
   * 为一个站点制定玩法。返回：
   * { lanes:[z...], gait, stepDur, stride, special, specialAfter, knead, bliss, peek, lookback, power }
   */
  planStation(s, idx) {
    this.stationIdx = idx;
    const d = s.def;
    const r = this.rng;
    const slack = this.slack();
    const e = this.mood.energy, j = this.mood.joy;
    const W = s.width;
    const laneSpan = Math.max(0, W / 2 - 0.3);
    // 步态：站点推荐 + 情绪（很有精神时更爱重踩，累了就踮脚轻踩）
    let gait = d.gait || 'normal';
    if (gait === 'normal' && e > 0.8 && /crunch|ice|water/.test(d.type) && r.next() < 0.4) gait = 'stomp';
    if (gait === 'stomp' && e < 0.4 && r.next() < 0.5) gait = 'normal';
    const stepDur = (d.stepDur || 0.65) * (gait === 'stomp' ? 1.05 : 1) / this.pace * (slack < 0.75 ? 0.92 : 1);
    const stride = gait === 'tiptoe' ? 0.21 : gait === 'stomp' ? 0.3 : 0.26;
    // 来回几趟：按本站的时间预算算（每趟从一头走到另一头）。总是奇数趟，最后正好从出口离开；
    // 车道从还没被踩过的地方开始（两侧 → 中间，或反过来）
    const passDur = (s.length / stride) * stepDur;
    const budget = (this.stageTarget / Math.max(1, this.stationCount)) * 0.6 * slack;
    let passes = clamp(Math.round(budget / passDur), 1, 3);
    if (passes === 2) passes = slack > 1 ? 3 : 1;
    const cand = passes === 1 ? [r.range(-0.08, 0.08)] : [-laneSpan, 0, laneSpan];
    const lanes = r.next() < 0.5 ? cand : cand.slice().reverse();
    // 特别动作：从站点支持的里面挑一个最近没做过的
    const specials = (d.specials || s.specials || []).slice();
    let special = null;
    if (specials.length && (slack > 0.6 || r.next() < 0.5)) {
      const fresh = specials.filter((x) => !this.recentSpecials.includes(x));
      special = r.pick(fresh.length ? fresh : specials);
      if (special === 'knead' && !d.kneadable) special = specials.find((x) => x !== 'knead') || null;
    }
    if (special) { this.recentSpecials.push(special); if (this.recentSpecials.length > 3) this.recentSpecials.shift(); }
    // 踩奶：可踩奶的材质 + 心情好 + 时间够
    const knead = special !== 'knead' && d.kneadable && j > 0.5 && slack > 0.9 && r.next() < 0.45;
    return {
      lanes, gait, stepDur, stride, special,
      specialAfter: Math.min(lanes.length - 1, r.int(0, lanes.length - 1)),
      knead, kneadAfter: lanes.length - 1,
      bliss: (special === 'knead' || special === 'sit' || knead) && r.next() < 0.7,
      peek: idx === 0 || r.next() < 0.55,
      lookback: s.length > 2.3 && r.next() < 0.35 && slack > 0.8,
      power: clamp(0.45 + e * 0.35 + (gait === 'stomp' ? 0.2 : 0) - (gait === 'tiptoe' ? 0.2 : 0), 0.2, 1),
    };
  }

  // 走完一趟后检查点播
  takeRequest() {
    // 太久以前的点播（超过 40 秒）就不做了，免得观众早就忘了
    while (this.requests.length && this.t - this.requests[0].at > 40) this.requests.shift();
    return this.requests.shift() || null;
  }

  // ---------------- 弹幕 ----------------
  onChat(text, stages) {
    const t = String(text || '').trim();
    if (!t) return null;
    // 投票下一关：弹幕里出现世界的关键字。"踩雪""坐沙子"这种是在点动作，不算投票；
    // 明确说"去/想看/下一关"的才优先算投票
    const intent = /去|投|想看|下一关|换|下关/.test(t);
    const action = CHAT_ACTIONS.find((c) => c.re.test(t));
    if (intent || !action) {
      for (const st of stages) {
        const keys = st.voteKeys || [];
        if (!keys.some((k) => t.includes(k))) continue;
        if (this.stage && st.id === this.stage.id) return { kind: 'here', stage: st };
        this.votes.set(st.id, (this.votes.get(st.id) || 0) + 1);
        return { kind: 'vote', stage: st };
      }
    }
    for (const c of CHAT_ACTIONS) {
      if (!c.re.test(t)) continue;
      if (c.act === 'faster') { this.pace = 1.18; this.paceUntil = this.t + 40; return { kind: 'pace', say: c.say }; }
      if (c.act === 'slower') { this.pace = 0.85; this.paceUntil = this.t + 40; return { kind: 'pace', say: c.say }; }
      // 同一个动作不重复排队；队列最多 3 个
      if (this.requests.some((q) => q.act === c.act) || this.requests.length >= 3) return { kind: 'busy' };
      this.requests.push({ act: c.act, say: c.say, at: this.t });
      return { kind: 'action', act: c.act, say: c.say };
    }
    return null;
  }

  // 下一关：观众投票最多的；没有人投票就按顺序轮换（不重复上一关）
  nextStage(stages, lastId, queue) {
    let best = null, n = 0;
    for (const [id, v] of this.votes) if (v > n && id !== lastId) { n = v; best = id; }
    this.votes.clear();
    if (best) return { id: best, votes: n };
    if (!queue.length) {
      queue.push(...this.rng.shuffle(stages.map((s) => s.id)));
      if (queue[0] === lastId && queue.length > 1) queue.push(queue.shift());
    }
    return { id: queue.shift(), votes: 0 };
  }
}
