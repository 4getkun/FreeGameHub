import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

export interface RecoveryState {
  owner: number; adb: string; serial: string; before: Record<string, string>; armed?: boolean; done?: boolean;
  forward?: boolean; reverse?: boolean; serverPid?: number; targetId?: string; savedStorage?: string | null;
}
const file = process.argv[2];
function read(): RecoveryState { return JSON.parse(readFileSync(file, 'utf8')) as RecoveryState; }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function recover(state: RecoveryState): Promise<void> {
  const problems: string[] = [];
  const adb = (...args: string[]) => execFileSync(state.adb, ['-s', state.serial, ...args], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const shell = (...args: string[]) => adb('shell', ...args);
  try {
    if (state.forward && state.targetId) {
      const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
      try {
        const target = browser.targets().find(item => (item as unknown as { _targetId: string })._targetId === state.targetId);
        const page = await target?.page();
        if (!page) throw new Error('検証タブが見つかりません');
        if (page && state.savedStorage !== undefined) {
          const cdp = await page.createCDPSession();
          await cdp.send('DOMStorage.enable');
          const storageId = { securityOrigin: 'http://localhost:4173', isLocalStorage: true };
          if (state.savedStorage === null) await cdp.send('DOMStorage.removeDOMStorageItem', { storageId, key: 'freegamehub:claimed' });
          else await cdp.send('DOMStorage.setDOMStorageItem', { storageId, key: 'freegamehub:claimed', value: state.savedStorage });
        }
        await page?.close();
      } finally { browser.disconnect(); }
    }
  } catch { problems.push('検証タブ／localStorage の復元を確認できません'); }
  try { if (state.serverPid && alive(state.serverPid)) process.kill(state.serverPid); } catch { problems.push('プレビューサーバーを停止できません'); }
  try { if (state.reverse && /\btcp:4173\s+tcp:4173\b/.test(adb('reverse', '--list'))) adb('reverse', '--remove', 'tcp:4173'); } catch { problems.push('reverse を解除できません'); }
  try { if (state.forward && adb('forward', '--list').split(/\r?\n/).some(line => line.includes(state.serial) && /\btcp:9222\s+localabstract:chrome_devtools_remote\b/.test(line))) adb('forward', '--remove', 'tcp:9222'); } catch { problems.push('forward を解除できません'); }
  try {
    const night = state.before.night.match(/Night mode: (yes|no|auto)$/)?.[1]; if (night) shell('cmd', 'uimode', 'night', night);
    for (const key of ['font_scale', 'user_rotation', 'accelerometer_rotation']) {
      const value = state.before[key]; if (value === 'null') shell('settings', 'delete', 'system', key); else shell('settings', 'put', 'system', key, value);
    }
  } catch { problems.push('端末設定を復元できません'); }
  const after: Record<string, string> = {};
  try {
    after.night = shell('cmd', 'uimode', 'night');
    for (const key of ['font_scale', 'user_rotation', 'accelerometer_rotation']) after[key] = shell('settings', 'get', 'system', key);
    after.size = shell('wm', 'size'); after.density = shell('wm', 'density');
    for (const key of Object.keys(state.before)) if (state.before[key] !== after[key]) problems.push(`${key} が実行前と一致しません`);
  } catch { problems.push('復元後の設定を取得できません'); }
  const result = { generatedAt: new Date().toISOString(), interrupted: true, problems, settingsBefore: state.before, settingsAfter: after };
  writeFileSync(join(dirname(file), 'report.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(dirname(file), 'report.md'), ['# Android 実機テスト（中断）', '', 'プロセスが終了したため復旧処理を実行しました。', ...problems.map(x => `- 失敗: ${x}`), '', '## 端末設定の実行前後', ...Object.keys(state.before).map(key => `- ${key}: ${state.before[key]} → ${after[key] ?? '未確認'}`), '', '## 人が確認すべき項目', '- TalkBack の読み上げ、実際の指での操作、日光下の視認性を確認してください。', '- ホーム画面に追加した見た目は自動確認の対象外です。', ''].join('\n'));
}
if (file && existsSync(file)) {
  let state = read(); state.armed = true; writeFileSync(file, JSON.stringify(state));
  for (;;) {
    await delay(500);
    try { state = read(); } catch { continue; }
    if (state.done) break;
    if (!alive(state.owner)) { await recover(state); break; }
  }
  try { unlinkSync(file); } catch { /* already removed */ }
}
