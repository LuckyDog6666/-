// 自检工具：离线渲染全部 ASMR 声音，输出 WAV 与各项指标，并检查是否有问题。
// 用法： node tools/render-sounds.mjs [输出目录] [--only=id1,id2] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { RECIPES, AMB_EVENTS, AMBIENCE, renderRecipe, renderAmbience, LOUDNESS } from '../web/js/audio/recipes.js';
import { analyze, encodeWav } from '../web/js/audio/dsp.js';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--'));
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const quiet = args.includes('--quiet');
const SR = 48000;

if (outDir) fs.mkdirSync(outDir, { recursive: true });

// 各类别的合理时长范围（秒）——"踩得声音时长要合理"
const DURATION_RANGE = {
  step: [0.03, 0.4],
  soft: [0.12, 0.8],
  item: [0.06, 1.3],
  pop: [0.02, 0.3],
  chime: [0.3, 3.5],
  music: [0.05, 3.5],
  voice: [0.1, 1.3],
  fx: [0.2, 2.5],
  ambEvt: [0.05, 2.7],
};

const problems = [];
const rows = [];
const t0 = Date.now();
const ids = [...Object.keys(RECIPES), ...Object.keys(AMB_EVENTS)].filter((id) => !only.length || only.includes(id));
for (const id of ids) {
  const ts = Date.now();
  const { buffers, cat } = renderRecipe(id, SR, 1);
  const ms = Date.now() - ts;
  const stats = buffers.map((b) => analyze(b, SR));
  const durs = stats.map((s) => s.duration);
  const peaks = stats.map((s) => s.peakDb);
  const louds = stats.map((s) => s.loudDb);
  const [dmin, dmax] = DURATION_RANGE[cat] || [0.02, 4];
  const row = {
    id, cat, n: buffers.length,
    dur: `${Math.min(...durs).toFixed(3)}-${Math.max(...durs).toFixed(3)}`,
    peak: Math.max(...peaks).toFixed(1),
    loud: `${Math.min(...louds).toFixed(1)}..${Math.max(...louds).toFixed(1)}`,
    ms,
  };
  rows.push(row);
  stats.forEach((s, i) => {
    if (s.nan) problems.push(`${id}#${i}: 含 NaN`);
    if (s.peakDb > -2.5) problems.push(`${id}#${i}: 峰值过高 ${s.peakDb.toFixed(1)}dB`);
    if (s.duration < dmin || s.duration > dmax) problems.push(`${id}#${i}: 时长 ${s.duration.toFixed(3)}s 不在 [${dmin},${dmax}]`);
    const target = LOUDNESS[cat];
    if (Math.abs(s.loudDb - target) > 3.5 && s.peakDb < -3.2) problems.push(`${id}#${i}: 响度 ${s.loudDb.toFixed(1)} 偏离目标 ${target}`);
    if (Math.abs(s.dc) > 0.002) problems.push(`${id}#${i}: 直流偏移 ${s.dc.toFixed(4)}`);
    const b = buffers[i];
    if (Math.abs(b[0]) > 0.01 || Math.abs(b[b.length - 1]) > 0.002) problems.push(`${id}#${i}: 首尾不为零，可能有爆音`);
  });
  if (outDir) {
    buffers.forEach((b, i) => fs.writeFileSync(path.join(outDir, `${id}_${i}.wav`), Buffer.from(encodeWav([b], SR))));
  }
}

for (const id of Object.keys(AMBIENCE).filter((id) => !only.length || only.includes(id))) {
  const ts = Date.now();
  const [L, R] = renderAmbience(id, SR, 24, 1);
  const a = analyze(L, SR);
  rows.push({ id: 'amb:' + id, cat: 'amb', n: 1, dur: (L.length / SR).toFixed(1), peak: a.peakDb.toFixed(1), loud: a.loudDb.toFixed(1), ms: Date.now() - ts });
  if (a.nan) problems.push(`amb:${id}: 含 NaN`);
  if (a.peakDb > -6) problems.push(`amb:${id}: 环境声峰值过高 ${a.peakDb.toFixed(1)}`);
  // 循环接缝检查：末尾与开头样本差
  const seam = Math.abs(L[L.length - 1] - L[0]);
  if (seam > 0.02) problems.push(`amb:${id}: 循环接缝跳变 ${seam.toFixed(3)}`);
  if (outDir) fs.writeFileSync(path.join(outDir, `amb_${id}.wav`), Buffer.from(encodeWav([L, R], SR)));
}

if (!quiet) console.table(rows);
console.log(`共 ${rows.length} 个声音，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (problems.length) {
  console.log('发现问题：');
  for (const p of problems) console.log('  - ' + p);
  process.exitCode = 1;
} else {
  console.log('✔ 所有声音通过检查（无 NaN、无削波、时长合理、响度达标、首尾无爆音、循环无接缝）');
}
