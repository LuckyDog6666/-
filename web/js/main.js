// 入口：渲染器、配置、声音、界面、直播事件连接、看门狗心跳、自动画质。
import * as THREE from 'three';
import { AsmrAudio } from './audio/asmrAudio.js';
import { RoomEnvironment } from '../vendor/addons/RoomEnvironment.js';
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

// 让游戏窗口的"画面区域"正好是设定的大小（--window-size 设的是含标题栏的外框）
function fitWindow() {
  const cw = Number(params.get('cw')), ch = Number(params.get('ch'));
  if (!cw || !ch) return;
  const fix = () => {
    const dw = window.outerWidth - window.innerWidth, dh = window.outerHeight - window.innerHeight;
    if (Math.abs(window.innerWidth - cw) > 2 || Math.abs(window.innerHeight - ch) > 2) { try { window.resizeTo(cw + dw, ch + dh); } catch {} }
  };
  fix();
  setTimeout(fix, 1500);
}

async function main() {
  fitWindow();
  const cfgAll = await loadConfig();
  const cfg = Object.assign({
    pixelRatio: 1.25, shadowSize: 2048, reloadHours: 6, stageSeconds: 210, showSoundLabels: true,
    audio: {}, gifts: {}, hud: {},
  }, cfgAll.game || {});
  if (params.get('layout')) cfg.layout = params.get('layout');
  if (params.get('stages')) cfg.stages = params.get('stages').split(',');
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
  // 柔和的室内环境光照（让史莱姆、果冻、泡泡有真实的高光和反射）
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();
  } catch (e) { console.warn('[env] 环境贴图创建失败', e); }
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
  setLoading('正在加载真实录制的 ASMR 声音…');
  const audio = new AsmrAudio(Object.assign({}, cfg.audio));
  try {
    await audio.init();
  } catch (e) {
    // 没有可用的声卡等极端情况：静音运行，画面照常
    report('error', 'audio init failed: ' + (e && e.message || e));
  }
  const hint = document.getElementById('audioHint');
  const checkAudio = () => hint.classList.toggle('show', !!audio.ctx && !audio.running && !params.has('nohint'));
  setInterval(checkAudio, 1500);
  hint.addEventListener('click', () => audio.ctx && audio.ctx.resume());

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
  let fpsAcc = 0, fpsN = 0, fps = 60, lowSince = 0, highSince = 0, cheapShadows = false;
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
      else if (lowSince && t - lowSince > 8 && pixelRatio <= 0.75 && !cheapShadows) {
        // 分辨率已经最低还是卡：换成更省的阴影
        cheapShadows = true; lowSince = 0;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        game.cfg.shadowSize = 1024;
        const sun = game.world && game.world.sun;
        if (sun) { if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(1024, 1024); }
        console.log('[quality] cheaper shadows');
      }
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
        fps: Math.round(fps), pixelRatio, audio: audio.state, level: audio.level(),
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
