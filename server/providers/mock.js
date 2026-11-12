// 演示/测试模式：模拟一个"几十个人在看"的直播间——点赞最多，弹幕其次（里面有投票、烦恼、指令），
// 偶尔有人进房、关注，礼物很少（和真实的小直播间差不多）。方便不开播时预览全部互动效果。
// config.json 里 "mock": { "pace": 2 } 可以让互动密一倍；"gifts": false 关掉模拟礼物。
const NAMES = ['小橘子', '奶茶不加糖', '星星眨眼', '晚风轻轻', '甜甜圈', '布丁酱', '一只小熊', '月亮邮递员', '草莓味的云', '柚子', '摸鱼大师', '熬夜冠军', '打工喵', '下班了吗', '芝士就是力量', '今天也要早睡'];
const WORRIES = ['加班', '周一', 'KPI', '早八', '房贷', '堵车', '熬夜', '内耗', '焦虑', '甲方', 'PPT', '迟到', '没钱', '失眠', '催婚', '减肥', '脱发', '开会', '周报', '老板画饼'];
const COMMANDS = ['踩奶', '坐下坐下', '跳一跳', '用力踩！', '转圈圈', '下一关去雪地', '想看史莱姆', '去厨房', '沙滩！'];
const TALK = ['好治愈啊', '糯糯好可爱', '加油', '声音好舒服', '哈哈哈', '冲鸭', '太解压了', '晚安'];
const VOTES = ['1', '2', '3', '1', '2', '左', '右', '左', '右'];
const GIFTS = [
  { name: '小心心', diamond: 1, w: 8 }, { name: '玫瑰', diamond: 1, w: 5 }, { name: '抖音', diamond: 1, w: 3 }, { name: '粉丝团灯牌', diamond: 1, w: 3 },
  { name: '你最好看', diamond: 2, w: 2 }, { name: '棒棒糖', diamond: 9, w: 1.5 }, { name: '爱你哟', diamond: 52, w: 0.5 },
  { name: '比心兔兔', diamond: 199, w: 0.15 }, { name: '嘉年华', diamond: 3000, w: 0.03 },
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class MockProvider {
  constructor({ cfg, emit, log }) { this.cfg = cfg; this.emit = emit; this.log = log; this.events = 0; this.state = 'idle'; this.timers = []; }
  status() { return { source: 'mock', state: this.state, events: this.events, message: '演示模式：随机模拟观众互动' }; }
  start() {
    this.state = 'listening';
    this.emit({ type: 'status', ...this.status() });
    this.log('[演示] 已开启演示模式，会随机模拟点赞 / 弹幕 / 关注 / 礼物');
    const M = this.cfg.mock || {};
    const pace = Math.max(0.2, Number(M.pace) || 1);
    const user = () => { const name = pick(NAMES); return { id: 'mock-' + name, name }; };
    const send = (ev) => { this.events++; this.emit(ev); };
    // 每一类互动各自按自己的节奏来（间隔带随机）
    const every = (a, b, fn) => {
      const tick = () => { fn(); this.timers[i] = setTimeout(tick, (a + Math.random() * (b - a)) * 1000 / pace); };
      const i = this.timers.length;
      this.timers.push(setTimeout(tick, (2 + Math.random() * b) * 1000 / pace));
    };
    every(1.5, 5, () => send({ type: 'like', user: user(), count: 1 + Math.floor(Math.random() * 12) }));
    every(4, 11, () => {
      const r = Math.random();
      const text = r < 0.35 ? pick(WORRIES) : r < 0.6 ? pick(VOTES) : r < 0.78 ? pick(TALK) : pick(COMMANDS);
      send({ type: 'chat', user: user(), text });
    });
    every(9, 22, () => send({ type: 'enter', user: user() }));
    every(50, 120, () => send({ type: Math.random() < 0.75 ? 'follow' : 'fansclub', user: user() }));
    every(140, 260, () => send({ type: 'share', user: user() }));
    if (M.gifts !== false) {
      const [a, b] = M.intervalSec || [45, 110];
      every(a, b, () => {
        let total = GIFTS.reduce((s, g) => s + g.w, 0), x = Math.random() * total, g = GIFTS[0];
        for (const it of GIFTS) { x -= it.w; if (x <= 0) { g = it; break; } }
        send({ type: 'gift', user: user(), gift: { id: g.name, name: g.name, count: g.diamond < 5 ? 1 + Math.floor(Math.random() * 3) : 1, diamond: g.diamond } });
      });
    }
  }
  stop() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
}
