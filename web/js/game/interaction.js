// 直播互动：观众的每一个动作，画面上都要立刻有反应。
//
// 上线测试时"发弹幕、送礼物没反应"，除了监听没连上以外，还有一半原因在这里：以前礼物要等糯糯走到两段之间才答谢
// （赶上做任务时要等半分钟），普通弹幕更是什么都不发生。现在：
//  - 点赞：小爱心飞进应援条，条子立刻往上涨
//  - 弹幕：投票时算一票；写的是烦恼就变成一个带名字的泡泡等糯糯来踩；是指令就照做；其它的也给应援值，飘一个"+3 昵称"
//  - 关注 / 加粉丝团 / 分享：点名感谢，糯糯挥手
//  - 礼物：半秒之内弹出"收到礼物"的大卡片 + 爱心，舞蹈在最近的安全点补上
//  - 应援条攒满：点名"XX 点亮了盲盒"，下一个空档天上就掉盲盒
import { Cheer, cleanWords, WORRIES } from './cheer.js';
import { Collection } from './collection.js';
import { STAGES } from '../course/stages.js';
import { escapeText, clamp } from '../core/util.js';

const LINK_TEXT = {
  listening: ['ok', '🟢 已连上直播间'],
  starting: ['warn', '🟡 正在启动直播间监听…'],
  connecting: ['warn', '🟡 正在连接直播间…'],
  waiting: ['warn', '🟡 直播间打开了，还没收到数据'],
  silent: ['warn', '🟡 暂时没有收到直播间数据'],
  offline: ['warn', '🟡 直播间还没开播'],
};

export class Interaction {
  constructor(game) {
    this.g = game;
    this.cheer = new Cheer(game.cfg.cheer || {});
    this.col = new Collection(game.rng);
    this.poll_ = null;
    this.worryQ = [];        // 观众写的烦恼：{ text, name, at }
    this._defaults = [];
    this.lastLikeTick = -1e9;
    this.lastLikeFx = -1e9;
    this.lastEnter = -1e9;
    this.lastVoteToast = -1e9;
    this.eggBy = '';         // 是谁把应援条攒满的
    this.stats = { like: 0, chat: 0, gift: 0, follow: 0 };
    game.hud.setCollection(this.col.count, this.col.total);
    this._showCheer();
  }

  // ---------------- 每帧 ----------------
  update(dt) {
    this.cheer.update(dt);
    this._showCheer();
    const p = this.poll_;
    if (p && !p.done) {
      const left = p.until - this.g.time;
      if (left <= 0) this._closePoll();
      else if (Math.ceil(left) !== p.shown) { p.shown = Math.ceil(left); this.g.hud.promptUpdate({ seconds: left, counts: p.counts }); }
    }
  }

  _showCheer() {
    const c = this.cheer, f = c.frac();
    const key = `${Math.round(f * 100)}|${c.pending}`;
    if (key === this._ck) return;
    this._ck = key;
    this.g.hud.setCheer(f, `💗 应援 ${Math.round(f * 100)}%`, c.pending > 0 ? `🎁 盲盒 ×${c.pending} 马上掉落！` : '攒满掉盲盒 🎁');
  }

  // ---------------- 直播事件 ----------------
  onLive(ev) {
    const g = this.g, hud = g.hud;
    if (ev.type === 'status') { this.onStatus(ev); return; }
    const name = escapeText(ev.user?.name, 8);
    const { pts, filled } = this.cheer.add(ev);
    if (filled) this._filled(name);
    const pet = g.pet, p = pet.root.position;
    switch (ev.type) {
      case 'gift': {
        this.stats.gift++;
        const info = g.gifts.add(ev);
        hud.toast(`🎁 ${info.name} 送出 ${info.giftName} ×${info.count}`, 'gold', 7000);
        hud.tick(`+${pts} ${name}`, 'gold');
        hud.flyHearts(6);
        // 立刻回应：屏幕中间弹出"收到礼物"，糯糯开心一下；舞蹈在最近的安全点补上
        // （正在投票 / 挑战时不弹大卡片，免得盖住面板；右边的提示条和飘字照样有）
        if (!g.dancing && !hud.root.classList.contains('prompting')) hud.reveal({ tag: '🎁 收到礼物', cls: 'sr', title: `谢谢 ${name}！`, sub: `${info.giftName} ×${info.count} · 糯糯马上给你跳舞`, secs: 2.4 });
        g.particles.burst('hearts', p.x, p.y + 0.8, p.z, { colors: ['#ff8fb3', '#ff6fa3', '#ffd166'], count: 5 });
        pet.expr('happy', 'open', 1.6);
        g.sfx('plop', p, { gain: -7, main: false });
        g.director.cheer(0.15);
        break;
      }
      case 'like': {
        const n = Math.max(1, Number(ev.count) || 1);
        this.stats.like += n;
        hud.addLikes(n);
        hud.flyHearts(Math.min(5, 1 + Math.floor(n / 4)));
        g.director.cheer(0.01);
        if (g.time - this.lastLikeTick > 1.2) { this.lastLikeTick = g.time; hud.tick(`+${pts} ${name} 点赞`); }
        if (g.time - this.lastLikeFx > 1.6) {
          this.lastLikeFx = g.time;
          g.particles.burst('hearts', p.x, p.y + 0.9, p.z, { colors: ['#ff8fb3', '#ffb3d1', '#ff6fa3'], count: 2 + Math.min(4, Math.floor(n / 5)) });
        }
        break;
      }
      case 'chat': this.stats.chat++; this.chatAt = g.time; this._chat(ev, name, pts); break;
      case 'follow': {
        this.stats.follow++;
        hud.toast(`➕ ${name} 关注了糯糯～`, 'follow');
        hud.tick(`+${pts} ${name} 关注`, 'gold');
        hud.flyHearts(4);
        if (g.pendingWaves.length < 2) g.pendingWaves.push({ name, why: '的关注' });
        break;
      }
      case 'fansclub': {
        hud.toast(`💡 ${name} 加入了粉丝团！`, 'gold', 7000);
        hud.tick(`+${pts} ${name} 加入粉丝团`, 'gold');
        hud.flyHearts(6);
        g.particles.burst('stars', p.x, p.y + 0.9, p.z, { colors: ['#ffd166', '#ff8fb3'], count: 8 });
        if (g.pendingWaves.length < 2) g.pendingWaves.push({ name, why: '加入粉丝团' });
        break;
      }
      case 'share': {
        hud.toast(`📣 谢谢 ${name} 的分享～`, 'follow');
        hud.tick(`+${pts} ${name} 分享`, 'gold');
        break;
      }
      case 'enter': {
        if (g.cfg.showEnter === false) break;
        if (g.time - this.lastEnter < (g.cfg.enterInterval || 8)) break;
        this.lastEnter = g.time;
        hud.toast(`👋 欢迎 ${name}`, 'enter', 3500);
        break;
      }
      default: break;
    }
  }

  _chat(ev, name, pts) {
    const g = this.g, hud = g.hud;
    const text = String(ev.text || '').trim();
    // 1) 正在投票：算一票
    if (this.poll_ && !this.poll_.done) {
      const k = this._vote(ev, text);
      if (k >= 0) { hud.tick(`${name} 选了 ${this.poll_.options[k].key}`); return; }
    }
    if (g.cfg.chatCommands !== false) {
      // 2) 指令 / 投票下一关
      const r = g.director.onChat(text, g._allowedStages());
      if (r) {
        if (r.kind === 'vote') {
          hud.setVotes(g.director.votes, STAGES);
          hud.tick(`${name} 想去「${r.stage.short || r.stage.name}」`);
        } else if (r.kind === 'here') hud.tick(`${name}：现在就在「${r.stage.short || r.stage.name}」啦`);
        else if (r.kind === 'action') { hud.tick(`${name}：${text.slice(0, 8)} → 糯糯收到！`, 'gold'); }
        else if (r.kind === 'pace') hud.tick(`${name}：${r.say}`);
        else hud.tick(`+${pts} ${name}`);
        return;
      }
    }
    // 3) 写的是烦恼：变成带名字的泡泡，等糯糯来踩扁
    const w = g.cfg.chatOnScreen === false ? '' : cleanWords(text);
    if (w) {
      if (!this.worryQ.some((q) => q.text === w) && this.worryQ.length < 12) this.worryQ.push({ text: w, name, at: g.time });
      hud.tick(`💭 ${name}：「${w}」 等糯糯来踩`);
      return;
    }
    // 4) 其它弹幕：也算应援
    if (pts > 0) hud.tick(`+${pts} ${name}`);
  }

  _filled(name) {
    const hud = this.g.hud;
    this.eggBy = name;
    hud.cheerFull();
    hud.toast(`🎉 ${name} 点亮了盲盒 🎁`, 'gold', 6000);
    hud.flyHearts(8);
  }

  // 直播间连接状态：给主播自己看（连上以后几秒钟自动消失；连不上就一直挂着）
  onStatus(ev) {
    const hud = this.g.hud;
    if (ev.source === 'mock') { hud.setLink('warn', '🟡 演示模式（没有连接真实直播间）'); return; }
    const t = LINK_TEXT[ev.state];
    if (t) hud.setLink(t[0], t[1]);
    else hud.setLink('err', `🔴 ${ev.message || '没有连上直播间'}（看控制台）`);
  }

  // ---------------- 投票 ----------------
  /**
   * 发起一次投票（观众发弹幕选）。options: [{ key: '1', label: '红礼盒', match: ['1', '一', '红'] }]
   * 返回 Promise<{ pick, counts, auto(没人投票、随机选的), voters: [{ name, id, idx }] }>
   */
  poll({ title, sub, options, seconds = 8 }) {
    const g = this.g;
    if (this.poll_ && !this.poll_.done) this._closePoll();
    // 直播间这一分钟没人说话（或者根本没开播）：不干等，4 秒后糯糯自己选
    if (this.chatAt == null || g.time - this.chatAt > 60) seconds = Math.min(seconds, 4);
    return new Promise((resolve) => {
      const res = options.map((o) => {
        const toks = [o.key, ...(o.match || [])].map((x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(`^(我)?(选|投|要|去|走)?(${toks.join('|')})(号|边|个|门|盒|块)?$`, 'i');
      });
      this.poll_ = { options, res, counts: options.map(() => 0), voters: new Map(), until: g.time + seconds, shown: -1, resolve, done: false };
      g.hud.prompt({ title, sub, options, seconds });
    });
  }

  _vote(ev, text) {
    const p = this.poll_;
    // "1111" 当成 "1"；去掉标点
    const t = text.replace(/[\s!！?？。.,，~～…、]/g, '').replace(/(.)\1+/gu, '$1');
    if (!t || Array.from(t).length > 6) return -1;
    const k = p.res.findIndex((re) => re.test(t));
    if (k < 0) return -1;
    const id = String(ev.user?.id || ev.user?.name || Math.random());
    const prev = p.voters.get(id);
    if (prev) p.counts[prev.idx]--;
    p.voters.set(id, { idx: k, name: escapeText(ev.user?.name, 8), id });
    p.counts[k]++;
    this.g.hud.promptUpdate({ counts: p.counts });
    return k;
  }

  _closePoll() {
    const p = this.poll_, g = this.g;
    if (!p || p.done) return;
    p.done = true;
    const max = Math.max(...p.counts);
    const auto = max <= 0;
    const best = p.counts.map((c, i) => [c, i]).filter(([c]) => c === max).map(([, i]) => i);
    const pick = best[Math.floor(g.rng.next() * best.length) % best.length];
    g.hud.promptUpdate({ counts: p.counts, pick, seconds: null, sub: auto ? '没人投票，糯糯自己选…' : `大家选了 ${p.options[pick].key}！` });
    p.resolve({ pick, counts: p.counts.slice(), auto, voters: [...p.voters.values()] });
  }

  // 给一批观众加分（猜中了、救场了……）。分数记在服务器的应援榜上
  award(users, pts, why = '') {
    const list = (users || []).filter((u) => u && u.id).slice(0, 80).map((u) => ({ id: u.id, name: u.name }));
    if (!list.length || !(pts > 0)) return;
    fetch('/api/award', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: list, pts, why }) }).catch(() => {});
  }

  // ---------------- 烦恼 ----------------
  // 取一条观众写的烦恼（4 分钟以前的就不用了）
  takeWorry() {
    const now = this.g.time;
    while (this.worryQ.length && now - this.worryQ[0].at > 240) this.worryQ.shift();
    return this.worryQ.shift() || null;
  }
  // 没有观众写的时候，用"打工人烦恼清单"里的词（不重复）
  defaultWorry() {
    if (!this._defaults.length) this._defaults = this.g.rng.shuffle(WORRIES.slice());
    return { text: this._defaults.pop(), name: '' };
  }

  // ---------------- 盲盒 ----------------
  // 开一个盲盒：按热度加成抽一款，更新图鉴。by：算在谁头上
  openBox({ boost = 0, min = 'n', by = '' } = {}) {
    const b = clamp(boost + this.cheer.heat() * 0.35, 0, 1);
    const res = this.col.draw(b, min);
    res.by = by;
    const hud = this.g.hud;
    hud.setCollection(res.allDone ? res.total : res.count, res.total, true);
    return res;
  }
}
