// 应援值：每一种互动都算分（不花钱的点赞、弹幕、关注也能上榜、也能推动应援条）。
// 礼物 1 抖币 = 10 分；点赞 1 分（一条点赞消息最多算 50 个）；弹幕 3 分（同一个人 20 秒内最多算 4 条，防刷屏）；
// 关注 30；加入粉丝团 50；分享 20；进房 1（进房不上榜）。可在 config.json 的 "points" 里改。
export const DEFAULT_POINTS = { like: 1, chat: 3, enter: 1, share: 20, follow: 30, fansclub: 50, giftPerDiamond: 10, likeCapPerEvent: 50, chatPerWindow: 4, chatWindowMs: 20000 };

export function makePoints(custom = {}) {
  const P = Object.assign({}, DEFAULT_POINTS, custom);
  const chatRate = new Map();
  return {
    table: P,
    pointsFor(ev, now = Date.now()) {
      const u = ev && ev.user;
      if (!u || !(u.id || u.name)) return 0;
      switch (ev.type) {
        case 'gift': return Math.max(1, Number(ev.gift?.diamond) || 1) * Math.max(1, Number(ev.gift?.count) || 1) * P.giftPerDiamond;
        case 'like': return Math.min(P.likeCapPerEvent, Math.max(1, Number(ev.count) || 1)) * P.like;
        case 'chat': {
          const id = String(u.id || u.name);
          let r = chatRate.get(id);
          if (!r || now - r.t > P.chatWindowMs) { r = { t: now, n: 0 }; chatRate.set(id, r); }
          if (chatRate.size > 5000) for (const [k, v] of chatRate) if (now - v.t > P.chatWindowMs) chatRate.delete(k);
          return ++r.n <= P.chatPerWindow ? P.chat : 0;
        }
        case 'follow': return P.follow;
        case 'fansclub': return P.fansclub;
        case 'share': return P.share;
        case 'enter': return P.enter;
        default: return 0;
      }
    },
  };
}
