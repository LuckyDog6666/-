// 监听链路自检（不需要开播、不连接抖音）：
// 在本机起一个"假的直播间页面"，它用和抖音一样的格式推送礼物 / 点赞 / 弹幕；
// 然后用真实的浏览器 + CDP 监听程序去抓取并解码，验证整条链路在你的电脑上能正常工作。
//
// 用法：node tools/test-listener.mjs            （标准地址 + 陌生地址 + 安全验证页，约 30 秒）
//       node tools/test-listener.mjs --all      （再加上 Worker 内连接、备用的页面文字通道，约 2 分钟）
//       node tools/test-listener.mjs --mode=dom （只跑某一项：page / oddurl / worker / verify / dom）
//       加 --show 可以看到监听浏览器窗口
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { encode } from '../server/douyin/proto.js';
import { DouyinProvider } from '../server/providers/douyin.js';

const user = (id, nick) => [[1, 'varint', id], [3, 'string', nick]];
let msgId = 1000n, repeat = 0;
function frame() {
  repeat++;
  const gift = encode([
    [1, 'msg', [[1, 'string', 'WebcastGiftMessage'], [2, 'varint', ++msgId]]], [2, 'varint', 463], [4, 'varint', 1], [5, 'varint', repeat],
    [7, 'msg', user(42n, '测试老板')], [9, 'varint', 0],
    [15, 'msg', [[5, 'varint', 463], [10, 'varint', true], [12, 'varint', 1], [16, 'string', '小心心']]],
  ]);
  const like = encode([[1, 'msg', [[2, 'varint', ++msgId]]], [2, 'varint', 3], [5, 'msg', user(43n, '点赞的人')]]);
  const chat = encode([[1, 'msg', [[2, 'varint', ++msgId]]], [2, 'msg', user(44n, '发弹幕的人')], [3, 'string', '踩奶']]);
  const resp = encode([
    [1, 'msg', [[1, 'string', 'WebcastGiftMessage'], [2, 'bytes', gift]]],
    [1, 'msg', [[1, 'string', 'WebcastLikeMessage'], [2, 'bytes', like]]],
    [1, 'msg', [[1, 'string', 'WebcastChatMessage'], [2, 'bytes', chat]]],
    [1, 'msg', [[1, 'string', 'WebcastSomethingNewMessage'], [2, 'bytes', chat]]],
  ]);
  return encode([[1, 'varint', 1], [5, 'msg', [[1, 'string', 'compress_type'], [2, 'string', 'gzip']]], [7, 'string', 'msg'], [8, 'bytes', zlib.gzipSync(resp)]]);
}
function wsFrame(buf) {
  const len = buf.length;
  const head = len < 126 ? Buffer.from([0x82, len]) : len < 65536 ? Buffer.from([0x82, 126, len >> 8, len & 255]) : null;
  return Buffer.concat([head, buf]);
}

const WS_STD = '/webcast/im/push/v2/?room=test', WS_ODD = '/frontier/ws/v9?aid=6383'; // 第二个：假设抖音以后换了通道地址
const wsPage = (p) => `<!doctype html><title>fake live</title><script>
  const ws = new WebSocket('ws://' + location.host + '${p}'); ws.binaryType = 'arraybuffer'; ws.onmessage = () => {};
  // 干扰项：另一条不相干的连接（不是弹幕），监听程序不应该被它搞糊涂
  const junk = new WebSocket('ws://' + location.host + '/junk'); junk.binaryType = 'arraybuffer';
</script>`;
const PAGES = {
  page: wsPage(WS_STD),
  oddurl: wsPage(WS_ODD),
  worker: `<!doctype html><title>fake live</title><script>setTimeout(() => new Worker('/worker.js'), 1200);</script>`,
  verify: `<!doctype html><title>验证码中间页</title><body><div id="captcha_container" style="width:300px;height:200px">请完成下列验证后继续 拖动滑块</div></body>`,
  // 没有任何数据连接，只有聊天区的文字在滚动（模拟"数据帧解不出来"时的备用通道）
  dom: `<!doctype html><title>fake live</title><body><div class="webcast-chatroom___list"></div><div class="webcast-chatroom___bottom-message"></div><script>
    const list = document.querySelector('.webcast-chatroom___list'), bottom = document.querySelector('.webcast-chatroom___bottom-message');
    const lines = ['小糯米 12 弹幕观众：糯糯好可爱', '送礼的人：送出了 小心心 × 2', '点赞的人：为主播点赞了', '新粉丝：关注了主播'];
    let i = 0;
    setInterval(() => { const d = document.createElement('div'); d.className = 'webcast-chatroom___item'; d.innerHTML = '<span>' + lines[i++ % lines.length] + '</span>'; list.appendChild(d); bottom.textContent = '路人' + i + ' 来了'; }, 700);
  </script></body>`,
};
const WORKER = `const ws = new WebSocket('ws://' + location.host + '${WS_STD}'); ws.binaryType = 'arraybuffer'; ws.onmessage = () => {};`;

async function run(mode) {
  repeat = 0; // 每一项从头数连击
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/worker.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(WORKER); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGES[mode]);
  });
  const sockets = new Set();
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    const junk = req.url.startsWith('/junk');
    const t = setInterval(() => { try { socket.write(wsFrame(junk ? crypto.randomBytes(40) : frame())); } catch {} }, 400);
    socket.on('close', () => { clearInterval(t); sockets.delete(socket); });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuonuo-test-'));
  const events = [];
  const provider = new DouyinProvider({
    cfg: { room: ` http://x/live.douyin.com/test?from=share `, browserPath: process.env.BROWSER || '', listener: { baseUrl: `http://127.0.0.1:${port}/live/`, headless: !process.argv.includes('--show'), cdpPort: 19000 + Math.floor(Math.random() * 900), blockVideo: true } },
    emit: (e) => { events.push(e); },
    log: (m) => console.log('   ' + m),
    dataDir,
  });
  const of = (t) => events.filter((e) => e.type === t);
  const NAMES = { page: '标准弹幕通道', oddurl: '陌生地址的弹幕通道（按内容识别）', worker: 'Worker 里的弹幕通道', verify: '安全验证页（应该报告"需要验证"）', dom: '备用通道：读取页面聊天区文字' };
  console.log(`■ ${NAMES[mode]} …`);
  provider.start();
  const t0 = Date.now();
  const done = () => {
    if (mode === 'verify') return provider.state === 'verify';
    if (mode === 'dom') return of('chat').length >= 1 && of('gift').length >= 1 && of('like').length >= 1 && of('enter').length >= 1 && of('follow').length >= 1;
    return of('gift').length >= 3 && of('like').length >= 1 && of('chat').length >= 1;
  };
  const limit = mode === 'dom' ? 80000 : 40000;
  while (Date.now() - t0 < limit && !done()) await new Promise((r) => setTimeout(r, 300));
  let ok = done();
  const st = provider.status();
  if (ok && mode === 'verify') ok = /验证/.test(st.message) && st.hint.length > 10 && of('gift').length === 0;
  else if (ok && mode === 'dom') {
    const c = of('chat')[0], g = of('gift')[0];
    ok = c.user.name === '弹幕观众' && c.text === '糯糯好可爱' && g.gift.name === '小心心' && g.gift.count === 2 && st.channel === 'dom';
  } else if (ok) {
    const gifts = of('gift');
    ok = gifts.every((g) => g.gift.count === 1 && g.user.name === '测试老板' && g.gift.name === '小心心') && of('chat')[0].text === '踩奶' && st.state !== 'error' && provider.room === 'test'
      && provider.diagnose().unknownMethods.some(([m]) => m === 'WebcastSomethingNewMessage');
  }
  console.log(`  礼物 ${of('gift').length} · 点赞 ${of('like').length} · 弹幕 ${of('chat').length} · 状态「${st.message}」${st.channel ? ' · 通道 ' + st.channel : ''}`);
  console.log(ok ? `  ✔ ${NAMES[mode]}：正常` : `  ✘ ${NAMES[mode]}：异常`);
  await provider.stop();
  server.close();
  for (const s of sockets) s.destroy();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  return ok;
}

const one = (process.argv.find((a) => a.startsWith('--mode=')) || '').slice(7);
const modes = one ? [one] : process.argv.includes('--worker') ? ['worker'] : process.argv.includes('--all') ? ['page', 'oddurl', 'worker', 'verify', 'dom'] : ['page', 'oddurl', 'verify'];
let allOk = true;
for (const m of modes) { if (!PAGES[m]) { console.log('未知模式 ' + m); process.exit(2); } if (!(await run(m))) allOk = false; }
console.log(allOk ? '✔ 监听链路正常：浏览器抓包 → 解压 → 解码 → 连击去重 → 页面体检 全部工作' : '✘ 监听链路异常，请把上面的日志发给开发者');
process.exit(allOk ? 0 : 1);
