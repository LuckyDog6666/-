// 应援系统：观众的每一种互动（点赞、弹幕、关注、加粉丝团、分享、礼物）都变成"应援值"，推着游戏往前走。
//
// 为什么要有它：直播测试发现来的观众大多不送礼物。成熟的弹幕互动游戏都把"不花钱的互动"做成玩法的发动机——
// 点赞、弹幕能立刻在画面上看到效果，观众才会留下来、才会继续互动，直播间的停留时长和互动率上去了，平台才会多推流。
//
//  - 应援条：攒满一次，天上掉一个盲盒；满得越快，下一条越长（小直播间一两分钟能满一次，热闹的直播间不会几秒就满）
//  - 糯糯自己踩的每一脚也算一点点应援：没人互动的时候，每关也能攒出一个盲盒，画面不会干等
//  - 热度（最近 30 秒的应援）：悬念挑战的成功率跟着它涨
//  - 本关贡献最多的人 = 本关 MVP，通关时点名感谢
import { clamp, lerp } from '../core/util.js';

// 服务器已经给每个事件算好了 pts；直接打开网页（没有服务器）时按这个表估算
export const LOCAL_PTS = { like: 1, chat: 3, enter: 1, share: 20, follow: 30, fansclub: 50, giftPerDiamond: 10 };

export class Cheer {
  constructor(cfg = {}) {
    this.cfg = Object.assign({ goalMin: 70, goalMax: 8000, fillSeconds: 90, stepPts: 0.5, maxPending: 2 }, cfg);
    this.energy = 0;                 // 应援条里现在有多少
    this.goal = this.cfg.goalMin;    // 攒满需要多少
    this.fills = 0;                  // 一共攒满了几次
    this.pending = 0;                // 攒满了、还没兑现的盲盒
    this.total = 0;
    this.viewerTotal = 0;            // 其中观众贡献的
    this.t = 0;
    this.inflow = [];                // 最近 60 秒观众的贡献 [时间, 分]
    this.level = new Map();          // 本关每个人的贡献：id → { name, pts }
  }

  update(dt) {
    this.t += dt;
    while (this.inflow.length && this.t - this.inflow[0][0] > 60) this.inflow.shift();
  }

  frac() { return clamp(this.energy / this.goal, 0, 1); }

  // 最近 sec 秒观众贡献的应援值
  recent(sec = 30) {
    let s = 0;
    for (const [t, p] of this.inflow) if (this.t - t <= sec) s += p;
    return s;
  }

  // 热度 0..1：最近 30 秒的贡献够半条应援条，就算"非常热"
  heat() { return clamp(this.recent(30) / (this.goal * 0.5), 0, 1); }

  ptsFor(ev) {
    if (Number.isFinite(ev.pts)) return Math.max(0, ev.pts);
    switch (ev.type) {
      case 'gift': return Math.max(1, Number(ev.gift?.diamond) || 1) * Math.max(1, Number(ev.gift?.count) || 1) * LOCAL_PTS.giftPerDiamond;
      case 'like': return Math.min(50, Math.max(1, Number(ev.count) || 1)) * LOCAL_PTS.like;
      case 'chat': return LOCAL_PTS.chat;
      case 'follow': return LOCAL_PTS.follow;
      case 'fansclub': return LOCAL_PTS.fansclub;
      case 'share': return LOCAL_PTS.share;
      case 'enter': return LOCAL_PTS.enter;
      default: return 0;
    }
  }

  // 一条观众互动。返回 { pts, filled }：filled = 这一下把应援条攒满了
  add(ev) {
    const pts = this.ptsFor(ev);
    if (pts <= 0) return { pts: 0, filled: false };
    const u = ev.user || {};
    const id = String(u.id || u.name || '');
    if (id && ev.type !== 'enter') {
      const rec = this.level.get(id) || { name: u.name || '神秘人', pts: 0 };
      rec.name = u.name || rec.name;
      rec.pts += pts;
      this.level.set(id, rec);
    }
    this.inflow.push([this.t, pts]);
    this.viewerTotal += pts;
    return { pts, filled: this._gain(pts) };
  }

  // 糯糯自己踩的脚步
  addSteps(n = 1) { return this._gain(n * this.cfg.stepPts); }

  _gain(p) {
    this.energy += p;
    this.total += p;
    let filled = false;
    for (let k = 0; k < 8 && this.energy >= this.goal; k++) {
      this.energy -= this.goal;
      this.fills++;
      this.pending = Math.min(this.cfg.maxPending, this.pending + 1);
      this._retarget();
      filled = true;
    }
    if (this.energy >= this.goal) this.energy = this.goal * 0.9; // 一下子涨太多（大礼物）：留在九成，不无限连开
    return filled;
  }

  // 攒满以后重新定下一条的长度：按最近一分钟的互动速度，让它大约 fillSeconds 秒满一次
  _retarget() {
    const rate = this.recent(60) / 60;
    const target = clamp(rate * this.cfg.fillSeconds, this.cfg.goalMin, this.cfg.goalMax);
    this.goal = Math.round(lerp(this.goal, target, 0.6));
  }

  // 兑现一个攒满的盲盒
  take() { if (this.pending > 0) { this.pending--; return true; } return false; }

  beginLevel() { this.level.clear(); }

  // 本关贡献最多的观众
  mvp() {
    let best = null;
    for (const r of this.level.values()) if (!best || r.pts > best.pts) best = r;
    return best && best.pts >= 3 ? best : null;
  }
}

// ---------------- 观众的字要不要上屏 ----------------
// 弹幕会被做成画面里的"烦恼泡泡"，所以先过滤：太长的、带联系方式 / 广告 / 脏话 / 敏感词的一律不上屏。
// 宁可错杀：不上屏的弹幕照样算应援值，只是不显示文字。
const BLOCK = /微信|威信|薇信|v信|vx|wx|qq|扣扣|加我|私信|私聊|联系方式|电话|手机号|链接|网址|下载|代理|兼职|刷单|返利|免费领|红包群|福利群|加群|裸|黄片|色情|约炮|嫖|做爱|性爱|赌|博彩|彩票|毒品|吸毒|枪|炸弹|爆炸|杀|自残|去死|死全家|傻逼|煞笔|沙比|傻比|草泥马|操你|艹|妈的|尼玛|你妈|他妈|滚蛋|贱|婊|屌|逼|政府|主席|总理|总统|领导人|共产|党中央|习近平|习大大|近平|毛泽东|台独|港独|藏独|疆独|六四|法轮|反共|暴乱|游行|革命|颠覆|独裁/i;
const NOT_WORRY = /^(左|右|左边|右边|一|二|三|两|上|下|中|对|好|是|哈+|嗯+|啊+|哦+|呵+|嘿+|6+|ok|yes|no|hi|hello)$/i;
export function cleanWords(text, max = 8) {
  let t = String(text ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202f\ufeff]/g, '').replace(/\s+/g, '').trim();
  if (!t) return '';
  // 去掉句末的标点和语气符号
  t = t.replace(/[!！?？。.,，~～…、]+$/g, '');
  const chars = Array.from(t);
  if (chars.length < 1 || chars.length > max) return '';
  if (/\d{3,}/.test(t) || /https?:|www\.|\.com|\.cn|@/i.test(t)) return '';
  if (BLOCK.test(t)) return '';
  if (NOT_WORRY.test(t)) return ''; // 投票 / 指令用的字不算烦恼
  // 只留中文、字母、数字（纯符号、纯表情不上屏）
  if (!/[\u4e00-\u9fffA-Za-z]/.test(t)) return '';
  if (/[^\u4e00-\u9fffA-Za-z0-9\u00b7]/.test(t)) return '';
  return t;
}

// 没有观众写烦恼时用的"打工人烦恼清单"（成年观众一看就懂）
export const WORRIES = ['加班', '周一', 'KPI', '早八', '房贷', '堵车', '熬夜', '内耗', '焦虑', '甲方', 'PPT', '迟到', '没钱', '失眠', '催婚', '减肥', '脱发', '开会', '周报', '画饼', '绩效', '闹钟', '挤地铁', '改方案', '相亲', '还款', '背锅', '拖延'];
