// 今日感谢榜：按抖币累计，每天在设定的时间（默认早上 5 点）自动清零，数据保存在 data/board.json。
import fs from 'node:fs';

export class Board {
  constructor(file, opts = {}) {
    this.file = file;
    this.resetHour = opts.resetHour ?? 5;
    this.size = opts.size ?? 5;
    this.data = { day: this.dayKey(), users: {} };
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d && d.day === this.data.day && d.users) this.data = d;
    } catch {}
    this._dirty = false;
    setInterval(() => this.flush(), 15000).unref?.();
  }
  dayKey() {
    const d = new Date(Date.now() - this.resetHour * 3600 * 1000);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  _roll() {
    const k = this.dayKey();
    if (k !== this.data.day) { this.data = { day: k, users: {} }; this._dirty = true; }
  }
  // 返回榜单前几名是否发生变化
  add(user, value) {
    this._roll();
    const before = JSON.stringify(this.top());
    const id = String(user?.id || user?.name || '?');
    const u = this.data.users[id] || (this.data.users[id] = { name: user?.name || '神秘老板', value: 0 });
    u.name = user?.name || u.name;
    u.value += Math.max(0, Math.round(value));
    this._dirty = true;
    return JSON.stringify(this.top()) !== before;
  }
  top() {
    this._roll();
    return Object.values(this.data.users).sort((a, b) => b.value - a.value).slice(0, this.size).map((u) => ({ name: u.name, value: u.value }));
  }
  clear() { this.data = { day: this.dayKey(), users: {} }; this._dirty = true; this.flush(); }
  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch {}
  }
}
