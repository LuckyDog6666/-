// 抖音直播间监听（默认方案）：
// 用本机 Edge/Chrome 以"观众"身份打开你的直播间网页，通过浏览器调试协议(CDP) 读取页面收到的
// 弹幕/礼物数据帧，再在本地解码。签名等加密参数全部由浏览器自己完成，抖音改版签名算法也不受影响。
// 浏览器静音、并拦截视频流（不占带宽、不会把直播声音录回去）。
//
// v2（上线后发现"弹幕、礼物没反应"以后重做的部分）：
//  - 按内容认数据帧：页面上所有 WebSocket 的二进制帧都试着解码，解得出直播间消息的就是弹幕通道
//    （以前只认网址里带 webcast/im/push 的连接：抖音换了地址，或者连接建在 Worker 里晚一步被发现，就全丢了）
//  - 每 5 秒看一眼页面：是不是被拦在"安全验证 / 登录 / 直播间不存在 / 还没开播"上，
//    把原因用大白话写进状态里；遇到安全验证自动把监听窗口弹出来让人处理，过了以后自动收起来
//  - 备用通道：数据帧一直解不出弹幕时，直接读页面聊天区的文字（昵称：内容）
//  - 拦截视频流后迟迟连不上，自动放开拦截重试一次
//  - status() 里带上每种事件的条数、最近一条弹幕、页面标题、通道地址，控制台据此做"连接体检"
import path from 'node:path';
import fs from 'node:fs';
import { CDP, getBrowserWsUrl } from '../cdp.js';
import { findBrowser, launchBrowser, ANTI_THROTTLE_FLAGS, killByProfile, killTree } from '../browser.js';
import { decodePushFrame, decodeFetchBody, messagesToEvents, looksLikeWebcast, GiftDeduper } from '../douyin/decode.js';

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

// 注入到直播页：把聊天区新出现的每一行文字记下来（备用通道，平时不用）
const DOM_HOOK = `
(() => {
  if (window.__nnHooked) return; window.__nnHooked = true;
  const q = window.__nnq = [];
  const seen = new WeakSet();
  let lastBottom = '';
  const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const push = (t) => { if (!t || t.length > 120) return; q.push({ t, ts: Date.now() }); if (q.length > 300) q.splice(0, q.length - 300); };
  const ITEM = '[class*="chatroom___item"]', BOTTOM = '[class*="chatroom___bottom-message"], [class*="chatroom___enter"]';
  const scan = (n) => {
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (!el || !el.closest) return;
    const b = el.closest(BOTTOM);
    if (b) { const t = text(b); if (t && t !== lastBottom) { lastBottom = t; push(t); } return; }
    const items = [];
    const it = el.closest(ITEM);
    if (it) items.push(it); else if (n.nodeType === 1 && n.querySelectorAll) items.push(...n.querySelectorAll(ITEM));
    for (const x of items) { if (seen.has(x)) continue; seen.add(x); push(text(x)); }
  };
  const start = () => {
    try { new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) scan(n); if (m.type === 'characterData') scan(m.target); } }).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); } catch (e) {}
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
})();
`;

// 每隔几秒在页面里跑一下：页面现在是什么情况
const PROBE = `
(() => {
  const b = document.body;
  const text = b ? (b.innerText || '').replace(/\\s+/g, ' ').slice(0, 1500) : '';
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight);
  const q = (s) => { try { return document.querySelector(s); } catch (e) { return null; } };
  const captcha = vis(q('#captcha_container')) || vis(q('iframe[src*="verify"]')) || vis(q('iframe[src*="captcha"]')) || vis(q('[class*="captcha_verify"]')) || vis(q('[id*="captcha"]')) || vis(q('[class*="secsdk-captcha"]'));
  const login = vis(q('#login-pannel')) || vis(q('[id*="login-full-panel"]')) || vis(q('[class*="login-panel"]')) || vis(q('[class*="loginContainer"]')) || vis(q('[class*="login-mask"]'));
  let items = 0; try { items = document.querySelectorAll('[class*="chatroom___item"]').length; } catch (e) {}
  return { href: location.href, title: document.title, text, captcha, login, items, ready: document.readyState, dom: (window.__nnq || []).splice(0) };
})()
`;

const BLOCK_VIDEO = ['*://pull-*', '*.flv?*', '*.flv', '*.m3u8*', '*://*-hls-*', '*://*.douyinvod.com/*'];
const USER_EVENTS = ['chat', 'gift', 'like', 'enter', 'follow', 'share', 'fansclub'];

// 直播间号：可以直接粘贴整条网址（live.douyin.com/123456?xxx），自动取出号码
export function normalizeRoom(input) {
  let r = String(input || '').trim();
  if (!r) return '';
  const m = r.match(/live\.douyin\.com\/(?:follow\/)?([A-Za-z0-9_.\-]+)/i);
  if (m) return m[1];
  r = r.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (r.includes('/')) r = r.split('/').pop();
  return r.replace(/\s+/g, '');
}

// 聊天区的一行文字 → 事件（备用通道）。格式："昵称：内容" / "昵称 来了" / "昵称：送出了 xx × 3" / "昵称：为主播点赞了"
export function parseDomLine(t) {
  let m;
  if ((m = t.match(/^(.{1,30}?)\s*来了$/))) return { type: 'enter', name: lastToken(m[1]) };
  const i = t.indexOf('：');
  if (i <= 0) return null;
  const name = lastToken(t.slice(0, i));
  const content = t.slice(i + 1).trim();
  if (!name || !content) return null;
  if (/^为主播点赞/.test(content)) return { type: 'like', name };
  if (/^关注了主播/.test(content)) return { type: 'follow', name };
  if (/^分享了直播间/.test(content)) return { type: 'share', name };
  if (/^(加入了|点亮了).{0,6}粉丝团/.test(content)) return { type: 'fansclub', name };
  if ((m = content.match(/^送出了?\s*(.*?)\s*[×xX*]\s*(\d+)\s*$/))) return { type: 'gift', name, gift: m[1] || '礼物', count: Number(m[2]) || 1 };
  if (/^送出了?/.test(content)) return { type: 'gift', name, gift: content.replace(/^送出了?\s*/, '') || '礼物', count: 1 };
  return { type: 'chat', name, text: content };
}
// 昵称前面可能带着等级、粉丝牌的文字（"小糯米 12 昵称"）：取最后一段
function lastToken(s) { const a = String(s).trim().split(' ').filter(Boolean); return a.length ? a[a.length - 1] : ''; }

// 页面现在卡在哪里
export function classifyPage(p) {
  const t = `${p.title || ''} ${p.text || ''}`;
  if (p.captcha || /验证码中间页|安全验证|请完成下列验证|拖动滑块|请依次点击|访问过于频繁|操作过于频繁/.test(t)) return 'verify';
  if (/^chrome-error:/.test(p.href || '') || /无法访问此网站|未连接到互联网|ERR_[A-Z_]{4,}/.test(t)) return 'neterror';
  if (/直播间不存在|你访问的页面不见了|页面不存在|内容不存在|该内容暂时无法查看/.test(t)) return 'notfound';
  if (/直播已结束|暂未开播|主播暂时离开|还没开播/.test(t)) return 'offline';
  if (p.login) return 'login';
  return 'ok';
}

const HINTS = {
  verify: ['抖音要求先做安全验证', '已经把"监听窗口"弹出来了：请在里面完成验证（拖动滑块 / 点选图片），验证通过后会自动继续，窗口也会自己收起来。'],
  neterror: ['监听窗口打不开抖音网页', '请检查这台电脑能不能上网、有没有开着会拦截网页的代理或安全软件。'],
  notfound: ['没有找到这个直播间', '请检查直播间号：用电脑浏览器打开 live.douyin.com/你的直播间号，能看到自己的直播才是对的。'],
  offline: ['直播间还没有开播', '开播以后会自动连上，不需要重启程序。'],
  login: ['抖音要求登录后才能看弹幕', '在控制台点"显示监听窗口"，在窗口里用抖音 App 扫码登录一个账号（建议用小号），登录一次以后都不用再登。'],
};

export class DouyinProvider {
  constructor({ cfg, emit, log, dataDir }) {
    this.cfg = cfg;
    this.emit = emit;
    this.log = log;
    this.dataDir = dataDir;
    this.room = normalizeRoom(cfg.room);
    this.dedupe = new GiftDeduper();
    this.state = 'idle';
    this.frames = 0;
    this.events = 0;
    this.lastFrameAt = 0;
    this.stopped = false;
    this.sockets = new Map();   // "会话|请求号" → { url, frames, ok, bad }
    this.fetchIds = new Set();
    this.reloads = 0;
    this.backoff = 3000;
    this.counts = Object.fromEntries(USER_EVENTS.map((k) => [k, 0]));
    this.lastOf = {};           // 每种事件最近一条（给控制台看）
    this.lastEventAt = 0;       // 最近一条观众互动（任何通道）
    this.lastPbEventAt = 0;     // 最近一条从数据帧解出来的观众互动
    this.unknown = new Map();   // 没处理的消息类型 → 条数
    this.decodeErrors = 0;
    this.compress = new Set();
    this.page = { kind: 'unknown', href: '', title: '', text: '', items: 0 };
    this.channel = '';          // ws / fetch / dom
    this.visible = !!(cfg.listener && cfg.listener.visible);
    this.autoShown = false;
    this.videoUnblocked = false;
    this.hint = '';
  }

  status() {
    const imSockets = [...this.sockets.values()].filter((s) => s.ok > 0).map((s) => ({ url: String(s.url).slice(0, 90), frames: s.ok }));
    return {
      source: 'douyin', state: this.state, room: this.room, frames: this.frames, events: this.events, lastFrameAt: this.lastFrameAt,
      message: this.message || '', hint: this.hint || '', counts: { ...this.counts }, last: this.lastOf, lastEventAt: this.lastEventAt,
      channel: this.channel, page: { kind: this.page.kind, href: this.page.href, title: this.page.title, items: this.page.items },
      visible: this.visible, sockets: imSockets.slice(0, 3), decodeErrors: this.decodeErrors,
    };
  }

  // 完整体检报告（控制台"导出诊断"用）
  diagnose() {
    return {
      ...this.status(), at: new Date().toISOString(), pageText: (this.page.text || '').slice(0, 600),
      allSockets: [...this.sockets.values()].map((s) => ({ url: String(s.url).slice(0, 160), frames: s.frames, ok: s.ok, bad: s.bad })),
      unknownMethods: [...this.unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
      compress: [...this.compress], reloads: this.reloads, videoUnblocked: this.videoUnblocked,
      listenerCfg: this.cfg.listener || {}, browser: findBrowser(this.cfg.browserPath) || '(没找到)',
    };
  }

  _setState(state, message = '', hint = '') {
    const changed = state !== this.state || message !== this.message;
    this.state = state;
    this.message = message;
    this.hint = hint;
    if (changed) this.emit({ type: 'status', ...this.status() });
  }

  async start() {
    if (!this.room) { this._setState('error', '还没有填写直播间号', '打开控制台，在"抖音直播间号"里填上 live.douyin.com/ 后面的那串号码。'); this.log('[抖音] 未配置直播间号，监听未启动。请在控制台或 config.json 中填写 room。'); return; }
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
        this._setState('error', e.message, /没有找到 Chrome/.test(e.message) ? '请安装 Chrome 浏览器，或在 config.json 的 browserPath 里填上浏览器的位置。' : '程序会自动重试。');
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
      '--window-size=1100,800',
      '--window-position=60,60',
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
    const S = (m, p, t) => cdp.send(m, p, sessionId, t);
    this.S = S;
    const key = (sid, id) => `${sid || ''}|${id}`;

    cdp.on('Network.webSocketCreated', (p, sid) => {
      this.sockets.set(key(sid, p.requestId), { url: p.url, frames: 0, ok: 0, bad: 0 });
      if (/webcast\/im\/push/.test(p.url)) this.log('[抖音] 弹幕通道已连接');
    });
    cdp.on('Network.webSocketClosed', (p, sid) => {
      const s = this.sockets.get(key(sid, p.requestId));
      if (s && s.ok > 0) this.log('[抖音] 弹幕通道关闭（页面会自动重连）');
      this.sockets.delete(key(sid, p.requestId));
    });
    cdp.on('Network.webSocketFrameReceived', (p, sid) => {
      if (!p.response || p.response.opcode !== 2) return;
      const k = key(sid, p.requestId);
      // 连接建立得比我们开始监听还早（Worker 里常见）：没见过"创建"事件，照样收它的数据
      let s = this.sockets.get(k);
      if (!s) { s = { url: '(连接建立时还没开始监听)', frames: 0, ok: 0, bad: 0 }; this.sockets.set(k, s); }
      if (s.ok === 0 && s.bad >= 60) return; // 试了 60 帧都不是直播间消息：这条连接不是弹幕通道
      s.frames++;
      let good = false;
      try { good = this.onBinary(Buffer.from(p.response.payloadData, 'base64'), 'ws'); } catch { this.decodeErrors++; }
      if (good) { if (s.ok === 0) this.log(`[抖音] 开始收到直播间数据（通道：${String(s.url).slice(0, 70)}）`); s.ok++; }
      else if (s.ok > 0) this.lastFrameAt = Date.now(); // 已确认的弹幕通道上的心跳 / 确认帧：通道还活着
      else s.bad++;
    });
    cdp.on('Network.responseReceived', (p, sid) => { if (/webcast\/im\//.test(p.response.url) && !/\/push\//.test(p.response.url)) this.fetchIds.add(key(sid, p.requestId)); });
    cdp.on('Network.loadingFinished', async (p, sid) => {
      if (!this.fetchIds.delete(key(sid, p.requestId))) return;
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: p.requestId }, sid || sessionId, 8000);
        const buf = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'binary');
        this.onBinary(buf, 'fetch');
      } catch {}
    });

    // 弹幕连接可能建在 Web Worker / iframe 里：新目标先停住，等我们开好网络监听再放行，一帧都不漏
    cdp.on('Target.attachedToTarget', async (p) => {
      const sid = p.sessionId;
      try { await cdp.send('Network.enable', {}, sid, 5000); } catch {}
      try { await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid, 5000); } catch {}
      try { await cdp.send('Runtime.runIfWaitingForDebugger', {}, sid, 5000); } catch {}
    });
    await S('Network.enable', { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 5_000_000 });
    await S('Page.enable');
    await S('Runtime.enable').catch(() => {});
    try { await S('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }); } catch {}
    await S('Page.addScriptToEvaluateOnNewDocument', { source: ANTI_PAUSE });
    if (L.domFallback !== false) await S('Page.addScriptToEvaluateOnNewDocument', { source: DOM_HOOK });
    const block = async (on) => { try { await S('Network.setBlockedURLs', { urls: on ? BLOCK_VIDEO : [] }); } catch {} };
    if (L.blockVideo !== false && !this.videoUnblocked) await block(true);
    const url = `${L.baseUrl || 'https://live.douyin.com/'}${encodeURIComponent(this.room)}`;
    this.log(`[抖音] 打开直播间 ${url}`);
    this._setState('connecting', '正在打开直播间');
    await S('Page.navigate', { url });
    const navAt = Date.now();
    this.navAt = navAt;
    this.lastFrameAt = navAt;
    this.sessionFrames0 = this.frames;
    await this.setVisible(this.visible, true);

    // 体检 + 看门狗：每 5 秒一次
    const silent = (L.reloadIfSilentSec || 150) * 1000;
    let busy = false;
    const tick = async () => {
      if (busy || this.stopped) return;
      busy = true;
      try {
        const now = Date.now();
        // 1) 页面现在是什么情况
        let p = null;
        try { const r = await S('Runtime.evaluate', { expression: PROBE, returnByValue: true }, 6000); p = r && r.result && r.result.value; } catch {}
        if (p) {
          this.page = { kind: classifyPage(p), href: p.href, title: p.title, text: p.text, items: p.items };
          this.onDomLines(p.dom || [], navAt);
        }
        const kind = this.page.kind;
        const quiet = now - this.lastFrameAt;
        const got = this.frames > this.sessionFrames0;
        // 2) 状态
        if (got && quiet < 20000) {
          if (this.state !== 'listening') this.log('[抖音] 已连上直播间，正在接收弹幕和礼物');
          this._setState('listening', '已连上直播间，正在接收弹幕和礼物');
          if (this.autoShown && !L.visible) { this.autoShown = false; await this.setVisible(false); }
        } else if (HINTS[kind] && (kind !== 'login' || !got)) {
          if (this.state !== kind) this.log(`[抖音] ${HINTS[kind][0]}：${HINTS[kind][1]}`);
          this._setState(kind, HINTS[kind][0], HINTS[kind][1]);
          if (kind === 'verify' && !this.visible) { this.autoShown = true; await this.setVisible(true); }
        } else if (got && quiet > 30000) {
          this._setState('silent', '暂时没有收到数据', '直播间可能刚下播，或者网络波动；程序会自动刷新重连。');
        } else if (!got && now - navAt > 25000) {
          this._setState('waiting', '直播间页面打开了，但还没收到任何数据', '如果已经开播超过 1 分钟还是这样：在控制台点"显示监听窗口"看看页面上有没有要处理的弹窗，或点"导出诊断"。');
        }
        // 3) 拦截视频流后一直连不上：放开拦截重来一次（个别情况下页面要先拿到视频才建立弹幕连接）
        if (!got && kind === 'ok' && now - navAt > 45000 && L.blockVideo !== false && !this.videoUnblocked) {
          this.videoUnblocked = true;
          this.log('[抖音] 45 秒没有收到数据：放开视频流拦截，重新打开直播间');
          await block(false);
          this.lastFrameAt = now;
          try { await S('Page.navigate', { url }); } catch {}
          this.navAt = Date.now();
          return;
        }
        // 4) 长时间没有数据：刷新页面；多次无效就重启浏览器（正在等人做验证 / 登录时不刷新）
        if (quiet > silent && kind !== 'verify' && kind !== 'login') {
          this.reloads++;
          this.lastFrameAt = now;
          this.log(`[抖音] ${Math.round(quiet / 1000)} 秒没有数据，刷新直播间页面（第 ${this.reloads} 次）`);
          if (this.reloads >= 4) { this.reloads = 0; this.log('[抖音] 多次刷新无效，重启监听浏览器'); cdp.close(); return; }
          try { await S('Page.navigate', { url }); } catch {}
        }
      } finally { busy = false; }
    };
    const watchdog = setInterval(tick, 5000);
    setTimeout(tick, 2500);
    await Promise.race([closed, exited]);
    clearInterval(watchdog);
    throw new Error('监听浏览器已关闭');
  }

  // 显示 / 收起监听窗口（不重启浏览器）
  async setVisible(v, quiet = false) {
    this.visible = !!v;
    const cdp = this.cdp;
    if (!cdp || !this.targetId) return false;
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: this.targetId }, undefined, 5000);
      if (v) {
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }, undefined, 5000);
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 60, top: 60, width: 1100, height: 800 } }, undefined, 5000).catch(() => {});
        await this.S('Page.bringToFront', {}, 5000).catch(() => {});
      } else {
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }, undefined, 5000);
      }
      if (!quiet) { this.log(`[抖音] 监听窗口已${v ? '显示' : '收起'}`); this.emit({ type: 'status', ...this.status() }); }
      return true;
    } catch { return false; }
  }

  // 监听窗口现在的画面（控制台预览用）。窗口收起时浏览器可能截不了图，返回 null
  async screenshot() {
    if (!this.cdp || !this.S) return null;
    try {
      const r = await this.S('Page.captureScreenshot', { format: 'jpeg', quality: 50 }, 5000);
      return r && r.data ? Buffer.from(r.data, 'base64') : null;
    } catch { return null; }
  }

  // 数据帧 → 事件。返回 true 表示这一帧确实是直播间消息
  onBinary(buf, via) {
    let response;
    if (via === 'ws') {
      const r = decodePushFrame(buf);
      response = r.response;
      if (r.compress) this.compress.add(r.compress);
      if (!response) return false; // 心跳、确认帧（调用处会记"通道还活着"）
    } else response = decodeFetchBody(buf);
    if (!looksLikeWebcast(response)) return false;
    this.frames++;
    this.lastFrameAt = Date.now();
    this.reloads = 0;
    this.channel = via;
    for (const ev of messagesToEvents(response, (m) => this.unknown.set(m, (this.unknown.get(m) || 0) + 1))) {
      let out = ev;
      if (ev.type === 'giftRaw') { out = this.dedupe.push(ev); if (!out) continue; }
      if (ev.type === 'liveEnd') { this.log('[抖音] 收到下播消息'); continue; }
      this._emit(out, true);
    }
    return true;
  }

  _emit(ev, fromFrames) {
    const now = Date.now();
    this.events++;
    if (USER_EVENTS.includes(ev.type)) {
      this.counts[ev.type]++;
      this.lastEventAt = now;
      if (fromFrames) this.lastPbEventAt = now;
      this.lastOf[ev.type] = { name: ev.user && ev.user.name, text: ev.text || (ev.gift ? `${ev.gift.name}×${ev.gift.count}` : ''), at: now };
    }
    this.emit(ev);
  }

  // 备用通道：聊天区的文字。只有数据帧 30 秒没解出任何观众互动时才用（避免同一条弹幕算两遍）
  onDomLines(lines, navAt) {
    if (!lines.length) return;
    const now = Date.now();
    if (now - this.lastPbEventAt < 30000 || now - navAt < 20000) return; // 先给数据帧 20 秒时间
    for (const { t, ts } of lines) {
      if (ts < navAt + 6000) continue; // 刚打开页面时刷出来的是历史弹幕
      if (t === this._lastDom && ts - (this._lastDomAt || 0) < 2000) continue;
      this._lastDom = t; this._lastDomAt = ts;
      const d = parseDomLine(t);
      if (!d) continue;
      const user = { id: 'dom:' + d.name, name: d.name };
      let ev = null;
      if (d.type === 'chat') ev = { type: 'chat', user, text: d.text };
      else if (d.type === 'gift') ev = { type: 'gift', user, gift: { id: d.gift, name: d.gift, count: d.count, diamond: 0 } };
      else if (d.type === 'like') ev = { type: 'like', user, count: 1 };
      else ev = { type: d.type, user };
      ev.via = 'dom';
      if (this.channel !== 'dom') { this.channel = 'dom'; this.log('[抖音] 数据帧里没有解出弹幕，改用备用通道（读取页面聊天区文字）'); }
      this.lastFrameAt = now;
      this.frames++;
      this._emit(ev, false);
    }
  }

  async teardown() {
    try { this.cdp && this.cdp.close(); } catch {}
    this.cdp = null;
    this.S = null;
    this.sockets.clear();
    this.fetchIds.clear();
    if (this.child) { killTree(this.child); this.child = null; }
    await sleep(800);
  }

  async stop() { this.stopped = true; await this.teardown(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
