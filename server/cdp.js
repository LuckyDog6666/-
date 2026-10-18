// 极简 Chrome DevTools Protocol 客户端（使用 Node 22+ 自带的 WebSocket，无需安装任何依赖）。
export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', () => this._onClose());
    ws.addEventListener('error', () => {});
  }

  static async connect(url, timeoutMs = 10000) {
    if (typeof WebSocket === 'undefined') throw new Error('当前 Node.js 版本没有内置 WebSocket，请使用 Node.js 22 或更高版本');
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP 连接超时')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('CDP 连接失败')); }, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('CDP 已断开'));
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} 超时`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, t, method });
      try { this.ws.send(JSON.stringify(msg)); } catch (e) { clearTimeout(t); this.pending.delete(id); reject(e); }
    });
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); } catch { return; }
    if (msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.t);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result || {});
      return;
    }
    const hs = this.handlers.get(msg.method);
    if (hs) for (const h of hs) { try { h(msg.params || {}, msg.sessionId); } catch (e) { console.error('[cdp] handler error', e); } }
  }

  _onClose() {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.t); p.reject(new Error('CDP 连接关闭')); }
    this.pending.clear();
    const hs = this.handlers.get('__close');
    if (hs) for (const h of hs) { try { h(); } catch {} }
  }

  close() { try { this.ws.close(); } catch {} }
}

export async function getBrowserWsUrl(port, timeoutMs = 20000) {
  const t0 = Date.now();
  let lastErr;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) { const j = await r.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; }
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('浏览器调试端口未就绪：' + (lastErr ? lastErr.message : '超时'));
}
