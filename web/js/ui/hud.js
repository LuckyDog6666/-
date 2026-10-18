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
    // 关卡卡片
    const card = h('div', 'level-card', root);
    const r1 = h('div', 'row1', card);
    this.elLv = h('span', 'lv', r1, '第 1 关');
    this.elName = h('span', 'name', r1, '');
    const r2 = h('div', 'row2', card);
    this.elStars = h('span', 'stars', r2);
    this.elKey = h('span', 'keyicon', r2, '🔑');
    this.elProg = h('i', null, h('div', 'progress', card));
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
      '大礼物会解锁皇冠和彩带特效哦 ✨',
      '戴上耳机听，每一步都是不同的 ASMR 声音 🎧',
      '点赞会冒出小爱心 💗  关注糯糯，陪它闯关吧',
      '糯糯正在自己闯关：收集 3 颗星星，找到钥匙打开小门！',
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
    const w = window.innerWidth, hh = window.innerHeight;
    const portrait = hh > w;
    const s = portrait ? w / 720 : Math.min(w / 1920, hh / 1080) * 1.0;
    document.documentElement.style.setProperty('--s', `${Math.max(0.35, s)}px`);
    document.body.classList.toggle('portrait', portrait);
    this.portrait = portrait;
  }

  setLevel({ n, name, stars = 0, total = 3, needKey = false, hasKey = false }) {
    this.elLv.textContent = `第 ${n} 关`;
    this.elName.textContent = name;
    this.elStars.textContent = '';
    for (let i = 0; i < total; i++) h('span', i < stars ? 'on' : 'off', this.elStars, '★');
    this.elKey.style.display = needKey ? '' : 'none';
    this.elKey.classList.toggle('on', hasKey);
  }
  setProgress(p) { this.elProg.style.width = `${Math.round(p * 100)}%`; }

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

  say(text) { this.bubble.textContent = text; this.bubble.classList.add('show'); }
  unsay() { this.bubble.classList.remove('show'); }
  placeBubble(x, y) { this.bubble.style.left = `${x}px`; this.bubble.style.top = `${y}px`; }

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
