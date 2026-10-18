// 糯糯 ASMR 奇遇 —— 本地服务（零依赖，只需要 Node.js 22+）
//  - 提供游戏网页与控制台
//  - 连接抖音直播间（或 BarrageGrab / 演示模式），把礼物等事件推送给游戏（SSE，断线补发）
//  - 维护"今日感谢榜"
//  - 自动打开游戏窗口，并做看门狗：页面卡死/崩溃/被关掉都会自动恢复
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, saveConfig, ROOT, DATA_DIR } from './config.js';
import { findBrowser, launchBrowser, ANTI_THROTTLE_FLAGS, killByProfile, killTree } from './browser.js';
import { DouyinProvider } from './providers/douyin.js';
import { BarrageGrabProvider } from './providers/barragegrab.js';
import { MockProvider } from './providers/mock.js';
import { Board } from './board.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`需要 Node.js 22 或更高版本，当前是 ${process.versions.node}。请运行 启动糯糯.bat（会自动准备合适的 Node.js），或到 https://nodejs.org 下载 LTS 版本。`);
  process.exit(2);
}

const ARGS = new Set(process.argv.slice(2));
let cfg = loadConfig();
if (ARGS.has('--mock')) cfg.source = 'mock';
if (ARGS.has('--no-launch')) cfg.launchGame = false;
const portArg = process.argv.find((a) => a.startsWith('--port='));
if (portArg) cfg.port = Number(portArg.slice(7));

fs.mkdirSync(DATA_DIR, { recursive: true });
const LOG_DIR = path.join(ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------- 日志（按天分文件，保留 7 天） ----------------
function stamp() { const d = new Date(); return d.toLocaleString('zh-CN', { hour12: false }); }
function logFile() { const d = new Date(); return path.join(LOG_DIR, `server-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`); }
export function log(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logFile(), line + '\n'); } catch {}
}
try {
  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 7))) fs.unlinkSync(path.join(LOG_DIR, f));
} catch {}

// ---------------- 事件总线（带编号的环形缓冲，SSE 断线补发） ----------------
const clients = new Set();
const ring = [];
let seq = Date.now() % 1e9 | 0; // 每次启动从一个新的大数开始，避免与页面里记住的旧编号冲突
const recent = { gift: [], status: {} };
function broadcast(ev, { store = true } = {}) {
  ev.ts = ev.ts || Date.now();
  const id = ++seq;
  const data = `id: ${id}\ndata: ${JSON.stringify(ev)}\n\n`;
  if (store) { ring.push({ id, data, ts: ev.ts }); if (ring.length > 300) ring.shift(); }
  for (const res of clients) { try { res.write(data); } catch {} }
  return id;
}

const board = new Board(path.join(DATA_DIR, 'board.json'), cfg.board);
function onLiveEvent(ev) {
  if (ev.type === 'status') { recent.status = ev; broadcast(ev, { store: false }); return; }
  if (ev.type === 'gift') {
    recent.gift.unshift({ ...ev, ts: Date.now() });
    recent.gift.length = Math.min(recent.gift.length, 30);
    log(`[礼物] ${ev.user?.name} 送出 ${ev.gift?.name} ×${ev.gift?.count}（${ev.gift?.diamond || '?'} 抖币）`);
    if (board.add(ev.user, (Number(ev.gift?.diamond) || 1) * (Number(ev.gift?.count) || 1))) broadcast({ type: 'board', list: board.top() }, { store: false });
  }
  if (ev.type === 'follow') log(`[关注] ${ev.user?.name}`);
  if (ev.type === 'online') { recent.online = ev.count; return; }
  if (ev.type === 'chat') { recent.lastChat = ev; if (!cfg.forwardChat) return; }
  broadcast(ev);
}

// ---------------- 直播数据来源 ----------------
let provider = null;
function startProvider() {
  if (provider) { try { provider.stop(); } catch {} provider = null; }
  const ctx = { cfg, emit: onLiveEvent, log, dataDir: DATA_DIR };
  if (cfg.source === 'douyin') provider = new DouyinProvider(ctx);
  else if (cfg.source === 'barragegrab') provider = new BarrageGrabProvider(ctx);
  else if (cfg.source === 'mock') provider = new MockProvider(ctx);
  if (provider) provider.start();
  else log('[来源] 未启用直播数据来源（source=none），只能用控制台测试礼物');
}

// ---------------- 游戏窗口 + 看门狗 ----------------
let gameChild = null;
let lastBeat = 0;
let lastBeatData = null;
let gameLaunchedAt = 0;
let quickExits = 0;
let shuttingDown = false;
const gameLog = [];

async function launchGame() {
  if (!cfg.launchGame || shuttingDown) return;
  const exe = findBrowser(cfg.browserPath);
  if (!exe) { log('[游戏] 没有找到 Chrome/Edge，请手动用浏览器打开 ' + gameUrl()); return; }
  const profile = path.join(DATA_DIR, 'nuonuo-game-profile');
  fs.mkdirSync(profile, { recursive: true });
  await killByProfile('nuonuo-game-profile');
  const W = cfg.gameWindow || {};
  const args = [
    `--app=${gameUrl()}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W.width || 1280},${W.height || 720}`,
    `--window-position=${W.x ?? 40},${W.y ?? 40}`,
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--overscroll-history-navigation=0',
    ...ANTI_THROTTLE_FLAGS,
  ];
  if (W.fullscreen) args.push('--start-fullscreen');
  if (ARGS.has('--headless-game')) args.push('--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'); // 仅用于自动化自检
  if (W.deviceScaleFactor) args.push(`--force-device-scale-factor=${W.deviceScaleFactor}`);
  log(`[游戏] 打开游戏窗口：${path.basename(exe)}`);
  gameLaunchedAt = Date.now();
  lastBeat = 0;
  const child = launchBrowser(exe, args, log);
  gameChild = child;
  child.on('exit', (code) => {
    if (gameChild !== child) return;
    gameChild = null;
    if (shuttingDown) return;
    const lived = Date.now() - gameLaunchedAt;
    quickExits = lived < 15000 ? quickExits + 1 : 0;
    const wait = Math.min(60000, 3000 * Math.pow(2, quickExits));
    log(`[游戏] 游戏窗口已关闭（code=${code}），${Math.round(wait / 1000)} 秒后自动重新打开`);
    setTimeout(launchGame, wait);
  });
}
function gameUrl() {
  const layout = cfg.game?.layout && cfg.game.layout !== 'auto' ? `&layout=${cfg.game.layout}` : '';
  return `http://127.0.0.1:${cfg.port}/?mode=live${layout}`;
}
setInterval(() => {
  if (!cfg.launchGame || !gameChild) return;
  const W = cfg.watchdog || {};
  const now = Date.now();
  const grace = (W.bootGraceSec || 120) * 1000;
  const timeout = (W.heartbeatTimeoutSec || 60) * 1000;
  if (now - gameLaunchedAt < grace) return;
  if (!lastBeat || now - lastBeat > timeout) {
    log(`[看门狗] 游戏页面 ${lastBeat ? Math.round((now - lastBeat) / 1000) + ' 秒' : '一直'}没有心跳，重启游戏窗口`);
    const c = gameChild; gameChild = null;
    killTree(c);
    setTimeout(launchGame, 3000);
  }
}, 10000);

// ---------------- HTTP ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.txt': 'text/plain; charset=utf-8',
};
const WEB = path.join(ROOT, 'web');
const SOUNDS = path.join(ROOT, 'assets', 'sounds');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function serveFile(res, base, rel) {
  const p = path.normalize(path.join(base, rel));
  if (!p.startsWith(base)) return send(res, 403, 'forbidden', 'text/plain');
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found', 'text/plain');
    const ext = path.extname(p).toLowerCase();
    const cacheable = ['.woff2', '.ttf', '.wav', '.mp3', '.ogg'].includes(ext) || rel.includes('vendor/');
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cacheable ? 'max-age=86400' : 'no-cache' });
    fs.createReadStream(p).pipe(res);
  });
}
function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function listCustomSounds() {
  const out = {};
  try {
    for (const id of fs.readdirSync(SOUNDS)) {
      const dir = path.join(SOUNDS, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir).filter((f) => /\.(wav|mp3|ogg|m4a|flac)$/i.test(f));
      if (files.length) out[id] = files.map((f) => `/assets/sounds/${encodeURIComponent(id)}/${encodeURIComponent(f)}`);
    }
  } catch {}
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const since = Number(req.headers['last-event-id'] || url.searchParams.get('since') || 0);
      // 补发 2 分钟内、页面还没收到的事件（页面刷新/重连时不丢礼物）
      if (since) for (const e of ring) if (e.id > since && Date.now() - e.ts < 120000) res.write(e.data);
      res.write(`id: ${seq}\ndata: ${JSON.stringify({ type: 'board', list: board.top() })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/config' && req.method === 'GET') return send(res, 200, { game: cfg.game, room: cfg.room, source: cfg.source });
    if (p === '/api/config/full' && req.method === 'GET') { if (!isLocal(req)) return send(res, 403, {}); return send(res, 200, cfg); }
    if (p === '/api/config' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, { error: '只允许本机修改' });
      const patch = await readBody(req);
      const key = (c) => JSON.stringify([c.source, c.room, c.barrageGrabUrl, c.listener?.visible]);
      const before = key(cfg);
      saveConfig(patch);
      cfg = loadConfig();
      if (ARGS.has('--mock')) cfg.source = 'mock';
      if (ARGS.has('--no-launch')) cfg.launchGame = false;
      log('[控制台] 配置已保存');
      if (before !== key(cfg)) startProvider();
      broadcast({ type: 'control', cmd: 'reload' }, { store: false });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/heartbeat' && req.method === 'POST') {
      lastBeat = Date.now();
      lastBeatData = await readBody(req).catch(() => null);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/log' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      const m = String(b.message || '').slice(0, 1500);
      gameLog.unshift({ ts: Date.now(), m }); gameLog.length = Math.min(gameLog.length, 50);
      log(`[页面] ${m}`);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/status') {
      return send(res, 200, {
        ok: true, version: 1, uptime: Math.round(process.uptime()), source: cfg.source, room: cfg.room,
        provider: provider ? provider.status() : null, game: lastBeatData, lastBeatAgo: lastBeat ? Math.round((Date.now() - lastBeat) / 1000) : null,
        clients: clients.size, gifts: recent.gift.slice(0, 15), online: recent.online || 0, board: board.top(), gameLog: gameLog.slice(0, 10), launchGame: cfg.launchGame,
      });
    }
    if (p === '/api/sounds') return send(res, 200, listCustomSounds());
    if (p === '/api/test' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, {});
      const b = await readBody(req);
      const user = { id: 'test-' + (b.name || 'x'), name: String(b.name || '测试老板').slice(0, 20) };
      if (b.type === 'gift') onLiveEvent({ type: 'gift', user, gift: { id: b.gift || '小心心', name: String(b.gift || '小心心').slice(0, 10), count: Math.max(1, Math.min(999, Number(b.count) || 1)), diamond: Math.max(1, Number(b.diamond) || 1) } });
      else if (b.type === 'like') onLiveEvent({ type: 'like', user, count: Number(b.count) || 10 });
      else if (b.type === 'follow') onLiveEvent({ type: 'follow', user });
      else if (b.type === 'enter') onLiveEvent({ type: 'enter', user });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/control' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, {});
      const b = await readBody(req);
      if (b.cmd === 'restartGame') { const c = gameChild; gameChild = null; killTree(c); setTimeout(launchGame, 2000); }
      else if (b.cmd === 'restartListener') startProvider();
      else if (b.cmd === 'clearBoard') { board.clear(); broadcast({ type: 'board', list: [] }, { store: false }); }
      else if (b.cmd === 'shutdown') { send(res, 200, { ok: true }); shutdown(); return; }
      else broadcast({ type: 'control', ...b }, { store: false });
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/assets/sounds/')) return serveFile(res, SOUNDS, p.slice('/assets/sounds/'.length));
    if (p === '/' || p === '') return serveFile(res, WEB, 'index.html');
    if (p === '/admin') return serveFile(res, WEB, 'admin.html');
    return serveFile(res, WEB, p.slice(1));
  } catch (e) {
    log('[http] ' + e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

// SSE 保活
setInterval(() => { for (const res of clients) { try { res.write(`data: {"type":"ping"}\n\n`); } catch {} } }, 15000);

server.on('error', async (e) => {
  if (e.code === 'EADDRINUSE') {
    try {
      const r = await fetch(`http://127.0.0.1:${cfg.port}/api/status`);
      if (r.ok) { log(`糯糯已经在运行了（端口 ${cfg.port}），不需要重复启动。控制台：http://127.0.0.1:${cfg.port}/admin`); process.exit(0); }
    } catch {}
    log(`端口 ${cfg.port} 被其它程序占用，请在 config.json 中修改 port`);
    process.exit(3);
  }
  log('服务器错误：' + e.message);
  process.exit(1);
});

server.listen(cfg.port, cfg.host || '127.0.0.1', () => {
  log('==============================================');
  log(' 糯糯的 ASMR 奇遇 已启动');
  log(` 游戏画面： http://127.0.0.1:${cfg.port}/`);
  log(` 控制台：   http://127.0.0.1:${cfg.port}/admin`);
  log(` 数据来源： ${cfg.source}${cfg.room ? '（直播间 ' + cfg.room + '）' : ''}`);
  log('==============================================');
  startProvider();
  launchGame();
  // 第一次使用还没填直播间号：自动打开控制台引导设置
  if (!cfg.room && cfg.source === 'douyin' && !ARGS.has('--no-launch')) openUrl(`http://127.0.0.1:${cfg.port}/admin`);
});

function openUrl(u) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [u], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [u], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {}
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('正在退出…');
  try { provider && (await provider.stop()); } catch {}
  killTree(gameChild);
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => log('[未捕获异常] ' + (e && e.stack || e)));
process.on('unhandledRejection', (e) => log('[未处理的 Promise] ' + (e && e.stack || e)));
