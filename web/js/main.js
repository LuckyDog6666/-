// 入口：渲染器、配置、声音、界面、直播事件连接、看门狗心跳、自动画质。
import * as THREE from 'three';
import { AudioEngine } from './audio/audioEngine.js';
import { Particles } from './render/particles.js';
import { MaterialBank } from './render/materials.js';
import { Hud } from './ui/hud.js';
import { Game } from './game/game.js';
import { LiveClient } from './net/live.js';

const params = new URLSearchParams(location.search);
const SIM = Math.max(1, Math.min(60, Number(params.get('sim')) || 1));
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');
const setLoading = (t) => { if (loadingText) loadingText.textContent = t; };

window.addEventListener('error', (e) => report('error', e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')));
window.addEventListener('unhandledrejection', (e) => report('error', String(e.reason && (e.reason.stack || e.reason))));

let errorCount = 0;
function report(type, message) {
  errorCount++;
  console.error('[nuonuo]', message);
  fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, message: String(message).slice(0, 2000) }) }).catch(() => {});
}

async function loadConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch {}
  return {};
}

async function main() {
  const cfgAll = await loadConfig();
  const cfg = Object.assign({
    pixelRatio: 1.25, shadowSize: 2048, reloadHours: 6, levelBudget: 170, levelLength: [34, 46], showSoundLabels: true,
    audio: {}, gifts: {}, hud: {},
  }, cfgAll.game || {});
  if (params.get('layout')) cfg.layout = params.get('layout');
  if (params.get('hud') === '0') document.body.classList.add('hide-board', 'hide-tips');
  if (cfg.hud && cfg.hud.showBoard === false) document.body.classList.add('hide-board');
  if (cfg.hud && cfg.hud.showTips === false) document.body.classList.add('hide-tips');

  // ---- 渲染器 ----
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
  let pixelRatio = Math.min(window.devicePixelRatio || 1, Number(params.get('pr')) || cfg.pixelRatio);
  const particles = new Particles(scene);
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = h > w ? 52 : 40;
    camera.updateProjectionMatrix();
    particles.setScale(h * pixelRatio, camera.fov);
  };
  window.addEventListener('resize', resize);
  resize();

  // WebGL 上下文丢失（显卡驱动重置等）：自动刷新恢复
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); report('error', 'webgl context lost'); setTimeout(() => location.reload(), 2500); });

  // ---- 声音 ----
  setLoading('正在调制 ASMR 声音…');
  const audio = new AudioEngine(Object.assign({}, cfg.audio));
  await audio.init();
  const hint = document.getElementById('audioHint');
  const checkAudio = () => hint.classList.toggle('show', !audio.running && !params.has('nohint'));
  setInterval(checkAudio, 1500);
  hint.addEventListener('click', () => audio.ctx.resume());

  // ---- 界面与游戏 ----
  const hud = new Hud(document.getElementById('hud'), Object.assign({ showSoundLabels: cfg.showSoundLabels }, cfg.hud));
  const game = new Game({
    renderer, scene, camera, audio, hud, particles, petMats: new MaterialBank(), cfg,
    onStatus: (s) => { if (s.type === 'error') report('error', s.message); },
  });
  window.__game = game; // 方便调试/自检
  setLoading('糯糯正在出门…');
  await game.init();

  // ---- 直播事件 ----
  const live = new LiveClient({
    onEvent: (ev) => {
      if (ev.type === 'control') game.command(ev);
      else if (ev.type === 'board') hud.setBoard(ev.list);
      else game.onLive(ev);
    },
  });
  live.connect();
  window.__live = live;

  // ---- 主循环 ----
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fps = 60, lowSince = 0, highSince = 0;
  const loop = (now) => {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1); // 卡顿时不要"瞬移"
    try {
      if (SIM > 1) for (let i = 0; i < SIM; i++) game.update(1 / 30); // 自检用：快进模拟
      else game.update(dt);
      renderer.render(scene, camera);
    } catch (err) {
      report('error', err && err.stack || err);
      if (errorCount > 50) location.reload();
    }
    // 自动画质：持续掉帧就降低分辨率，持续流畅再慢慢提回来
    fpsAcc += 1 / Math.max(dt, 1e-3); fpsN++;
    if (fpsN >= 30) {
      fps = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
      const t = now / 1000;
      if (fps < 42) { if (!lowSince) lowSince = t; highSince = 0; } else if (fps > 57) { if (!highSince) highSince = t; lowSince = 0; } else { lowSince = highSince = 0; }
      if (lowSince && t - lowSince > 6 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.2); resize(); lowSince = 0; console.log('[quality] pixelRatio ->', pixelRatio); }
      if (highSince && t - highSince > 40 && pixelRatio < Math.min(window.devicePixelRatio || 1, cfg.pixelRatio)) { pixelRatio = Math.min(cfg.pixelRatio, pixelRatio + 0.1); resize(); highSince = 0; }
    }
  };
  requestAnimationFrame(loop);

  // ---- 心跳（服务器看门狗：页面卡死会被自动重启） ----
  const beat = () => {
    const info = renderer.info;
    fetch('/api/heartbeat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fps: Math.round(fps), pixelRatio, audio: audio.ctx.state, level: audio.level(),
        game: game.status(), mem: { geometries: info.memory.geometries, textures: info.memory.textures, calls: info.render.calls, js: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null },
        live: live.status(), errors: errorCount,
      }),
    }).catch(() => {});
  };
  setInterval(beat, 5000);
  beat();

  loadingEl.classList.add('hide');
  setTimeout(() => loadingEl.remove(), 1200);
}

main().catch((err) => {
  report('error', 'boot failed: ' + (err && err.stack || err));
  setLoading('启动失败，10 秒后自动重试…');
  setTimeout(() => location.reload(), 10000);
});
