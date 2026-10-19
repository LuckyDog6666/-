// 界面层（HTML 叠加在 3D 画面上，文字清晰可爱）。所有用户昵称都用 textContent 写入，杜绝注入。
const h = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

export class Hud {
  constructor(root, cfg = {}) {
    this.cfg = cfg;
    this.root = root;
    h('div', 'vignette', root);
    // 关卡卡片：世界名、解压站进度点、解压进度条、累计踩踏数
    const card = h('div', 'level-card', root);
    const r1 = h('div', 'row1', card);
    this.elLv = h('span', 'lv', r1, '第 1 关');
    this.elName = h('span', 'name', r1, '');
    this.elDots = h('div', 'dots', card);
    const r3 = h('div', 'row3', card);
    h('span', 'mlabel', r3, '解压进度');
    this.elProg = h('i', null, h('div', 'progress', r3));
    this.elPct = h('span', 'pct', r3, '0%');
    this.elSteps = h('div', 'steps', card, '');
    // 弹幕互动面板（抖音要求直播要有真实互动：观众的弹幕会直接改变糯糯的动作和下一关）
    this.cmds = h('div', 'cmds', root);
    h('div', 'ct', this.cmds, '💬 发弹幕指挥糯糯');
    for (const [k, v] of [['踩', '重重踩一脚'], ['坐', '一屁股坐下'], ['踩奶', '踩踩奶'], ['跳', '蹦蹦跳'], ['转圈', '转个圈']]) {
      const row = h('div', 'cr', this.cmds);
      h('b', null, row, k); h('span', null, row, v);
    }
    this.elVoteHint = h('div', 'cv', this.cmds, '打「雪/落叶/史莱姆/水洼/沙滩/键盘」投票下一关');
    this.elVotes = h('div', 'votes', this.cmds);
    // 当前解压站的小标签
    this.elStation = h('div', 'station-pill', root, '');
    // 舞曲署名（CC BY 要求注明作者）
    this.elMusic = h('div', 'music-credit', root, '');
    // 感谢榜
    const board = h('div', 'board', root);
    h('h3', null, board, cfg.boardTitle || '💖 今日感谢榜 💖');
    this.elBoard = h('ol', null, board);
    this.setBoard([]);
    // 提示条、气泡、横幅
    this.elToasts = h('div', 'toasts', root);
    this.banner = h('div', 'banner', root);
    this.bT1 = h('div', 't1', this.banner);
    this.bT2 = h('div', 't2', this.banner);
    this.bubble = h('div', 'bubble', root);
    this.tips = h('div', 'tips', root);
    this.likes = h('div', 'likes', root, '');
    this.likes.style.display = 'none';
    this.title = h('div', 'title-card', root);
    this.tA = h('div', 'a', this.title);
    this.tB = h('div', 'b', this.title);
    h('br', null, this.title);
    this.tC = h('div', 'c', this.title);
    this.iris = h('div', 'iris', root);
    h('div', 'paw', this.iris, '🐾');
    this.irisR = 150;
    this.tipList = cfg.tips && cfg.tips.length ? cfg.tips : [
      '送任意礼物，糯糯会停下来给你跳支舞～',
      '中礼物：糯糯把你的名字踩进雪地/沙子里 ✍️',
      '大礼物：巨人糯糯出动，每一脚都超级重！',
      '戴上耳机听 🎧 每种材质都是真实录制的 ASMR 声音',
      '发弹幕「踩奶」，糯糯会给你踩踩奶 🐾',
      '点赞会冒出小爱心 💗  关注糯糯，陪它一起解压',
    ];
    this.tipIdx = 0;
    this._rotateTips();
    this.likeTotal = 0;
    this.toastList = [];
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  // 根据画面尺寸设置缩放单位（1080p 为基准）
  layout() {
    this._bubbleSize = null;
    const w = window.innerWidth, hh = window.innerHeight;
    const portrait = hh > w;
    const s = portrait ? w / 720 : Math.min(w / 1920, hh / 1080) * 1.0;
    document.documentElement.style.setProperty('--s', `${Math.max(0.35, s)}px`);
    document.body.classList.toggle('portrait', portrait);
    this.portrait = portrait;
  }

  setStage({ n, name, stations = [] }) {
    this.elLv.textContent = `第 ${n} 关`;
    this.elName.textContent = name;
    this.elDots.textContent = '';
    this.dots = stations.map((label, i) => {
      const d = h('span', i === stations.length - 1 ? 'dot big' : 'dot', this.elDots, i === stations.length - 1 ? '★' : '');
      d.title = label;
      return d;
    });
  }
  setStation(i, label) {
    (this.dots || []).forEach((d, k) => d.classList.toggle('cur', k === i));
    this.curStation = label;
  }
  stationDone(i) { const d = (this.dots || [])[i]; if (d) { d.classList.remove('cur'); d.classList.add('done'); } }
  setMeter(p) {
    const v = Math.max(0, Math.min(1, p || 0));
    this.elProg.style.width = `${Math.round(v * 100)}%`;
    this.elPct.textContent = `${Math.round(v * 100)}%`;
  }
  setProgress(p) { this.setMeter(p); }
  setSteps(n) {
    if (this._stepsShown === n) return;
    this._stepsShown = n;
    this.elSteps.textContent = `🐾 糯糯已经踩了 ${Number(n).toLocaleString('zh-CN')} 脚`;
  }
  // 走进一个新的解压站时，屏幕下方浮出它的名字
  floatStation(label) {
    if (this.cfg.showSoundLabels === false) return;
    this.elStation.textContent = `✦ ${label} ✦`;
    this.elStation.classList.add('show');
    clearTimeout(this._stT);
    this._stT = setTimeout(() => this.elStation.classList.remove('show'), 3200);
  }
  showMusic(text) { this.elMusic.textContent = text || ''; this.elMusic.classList.toggle('show', !!text); }
  // 声音素材致谢（CC BY 作者）加入底部轮播
  setAttribution(names) {
    if (!names || !names.length || this._attrAdded) return;
    this._attrAdded = true;
    this.tipList.push(`🎧 声音素材致谢：${names.slice(0, 6).join('、')} 等（CC BY），音乐 Kevin MacLeod（CC BY 4.0）`);
  }
  setVotes(votes, stages) {
    this.elVotes.textContent = '';
    if (!votes || !votes.size) { this.elVotes.style.display = 'none'; return; }
    this.elVotes.style.display = '';
    const list = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    h('span', 'vt', this.elVotes, '下一关投票：');
    for (const [id, n] of list) {
      const st = (stages || []).find((x) => x.id === id);
      h('span', 'vi', this.elVotes, `${st ? st.name : id} ${n} 票`);
    }
  }

  setBoard(list) {
    this.elBoard.textContent = '';
    if (!list || !list.length) { h('div', 'empty', this.elBoard, '虚位以待～送礼物上榜吧'); return; }
    list.slice(0, this.cfg.boardSize || 5).forEach((it, i) => {
      const li = h('li', null, this.elBoard);
      h('span', 'n', li, `${['🥇', '🥈', '🥉'][i] || ' ' + (i + 1) + '.'} ${it.name}`);
      h('span', 'v', li, `${it.value}`);
    });
  }

  toast(text, kind = 'gift', life = 6000) {
    const t = h('div', `toast ${kind}`, this.elToasts, text);
    this.toastList.push(t);
    while (this.toastList.length > (this.portrait ? 4 : 6)) { const old = this.toastList.shift(); old.remove(); }
    setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.remove(); this.toastList = this.toastList.filter((x) => x !== t); }, 520); }, life);
  }

  showThanks(line1, line2, superMode = false) {
    this.bT1.textContent = line1;
    this.bT2.textContent = line2 || '';
    this.bT2.style.display = line2 ? '' : 'none';
    this.banner.classList.toggle('super', !!superMode);
    this.banner.classList.add('show');
  }
  updateThanksSub(line2) { this.bT2.textContent = line2; this.bT2.style.display = line2 ? '' : 'none'; }
  hideThanks() { this.banner.classList.remove('show'); }

  say(text) { this.bubble.textContent = text; this.bubble.classList.add('show'); this._bubbleSize = null; }
  unsay() { this.bubble.classList.remove('show'); }
  // 气泡跟着糯糯的头；近景镜头里头顶出了画面时，气泡贴着画面边缘，不会被切掉
  placeBubble(x, y) {
    if (!this._bubbleSize) this._bubbleSize = [this.bubble.offsetWidth / 2 + 8, this.bubble.offsetHeight + 16];
    const [bw, bh] = this._bubbleSize;
    const W = this.root.clientWidth || innerWidth, H = this.root.clientHeight || innerHeight;
    x = Math.min(Math.max(x, bw), Math.max(bw, W - bw));
    y = Math.min(Math.max(y, bh), Math.max(bh, H - 12));
    this.bubble.style.left = `${x}px`; this.bubble.style.top = `${y}px`;
  }

  floatLabel(text, x, y) {
    if (this.cfg.showSoundLabels === false) return;
    const e = h('div', 'float-label', this.root, text);
    e.style.left = `${x}px`; e.style.top = `${y}px`;
    setTimeout(() => e.remove(), 1550);
  }

  addLikes(n) {
    this.likeTotal += n;
    this.likes.style.display = '';
    this.likes.textContent = `💗 ${this.likeTotal}`;
  }

  async showTitle(n, name, sub, secs = 3.2) {
    this.tA.textContent = `第 ${n} 关`;
    this.tB.textContent = name;
    this.tC.textContent = sub || '';
    this.title.classList.add('show');
    await sleep(secs * 1000);
    this.title.classList.remove('show');
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
    this.tips.textContent = this.tipList[this.tipIdx % this.tipList.length];
    this.tipIdx++;
    setTimeout(() => {
      this.tips.style.opacity = '0';
      setTimeout(() => { this._rotateTips(); this.tips.style.opacity = '1'; }, 600);
    }, 9000);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
