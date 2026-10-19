// 一键自检：node tools/selftest.mjs
// 检查：协议解码、礼物去重/连击、BarrageGrab 解析、配置解析、解压世界与 AI 导演、弹幕互动、全部声音素材与授权。
import zlib from 'node:zlib';
import { encode } from '../server/douyin/proto.js';
import { decodePushFrame, decodeFetchBody, messagesToEvents, GiftDeduper } from '../server/douyin/decode.js';
import { BarrageGrabProvider } from '../server/providers/barragegrab.js';
import { stripComments, deepMerge, DEFAULTS } from '../server/config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES } from '../web/js/course/stages.js';
import { Director } from '../web/js/ai/director.js';
import { Rng } from '../web/js/core/util.js';
import { GiftManager } from '../web/js/game/giftManager.js';
import { DANCES } from '../web/js/pet/dances.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  ok(m.game.audio.master === 0.5 && m.game.audio.sfx === DEFAULTS.game.audio.sfx && m.port === 17890 && m.forwardChat === true, '用户配置与默认值合并');
}

section('解压世界与 AI 导演');
{
  // 站点类型（从源码里读，避免在 Node 里加载 three.js）
  const stSrc = fs.readFileSync(path.join(ROOT, 'web/js/course/stations.js'), 'utf8');
  const typeBlock = stSrc.slice(stSrc.indexOf('export const STATION_TYPES = {'));
  const types = new Set([...typeBlock.slice(0, typeBlock.indexOf('};')).matchAll(/(\w+): \w+/g)].map((m) => m[1]));
  const bad = [];
  for (const st of STAGES) {
    if (!st.stations || st.stations.length < 4) bad.push(`${st.id} 站点太少`);
    if (!st.finale || !st.finale.finale) bad.push(`${st.id} 缺少终点解压物`);
    for (const d of [...st.stations, st.finale]) {
      if (!types.has(d.type)) bad.push(`${st.id}/${d.label} 未知类型 ${d.type}`);
      if (!d.sound || !d.sound.step) bad.push(`${st.id}/${d.label} 没有声音`);
      if (!d.label) bad.push(`${st.id} 有站点没有名字`);
    }
    if (!st.voteKeys || !st.voteKeys.length) bad.push(`${st.id} 没有投票关键字`);
  }
  ok(bad.length === 0, `${STAGES.length} 个解压世界、${STAGES.reduce((n, s) => n + s.stations.length + 1, 0)} 个解压站定义完整`, bad.slice(0, 4).join('; '));
  // 导演：每个站的玩法计划
  const d = new Director(new Rng(7), { stageSeconds: 210 });
  let planBad = 0, total = 0, specials = 0;
  for (const st of STAGES) {
    const fake = st.stations.map((def, i) => ({ def, length: def.length || 2.4, width: def.width || 1.3, specials: def.specials || [] }));
    d.beginStage(st, fake);
    fake.forEach((s, i) => {
      const p = d.planStation(s, i);
      const odd = p.lanes.length % 2 === 1;
      const inTray = p.lanes.every((z) => Math.abs(z) <= s.width / 2 - 0.25);
      if (!odd || !inTray || !(p.stepDur > 0.3 && p.stepDur < 1.6) || !['normal', 'stomp', 'tiptoe'].includes(p.gait)) planBad++;
      if (p.special && !(s.def.specials || []).includes(p.special)) planBad++;
      if (p.special) specials++;
      total += p.lanes.length * (s.length / p.stride) * p.stepDur;
      d.tick(25);
    });
  }
  ok(planBad === 0, '每个解压站的玩法计划合理（奇数趟、在托盘内、步速与动作有效）', planBad + ' 个问题');
  const perStage = total / STAGES.length;
  ok(perStage > 60 && perStage < 200, `平均每关踩踏时长 ${perStage.toFixed(0)} 秒（加上特别动作约 2~4 分钟一关）`);
  ok(specials >= STAGES.length * 3, `特别动作（坐下/踩奶/切/蹦/按）出现 ${specials} 次`);
  // 弹幕
  const c1 = d.onChat('踩奶踩奶', STAGES), c2 = d.onChat('下一关想去雪地', STAGES), c3 = d.onChat('哈哈哈', STAGES);
  ok(c1 && c1.act === 'knead' && c2 && c2.kind === 'vote' && c2.stage.id === 'snow' && c3 === null, '弹幕指令与投票识别');
  d.onChat('沙滩', STAGES); d.onChat('沙滩！', STAGES);
  const nx = d.nextStage(STAGES, 'snow', []);
  ok(nx.id === 'beach' && nx.votes === 2, '下一关按弹幕投票决定', JSON.stringify(nx));
  const q = [], seen = [];
  let last = null;
  for (let i = 0; i < 18; i++) { const n = d.nextStage(STAGES, last, q); seen.push(n.id); if (n.id === last) { last = 'REPEAT'; break; } last = n.id; }
  ok(last !== 'REPEAT' && new Set(seen).size === STAGES.length, '没人投票时轮流去所有世界、不连续重复', seen.join(','));
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
  // 页面刷新时没谢完的礼物（正在跳的、排队的、还在连击合并的）都要保存下来，刷新后接着谢
  {
    const a = new GiftManager({});
    a.current = { users: ['正在谢'], user: '正在谢', gift: '小心心', count: 1, value: 1, tier: 0, at: 0 };
    a.ready.push({ users: ['排队中'], user: '排队中', gift: '加油鸭', count: 2, value: 30, tier: 1, at: 0 });
    a.add({ user: { id: 'z', name: '连击中' }, gift: { name: '嘉年华', count: 1, diamond: 3000 } });
    const b = new GiftManager({});
    const n = b.restore(a.snapshot());
    b.restore('not json'); b.restore('[{"users":"x"},null]');
    const names = b.ready.map((e) => e.user);
    ok(n === 3 && names.join() === '正在谢,排队中,连击中' && b.ready[2].tier === 3, '页面刷新后礼物队列不丢（坏数据自动忽略）', names.join());
  }
  ok(DANCES.length >= 16 && new Set(DANCES.map((d) => d.id)).size === DANCES.length, `舞蹈动作库 ${DANCES.length} 支`);
}

section('ASMR 声音（全部是真实录音）');
{
  const SND = path.join(ROOT, 'web/sounds');
  const man = JSON.parse(fs.readFileSync(path.join(SND, 'manifest.json'), 'utf8'));
  const sounds = man.sounds || {};
  const need = new Set(['land_soft', 'path_step', 'purr', 'music_dance']);
  for (const st of STAGES) { need.add(st.ambience); need.add(st.pathSound); for (const dd of [...st.stations, st.finale]) for (const k of ['step', 'heavy', 'special', 'pull']) if (dd.sound[k]) need.add(dd.sound[k]); }
  const missing = [...need].filter((id) => !sounds[id] || !sounds[id].files || !sounds[id].files.length);
  ok(missing.length === 0, `游戏用到的 ${need.size} 种声音都有真实录音`, missing.join(','));
  const RANGE = { trigger: [0.1, 2.6], sustain: [0.8, 4.0], soft: [3, 12], step: [0.1, 0.8], ambience: [15, 120], music: [20, 90] };
  const probs = [];
  let files = 0;
  for (const [id, def] of Object.entries(sounds)) {
    const [lo, hi] = RANGE[def.cat] || [0.05, 120];
    if (def.cat === 'trigger' && def.files.length < 3) probs.push(`${id} 只有 ${def.files.length} 个变体`);
    for (const f of def.files) {
      files++;
      const p = path.join(SND, f.src);
      if (!fs.existsSync(p)) { probs.push(`${f.src} 文件缺失`); continue; }
      const head = Buffer.alloc(4);
      const fd = fs.openSync(p, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      if (head.toString('latin1') !== 'OggS') probs.push(`${f.src} 不是 OGG`);
      if (!(f.dur >= lo && f.dur <= hi)) probs.push(`${id} 时长 ${f.dur}s`);
      if (!(f.gain >= 0 && f.gain <= 6)) probs.push(`${id} 增益 ${f.gain}`);
    }
  }
  ok(probs.length === 0, `${Object.keys(sounds).length} 种声音 / ${files} 个录音变体：文件完整、时长合理、变体充足`, probs.slice(0, 5).join('; '));
  const credits = fs.readFileSync(path.join(SND, 'CREDITS.md'), 'utf8');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sound_spec.json'), 'utf8'));
  const lic = new Set();
  const noCredit = [];
  for (const sd of spec.sounds) for (const src of sd.sources) { lic.add(src.license); if (!credits.includes(src.title || '')) noCredit.push(src.title); }
  const badLic = [...lic].filter((l) => /NC|ND|non-?commercial/i.test(l) || !/(CC0|CC BY|Public Domain|Pixabay|MIT)/i.test(l));
  ok(badLic.length === 0, `素材授权全部允许商用（${[...lic].join(' / ')}）`, badLic.join(','));
  ok(noCredit.length === 0, '每个素材都在 CREDITS.md 里署名', noCredit.slice(0, 3).join(','));
  const synth = ['dsp.js', 'recipes.js', 'synthWorker.js', 'audioEngine.js'].filter((f) => fs.existsSync(path.join(ROOT, 'web/js/audio', f)));
  ok(synth.length === 0, '游戏里没有任何程序合成的声音', synth.join(','));
  ok(sounds.music_dance && sounds.music_dance.files.every((f) => f.bpm >= 80 && f.bpm <= 170), '舞曲都有节拍信息（舞步踩在拍子上）');
}

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
process.exitCode = fail ? 1 : 0;
