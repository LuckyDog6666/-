// 界面层（HTML 叠加在 3D 画面上，文字清晰可爱）。所有用户昵称都用 textContent 写入，杜绝注入。
//
// v4：竖屏优先。抖音观众几乎都是竖着拿手机看，而且抖音自己的界面会盖住画面的上面一条（主播头像、在线人数）
// 和下面三分之一多（弹幕、输入框、礼物按钮）。所以：
//  - 所有要让观众看清的字都放在"安全区"（画面高度的 13% ~ 60%），字号按手机上看得清来定
//  - 以前放在左下角的弹幕指令面板、底部的提示条都挪到上面，合并成一条轮播提示
//  - 新增：应援条（点赞 / 弹幕 / 礼物都会涨）、投票和倒计时面板、应援榜、图鉴、开盲盒的揭晓卡片
const h = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const DEFAULT_TIPS = [
  '💬 弹幕写下你的烦恼（比如「加班」），糯糯帮你一脚踩扁',
  '👍 点赞给糯糯应援，应援条满了天上掉盲盒 🎁',
  '🎁 送任意礼物：糯糯当场跳舞谢你，名字上应援榜',
  '🎁 遇到礼盒发 1 / 2 / 3，脆脆桥发「左」「右」',
  '🎧 戴上耳机：每种材质都是真实录制的 ASMR',
  '🐾 弹幕发「踩奶」「坐」「跳」「转圈」，糯糯照做',
  '🗺️ 想去哪个世界？弹幕说「雪 / 沙滩 / 厨房 / 史莱姆…」',
  '➕ 点个关注，糯糯每天都在这里陪你解压',
];

export class Hud {
  constructor(root, cfg = {}) {
    this.cfg = cfg;
    this.root = root;
    h('div', 'vignette', root);
    // ---- 顶部：关卡 + 图鉴 ----
    const card = this.card = h('div', 'level-card', root);
    const r1 = h('div', 'row1', card);
    this.elLv = h('span', 'lv', r1, '第 1 关');
    this.elName = h('span', 'name', r1, '');
    this.elDots = h('div', 'dots', card);
    this.elSteps = h('div', 'steps', card, '');
    this.col = h('div', 'col-chip', root, '');
    this.col.style.display = 'none';
    this.link = h('div', 'link-chip', root, '');
    // ---- 应援条 ----
    this.cheer = h('div', 'cheer', root);
    this.cheerFill = h('i', null, this.cheer);
    this.cheerText = h('span', 'ct', this.cheer, '💗 应援条');
    this.cheerGoal = h('span', 'cg', this.cheer, '满了掉盲盒 🎁');
    this.ticks = h('div', 'ticks', root);
    // ---- 提示 / 投票面板 ----
    this.tipzone = h('div', 'tipzone', root);
    this.tips = h('div', 'tips', this.tipzone);
    this.promptEl = h('div', 'prompt', root);
    const ph = h('div', 'ph', this.promptEl);
    this.pTitle = h('span', 'pt', ph, '');
    this.pTime = h('span', 'ptime', ph, '');
    this.pSub = h('div', 'ps', this.promptEl, '');
    this.pOpts = h('div', 'popts', this.promptEl);
    this.pRate = h('div', 'prate', this.promptEl);
    this.pRateFill = h('i', null, h('div', 'prbar', this.pRate));
    this.pRateText = h('span', 'prt', this.pRate, '');
    // 兼容旧接口：下一关投票写在提示区下面
    this.elVotes = h('div', 'votes', root);
    this.elVotes.style.display = 'none';
    // ---- 当前解压站的小标签 ----
    this.elStation = h('div', 'station-pill', root, '');
    // ---- 舞曲署名（CC BY 要求注明作者）----
    this.elMusic = h('div', 'music-credit', root, '');
    // ---- 应援榜 ----
    const board = this.boardEl = h('div', 'board', root);
    h('h3', null, board, cfg.boardTitle || '🏆 应援榜');
    this.elBoard = h('ol', null, board);
    this.setBoard([]);
    // ---- 提示条、气泡、横幅 ----
    this.elToasts = h('div', 'toasts', root);
    this.banner = h('div', 'banner', root);
    this.bT1 = h('div', 't1', this.banner);
    this.bT2 = h('div', 't2', this.banner);
    this.bubble = h('div', 'bubble', root);
    // ---- 揭晓卡片（开盲盒、挑战结果）----
    this.revealEl = h('div', 'reveal', root);
    this.rvTag = h('div', 'rtag', this.revealEl);
    this.rvTitle = h('div', 'rtitle', this.revealEl);
    this.rvSub = h('div', 'rsub', this.revealEl);
    this.hearts = h('div', 'hearts', root);
    this.title = h('div', 'title-card', root);
    this.tA = h('div', 'a', this.title);
    this.tB = h('div', 'b', this.title);
    h('br', null, this.title);
    this.tC = h('div', 'c', this.title);
    this.iris = h('div', 'iris', root);
    h('div', 'paw', this.iris, '🐾');
    this.irisR = 150;
    this.tipList = cfg.tips && cfg.tips.length ? cfg.tips.slice() : DEFAULT_TIPS.slice();
    this.tipIdx = 0;
    this._rotateTips();
    this.likeTotal = 0;
    this.toastList = [];
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  // 根据画面尺寸设置缩放单位：竖屏以宽 720 为基准，横屏以 1920×1080 为基准
  layout() {
    this._bubbleSize = null;
    const w = window.innerWidth, hh = window.innerHeight;
    const portrait = hh > w;
    const s = portrait ? w / 720 : Math.min(w / 1920, hh / 1080);
    document.documentElement.style.setProperty('--s', `${Math.max(0.3, s)}px`);
    document.body.classList.toggle('portrait', portrait);
    this.portrait = portrait;
  }

  setStage({ n, name, stations = [] }) {
    this.elLv.textContent = `第 ${n} 关`;
    this.elName.textContent = name;
    this.elDots.textContent = '';
    // 解压站 = 圆点，闯关小挑战 = 小菱形，悬念点 = ?，终点 = ★
    this.dots = stations.map((st, i) => {
      const it = typeof st === 'string' ? { label: st, kind: 'station' } : st;
      const last = i === stations.length - 1;
      const d = h('span', last ? 'dot big' : it.suspense ? 'dot sus' : it.kind === 'gimmick' ? 'dot gim' : 'dot', this.elDots, last ? '★' : it.suspense ? '?' : '');
      d.title = it.label;
      return d;
    });
  }
  setStation(i, label) {
    (this.dots || []).forEach((d, k) => d.classList.toggle('cur', k === i));
    this.curStation = label;
  }
  stationDone(i) { const d = (this.dots || [])[i]; if (d) { d.classList.remove('cur'); d.classList.add('done'); } }
  setMeter() {}        // 旧的"解压进度条"已经并进站点圆点里
  setProgress() {}
  setSteps(n) {
    if (this._stepsShown === n) return;
    this._stepsShown = n;
    this.elSteps.textContent = `🐾 已踩 ${Number(n).toLocaleString('zh-CN')} 脚`;
  }
  // 走进一个新的解压站时浮出它的名字
  floatStation(label) {
    if (this.cfg.showSoundLabels === false) return;
    clearTimeout(this._stT);
    if (this.portrait) {
      // 竖屏：画面中间留给糯糯，名字借提示条显示 3 秒
      this.tips.textContent = `✦ ${label} ✦`;
      this.tips.classList.add('now');
      this._stT = setTimeout(() => { this.tips.classList.remove('now'); this.tips.textContent = this._tip || ''; }, 3200);
      return;
    }
    this.elStation.textContent = `✦ ${label} ✦`;
    this.elStation.classList.add('show');
    this._stT = setTimeout(() => this.elStation.classList.remove('show'), 3200);
  }
  showMusic(text) { this.elMusic.textContent = text || ''; this.elMusic.classList.toggle('show', !!text); }
  // 声音素材致谢（CC BY 作者）加入轮播
  setAttribution(names) {
    if (!names || !names.length || this._attrAdded) return;
    this._attrAdded = true;
    this.tipList.push(`🎧 声音致谢：${names.slice(0, 5).join('、')} 等（CC BY），音乐 Kevin MacLeod（CC BY 4.0）`);
  }
  setVotes(votes, stages) {
    this.elVotes.textContent = '';
    if (!votes || !votes.size) { this.elVotes.style.display = 'none'; return; }
    this.elVotes.style.display = '';
    const list = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    h('span', 'vt', this.elVotes, '下一关：');
    for (const [id, n] of list) {
      const st = (stages || []).find((x) => x.id === id);
      h('span', 'vi', this.elVotes, `${st ? st.short || st.name : id} ${n}票`);
    }
  }

  setBoard(list) {
    this.elBoard.textContent = '';
    if (!list || !list.length) { h('div', 'empty', this.elBoard, '点赞 / 弹幕 / 礼物都能上榜'); return; }
    list.slice(0, Math.min(this.cfg.boardSize || 5, this.portrait ? 3 : 5)).forEach((it, i) => {
      const li = h('li', null, this.elBoard);
      h('span', 'n', li, `${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${it.name}`);
      h('span', 'v', li, fmtNum(it.value));
    });
  }

  toast(text, kind = 'gift', life = 6000) {
    const t = h('div', `toast ${kind}`, this.elToasts, text);
    this.toastList.push(t);
    // 竖屏最多同时两条：提示条就在糯糯头顶上，叠多了会挡住小脸
    while (this.toastList.length > (this.portrait ? 2 : 5)) { const old = this.toastList.shift(); old.remove(); }
    setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.remove(); this.toastList = this.toastList.filter((x) => x !== t); }, 520); }, life);
  }

  showThanks(line1, line2, superMode = false) {
    this.bT1.textContent = line1;
    this.bT2.textContent = line2 || '';
    this.bT2.style.display = line2 ? '' : 'none';
    this.banner.classList.toggle('super', !!superMode);
    this.banner.classList.add('show');
    this.root.classList.add('thanking');
    this.revealEl.classList.remove('show'); this.root.classList.remove('revealing'); // "收到礼物"的卡片让位给答谢横幅
  }
  updateThanksSub(line2) { this.bT2.textContent = line2; this.bT2.style.display = line2 ? '' : 'none'; }
  hideThanks() { this.banner.classList.remove('show'); this.root.classList.remove('thanking'); }

  say(text) { this.bubble.textContent = text; this.bubble.classList.add('show'); this._bubbleSize = null; }
  unsay() { this.bubble.classList.remove('show'); }
  // 气泡跟着糯糯的头；头顶出了画面、或者顶到上面的面板时，气泡贴着安全区的边，不会被切掉、也不盖住面板
  placeBubble(x, y) {
    if (!this._bubbleSize) this._bubbleSize = [this.bubble.offsetWidth / 2 + 8, this.bubble.offsetHeight + 16];
    const [bw, bh] = this._bubbleSize;
    const W = this.root.clientWidth || innerWidth, H = this.root.clientHeight || innerHeight;
    x = Math.min(Math.max(x, bw), Math.max(bw, W - bw));
    // 竖屏：气泡不高过提示区的下沿、不低过抖音弹幕区的上沿
    // （答谢横幅 / 投票面板 / 揭晓卡片出来时再低一点，不压在它们上面）
    const busy = this.root.classList.contains('thanking') || this.root.classList.contains('prompting') || this.root.classList.contains('revealing');
    const top = this.portrait ? H * (busy ? 0.44 : 0.33) : 0, bottom = this.portrait ? H * 0.66 : H - 12;
    y = Math.min(Math.max(y, bh + top), Math.max(bh + top, bottom));
    if (!this.portrait) {
      const now = performance.now();
      if (!this._avoid || now - this._avoidT > 1000) {
        this._avoidT = now;
        const base = this.root.getBoundingClientRect();
        this._avoid = [this.card, this.boardEl, this.cheer].filter((e) => e && e.offsetParent !== null).map((e) => {
          const r = e.getBoundingClientRect();
          return [r.left - base.left, r.top - base.top, r.right - base.left, r.bottom - base.top];
        });
      }
      for (const [l, t, r, b] of this._avoid) if (x + bw > l && x - bw < r && y > t && y - bh < b) y = Math.min(b + bh + 4, H - 12);
    }
    this.bubble.style.left = `${x}px`; this.bubble.style.top = `${y}px`;
  }

  floatLabel(text, x, y) {
    if (this.cfg.showSoundLabels === false) return;
    const e = h('div', 'float-label', this.root, text);
    e.style.left = `${x}px`; e.style.top = `${y}px`;
    setTimeout(() => e.remove(), 1550);
  }

  addLikes(n) { this.likeTotal += n; }

  // ---------------- v4：应援条 ----------------
  // frac 0..1；label 左边的字；goal 右边"满了会怎样"
  setCheer(frac, label, goal) {
    const v = Math.max(0, Math.min(1, frac || 0));
    this.cheerFill.style.width = `${(v * 100).toFixed(1)}%`;
    if (label != null && label !== this._cl) { this._cl = label; this.cheerText.textContent = label; }
    if (goal != null && goal !== this._cg) { this._cg = goal; this.cheerGoal.textContent = goal; }
    this.cheer.classList.toggle('hot', v > 0.8);
  }
  cheerFull() { this.cheer.classList.remove('full'); void this.cheer.offsetWidth; this.cheer.classList.add('full'); }
  // 应援条旁边飘一个小字："+3 小橘子"
  tick(text, kind = '') {
    if (this.ticks.childElementCount >= 5) this.ticks.firstChild.remove();
    const e = h('div', `tick ${kind}`, this.ticks, text);
    setTimeout(() => e.remove(), 1700);
  }
  // 一串小爱心从下面飞进应援条
  flyHearts(n = 3) {
    n = Math.min(8, n);
    for (let i = 0; i < n; i++) {
      if (this.hearts.childElementCount > 24) break;
      const e = h('span', 'fh', this.hearts, ['💗', '💖', '💕'][i % 3]);
      e.style.setProperty('--x0', `${40 + Math.random() * 50}%`);
      e.style.setProperty('--x1', `${20 + Math.random() * 60}%`);
      e.style.animationDelay = `${i * 70}ms`;
      setTimeout(() => e.remove(), 1500 + i * 70);
    }
  }

  // ---------------- v4：图鉴 / 连接状态 ----------------
  setCollection(n, total, flash = false) {
    this.col.style.display = '';
    this.col.textContent = `🎁 图鉴 ${n}/${total}`;
    if (flash) { this.col.classList.remove('flash'); void this.col.offsetWidth; this.col.classList.add('flash'); }
  }
  // 直播间连接状态（给主播自己看的小提示；连上以后几秒钟自动消失）
  setLink(state, text) {
    if (this.cfg.showLink === false) { this.link.style.display = 'none'; return; }
    this.link.className = `link-chip ${state || ''}`;
    this.link.textContent = text || '';
    clearTimeout(this._linkT);
    this.link.style.display = text ? '' : 'none';
    if (state === 'ok') this._linkT = setTimeout(() => { this.link.style.display = 'none'; }, 6000);
  }

  // ---------------- v4：投票 / 倒计时 / 成功率面板 ----------------
  // o = { title, sub, options: [{ key, label }], seconds, rate(0..1), rateLabel }
  prompt(o) {
    this.pTitle.textContent = o.title || '';
    this.pSub.textContent = o.sub || '';
    this.pSub.style.display = o.sub ? '' : 'none';
    this.pOpts.textContent = '';
    this._pOpts = (o.options || []).map((op) => {
      const row = h('div', 'po', this.pOpts);
      const bar = h('i', 'pfill', row);
      h('b', null, row, op.key);
      h('span', 'pl', row, op.short || op.label || '');
      const n = h('span', 'pn', row, '0票');
      return { row, bar, n };
    });
    this.pOpts.style.display = this._pOpts.length ? '' : 'none';
    this.pRate.style.display = o.rate != null ? '' : 'none';
    this._rateLabel = o.rateLabel || '成功率';
    this.promptUpdate(o);
    this.promptEl.classList.add('show');
    this.root.classList.add('prompting');
    clearTimeout(this._rvT); this.revealEl.classList.remove('show'); this.root.classList.remove('revealing'); // 上一张揭晓卡片让位
  }
  // o = { counts: [n...], seconds, rate, rateLabel, sub, pick(选中了第几个) }
  promptUpdate(o = {}) {
    if (o.sub != null) { this.pSub.textContent = o.sub; this.pSub.style.display = o.sub ? '' : 'none'; }
    if (o.seconds != null) { const s = Math.max(0, Math.ceil(o.seconds)); this.pTime.textContent = `⏱ ${s}`; this.pTime.style.display = ''; this.pTime.classList.toggle('urgent', s <= 3); } else if (o.seconds === null) this.pTime.style.display = 'none';
    if (o.counts && this._pOpts) {
      const sum = Math.max(1, o.counts.reduce((a, b) => a + b, 0));
      this._pOpts.forEach((p, i) => { const c = o.counts[i] || 0; p.n.textContent = `${c}票`; p.bar.style.width = `${(c / sum) * 100}%`; });
    }
    if (o.pick != null && this._pOpts) this._pOpts.forEach((p, i) => p.row.classList.toggle('pick', i === o.pick));
    if (o.rate != null) {
      const r = Math.max(0, Math.min(1, o.rate));
      this.pRateFill.style.width = `${r * 100}%`;
      if (o.rateLabel) this._rateLabel = o.rateLabel;
      this.pRateText.textContent = `${this._rateLabel || '成功率'} ${Math.round(r * 100)}%`;
      this.pRate.classList.toggle('high', r >= 0.75);
    }
  }
  promptHide() { this.promptEl.classList.remove('show'); this.root.classList.remove('prompting'); }

  // 揭晓卡片：tag 小标签（稀有度 / 成功 / 失败），title 大字，sub 小字
  reveal({ tag = '', cls = '', title = '', sub = '', secs = 3 } = {}) {
    this.rvTag.textContent = tag; this.rvTag.style.display = tag ? '' : 'none';
    this.rvTitle.textContent = title;
    this.rvSub.textContent = sub; this.rvSub.style.display = sub ? '' : 'none';
    this.revealEl.className = `reveal show ${cls}`;
    this.root.classList.add('revealing');
    clearTimeout(this._rvT);
    this._rvT = setTimeout(() => { this.revealEl.classList.remove('show'); this.root.classList.remove('revealing'); }, secs * 1000);
  }

  async showTitle(n, name, sub, secs = 3.2) {
    this.tA.textContent = `第 ${n} 关`;
    this.tB.textContent = name;
    this.tC.textContent = sub || '';
    this.title.classList.add('show');
    this.root.classList.add('titling');
    await sleep(secs * 1000);
    this.title.classList.remove('show');
    this.root.classList.remove('titling');
  }

  // 圆形转场：close=true 收拢，false 展开
  irisTo(close, ms = 900) {
    return new Promise((res) => {
      const from = this.irisR, to = close ? 0 : 150;
      const t0 = performance.now();
      if (close) this.iris.classList.add('closed'); else this.iris.classList.remove('closed');
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / ms);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        this.irisR = from + (to - from) * e;
        this.iris.style.setProperty('--r', `${this.irisR}%`);
        if (u < 1) requestAnimationFrame(step); else res();
      };
      step();
    });
  }

  _rotateTips() {
    this._tip = this.tipList[this.tipIdx % this.tipList.length];
    if (!this.tips.classList.contains('now')) this.tips.textContent = this._tip;
    this.tipIdx++;
    setTimeout(() => {
      this.tips.style.opacity = '0';
      setTimeout(() => { this._rotateTips(); this.tips.style.opacity = '1'; }, 500);
    }, 7000);
  }
}

// 1234 → 1,234；12345 → 1.2万
export function fmtNum(n) {
  n = Math.round(Number(n) || 0);
  if (n >= 100000) return `${(n / 10000).toFixed(0)}万`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString('zh-CN');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
