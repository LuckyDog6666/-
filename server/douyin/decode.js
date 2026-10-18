// 抖音网页直播间消息解码：PushFrame(gzip) → Response → 各类 Webcast 消息 → 标准化事件。
// 字段号参考开源项目 DouyinLiveWebFetcher / DouyinBarrageGrab 公开的 douyin.proto。
import zlib from 'node:zlib';
import { decode } from './proto.js';

const Image = { 1: ['urls', 'string[]'] };
const User = {
  1: ['id', 'u64'], 2: ['shortId', 'u64'], 3: ['nickName', 'string'], 9: ['avatar', 'msg', Image],
  38: ['displayId', 'string'], 46: ['secUid', 'string'], 1028: ['idStr', 'string'],
};
const Common = { 1: ['method', 'string'], 2: ['msgId', 'u64'], 3: ['roomId', 'u64'], 4: ['createTime', 'u64'] };
const GiftStruct = { 1: ['image', 'msg', Image], 5: ['id', 'u64'], 10: ['combo', 'bool'], 11: ['type', 'u32'], 12: ['diamondCount', 'u32'], 16: ['name', 'string'] };

export const SCHEMAS = {
  PushFrame: { 1: ['seqId', 'u64'], 2: ['logId', 'u64'], 3: ['service', 'u64'], 4: ['method', 'u64'], 5: ['headers', 'msg[]', { 1: ['key', 'string'], 2: ['value', 'string'] }], 6: ['payloadEncoding', 'string'], 7: ['payloadType', 'string'], 8: ['payload', 'bytes'] },
  Response: { 1: ['messages', 'msg[]', { 1: ['method', 'string'], 2: ['payload', 'bytes'], 3: ['msgId', 'u64'], 4: ['msgType', 'int'] }], 2: ['cursor', 'string'], 3: ['fetchInterval', 'u64'], 4: ['now', 'u64'], 8: ['heartbeatDuration', 'u64'], 9: ['needAck', 'bool'] },
  WebcastGiftMessage: { 1: ['common', 'msg', Common], 2: ['giftId', 'u64'], 4: ['groupCount', 'u64'], 5: ['repeatCount', 'u64'], 6: ['comboCount', 'u64'], 7: ['user', 'msg', User], 8: ['toUser', 'msg', User], 9: ['repeatEnd', 'u32'], 11: ['groupId', 'u64'], 15: ['gift', 'msg', GiftStruct], 29: ['totalCount', 'u64'] },
  WebcastChatMessage: { 1: ['common', 'msg', Common], 2: ['user', 'msg', User], 3: ['content', 'string'] },
  WebcastLikeMessage: { 1: ['common', 'msg', Common], 2: ['count', 'u64'], 3: ['total', 'u64'], 5: ['user', 'msg', User] },
  WebcastSocialMessage: { 1: ['common', 'msg', Common], 2: ['user', 'msg', User], 3: ['shareType', 'u64'], 4: ['action', 'u64'], 6: ['followCount', 'u64'] },
  WebcastMemberMessage: { 1: ['common', 'msg', Common], 2: ['user', 'msg', User], 3: ['memberCount', 'u64'], 10: ['action', 'u64'] },
  WebcastRoomUserSeqMessage: { 1: ['common', 'msg', Common], 3: ['total', 'i64'], 7: ['totalUser', 'i64'], 8: ['totalUserStr', 'string'] },
  WebcastControlMessage: { 1: ['common', 'msg', Common], 2: ['status', 'int'] },
};

function user(u) {
  if (!u) return { id: '', name: '神秘人' };
  return { id: u.id && u.id !== '0' ? u.id : u.idStr || u.secUid || '', name: u.nickName || '神秘人', avatar: u.avatar?.urls?.[0] || '' };
}

// 解码 WebSocket 二进制帧（PushFrame）。返回 Response 或 null
export function decodePushFrame(buf) {
  const frame = decode(buf, SCHEMAS.PushFrame);
  if (!frame.payload || !frame.payload.length) return { frame, response: null };
  if (frame.payloadType && frame.payloadType !== 'msg') return { frame, response: null };
  let body = frame.payload;
  const compress = (frame.headers || []).find((h) => h.key === 'compress_type')?.value;
  if (compress === 'gzip' || (body[0] === 0x1f && body[1] === 0x8b)) body = zlib.gunzipSync(body);
  return { frame, response: decode(body, SCHEMAS.Response) };
}

// 解码 HTTP 轮询（webcast/im/fetch）返回体：直接就是 Response
export function decodeFetchBody(buf) {
  let body = buf;
  if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
  return decode(body, SCHEMAS.Response);
}

/**
 * 把 Response 里的消息转成标准化原始事件（礼物还需要经过 GiftDeduper 去重合并）
 */
export function messagesToEvents(response) {
  const out = [];
  for (const m of response?.messages || []) {
    const schema = SCHEMAS[m.method];
    if (!schema || !m.payload) continue;
    let d;
    try { d = decode(m.payload, schema); } catch { continue; }
    const msgId = d.common?.msgId || m.msgId || '';
    switch (m.method) {
      case 'WebcastGiftMessage':
        out.push({
          type: 'giftRaw', msgId, user: user(d.user),
          gift: {
            id: d.gift?.id || d.giftId || '', name: d.gift?.name || '礼物', diamond: d.gift?.diamondCount || 0, combo: !!d.gift?.combo,
            image: d.gift?.image?.urls?.[0] || '',
          },
          groupId: d.groupId || '', groupCount: Number(d.groupCount || 1), repeatCount: Number(d.repeatCount || 0), comboCount: Number(d.comboCount || 0),
          repeatEnd: d.repeatEnd || 0, totalCount: Number(d.totalCount || 0),
        });
        break;
      case 'WebcastChatMessage': out.push({ type: 'chat', msgId, user: user(d.user), text: d.content || '' }); break;
      case 'WebcastLikeMessage': out.push({ type: 'like', msgId, user: user(d.user), count: Number(d.count || 1), total: Number(d.total || 0) }); break;
      case 'WebcastSocialMessage':
        if (String(d.action) === '1') out.push({ type: 'follow', msgId, user: user(d.user) });
        else out.push({ type: 'share', msgId, user: user(d.user) });
        break;
      case 'WebcastMemberMessage': out.push({ type: 'enter', msgId, user: user(d.user), online: Number(d.memberCount || 0) }); break;
      case 'WebcastRoomUserSeqMessage': out.push({ type: 'online', msgId, count: Number(d.total || 0), totalUser: Number(d.totalUser || 0) }); break;
      case 'WebcastControlMessage': if (d.status === 3) out.push({ type: 'liveEnd', msgId }); break;
      default: break;
    }
  }
  return out;
}

/**
 * 礼物去重与连击处理：
 *  - 同一 msgId 只处理一次
 *  - 可连击礼物：repeatCount 是累计值，只发出"增量"；repeatEnd=1 的结束消息不重复计数
 *  - 不可连击礼物：可能先后收到 repeatEnd=0/1 两条相同消息，只算一次
 */
export class GiftDeduper {
  constructor() { this.msgSeen = new Map(); this.state = new Map(); }

  push(g, now = Date.now()) {
    this._gc(now);
    if (g.msgId) {
      if (this.msgSeen.has(g.msgId)) return null;
      this.msgSeen.set(g.msgId, now);
    }
    const key = `${g.user.id || g.user.name}|${g.gift.id || g.gift.name}|${g.groupId || ''}`;
    const st = this.state.get(key);
    const repeat = Math.max(g.repeatCount || 0, g.comboCount || 0, 1);
    const group = Math.max(1, g.groupCount || 1);
    let delta = 0;
    if (g.gift.combo) {
      const prev = st ? st.repeat : 0;
      if (repeat > prev) delta = repeat - prev;
      if (g.repeatEnd) this.state.delete(key);
      else this.state.set(key, { repeat: Math.max(prev, repeat), at: now });
    } else if (st && st.open && g.repeatEnd && now - st.at < 10000) {
      // 非连击礼物：先来一条 repeatEnd=0，随后的 repeatEnd=1 是同一份礼物的"结束"通知，不重复计数
      this.state.delete(key);
    } else {
      delta = 1;
      this.state.set(key, { repeat, at: now, open: !g.repeatEnd });
    }
    if (delta <= 0) return null;
    return { type: 'gift', user: g.user, gift: { id: g.gift.id, name: g.gift.name, count: delta * group, diamond: g.gift.diamond, image: g.gift.image } };
  }

  _gc(now) {
    if (this.msgSeen.size > 5000 || (this._lastGc || 0) + 30000 < now) {
      this._lastGc = now;
      for (const [k, t] of this.msgSeen) if (now - t > 120000) this.msgSeen.delete(k);
      for (const [k, s] of this.state) if (now - s.at > 60000) this.state.delete(k);
    }
  }
}
