// 一键自检：node tools/selftest.mjs
// 检查：协议解码、礼物去重/连击、BarrageGrab 解析、配置解析、关卡可解性、AI 能否通关、全部声音质量。
import zlib from 'node:zlib';
import { encode } from '../server/douyin/proto.js';
import { decodePushFrame, decodeFetchBody, messagesToEvents, GiftDeduper } from '../server/douyin/decode.js';
import { BarrageGrabProvider } from '../server/providers/barragegrab.js';
import { stripComments, deepMerge, DEFAULTS } from '../server/config.js';
import { THEMES } from '../web/js/world/themes.js';
import { ITEM_META } from '../web/js/world/itemMeta.js';
import { generateLevel, validateLevel } from '../web/js/world/levelGen.js';
import { Brain } from '../web/js/ai/brain.js';
import { Rng } from '../web/js/core/util.js';
import { RECIPES, AMB_EVENTS, renderRecipe } from '../web/js/audio/recipes.js';
import { analyze } from '../web/js/audio/dsp.js';
import { GiftManager } from '../web/js/game/giftManager.js';
import { DANCES } from '../web/js/pet/dances.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}
const section = (t) => console.log('\n■ ' + t);

// ---------- 构造假的抖音消息 ----------
const user = (id, nick) => [[1, 'varint', id], [3, 'string', nick], [9, 'msg', [[1, 'string', 'https://p3.douyinpic.com/a.jpeg']]]];
const common = (msgId) => [[1, 'string', 'WebcastGiftMessage'], [2, 'varint', msgId]];
function giftMsg({ msgId, uid = 1001n, nick = '小橘子', giftId = 463, name = '玫瑰', diamond = 1, combo = true, repeat = 1, end = 0, group = 1 }) {
  return encode([
    [1, 'msg', common(msgId)], [2, 'varint', giftId], [4, 'varint', group], [5, 'varint', repeat], [6, 'varint', repeat],
    [7, 'msg', user(uid, nick)], [9, 'varint', end],
    [15, 'msg', [[5, 'varint', giftId], [10, 'varint', combo], [12, 'varint', diamond], [16, 'string', name]]],
  ]);
}
function response(msgs) {
  return encode(msgs.map(([method, payload, id]) => [1, 'msg', [[1, 'string', method], [2, 'bytes', payload], [3, 'varint', id || 1]]]).concat([[2, 'string', 'cursor-x'], [9, 'varint', true]]));
}
function pushFrame(resp) {
  return encode([[1, 'varint', 1], [2, 'varint', 99], [5, 'msg', [[1, 'string', 'compress_type'], [2, 'string', 'gzip']]], [6, 'string', 'pb'], [7, 'string', 'msg'], [8, 'bytes', zlib.gzipSync(resp)]]);
}

section('抖音协议解码');
{
  const big = 4089457720346124n; // 超过 2^53 的用户 ID 也不能丢精度
  const resp = response([
    ['WebcastGiftMessage', giftMsg({ msgId: 1n, uid: big, nick: '星星眨眼', name: '嘉年华', diamond: 3000, combo: false })],
    ['WebcastChatMessage', encode([[1, 'msg', [[2, 'varint', 2]]], [2, 'msg', user(5, '奶茶')], [3, 'string', '糯糯好可爱！']])],
    ['WebcastLikeMessage', encode([[1, 'msg', [[2, 'varint', 3]]], [2, 'varint', 15], [3, 'varint', 1200], [5, 'msg', user(6, '柚子')]])],
    ['WebcastSocialMessage', encode([[1, 'msg', [[2, 'varint', 4]]], [2, 'msg', user(7, '月亮')], [4, 'varint', 1]])],
    ['WebcastMemberMessage', encode([[1, 'msg', [[2, 'varint', 5]]], [2, 'msg', user(8, '路人甲')], [3, 'varint', 321]])],
    ['WebcastRoomUserSeqMessage', encode([[1, 'msg', [[2, 'varint', 6]]], [3, 'varint', 88]])],
    ['WebcastUnknownFutureMessage', Buffer.from([1, 2, 3])],
  ]);
  const { response: r } = decodePushFrame(pushFrame(resp));
  ok(r && r.messages.length === 7, 'PushFrame + gzip + Response 解码', r && r.messages.length);
  const evs = messagesToEvents(r);
  const gift = evs.find((e) => e.type === 'giftRaw');
  ok(gift && gift.user.name === '星星眨眼' && gift.gift.name === '嘉年华' && gift.gift.diamond === 3000, '礼物：昵称/礼物名/抖币', JSON.stringify(gift));
  ok(gift && gift.user.id === big.toString(), '超大用户 ID 不丢精度', gift && gift.user.id);
  ok(evs.some((e) => e.type === 'chat' && e.text === '糯糯好可爱！'), '弹幕解码（中文）');
  ok(evs.some((e) => e.type === 'like' && e.count === 15 && e.user.name === '柚子'), '点赞解码');
  ok(evs.some((e) => e.type === 'follow' && e.user.name === '月亮'), '关注解码');
  ok(evs.some((e) => e.type === 'enter' && e.user.name === '路人甲'), '进入直播间解码');
  ok(evs.some((e) => e.type === 'online' && e.count === 88), '在线人数解码');
  const r2 = decodeFetchBody(resp);
  ok(r2.messages.length === 7, 'HTTP 轮询返回体解码');
  let threw = false;
  try { messagesToEvents({ messages: [{ method: 'WebcastGiftMessage', payload: Buffer.from([0xff, 0xff, 0xff]) }] }); } catch { threw = true; }
  ok(!threw, '损坏的数据不会让程序崩溃');
}

section('礼物去重与连击');
{
  const d = new GiftDeduper();
  const dec = (buf) => messagesToEvents({ messages: [{ method: 'WebcastGiftMessage', payload: buf }] })[0];
  const out = [];
  const t = 1e12;
  // 连击玫瑰：repeat 1,2,3,3(结束)
  [1, 2, 3].forEach((n, i) => { const e = d.push(dec(giftMsg({ msgId: BigInt(100 + i), repeat: n })), t + i * 300); if (e) out.push(e.gift.count); });
  const endEv = d.push(dec(giftMsg({ msgId: 103n, repeat: 3, end: 1 })), t + 1000);
  ok(out.join(',') === '1,1,1' && !endEv, '连击礼物按增量计数，结束消息不重复', out.join(','));
  ok(!d.push(dec(giftMsg({ msgId: 101n, repeat: 2 })), t + 1100), '同一 msgId 只算一次');
  // 非连击大礼物：先 end=0 再 end=1
  const a = d.push(dec(giftMsg({ msgId: 200n, name: '嘉年华', giftId: 3000, combo: false, diamond: 3000 })), t + 2000);
  const b = d.push(dec(giftMsg({ msgId: 201n, name: '嘉年华', giftId: 3000, combo: false, diamond: 3000, end: 1 })), t + 2100);
  ok(a && a.gift.count === 1 && !b, '非连击礼物的结束通知不重复计数');
  const c = d.push(dec(giftMsg({ msgId: 202n, name: '嘉年华', giftId: 3000, combo: false, diamond: 3000 })), t + 9000);
  ok(c && c.gift.count === 1, '再送一个能正常计数');
  // 中途才开始监听：直接收到 repeat=5
  const d2 = new GiftDeduper();
  const m = d2.push(dec(giftMsg({ msgId: 300n, repeat: 5 })), t);
  ok(m && m.gift.count === 5, '中途加入时连击数正确', m && m.gift.count);
  const grp = new GiftDeduper().push(dec(giftMsg({ msgId: 400n, group: 10, combo: false })), t);
  ok(grp && grp.gift.count === 10, '成组礼物（×10）计数');
}

section('BarrageGrab 对接');
{
  const got = [];
  const p = new BarrageGrabProvider({ cfg: {}, emit: (e) => got.push(e), log: () => {} });
  p.onMessage(JSON.stringify({ Type: 5, ProcessName: 'chrome', Data: JSON.stringify({ GiftId: 1, GiftName: '小心心', GiftCount: 3, RepeatCount: 3, DiamondCount: 1, User: { Id: 9, Nickname: '布丁酱' } }) }));
  p.onMessage(JSON.stringify({ Type: 5, Data: JSON.stringify({ GiftName: '小心心', GiftCount: 0, User: { Nickname: '布丁酱' } }) }));
  p.onMessage(JSON.stringify({ Type: 2, Data: JSON.stringify({ Count: 7, User: { Nickname: '甜甜圈' } }) }));
  p.onMessage(JSON.stringify({ Type: 4, Data: { User: { Nickname: '新粉丝' } } }));
  p.onMessage('not json');
  ok(got.length === 3, 'BarrageGrab 消息解析（忽略重复包与坏数据）', got.length);
  ok(got[0].type === 'gift' && got[0].gift.count === 3 && got[0].user.name === '布丁酱', 'BarrageGrab 礼物字段');
}

section('配置文件');
{
  const j = JSON.parse(stripComments('{ // 注释\n "room": "123", /* 块注释 */ "a": "http://x//y", }'));
  ok(j.room === '123' && j.a === 'http://x//y', '支持注释与尾逗号，不误伤字符串');
  const m = deepMerge(DEFAULTS, { game: { audio: { master: 0.5 } } });
  ok(m.game.audio.master === 0.5 && m.game.audio.sfx === 1 && m.port === 17890, '用户配置与默认值合并');
}

section('关卡生成与自主闯关 AI');
{
  let bad = 0, stuck = 0, levels = 0, stars = 0, missingMeta = [];
  for (const th of THEMES) {
    for (const it of th.items) if (!ITEM_META[it.type]) missingMeta.push(it.type);
    for (let s = 1; s <= 60; s++) {
      const lv = generateLevel(th, { seed: s * 7919 + th.id.length });
      levels++;
      if (!validateLevel(lv).ok) bad++;
      const b = new Brain(lv, new Rng(s), { budget: 170 });
      let done = false, t = 0;
      for (let k = 0; k < 4000; k++) {
        const a = b.decide();
        if (a.type === 'finish') { done = true; break; }
        if (a.type === 'move') { b.arrived(a.to); t += 0.7; }
        else if (a.type === 'idle') t += a.secs;
        else if (a.type === 'repeat') t += a.times * 0.6;
        else if (a.type === 'gateLocked') b.onGateLocked();
        else if (a.type === 'openGate') b.onGateOpened();
        b.tick(t - b.elapsed);
      }
      if (!done) stuck++;
      stars += 3 - b.stars.size;
    }
  }
  ok(missingMeta.length === 0, '所有场景物件都有声音与互动定义', missingMeta.join(','));
  ok(bad === 0, `${levels} 个随机关卡全部可解（钥匙可达、门确实挡路、星星可达）`, bad + ' 个不可解');
  ok(stuck === 0, `AI 在 ${levels} 个关卡中全部自主通关、从不卡死`, stuck + ' 个卡住');
  ok(stars / levels > 2.7, `AI 平均收集星星 ${(stars / levels).toFixed(2)}/3`);
}

section('礼物答谢调度');
{
  const g = new GiftManager({});
  const step = (s) => { for (let i = 0; i < s * 10; i++) g.update(0.1); };
  for (let i = 0; i < 5; i++) { g.add({ user: { id: 'a', name: '小橘子' }, gift: { id: 'r', name: '玫瑰', count: 1, diamond: 1 } }); step(0.5); }
  step(3);
  const e1 = g.next();
  ok(e1 && e1.count === 5 && e1.users[0] === '小橘子', '连续送礼合并成一次答谢（×5）', e1 && e1.count);
  g.danceStarted(); step(6); g.danceEnded();
  g.add({ user: { id: 'b', name: 'B' }, gift: { name: '小心心', count: 1, diamond: 1 } });
  step(3);
  ok(g.next() === null, '小礼物冷却期内先攒着（保证闯关进度）');
  g.add({ user: { id: 'c', name: '大老板' }, gift: { name: '嘉年华', count: 1, diamond: 3000 } });
  step(3);
  const big = g.next();
  ok(big && big.tier === 3 && big.user === '大老板', '大礼物立即插队答谢');
  g.danceStarted(); step(20); g.danceEnded(); step(15);
  const merged = g.next();
  ok(merged && merged.users.includes('B'), '冷却结束后补上之前攒下的小礼物');
  g.add({ user: { name: '<img src=x onerror=alert(1)>超级超级超级长的名字啊啊啊' }, gift: { name: '小心心', count: 1 } });
  step(3);
  const x = g.ready[0] || g.next();
  ok(x && Array.from(x.user).length <= 13, '超长昵称会被截断', x && x.user);
  ok(DANCES.length >= 16 && new Set(DANCES.map((d) => d.id)).size === DANCES.length, `舞蹈动作库 ${DANCES.length} 支`);
}

section('ASMR 声音质量');
{
  const RANGE = { step: [0.03, 0.4], soft: [0.12, 0.8], item: [0.06, 1.3], pop: [0.02, 0.3], chime: [0.3, 3.5], music: [0.05, 3.5], voice: [0.1, 1.3], fx: [0.2, 2.5], ambEvt: [0.05, 2.7] };
  const ids = [...Object.keys(RECIPES), ...Object.keys(AMB_EVENTS)];
  let n = 0;
  const probs = [];
  for (const id of ids) {
    const { buffers, cat } = renderRecipe(id, 48000, 1);
    for (const b of buffers) {
      n++;
      const a = analyze(b, 48000);
      const [lo, hi] = RANGE[cat];
      if (a.nan) probs.push(id + ' NaN');
      if (a.peakDb > -2.5) probs.push(`${id} 峰值 ${a.peakDb.toFixed(1)}`);
      if (a.duration < lo || a.duration > hi) probs.push(`${id} 时长 ${a.duration.toFixed(2)}`);
      if (Math.abs(b[0]) > 0.01 || Math.abs(b[b.length - 1]) > 0.002) probs.push(`${id} 首尾爆音`);
    }
  }
  const soundIds = new Set(ids);
  const missing = Object.values(ITEM_META).map((m) => m.sound).filter((s) => !soundIds.has(s));
  for (const th of THEMES) for (const s of th.surfaces) if (!soundIds.has(s.step)) missing.push(s.step);
  ok(missing.length === 0, '每个物件/地面都有对应的声音', missing.join(','));
  ok(probs.length === 0, `${ids.length} 种声音 / ${n} 个变体：无削波、无爆音、时长合理`, probs.slice(0, 5).join('; '));
}

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
process.exitCode = fail ? 1 : 0;
