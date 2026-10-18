// 备用方案：对接成熟的开源弹幕抓取工具 DouyinBarrageGrab（WssBarrageService.exe）。
// 它通过系统代理抓取直播伴侣/浏览器的弹幕，在 ws://127.0.0.1:8888 推送 JSON。
// 消息格式：{ Type: 1弹幕 2点赞 3进房 4关注 5礼物 6统计 ..., Data: "<JSON字符串>" }
export class BarrageGrabProvider {
  constructor({ cfg, emit, log }) {
    this.cfg = cfg; this.emit = emit; this.log = log;
    this.state = 'idle'; this.events = 0; this.lastFrameAt = 0; this.stopped = false; this.backoff = 2000;
  }
  status() { return { source: 'barragegrab', state: this.state, url: this.cfg.barrageGrabUrl, events: this.events, lastFrameAt: this.lastFrameAt, message: this.message || '' }; }
  _set(state, message = '') { this.state = state; this.message = message; this.emit({ type: 'status', ...this.status() }); }

  start() { this.connect(); }

  connect() {
    if (this.stopped) return;
    const url = this.cfg.barrageGrabUrl || 'ws://127.0.0.1:8888';
    this._set('connecting', '正在连接弹幕抓取工具 ' + url);
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return this.retry(e.message); }
    this.ws = ws;
    ws.addEventListener('open', () => { this.backoff = 2000; this._set('listening', '已连接弹幕抓取工具'); this.log('[BarrageGrab] 已连接 ' + url); });
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    ws.addEventListener('close', () => this.retry('连接断开'));
    ws.addEventListener('error', () => {});
  }

  retry(why) {
    if (this.stopped) return;
    this._set('error', `${why}，${Math.round(this.backoff / 1000)} 秒后重连（请确认 WssBarrageService 正在运行）`);
    clearTimeout(this.t);
    this.t = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(30000, this.backoff * 1.6);
  }

  onMessage(raw) {
    let pack;
    try { pack = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); } catch { return; }
    let d = pack.Data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
    if (!d) return;
    this.lastFrameAt = Date.now();
    const u = d.User || {};
    const user = { id: String(u.Id || u.SecUid || u.Nickname || ''), name: u.Nickname || '神秘人', avatar: u.HeadImgUrl || '' };
    let ev = null;
    switch (Number(pack.Type)) {
      case 1: ev = { type: 'chat', user, text: d.Content || '' }; break;
      case 2: ev = { type: 'like', user, count: Number(d.Count) || 1 }; break;
      case 3: ev = { type: 'enter', user }; break;
      case 4: ev = { type: 'follow', user }; break;
      case 5: {
        const count = Number(d.GiftCount) || 0;
        if (count <= 0) return; // 连击过程中的重复包
        ev = { type: 'gift', user, gift: { id: String(d.GiftId || ''), name: d.GiftName || '礼物', count, diamond: Number(d.DiamondCount) || 0, image: d.ImgUrl || '' } };
        break;
      }
      case 6: ev = { type: 'online', count: Number(d.OnlineUserCount || d.OnlineUserCountStr || 0) }; break;
      default: return;
    }
    this.events++;
    this.emit(ev);
  }

  stop() { this.stopped = true; clearTimeout(this.t); try { this.ws && this.ws.close(); } catch {} }
}
