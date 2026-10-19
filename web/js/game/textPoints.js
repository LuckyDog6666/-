// 把一段文字（老板的昵称）变成一组点，用来一个点一个点地"压"进雪地/沙子里。
// 返回站点局部坐标 [x, z]：x ∈ [0, w]（从左到右），z ∈ [-h/2, h/2]（文字的上边离镜头远）。
export function textPoints(text, w, h, spacing = 0.045) {
  const t = String(text || '').trim();
  if (!t) return [];
  const H = 64;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `900 ${H}px "ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif`;
  g.font = font;
  const tw = Math.ceil(g.measureText(t).width) + 8;
  c.width = Math.max(8, tw); c.height = H + 12;
  g.font = font;
  g.fillStyle = '#000';
  g.textBaseline = 'middle';
  g.fillText(t, 4, c.height / 2);
  const img = g.getImageData(0, 0, c.width, c.height).data;
  // 保持字形比例，放进 w × h 的区域
  const scale = Math.min(w / c.width, h / c.height);
  const ox = (w - c.width * scale) / 2, oz = -(c.height * scale) / 2;
  const step = Math.max(1, Math.round(spacing / scale));
  const pts = [];
  for (let y = 0; y < c.height; y += step) {
    for (let x = 0; x < c.width; x += step) {
      if (img[(y * c.width + x) * 4 + 3] > 128) pts.push([ox + x * scale, oz + y * scale]);
    }
  }
  // 按书写顺序（从左到右）排列，压出来像是一笔一笔写上去的
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return pts;
}
