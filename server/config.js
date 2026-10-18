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
  gameWindow: { width: 1280, height: 720, x: 40, y: 40, fullscreen: false, deviceScaleFactor: 0 },
  listener: { visible: false, reloadIfSilentSec: 150, blockVideo: true, cdpPort: 19333 },
  barrageGrabUrl: 'ws://127.0.0.1:8888',
  mock: { intervalSec: [15, 45] },
  board: { resetHour: 5, size: 5 },
  watchdog: { heartbeatTimeoutSec: 60, bootGraceSec: 120 },
  game: {
    layout: 'auto',
    pixelRatio: 1.25,
    shadowSize: 2048,
    reloadHours: 6,
    levelBudget: 170,
    levelLength: [34, 46],
    showSoundLabels: true,
    showEnter: true,
    enterInterval: 10,
    themes: [],
    audio: { master: 1.0, sfx: 1.0, ambience: 0.8, music: 0.7, spatial: 'hrtf' },
    gifts: { tierThresholds: [10, 100, 1000], smallCooldown: 14, comboWindow: 2.2, maxDanceShare: 0.65, minAdventure: 8, giftValues: {} },
    hud: { showBoard: true, showTips: true, boardSize: 5, tips: [] },
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
