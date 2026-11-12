// 配置读取/保存：config.json 支持 // 注释（方便小白直接用记事本修改）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(ROOT, 'config.json');
export const DATA_DIR = path.join(ROOT, 'data');

export const DEFAULTS = {
  room: '',
  source: 'douyin',
  port: 17890,
  host: '127.0.0.1',
  browserPath: '',
  launchGame: true,
  // orientation: portrait 竖屏（默认：抖音观众竖着拿手机看）/ landscape 横屏；width、height 填 0 = 自动（屏幕放得下的最大 9:16 或 16:9）
  gameWindow: { orientation: 'portrait', width: 0, height: 0, x: 20, y: 10, fullscreen: false, deviceScaleFactor: 0 },
  listener: { visible: false, reloadIfSilentSec: 150, blockVideo: true, cdpPort: 19333 },
  barrageGrabUrl: 'ws://127.0.0.1:8888',
  forwardChat: true,
  mock: { pace: 1, gifts: true, intervalSec: [45, 110] },
  board: { resetHour: 5, size: 5 },
  points: {},   // 每种互动算多少应援值（默认见 server/points.js）
  watchdog: { heartbeatTimeoutSec: 60, bootGraceSec: 120 },
  game: {
    layout: 'auto',
    pixelRatio: 1.25,
    post: true,
    shadowSize: 2048,
    reloadHours: 6,
    stageSeconds: 270,
    showSoundLabels: true,
    showEnter: true,
    enterInterval: 10,
    stages: [],
    chatCommands: true,
    chatOnScreen: true,   // 观众弹幕里写的烦恼显示在画面上（有敏感词过滤）；不想显示观众的字就改成 false
    audio: { master: 1.0, sfx: 0.85, ambience: 0.6, music: 0.5, spatial: 'stereo' },
    gifts: { tierThresholds: [10, 100, 1000], smallCooldown: 8, comboWindow: 2.2, maxDanceShare: 0.65, minAdventure: 5, giftValues: {} },
    hud: { showBoard: true, showTips: true, showLink: true, boardSize: 5, tips: [] },
  },
};

// 去掉 // 与 /* */ 注释（不影响字符串里的内容）
export function stripComments(src) {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  // 允许尾逗号
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over !== undefined ? over : base;
  if (typeof base !== 'object' || base === null) return over !== undefined ? over : base;
  const out = { ...base };
  if (over && typeof over === 'object') {
    for (const k of Object.keys(over)) {
      if (k.startsWith('_')) continue;
      out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
    }
  }
  return out;
}

export function loadConfig() {
  let user = {};
  if (fs.existsSync(CONFIG_PATH)) {
    let raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    try {
      user = JSON.parse(stripComments(raw));
    } catch (e) {
      console.error(`[config] config.json 格式有误：${e.message}，本次使用默认配置。请检查是否少了逗号或引号。`);
    }
  }
  const cfg = deepMerge(DEFAULTS, user);
  cfg.room = String(cfg.room || '').trim().replace(/^https?:\/\/live\.douyin\.com\//, '').replace(/[?#/].*$/, '');
  migrate(cfg, user);
  return cfg;
}

// 老版本留下来的 config.json：把当时的默认值换成现在的默认值（用户自己改过的不动）
export function migrate(cfg, user) {
  const W = user && user.gameWindow;
  // v4 以前没有 orientation，默认是 1280×720 的横屏窗口。抖音观众竖屏看，横屏在手机上只有一小条：改成自动大小的竖屏。
  // （想用横屏：控制台里"画面方向"选横屏，或者在 config.json 里写 "orientation": "landscape"）
  if (W && W.orientation === undefined && !(W.height > W.width)) {
    cfg.gameWindow.orientation = 'portrait';
    cfg.gameWindow.width = 0; cfg.gameWindow.height = 0;
  }
  if (cfg.game && cfg.game.layout === 'landscape' && (!W || W.orientation === undefined)) cfg.game.layout = 'auto';
  const G = user && user.game && user.game.gifts;
  if (G && G.smallCooldown === 14) cfg.game.gifts.smallCooldown = 8; // 以前小礼物要攒 14 秒才答谢，观众以为没反应
  return cfg;
}

// 保存（控制台修改设置时使用），保留为带缩进的纯 JSON
export function saveConfig(patch) {
  let current = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      let raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      current = JSON.parse(stripComments(raw));
    } catch { current = {}; }
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
  }
  const merged = deepMerge(deepMerge(DEFAULTS, current), patch);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
