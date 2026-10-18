// 查找并启动本机浏览器（Windows 优先 Chrome，其次系统自带的 Edge）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

export function findBrowser(preferred = '') {
  if (preferred && fs.existsSync(preferred)) return preferred;
  const env = process.env;
  const c = [];
  if (process.platform === 'win32') {
    const pf = env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = env.LOCALAPPDATA || '';
    c.push(
      path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      local && path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    c.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/opt/google/chrome/chrome');
    // 开发/自检环境中的 Playwright Chromium
    try {
      const base = env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
      for (const d of fs.readdirSync(base)) if (/^chromium-\d+/.test(d)) c.push(path.join(base, d, 'chrome-linux', 'chrome'));
    } catch {}
  }
  return c.find((p) => p && fs.existsSync(p)) || '';
}

// 让浏览器在后台/被遮挡时依然全速运行、自动播放声音
export const ANTI_THROTTLE_FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,Translate,MediaRouter,GlobalMediaControls',
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  '--disable-infobars',
  '--disable-component-update',
  '--password-store=basic',
];

export function launchBrowser(exe, args, log) {
  // Linux 下以 root 运行（例如服务器/容器自检）时 Chrome 需要关闭沙箱
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args = ['--no-sandbox', ...args];
  const child = spawn(exe, args, { stdio: 'ignore', detached: false, windowsHide: false });
  child.on('error', (e) => log && log(`浏览器启动失败：${e.message}`));
  return child;
}

// 结束使用指定资料目录的残留浏览器进程（上次异常退出留下的）
export function killByProfile(marker) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000 }, () => resolve());
    } else {
      execFile('pkill', ['-f', marker], { timeout: 10000 }, () => resolve());
    }
  });
}

export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else child.kill('SIGTERM');
  } catch {}
}
