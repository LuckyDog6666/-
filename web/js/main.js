// 入口：渲染器、配置、声音、界面、直播事件连接、看门狗心跳、自动画质。
import * as THREE from 'three';
import { AsmrAudio } from './audio/asmrAudio.js';
import { RoomEnvironment } from '../vendor/addons/RoomEnvironment.js';
import { Particles } from './render/particles.js';
import { FilmLook } from './render/post.js';
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
  let cw = Number(params.get('cw')), ch = Number(params.get('ch'));
  const fit = params.get('fit');
  if (fit) {
    // 自动大小：屏幕放得下的最大 9:16（竖屏）/ 16:9（横屏）窗口。直播伴侣捕获这个窗口后会拉伸到整个画布，窗口越大越清楚
    const dw = Math.max(0, window.outerWidth - window.innerWidth), dh = Math.max(0, window.outerHeight - window.innerHeight);
    const maxW = (screen.availWidth || 1280) - dw - 8, maxH = (screen.availHeight || 720) - dh - 8;
    const ar = fit === 'portrait' ? 9 / 16 : 16 / 9;
    ch = Math.min(maxH, fit === 'portrait' ? 1920 : 1080); cw = Math.round(ch * ar);
    if (cw > maxW) { cw = maxW; ch = Math.round(cw / ar); }
    try { window.moveTo((screen.availLeft || 0) + 4, (screen.availTop || 0) + 2); } catch {}
  }
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
  // 调试：?seg=3 从第 3 段开始；?gim=slide 把某种闯关元素排在第一个（检查画面用）
  if (params.get('seg')) cfg.startSegment = Math.max(0, Number(params.get('seg')) || 0);
  if (params.get('gim')) cfg.forceGimmick = params.get('gim');
  if (params.get('hud') === '0') document.body.classList.add('hide-board', 'hide-tips');
  if (cfg.hud && cfg.hud.showBoard === false) document.body.classList.add('hide-board');
  if (cfg.hud && cfg.hud.showTips === false) document.body.classList.add('hide-tips');

  // ---- 渲染器 ----
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // PBR Neutral 色调映射：基本保留材质原本的糖果色（ACES 会把粉色、天蓝洗得发灰）
  renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  // 柔和的室内环境光照（让史莱姆、果冻、泡泡有真实的高光和反射）
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();
  } catch (e) { console.warn('[env] 环境贴图创建失败', e); }
  // 动画电影感的后期（柔光 + 轻微调色）；掉帧时自动关闭，config.json 里 "post": false 或 ?nopost 可关
  const film = new FilmLook(renderer, { enabled: cfg.post !== false && !params.has('nopost') });
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
  // 刷新前没来得及答谢的礼物：刷新后接着谢（见 GiftManager.snapshot）
  try {
    const q = sessionStorage.getItem('nuonuo.giftQueue');
    if (q) { sessionStorage.removeItem('nuonuo.giftQueue'); game.gifts.restore(q); }
  } catch {}
  addEventListener('pagehide', () => { try { sessionStorage.setItem('nuonuo.giftQueue', game.gifts.snapshot()); } catch {} });
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
  // ?manual：自检 / 截图用的逐帧模式——游戏不自己走，由 window.__advance(秒) 推进（每一小步之间让出微任务，
  // 保证 await 链能接上），画面照常渲染。正常直播不会用到。
  const MANUAL = params.has('manual');
  let filmStage = null; // 当前后期参数对应的世界（换世界时按世界微调柔光）
  if (MANUAL) {
    window.__advance = async (sec, step = 1 / 60, render = true) => {
      const n = Math.max(1, Math.round(sec / step));
      for (let i = 0; i < n; i++) {
        game.update(step);
        // 正常运行时渲染会顺便更新所有物体的世界矩阵；不渲染的快进也要更新，不然有的逻辑读到旧矩阵会卡住
        if (!render) { scene.updateMatrixWorld(); camera.updateMatrixWorld(); }
        for (let k = 0; k < 12; k++) await null;
      }
      if (game.stage !== filmStage) { filmStage = game.stage; film.configure(filmStage && filmStage.film); }
      if (render) film.render(scene, camera);
      return game.time;
    };
    window.__render = () => film.render(scene, camera);
  }
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fps = 60, lowSince = 0, highSince = 0, cheapShadows = false;
  const loop = (now) => {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1); // 卡顿时不要"瞬移"
    if (game.stage !== filmStage) { filmStage = game.stage; film.configure(filmStage && filmStage.film); }
    try {
      if (MANUAL) return; // 逐帧模式：只在 __advance 之后渲染（省 CPU）
      if (SIM > 1) for (let i = 0; i < SIM; i++) game.update(1 / 30); // 自检用：快进模拟
      else game.update(dt);
      try { film.render(scene, camera); } catch (e) { film.setEnabled(false); report('error', 'film look disabled: ' + (e && e.message || e)); renderer.render(scene, camera); }
    } catch (err) {
      report('error', err && err.stack || err);
      if (errorCount > 50) location.reload();
    }
    // 自动画质：持续掉帧就降低分辨率，持续流畅再慢慢提回来（?fixedq 关闭，截图/录屏用）
    fpsAcc += 1 / Math.max(dt, 1e-3); fpsN++;
    if (fpsN >= 30 && params.has('fixedq')) { fps = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0; }
    if (fpsN >= 30) {
      fps = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
      const t = now / 1000;
      if (fps < 42) { if (!lowSince) lowSince = t; highSince = 0; } else if (fps > 57) { if (!highSince) highSince = t; lowSince = 0; } else { lowSince = highSince = 0; }
      if (lowSince && t - lowSince > 6 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.2); resize(); lowSince = 0; console.log('[quality] pixelRatio ->', pixelRatio); }
      else if (lowSince && t - lowSince > 8 && pixelRatio <= 0.75 && film.enabled) {
        // 分辨率已经最低还是卡：先关掉后期柔光
        film.setEnabled(false); lowSince = 0;
        console.log('[quality] film look off');
      }
      else if (lowSince && t - lowSince > 8 && pixelRatio <= 0.75 && !cheapShadows) {
        // 分辨率已经最低还是卡：换成更省的阴影
        cheapShadows = true; lowSince = 0;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        game.cfg.shadowSize = 1024;
        const sun = game.course && game.course.sun;
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
