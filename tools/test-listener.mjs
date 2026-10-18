// 监听链路自检（不需要开播、不连接抖音）：
// 在本机起一个"假的直播间页面"，它通过 WebSocket 推送和抖音格式一样的礼物数据帧；
// 然后用真实的浏览器 + CDP 监听程序去抓取并解码，验证整条链路在你的电脑上能正常工作。
// 用法：node tools/test-listener.mjs
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
  const resp = encode([
    [1, 'msg', [[1, 'string', 'WebcastGiftMessage'], [2, 'bytes', gift]]],
    [1, 'msg', [[1, 'string', 'WebcastLikeMessage'], [2, 'bytes', like]]],
  ]);
  return encode([[1, 'varint', 1], [5, 'msg', [[1, 'string', 'compress_type'], [2, 'string', 'gzip']]], [7, 'string', 'msg'], [8, 'bytes', zlib.gzipSync(resp)]]);
}
function wsFrame(buf) {
  const len = buf.length;
  const head = len < 126 ? Buffer.from([0x82, len]) : len < 65536 ? Buffer.from([0x82, 126, len >> 8, len & 255]) : null;
  return Buffer.concat([head, buf]);
}

const PAGE = `<!doctype html><title>fake live</title><script>
  const ws = new WebSocket('ws://' + location.host + '/webcast/im/push/v2/?room=test');
  ws.binaryType = 'arraybuffer';
  ws.onmessage = () => {};
</script>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); });
const sockets = new Set();
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sockets.add(socket);
  const t = setInterval(() => { try { socket.write(wsFrame(frame())); } catch {} }, 400);
  socket.on('close', () => { clearInterval(t); sockets.delete(socket); });
  socket.on('error', () => {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuonuo-test-'));
const events = [];
const headless = !process.argv.includes('--show');
const provider = new DouyinProvider({
  cfg: { room: 'test', browserPath: process.env.BROWSER || '', listener: { baseUrl: `http://127.0.0.1:${port}/live/`, headless, cdpPort: 19000 + Math.floor(Math.random() * 900), blockVideo: true } },
  emit: (e) => { if (e.type !== 'status') events.push(e); },
  log: (m) => console.log('   ' + m),
  dataDir,
});
console.log('■ 启动监听浏览器，抓取假直播间的数据帧…');
provider.start();
const t0 = Date.now();
while (Date.now() - t0 < 30000 && events.filter((e) => e.type === 'gift').length < 3) await new Promise((r) => setTimeout(r, 300));
const gifts = events.filter((e) => e.type === 'gift');
const likes = events.filter((e) => e.type === 'like');
await provider.stop();
server.close();
for (const s of sockets) s.destroy();
const okk = gifts.length >= 3 && gifts.every((g) => g.gift.count === 1 && g.user.name === '测试老板' && g.gift.name === '小心心') && likes.length >= 1;
console.log(`  收到礼物 ${gifts.length} 条、点赞 ${likes.length} 条`);
console.log(okk ? '✔ 监听链路正常：浏览器抓包 → 解压 → 解码 → 连击去重 全部工作' : '✘ 监听链路异常，请把上面的日志发给开发者');
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(okk ? 0 : 1);
