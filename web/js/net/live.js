// 直播事件客户端：通过 SSE（服务器推送事件）接收礼物/点赞/关注，断线自动重连且不丢事件。
export class LiveClient {
  constructor({ onEvent }) {
    this.onEvent = onEvent;
    this.connected = false;
    this.lastAt = 0;
    this.count = 0;
    this.seen = new Set();
    try { this.lastId = Number(localStorage.getItem('nuonuo.lastEventId')) || 0; } catch { this.lastId = 0; }
  }

  connect() {
    if (this.es) { try { this.es.close(); } catch {} }
    const url = `/api/events?since=${this.lastId}`;
    const es = new EventSource(url);
    this.es = es;
    es.onopen = () => { this.connected = true; };
    es.onerror = () => {
      this.connected = false;
      // EventSource 会自动重连；如果被浏览器彻底关闭了就手动重连
      if (es.readyState === EventSource.CLOSED) setTimeout(() => this.connect(), 3000);
    };
    es.onmessage = (m) => {
      this.lastAt = Date.now();
      let ev;
      try { ev = JSON.parse(m.data); } catch { return; }
      const id = Number(m.lastEventId) || 0;
      if (id) {
        if (this.seen.has(id)) return; // 去重（重连补发时）
        this.seen.add(id);
        if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
        if (id > this.lastId) { this.lastId = id; try { localStorage.setItem('nuonuo.lastEventId', String(id)); } catch {} }
      }
      if (ev.type === 'ping') return;
      this.count++;
      try { this.onEvent(ev); } catch (e) { console.error(e); }
    };
    // 心跳超时：60 秒没有任何消息（服务器每 15 秒发 ping）就重连
    clearInterval(this.watch);
    this.watch = setInterval(() => {
      if (this.lastAt && Date.now() - this.lastAt > 60000) { this.lastAt = Date.now(); this.connect(); }
    }, 10000);
  }

  status() { return { connected: this.connected, events: this.count, lastAt: this.lastAt }; }
}
