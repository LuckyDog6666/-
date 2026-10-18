// 抖音直播间监听（默认方案）：
// 用本机 Edge/Chrome 以"观众"身份打开你的直播间网页，通过浏览器调试协议(CDP) 读取页面收到的
// 弹幕/礼物数据帧，再在本地解码。签名等加密参数全部由浏览器自己完成，抖音改版签名算法也不受影响。
// 浏览器静音、并拦截视频流（不占带宽、不会把直播声音录回去）。
import path from 'node:path';
import fs from 'node:fs';
import { CDP, getBrowserWsUrl } from '../cdp.js';
import { findBrowser, launchBrowser, ANTI_THROTTLE_FLAGS, killByProfile, killTree } from '../browser.js';
import { decodePushFrame, decodeFetchBody, messagesToEvents, GiftDeduper } from '../douyin/decode.js';

// 注入到直播页：防止"长时间无操作自动暂停/断开"
const ANTI_PAUSE = `
(() => {
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Document.prototype.hasFocus = () => true;
    const stop = (e) => e.stopImmediatePropagation();
    window.addEventListener('visibilitychange', stop, true);
    document.addEventListener('visibilitychange', stop, true);
    window.addEventListener('blur', stop, true);
    window.addEventListener('pagehide', stop, true);
  } catch (e) {}
  const words = ['继续观看', '我知道了', '继续播放', '刷新重试', '重新加载'];
  setInterval(() => {
    try {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200 + Math.random() * 300, clientY: 200 + Math.random() * 200 }));
      for (const el of document.querySelectorAll('button, [role=button], div, span')) {
        const t = (el.textContent || '').trim();
        if (t.length <= 6 && words.includes(t) && el.offsetParent) { el.click(); break; }
      }
    } catch (e) {}
  }, 20000);
})();
`;

const BLOCK_VIDEO = ['*://pull-*', '*.flv?*', '*.flv', '*.m3u8*', '*://*-hls-*', '*://*.douyinvod.com/*'];

export class DouyinProvider {
  constructor({ cfg, emit, log, dataDir }) {
    this.cfg = cfg;
    this.emit = emit;
    this.log = log;
    this.dataDir = dataDir;
    this.dedupe = new GiftDeduper();
    this.state = 'idle';
    this.frames = 0;
    this.events = 0;
    this.lastFrameAt = 0;
    this.stopped = false;
    this.wsIds = new Set();
    this.fetchIds = new Set();
    this.reloads = 0;
    this.backoff = 3000;
  }

  status() {
    return { source: 'douyin', state: this.state, room: this.cfg.room, frames: this.frames, events: this.events, lastFrameAt: this.lastFrameAt, message: this.message || '' };
  }

  _setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.emit({ type: 'status', ...this.status() });
  }

  async start() {
    if (!this.cfg.room) { this._setState('error', '还没有填写直播间号（config.json 里的 room）'); this.log('[抖音] 未配置直播间号，监听未启动。请在控制台或 config.json 中填写 room。'); return; }
    this.loop();
  }

  async loop() {
    while (!this.stopped) {
      try {
        await this.session();
        this.backoff = 3000;
      } catch (e) {
        if (this.stopped) break;
        this.log(`[抖音] 监听中断：${e.message}`);
        this._setState('error', e.message);
      }
      await this.teardown();
      if (this.stopped) break;
      await sleep(this.backoff);
      this.backoff = Math.min(60000, this.backoff * 2);
    }
  }

  async session() {
    const exe = findBrowser(this.cfg.browserPath);
    if (!exe) throw new Error('没有找到 Chrome 或 Edge 浏览器');
    const L = this.cfg.listener || {};
    const port = L.cdpPort || 19333;
    const profile = path.join(this.dataDir, 'nuonuo-douyin-profile');
    fs.mkdirSync(profile, { recursive: true });
    await killByProfile('nuonuo-douyin-profile');
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--mute-audio',
      '--window-size=1000,760',
      L.visible ? '--window-position=80,80' : '--window-position=40,40',
      '--autoplay-policy=user-gesture-required',
      ...ANTI_THROTTLE_FLAGS,
      ...(L.headless ? ['--headless=new'] : []),
      'about:blank',
    ];
    this._setState('starting', '正在启动监听浏览器');
    this.child = launchBrowser(exe, args, this.log);
    const wsUrl = await getBrowserWsUrl(port, 30000);
    const cdp = await CDP.connect(wsUrl);
    this.cdp = cdp;
    const closed = new Promise((res) => cdp.on('__close', res));
    const exited = new Promise((res) => this.child.on('exit', res));

    const { targetInfos } = await cdp.send('Target.getTargets');
    let page = targetInfos.find((t) => t.type === 'page');
    if (!page) page = { targetId: (await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId };
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    this.sessionId = sessionId;
    this.targetId = page.targetId;
    const S = (m, p) => cdp.send(m, p, sessionId);

    cdp.on('Network.webSocketCreated', (p) => { if (/webcast\/im\/push/.test(p.url)) { this.wsIds.add(p.requestId); this.log('[抖音] 弹幕通道已连接'); } });
    cdp.on('Network.webSocketClosed', (p) => { if (this.wsIds.delete(p.requestId)) this.log('[抖音] 弹幕通道关闭（页面会自动重连）'); });
    cdp.on('Network.webSocketFrameReceived', (p) => {
      if (!this.wsIds.has(p.requestId) || p.response.opcode !== 2) return;
      try { this.onBinary(Buffer.from(p.response.payloadData, 'base64'), 'ws'); } catch (e) { this.decodeErrors = (this.decodeErrors || 0) + 1; }
    });
    cdp.on('Network.responseReceived', (p) => { if (/webcast\/im\/fetch/.test(p.response.url)) this.fetchIds.add(p.requestId); });
    cdp.on('Network.loadingFinished', async (p) => {
      if (!this.fetchIds.delete(p.requestId)) return;
      try {
        const body = await S('Network.getResponseBody', { requestId: p.requestId });
        const buf = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'binary');
        this.onBinary(buf, 'fetch');
      } catch {}
    });

    await S('Network.enable', { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 5_000_000 });
    await S('Page.enable');
    await S('Page.addScriptToEvaluateOnNewDocument', { source: ANTI_PAUSE });
    if (L.blockVideo !== false) await S('Network.setBlockedURLs', { urls: BLOCK_VIDEO });
    const url = `${L.baseUrl || 'https://live.douyin.com/'}${encodeURIComponent(this.cfg.room)}`;
    this.log(`[抖音] 打开直播间 ${url}`);
    this._setState('connecting', '正在打开直播间');
    await S('Page.navigate', { url });
    this.lastFrameAt = Date.now();
    if (!L.visible) {
      try {
        const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: page.targetId });
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      } catch {}
    }

    // 静默看门狗：长时间收不到任何数据就刷新页面；多次无效就重启浏览器
    const silent = (L.reloadIfSilentSec || 150) * 1000;
    const watchdog = setInterval(async () => {
      const quiet = Date.now() - this.lastFrameAt;
      if (this.frames > 0 && quiet < 20000 && this.state !== 'listening') this._setState('listening', '正在监听礼物');
      if (quiet > 30000 && this.state === 'listening') this._setState('silent', '暂时没有收到数据（直播间未开播或网络波动）');
      if (quiet > silent) {
        this.reloads++;
        this.lastFrameAt = Date.now();
        this.log(`[抖音] ${Math.round(quiet / 1000)} 秒没有数据，刷新直播间页面（第 ${this.reloads} 次）`);
        if (this.reloads >= 4) { this.reloads = 0; this.log('[抖音] 多次刷新无效，重启监听浏览器'); cdp.close(); return; }
        try { await S('Page.navigate', { url }); } catch {}
      }
    }, 10000);
    await Promise.race([closed, exited]);
    clearInterval(watchdog);
    throw new Error('监听浏览器已关闭');
  }

  onBinary(buf, via) {
    let response;
    if (via === 'ws') {
      const r = decodePushFrame(buf);
      response = r.response;
    } else response = decodeFetchBody(buf);
    this.frames++;
    this.lastFrameAt = Date.now();
    this.reloads = 0;
    if (!response) return;
    for (const ev of messagesToEvents(response)) {
      let out = ev;
      if (ev.type === 'giftRaw') { out = this.dedupe.push(ev); if (!out) continue; }
      if (ev.type === 'liveEnd') { this.log('[抖音] 收到下播消息'); continue; }
      this.events++;
      this.emit(out);
    }
  }

  async teardown() {
    try { this.cdp && this.cdp.close(); } catch {}
    this.cdp = null;
    this.wsIds.clear();
    this.fetchIds.clear();
    if (this.child) { killTree(this.child); this.child = null; }
    await sleep(800);
  }

  async stop() { this.stopped = true; await this.teardown(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
