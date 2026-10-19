#!/usr/bin/env python3
"""
声音打包工具（开发者用，直播时不需要运行）。

把下载来的真实录音（长段的踩雪、踩沙、捏史莱姆……）自动切成一个个"事件"：
  1. 解码成 48kHz 浮点，先做低切 / 去刺耳高频等清理
  2. 找出每一下触发（踩一脚、捏一下）的起点，保留完整的自然尾音（不会被切得短促生硬）
  3. 挑出最干净、最饱满、彼此不重复的若干个变体
  4. 微淡入淡出（无爆音），按类别统一响度（与 asmrAudio.js 的 autoGain 相同的度量）
  5. 编码成 OGG Vorbis，写入 web/sounds/<id>/ 和 manifest.json，并生成署名文件 CREDITS.md

用法：
  python3 tools/build_sounds.py --spec tools/sound_spec.json --raw <原始录音目录> --out web/sounds [--only id1,id2] [--sheet 预览图目录]

依赖：python3 + numpy + ffmpeg（libvorbis）。
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

SR = 48000
HOP = 240          # 5 ms
WIN = 480          # 10 ms
# 与 web/js/audio/asmrAudio.js 中 TARGET 一致：400ms 窗口最大 RMS（dBFS）
TARGET = {'trigger': -23, 'sustain': -24, 'soft': -27, 'step': -29, 'ambience': -29, 'music': -21}


def run(cmd, data=None):
    p = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError('命令失败: ' + ' '.join(cmd) + '\n' + p.stderr.decode('utf8', 'replace')[-1500:])
    return p.stdout


def decode(path, channels, af):
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-ac', str(channels), '-ar', str(SR)]
    if af:
        cmd += ['-af', af]
    cmd += ['-f', 'f32le', '-']
    raw = run(cmd)
    x = np.frombuffer(raw, dtype=np.float32).copy()
    return x.reshape(-1, channels)


def encode(x, path, quality):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ch = x.shape[1]
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-',
         '-c:a', 'libvorbis', '-q:a', str(quality), path], data=np.ascontiguousarray(x, dtype=np.float32).tobytes())


def probe_channels(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', path])
    try:
        return int(out.decode().strip().split('\n')[0])
    except ValueError:
        return 1


def env_db(mono):
    n = max(1, (len(mono) - WIN) // HOP + 1)
    idx = np.arange(n)[:, None] * HOP + np.arange(WIN)[None, :]
    idx = np.minimum(idx, len(mono) - 1)
    ms = np.mean(mono[idx] ** 2, axis=1)
    e = 10 * np.log10(ms + 1e-12)
    k = np.ones(3) / 3
    return np.convolve(e, k, mode='same')


def k_weight(d):
    """ITU-R BS.1770 的 K 计权（高频 +4 dB 搁架 + 38 Hz 高通），在频域里一次做完：
    这样响度统一的是"耳朵听到的响度"，明亮的脆声不会比低沉的闷声显得更响。"""
    n = len(d)
    if n < 16:
        return d
    m = 1 << int(np.ceil(np.log2(n)))
    X = np.fft.rfft(d, m)
    f = np.fft.rfftfreq(m, 1 / SR)
    shelf = (10 ** (4.0 / 20)) ** (1 / (1 + (1681.0 / np.maximum(f, 1)) ** 2))  # 平滑过渡到 +4 dB
    hp = (f / 38.0) ** 2 / np.sqrt(1 + (f / 38.0) ** 4)
    return np.fft.irfft(X * shelf * hp, m)[:n]


def loud400(x):
    """400ms 滑动窗口内最大均方（K 计权后，取各声道平均），返回 dB —— 近似"瞬时响度"的最大值。"""
    d = k_weight(x.mean(axis=1).astype(np.float64))
    win = int(0.4 * SR)
    if len(d) < win:
        ms = np.mean(d ** 2) if len(d) else 0
    else:
        c = np.concatenate([[0.0], np.cumsum(d * d)])
        ms = np.max((c[win:] - c[:-win]) / win)
    return 10 * np.log10(max(ms, 1e-12))


def fades(x, fin, fout):
    n = len(x)
    a = int(fin * SR)
    b = int(fout * SR)
    if a > 0:
        a = min(a, n // 2)
        x[:a] *= (np.sin(np.linspace(0, np.pi / 2, a)) ** 2)[:, None]
    if b > 0:
        b = min(b, n // 2)
        x[n - b:] *= (np.cos(np.linspace(0, np.pi / 2, b)) ** 2)[:, None]
    return x


def limit(x, ceil, attack=0.0015, release=0.08, max_red_db=6):
    """简单的前视峰值限幅：只压瞬态，最多压 max_red_db，保留录音的颗粒感。"""
    from numpy.lib.stride_tricks import sliding_window_view
    a = np.max(np.abs(x), axis=1)
    floor_g = 10 ** (-max_red_db / 20)
    need = np.clip(ceil / np.maximum(a, 1e-9), floor_g, 1.0)
    w = max(1, int(attack * SR))
    padded = np.concatenate([need, np.ones(w)])
    mn = sliding_window_view(padded, w + 1).min(axis=1)[:len(need)]
    out = np.empty_like(mn)
    r = 1 - np.exp(-1 / (release * SR))
    g = 1.0
    for i in range(len(mn)):
        t = mn[i]
        g = t if t < g else g + (t - g) * r
        out[i] = g
    # 再平滑一次攻击段，避免"咔"声
    k = np.ones(w) / w
    out = np.minimum(out, np.convolve(out, k, mode='same'))
    return x * out[:, None]


def tempo(x):
    """估计音乐的速度（BPM）和第一拍的位置，让糯糯的舞步踩在音乐的拍子上。"""
    mono = x.mean(axis=1)
    hop, n = 512, 2048
    frames = max(1, (len(mono) - n) // hop)
    win = np.hanning(n)
    prev = None
    flux = np.zeros(frames)
    for i in range(frames):
        X = np.abs(np.fft.rfft(mono[i * hop:i * hop + n] * win))
        X = np.log1p(X * 10)
        if prev is not None:
            flux[i] = np.sum(np.maximum(0, X - prev))
        prev = X
    flux -= np.convolve(flux, np.ones(16) / 16, mode='same')
    flux = np.maximum(flux, 0)
    fr = SR / hop
    ac = np.correlate(flux, flux, mode='full')[len(flux) - 1:]

    def acv(lag):
        l0 = int(lag)
        return ac[l0] * (1 - (lag - l0)) + ac[l0 + 1] * (lag - l0)
    # 谐波求和（同时看 1~4 倍周期）减少"半拍/双拍"误判，再折叠到适合跳舞的 85~170 BPM
    best, bpm = -1, 120
    for b in np.arange(60, 200, 0.5):
        lag = fr * 60 / b
        v = sum(acv(lag * k) / k ** 0.3 for k in (1, 2, 3, 4) if lag * k < len(ac) - 2)
        if v > best:
            best, bpm = v, b
    while bpm < 85:
        bpm *= 2
    while bpm >= 170:
        bpm /= 2
    period = fr * 60 / bpm
    offs = np.arange(0, period, 0.5)
    score = [np.sum(flux[np.clip((o + np.arange(0, frames - o, period)).astype(int), 0, frames - 1)]) for o in offs]
    beat0 = float(offs[int(np.argmax(score))] / fr)
    return float(bpm), beat0


def detect_events(x, o):
    pad = int(0.06 * SR)
    x = np.concatenate([np.zeros((pad, x.shape[1]), dtype=x.dtype), x])
    o = dict(o)
    o['_pad'] = pad
    mono = x.mean(axis=1)
    e = env_db(mono)
    floor = float(np.percentile(e, o.get('floorPct', 20)))
    rise_db = o.get('riseDb', 7)
    prom = o.get('promDb', 12)
    min_gap = int(o.get('minGap', 0.22) * SR / HOP)
    look = 6  # 30 ms
    cands = []
    for i in range(look, len(e) - 1):
        r = e[i] - np.min(e[i - look:i])
        if r > rise_db and e[i] > floor + prom * 0.6:
            cands.append((i, r))
    # 合并 20ms 以内的候选，取上升最陡处
    onsets = []
    for i, r in cands:
        if onsets and i - onsets[-1][0] < 4:
            if r > onsets[-1][1]:
                onsets[-1] = (i, r)
            continue
        if onsets and i - onsets[-1][0] < min_gap:
            continue
        onsets.append((i, r))
    pre = int(o.get('pre', 0.015) * SR / HOP)
    tail_drop = o.get('tailDb', 38)
    hold = int(0.035 * SR / HOP)
    min_dur = o.get('minDur', 0.18)
    max_dur = o.get('maxDur', 1.5)
    events = []
    for k, (i, r) in enumerate(onsets):
        nxt = onsets[k + 1][0] if k + 1 < len(onsets) else len(e)
        pk_end = min(len(e), i + int(0.12 * SR / HOP))
        p = i + int(np.argmax(e[i:pk_end])) if pk_end > i else i
        peak = float(e[p])
        if peak < floor + prom:
            continue
        thr = max(floor + o.get('floorMargin', 5), peak - tail_drop)
        end = p
        below = 0
        limit = min(len(e), i + int(max_dur * SR / HOP))
        if not o.get('allowOverlap', False):
            limit = min(limit, max(p + 1, nxt - 1))
        while end < limit:
            if e[end] < thr:
                below += 1
                if below >= hold:
                    end -= hold - 1
                    break
            else:
                below = 0
            end += 1
        s = max(0, i - pre)
        dur = (end - s) * HOP / SR
        if dur < min_dur:
            continue
        seg = x[s * HOP:end * HOP + WIN]
        clip = float(np.max(np.abs(seg))) >= 0.985
        # 前面越安静（孤立、干净）越好；太长的被截断的扣分
        quiet_before = float(peak - np.mean(e[max(0, i - 20):max(1, i - 2)])) if i > 4 else 10
        truncated = end >= limit and limit < len(e) and e[min(len(e) - 1, end)] > thr + 6
        score = (peak - floor) + 0.35 * min(quiet_before, 25) - (30 if clip else 0) - (8 if truncated else 0)
        events.append({'s': max(0, s * HOP - pad), 'e': min(len(x), end * HOP + WIN) - pad, 'peak': peak, 'score': score, 'dur': dur, 'clip': clip})
    return events, floor


def detect_chunks(x, o):
    """很长的连续纹理（一直在捏的史莱姆）：在包络较低的地方下刀，切成长度接近 ideal 的段落。"""
    mono = x.mean(axis=1)
    e = env_db(mono)
    sw = max(3, int(o.get('smooth', 0.12) * SR / HOP))
    es = np.convolve(e, np.ones(sw) / sw, mode='same')
    fr = SR / HOP
    lo, hi, ideal = int(o.get('minDur', 1.2) * fr), int(o.get('maxDur', 2.6) * fr), int(o.get('ideal', 1.8) * fr)
    floor = float(np.percentile(e, 20))
    events = []
    a = int(np.argmin(es[:max(1, lo // 2)]))  # 从开头附近最安静的地方开始
    while a + lo < len(es):
        w0, w1 = a + lo, min(len(es) - 1, a + hi)
        if w1 <= w0:
            break
        # 在允许范围内找最安静、又尽量接近理想长度的切点
        cand = np.arange(w0, w1 + 1)
        cost = es[cand] + np.abs(cand - (a + ideal)) / fr * 4
        b = int(cand[np.argmin(cost)])
        seg_e = e[a:b]
        peak = float(np.max(seg_e))
        activity = float(np.mean(seg_e > floor + 10))
        clip = float(np.max(np.abs(x[a * HOP:b * HOP]))) >= 0.985
        score = (peak - floor) * 0.5 + activity * 20 - (30 if clip else 0)
        events.append({'s': a * HOP, 'e': min(len(x), b * HOP), 'peak': peak, 'score': score, 'dur': (b - a) / fr, 'clip': clip})
        a = b
    return events, floor


def detect_humps(x, o):
    """连续纹理的录音（一直在走的踩雪、踩落叶）：按包络的"波谷"切开，每个波峰就是完整的一步。"""
    mono = x.mean(axis=1)
    e = env_db(mono)
    sw = max(3, int(o.get('smooth', 0.1) * SR / HOP))
    es = np.convolve(e, np.ones(sw) / sw, mode='same')
    half = max(2, int(o.get('minGap', 0.35) * SR / HOP / 2))
    valleys = [i for i in range(half, len(es) - half) if es[i] == np.min(es[i - half:i + half + 1])]
    # 去掉挨得太近的波谷
    vv = []
    for v in valleys:
        if vv and v - vv[-1] < half:
            if es[v] < es[vv[-1]]:
                vv[-1] = v
            continue
        vv.append(v)
    min_dur, max_dur = o.get('minDur', 0.3), o.get('maxDur', 1.2)
    ideal = o.get('ideal', (min_dur + max_dur) / 2)
    events = []
    floor = float(np.percentile(e, 20))
    for a, b in zip(vv, vv[1:]):
        dur = (b - a) * HOP / SR
        if dur < min_dur:
            continue
        if dur > max_dur:
            b = a + int(max_dur * SR / HOP)
            dur = max_dur
        seg_e = e[a:b]
        peak = float(np.max(seg_e))
        edge = max(float(es[a]), float(es[min(b, len(es) - 1)]))
        contrast = peak - edge
        clip = float(np.max(np.abs(x[a * HOP:b * HOP]))) >= 0.985
        score = contrast - abs(dur - ideal) * 6 - (30 if clip else 0)
        events.append({'s': a * HOP, 'e': min(len(x), b * HOP), 'peak': peak, 'score': score, 'dur': dur, 'clip': clip})
    return events, floor


def pick(events, count, spread=True):
    ev = sorted(events, key=lambda q: -q['score'])
    chosen = []
    for q in ev:
        if len(chosen) >= count:
            break
        chosen.append(q)
    chosen.sort(key=lambda q: q['s'])
    return chosen


def make_loop(x, o):
    seg_len = int(o.get('loopLen', 40) * SR)
    xf = int(o.get('crossfade', 2.0) * SR)
    start = int(o.get('start', 0) * SR)
    if start + seg_len + xf > len(x):
        seg_len = max(int(SR * 4), len(x) - start - xf)
    if start + seg_len + xf > len(x):
        start = 0
        seg_len = len(x) - xf
    a = x[start:start + seg_len].copy()
    tail = x[start + seg_len:start + seg_len + xf]
    # 把片段之后的一段淡入叠在开头：循环接缝处听不出来（等功率交叉）
    t = np.linspace(0, np.pi / 2, len(tail))[:, None]
    a[:len(tail)] = a[:len(tail)] * np.sin(t) + tail * np.cos(t)
    return a


def process_id(sd, args, credits):
    sid = sd['id']
    cat = sd.get('cat', 'trigger')
    mode = sd.get('mode', 'events')
    target = sd.get('target', TARGET.get(cat, -20))
    af = ','.join(f for f in [
        f"highpass=f={sd.get('hp', 50)}:p=2" if sd.get('hp', 50) else None,
        f"lowpass=f={sd['lp']}" if sd.get('lp') else None,
        f"equalizer=f={sd.get('deharshF', 4200)}:t=o:w=1.6:g={-abs(sd['deharsh'])}" if sd.get('deharsh') else None,
        f"equalizer=f={sd['warmF']}:t=o:w=1.4:g={sd.get('warm', 2)}" if sd.get('warmF') else None,
        sd.get('af'),
    ] if f)
    outs = []
    for src in sd['sources']:
        path = os.path.join(args.raw, src['file'])
        if not os.path.exists(path):
            print(f'  ! 缺少原始录音 {path}', file=sys.stderr)
            continue
        ch = 1 if sd.get('mono') else min(2, probe_channels(path))
        x = decode(path, ch, af)
        if src.get('range'):
            a, b = src['range']
            x = x[int(a * SR):int(b * SR)]
        gain_extra = src.get('gain', 0)
        if mode in ('events', 'humps', 'chunks'):
            opts = dict(sd)
            opts.update(src.get('opts', {}))
            evs, floor = {'humps': detect_humps, 'chunks': detect_chunks, 'events': detect_events}[mode](x, opts)
            if src.get('times'):
                # 手动指定的时间点（秒）：只保留离这些时间最近的事件
                want = [int(t * SR) for t in src['times']]
                evs = [min(evs, key=lambda q: abs(q['s'] - w)) for w in want if evs]
            take = pick(evs, src.get('count', sd.get('count', 6)))
            for q in take:
                seg = x[q['s']:q['e']].copy()
                outs.append((seg, src, gain_extra, q))
            durs = ', '.join('%.2fs' % q['dur'] for q in take)
            print(f"  {os.path.basename(path)}: 底噪 {floor:.1f} dB，检测到 {len(evs)} 个事件，选用 {len(take)} 个（{durs}）")
        elif mode == 'loop':
            seg = make_loop(x, {**sd, **src.get('opts', {})})
            outs.append((seg, src, gain_extra, None))
            print(f"  {os.path.basename(path)}: 循环 {len(seg) / SR:.1f}s")
        elif mode == 'ranges':
            for a, b in src['ranges']:
                seg = x[int(a * SR):int(b * SR)].copy()
                outs.append((seg, src, gain_extra, None))
            print(f"  {os.path.basename(path)}: 手动片段 {len(src['ranges'])} 个")
        else:  # whole（可选去掉首尾静音）
            y = x.copy()
            if sd.get('trim', True):
                e = env_db(y.mean(axis=1))
                on = np.where(e > float(np.max(e)) - sd.get('trimDb', 42))[0]
                if len(on):
                    a = max(0, on[0] * HOP - int(0.01 * SR))
                    b = min(len(y), on[-1] * HOP + WIN + int(0.08 * SR))
                    y = y[a:b]
            if sd.get('maxDur') and len(y) > sd['maxDur'] * SR:
                y = y[:int(sd['maxDur'] * SR)]
            outs.append((y, src, gain_extra, None))
        if not any(c['file'] == src['file'] for c in credits):
            credits.append({k: src.get(k) for k in ('file', 'title', 'author', 'url', 'license', 'via')})
    files = []
    odir = os.path.join(args.out, sid)
    if not outs:
        # 原始录音缺失：保留原来打包好的文件和清单，不要把这个声音清空
        print(f'  ! {sid} 没有生成任何片段，保留原有文件', file=sys.stderr)
        return None
    if os.path.isdir(odir):
        for f in os.listdir(odir):
            if f.endswith('.ogg'):
                os.remove(os.path.join(odir, f))
    for k, (seg, src, gain_extra, q) in enumerate(outs):
        fin = sd.get('fadeIn', 0.003)
        fout = sd.get('fadeOut', min(0.12, max(0.03, len(seg) / SR * 0.25)))
        if mode == 'loop':
            fin = fout = 0
        seg = fades(seg, fin, fout)
        # 统一响度，同时保证峰值不超过 -1 dBFS：瞬态先用前视限幅柔和压下（最多 6 dB），剩下的差距记在清单里由播放器补
        g = target - loud400(seg) + gain_extra
        g = min(g, sd.get('maxBoost', 24))
        seg = seg * (10 ** (g / 20))
        rest = 0.0
        pk_db = 20 * np.log10(float(np.max(np.abs(seg))) + 1e-9)
        if pk_db > -1.0 and mode not in ('loop', 'ranges'):
            seg = limit(seg, 10 ** (-1.0 / 20), max_red_db=sd.get('maxLimit', 6))
            pk_db = 20 * np.log10(float(np.max(np.abs(seg))) + 1e-9)
        if pk_db > -1.0:
            rest = pk_db + 1.0
            seg = seg * (10 ** (-rest / 20))
        name = f'{sid}_{k + 1:02d}.ogg'
        encode(seg, os.path.join(odir, name), sd.get('quality', 5))
        entry = {'src': f'{sid}/{name}', 'dur': round(len(seg) / SR, 3), 'gain': round(min(rest, 6), 2)}
        if cat == 'music':
            bpm, beat0 = tempo(seg)
            entry['bpm'] = round(bpm, 1)
            entry['beat0'] = round(beat0, 3)
            if src.get('title'):
                entry['title'] = src['title']
            entry['credit'] = f"{src.get('author', '')} · {src.get('license', '')}"

            print(f"    {src.get('title')}: {bpm:.1f} BPM，第一拍 {beat0:.2f}s")
        files.append(entry)
        if args.sheet:
            os.makedirs(args.sheet, exist_ok=True)
    if args.sheet and files:
        sheet(sid, odir, [f['src'].split('/')[-1] for f in files], args.sheet)
    return {'cat': cat, 'gain': sd.get('gain', 0), 'label': sd.get('label', ''), 'files': files,
            'credits': sorted({c.get('author') or '' for c in credits if any(s['file'] == c['file'] for s in sd['sources'])})}


def sheet(sid, odir, names, outdir):
    """把这一组声音画成波形+频谱拼图，方便肉眼检查切得好不好。"""
    pngs = []
    for n in names:
        p = os.path.join(outdir, f'_{sid}_{n}.png')
        run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(odir, n), '-lavfi',
             'showspectrumpic=s=360x120:legend=0:scale=log:fscale=lin:color=viridis,pad=380:140:10:10', p])
        pngs.append(p)
    if not pngs:
        return
    inputs = []
    for p in pngs:
        inputs += ['-i', p]
    cols = 4
    rows = (len(pngs) + cols - 1) // cols
    layout = '|'.join(f'{(i % cols) * 380}_{(i // cols) * 140}' for i in range(len(pngs)))
    out = os.path.join(outdir, f'{sid}.png')
    if len(pngs) == 1:
        os.replace(pngs[0], out)
        return
    run(['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', f'xstack=inputs={len(pngs)}:layout={layout}:fill=black', out])
    for p in pngs:
        os.remove(p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', default='tools/sound_spec.json')
    ap.add_argument('--raw', required=True)
    ap.add_argument('--out', default='web/sounds')
    ap.add_argument('--only', default='')
    ap.add_argument('--sheet', default='')
    args = ap.parse_args()
    spec = json.load(open(args.spec, encoding='utf8'))
    man_path = os.path.join(args.out, 'manifest.json')
    manifest = {'version': 2, 'sounds': {}}
    if os.path.exists(man_path):
        manifest = json.load(open(man_path, encoding='utf8'))
    only = set(filter(None, args.only.split(',')))
    credits = []
    for sd in spec['sounds']:
        if only and sd['id'] not in only:
            continue
        print(f"[{sd['id']}] {sd.get('label', '')}")
        r = process_id(sd, args, credits)
        if r is not None:
            manifest['sounds'][sd['id']] = r
    # 清理 spec 中已删除的声音
    ids = {sd['id'] for sd in spec['sounds']}
    for k in list(manifest['sounds'].keys()):
        if k not in ids:
            del manifest['sounds'][k]
    # 需要署名（CC BY）的作者名单：游戏会在画面上滚动显示致谢
    by = []
    for sd in spec['sounds']:
        if sd.get('cat') == 'music':
            continue
        for src in sd['sources']:
            if 'BY' in (src.get('license') or '').upper() and src.get('author') and src['author'] not in by:
                by.append(src['author'])
    manifest['attribution'] = by
    os.makedirs(args.out, exist_ok=True)
    with open(man_path, 'w', encoding='utf8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    write_credits(spec, args.out)
    print('完成：', man_path)


def write_credits(spec, out):
    seen = {}
    for sd in spec['sounds']:
        for s in sd['sources']:
            key = s['file']
            e = seen.setdefault(key, {**s, 'ids': []})
            e['ids'].append(sd['id'])
    lines = ['# 声音素材来源与授权 / Sound credits', '',
             '本项目内置的所有声音都是**真实录音**（没有任何程序合成音）。下列素材均允许商用；',
             'CC-BY 类素材需要署名，已在此列出。我们对原始录音做了切分、降噪滤波、淡入淡出与响度统一。', '',
             '| 素材 | 作者 | 来源 | 授权 | 用于 |', '|---|---|---|---|---|']
    for e in seen.values():
        title = e.get('title') or os.path.basename(e['file'])
        via = f"（经由 {e['via']}）" if e.get('via') else ''
        lines.append(f"| {title} | {e.get('author') or '-'} | {e.get('url') or '-'}{via} | {e.get('license') or '-'} | {', '.join(sorted(set(e['ids'])))} |")
    lines += ['', '授权说明：', '- CC0 1.0：公共领域，可自由使用。https://creativecommons.org/publicdomain/zero/1.0/',
              '- CC BY 3.0 / 4.0：可商用，需署名（即本文件）。https://creativecommons.org/licenses/by/4.0/',
              '- Pixabay Content License：可免费商用、无需署名；不得把原始素材单独转售或作为素材库再分发。https://pixabay.com/service/license-summary/',
              '- Public Domain：公有领域。',
              '- MIT（Button Sounds）：Copyright (c) 2026 Josh Comeau. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.',
              '']
    with open(os.path.join(out, 'CREDITS.md'), 'w', encoding='utf8') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
