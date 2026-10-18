// 演示/测试模式：随机生成礼物、点赞、关注，方便不开播时预览效果。
const NAMES = ['小橘子', '奶茶不加糖', '星星眨眼', '晚风轻轻', '甜甜圈', '布丁酱', '一只小熊', '月亮邮递员', '草莓味的云', '柚子', '摸鱼大师', '熬夜冠军'];
const GIFTS = [
  { name: '小心心', diamond: 1, w: 6 }, { name: '玫瑰', diamond: 1, w: 4 }, { name: '抖音', diamond: 1, w: 3 },
  { name: '你最好看', diamond: 2, w: 2 }, { name: '加油鸭', diamond: 15, w: 1.5 }, { name: '爱你哟', diamond: 52, w: 1 },
  { name: '比心兔兔', diamond: 199, w: 0.4 }, { name: '嘉年华', diamond: 3000, w: 0.08 },
];

export class MockProvider {
  constructor({ cfg, emit, log }) { this.cfg = cfg; this.emit = emit; this.log = log; this.events = 0; this.state = 'idle'; }
  status() { return { source: 'mock', state: this.state, events: this.events, message: '演示模式：随机模拟礼物' }; }
  start() {
    this.state = 'listening';
    this.emit({ type: 'status', ...this.status() });
    this.log('[演示] 已开启演示模式，会随机模拟礼物/点赞/关注');
    const [a, b] = this.cfg.mock?.intervalSec || [15, 45];
    const tick = () => {
      const r = Math.random();
      const name = NAMES[Math.floor(Math.random() * NAMES.length)];
      const user = { id: 'mock-' + name, name };
      if (r < 0.55) {
        let total = GIFTS.reduce((s, g) => s + g.w, 0), x = Math.random() * total, g = GIFTS[0];
        for (const it of GIFTS) { x -= it.w; if (x <= 0) { g = it; break; } }
        this.emit({ type: 'gift', user, gift: { id: g.name, name: g.name, count: g.diamond < 5 ? 1 + Math.floor(Math.random() * 3) : 1, diamond: g.diamond } });
      } else if (r < 0.85) this.emit({ type: 'like', user, count: 1 + Math.floor(Math.random() * 15) });
      else if (r < 0.93) this.emit({ type: 'follow', user });
      else this.emit({ type: 'enter', user });
      this.events++;
      this.t = setTimeout(tick, (a + Math.random() * (b - a)) * 1000);
    };
    this.t = setTimeout(tick, 4000);
  }
  stop() { clearTimeout(this.t); }
}
