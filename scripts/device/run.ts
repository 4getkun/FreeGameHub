import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { build } from 'vite';
import { createDeviceFixture } from './fixture';
import { measureDevicePerformance } from './performance';
import type { RecoveryState } from './watchdog';

type Result = { name: string; status: 'pass' | 'fail' | 'skip'; detail: string };
const smoke = process.argv.includes('--smoke');
const output = resolve('device-report');
const site = join(output, 'site');
const results: Result[] = [];
let before: Record<string, string> = {}, after: Record<string, string> = {};
let serial = '', forward = false, reverse = false, server: ChildProcess | undefined;
let browser: Browser | undefined, page: Page | undefined;
let savedStorage: string | null | undefined;
let interrupted = false;
let settingsChanged = false;
let recovery: RecoveryState | undefined;
const recoveryFile = join(output, `recovery-${process.pid}.json`);
function saveRecovery(): void { if (recovery) writeFileSync(recoveryFile, JSON.stringify(recovery)); }
const adb = process.env.ADB_PATH || (process.platform === 'win32' && process.env.LOCALAPPDATA && existsSync(join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'))
  ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe') : 'adb');
const record = (name: string, status: Result['status'], detail: string) => { results.push({ name, status, detail }); console.log(`${status}: ${name}: ${detail}`); };
const command = (...args: string[]) => execFileSync(adb, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const device = (...args: string[]) => command('-s', serial, ...args);
const shell = (...args: string[]) => device('shell', ...args);
function snapshot(): Record<string, string> {
  return { night: shell('cmd', 'uimode', 'night'), font_scale: shell('settings', 'get', 'system', 'font_scale'),
    user_rotation: shell('settings', 'get', 'system', 'user_rotation'), accelerometer_rotation: shell('settings', 'get', 'system', 'accelerometer_rotation'),
    size: shell('wm', 'size'), density: shell('wm', 'density') };
}
function restore(): void {
  if (!before.night) return;
  const night = before.night.match(/Night mode: (yes|no|auto|custom)/)?.[1];
  if (night && night !== 'custom') shell('cmd', 'uimode', 'night', night);
  for (const key of ['font_scale', 'user_rotation', 'accelerometer_rotation']) {
    const value = before[key];
    if (value === 'null') shell('settings', 'delete', 'system', key);
    else shell('settings', 'put', 'system', key, value);
  }
}
async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try { if (interrupted) throw new Error('中断されました'); record(name, 'pass', await fn()); }
  catch (error) { record(name, 'fail', error instanceof Error ? error.message : String(error)); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function waitServer(): Promise<void> {
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:4173/')).ok) return; } catch { /* waiting */ } await delay(100); }
  throw new Error('プレビューサーバーを起動できません');
}
async function portAvailable(port: number): Promise<boolean> {
  return await new Promise(resolvePort => {
    const probe = createServer();
    probe.once('error', () => resolvePort(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolvePort(true)));
  });
}
function report(): void {
  mkdirSync(output, { recursive: true });
  const data = { generatedAt: new Date().toISOString(), mode: smoke ? 'smoke' : 'full', results, settingsBefore: before, settingsAfter: after,
    limitations: ['ホーム画面に追加した見た目は対象外', 'TalkBack・指の感触・日光下の視認性は人手確認'] };
  writeFileSync(join(output, 'report.json'), JSON.stringify(data, null, 2));
  const lines = ['# Android 実機テスト', '', `実行: ${data.generatedAt} / ${data.mode}`, '', ...results.map(r => `- ${r.status}: ${r.name} — ${r.detail}`), '', '## 端末設定の実行前後', '', ...Object.keys(before).map(k => `- ${k}: ${before[k].replace(/\n/g, ' / ')} → ${(after[k] ?? '未確認').replace(/\n/g, ' / ')}`), '', '## 人が確認すべき項目', '', '- TalkBack を有効にし、見出し・フィルタ・カードを順に読み上げ、名前と状態が分かるか確認する。', '- 実際の指でフィルタと受け取り済みを操作し、誤操作なく押せるか確認する。', '- 文字を拡大した状態で日本語が豆腐にならず、カード内に収まるか確認する。', '- 屋外の日光下でライト／ダーク両方の文字と状態表示を読む。', '- ホーム画面に追加後の見た目は自動スクリーンショットの対象外。', ''];
  writeFileSync(join(output, 'report.md'), lines.join('\n'));
}
async function main(): Promise<void> {
  mkdirSync(output, { recursive: true });
  let devices: string;
  try { devices = command('devices'); } catch { record('接続', 'skip', 'adb が見つからないか起動できません'); return; }
  const found = devices.split(/\r?\n/).slice(1).map(s => s.trim().split(/\s+/)).filter(x => x[1] === 'device');
  if (found.length !== 1) { record('接続', 'skip', found.length ? '端末を1台だけ接続してください' : '認証済み端末なし（unauthorized の場合は端末で許可）'); return; }
  serial = found[0][0];
  const forwards = command('forward', '--list'); const reverses = device('reverse', '--list');
  if (/\btcp:9222\b/.test(forwards) || /\btcp:4173\b/.test(reverses)) { record('接続', 'skip', '指定ポートの ADB 接続が使用中です'); return; }
  if (!await portAvailable(9222) || !await portAvailable(4173)) { record('接続', 'skip', 'PC のポート 9222 または 4173 が使用中です'); return; }
  before = snapshot();
  if (!/Night mode: (yes|no|auto)$/.test(before.night)) { record('接続', 'skip', '元のナイトモードを安全に復元できません'); return; }
  recovery = { owner: process.pid, adb, serial, before };
  saveRecovery();
  const watcher = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/device/watchdog.ts'), recoveryFile], { detached: true, stdio: 'ignore', windowsHide: true });
  watcher.unref();
  let armed = false;
  for (let i = 0; i < 50; i++) { await delay(100); try { if ((JSON.parse(readFileSync(recoveryFile, 'utf8')) as RecoveryState).armed) { armed = true; break; } } catch { /* watcher is starting */ } }
  if (!armed) throw new Error('中断時の復元プロセスを起動できません');
  const oldSiteUrl = process.env.SITE_URL;
  try { delete process.env.SITE_URL; await build({ build: { outDir: site, emptyOutDir: true }, logLevel: 'silent' }); }
  finally { if (oldSiteUrl === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = oldSiteUrl; }
  writeFileSync(join(site, 'data', 'games.json'), JSON.stringify(createDeviceFixture(new Date(), smoke ? 5 : 20)));
  server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort', '--outDir', site], { stdio: 'ignore' });
  recovery.serverPid = server.pid; saveRecovery();
  await waitServer();
  recovery.forward = true; saveRecovery(); device('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote'); forward = true;
  recovery.reverse = true; saveRecovery(); device('reverse', 'tcp:4173', 'tcp:4173'); reverse = true;
  browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  page = await browser.newPage();
  const targetSession = await page.createCDPSession();
  recovery.targetId = (await targetSession.send('Target.getTargetInfo')).targetInfo.targetId; saveRecovery();
  await targetSession.detach();
  const errors: string[] = [], failed: string[] = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e instanceof Error ? e.message : String(e)));
  page.on('requestfailed', r => failed.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0', timeout: 25_000 });
  savedStorage = await page.evaluate(() => localStorage.getItem('freegamehub:claimed'));
  recovery.savedStorage = savedStorage; saveRecovery();
  await page.evaluate(() => localStorage.removeItem('freegamehub:claimed'));
  await page.reload({ waitUntil: 'networkidle0' });
  await check('接続と基本表示', async () => { assert(await page!.$('[data-app-root] h1'), '見出しがありません'); return '実機 Chrome の新しいタブで表示'; });
  if (smoke) return;
  await full(page, errors, failed);
}
async function full(p: Page, errors: string[], failed: string[]): Promise<void> {
  await check('4区分と概算・次回予告', async () => {
    await p.goto('http://localhost:4173/?type=all', { waitUntil: 'networkidle0' });
    const details = await p.evaluate(() => ({ sections: Array.from(document.querySelectorAll('[data-section]')).map(e => `${e.getAttribute('data-section')}:${e.querySelectorAll('.game-card').length}`), approx: !!document.querySelector('[data-approx="true"]'), preview: !!document.querySelector('.upcoming-preview__card') }));
    assert(details.sections.length === 4 && details.sections.every(x => !x.endsWith(':0')) && details.approx && details.preview, JSON.stringify(details)); return JSON.stringify(details);
  });
  const client = await p.createCDPSession();
  const scaleMetrics = new Map<string, string>();
  for (const theme of ['dark', 'light']) for (const rotation of ['portrait', 'landscape']) for (const scale of ['1.0', '1.3', '1.5']) {
    await check(`表示 ${theme}/${rotation}/${scale}`, async () => {
      settingsChanged = true;
      shell('cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no');
      shell('settings', 'put', 'system', 'accelerometer_rotation', '0');
      shell('settings', 'put', 'system', 'user_rotation', rotation === 'portrait' ? '0' : '1');
      shell('settings', 'put', 'system', 'font_scale', scale);
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await p.waitForFunction(expected => expected === 'portrait' ? innerHeight > innerWidth : innerWidth > innerHeight, { timeout: 10_000 }, rotation);
      await delay(800);
      const state = await p.evaluate(() => {
        let overlaps = 0;
        for (const card of Array.from(document.querySelectorAll('.game-card'))) {
          const boxes = Array.from(card.children).filter(e => getComputedStyle(e).position !== 'absolute').map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps++;
          }
        }
        return { width: innerWidth, height: innerHeight, scrollWidth: document.scrollingElement!.scrollWidth, dark: matchMedia('(prefers-color-scheme: dark)').matches, fonts: document.fonts.status, dpr: devicePixelRatio, bodyFont: getComputedStyle(document.body).fontSize, numberFont: document.fonts.check('16px "Space Grotesk"'), replacementCharacters: document.body.innerText.includes('\ufffd'), overlaps };
      });
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.screenshot({ path: join(output, `${theme}_${rotation}_${scale}.png`) });
      scaleMetrics.set(`${theme}/${rotation}/${scale}`, `${state.bodyFont}/${state.width}/${state.height}`);
      assert(state.scrollWidth <= state.width && state.dark === (theme === 'dark') && state.fonts === 'loaded' && !state.replacementCharacters && state.overlaps === 0, JSON.stringify(state));
      assert(rotation === 'portrait' ? state.height > state.width : state.width > state.height, `画面の向きが反映されません: ${JSON.stringify(state)}`);
      if (scale === '1.0') for (const section of ['active', 'ending', 'upcoming', 'ended']) {
        const element = await p.$(`[data-section="${section}"]`); if (element) { await element.scrollIntoView(); await p.screenshot({ path: join(output, `${theme}_${rotation}_${section}.png`) }); }
      }
      return JSON.stringify(state);
    });
  }
  if (scaleMetrics.get('dark/portrait/1.0') === scaleMetrics.get('dark/portrait/1.5')) record('システム文字倍率の反映', 'skip', 'Chrome の CSS 文字サイズと表示領域に差がなく、文字が実際に拡大されたことを確認できません');
  await check('実タッチ: 種別と受取済み', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const touch = async (selector: string) => { const target = await p.$(selector); assert(target, `対象なし: ${selector}`); await target.scrollIntoView(); const box = await target.boundingBox(); assert(box, '座標を取得できません'); const x = box.x + box.width / 2, y = box.y + box.height / 2; await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await delay(600); };
    await touch('[data-type="all"]'); await touch('[data-claimed-id="fixture-active"]');
    assert(await p.$eval('[data-claimed-id="fixture-active"]', e => (e as HTMLInputElement).checked), '受取済みに切り替わりません');
    await p.screenshot({ path: join(output, 'claimed.png') });
    await touch('[data-filter="hide-claimed"]'); assert(!await p.$('[data-claimed-id="fixture-active"]'), '受取済みが非表示になりません');
    return 'CDP touchStart/touchEnd で操作';
  });
  await check('絞り込みと空状態', async () => {
    await p.goto('http://localhost:4173/?store=other&type=beta', { waitUntil: 'networkidle0' });
    const counts = await p.evaluate(() => ({ empty: document.querySelectorAll('.game-section__empty').length, cards: document.querySelectorAll('.game-card').length }));
    assert(counts.empty === 4 && counts.cards === 0, JSON.stringify(counts));
    await p.screenshot({ path: join(output, 'empty.png') });
    await p.select('[data-filter="store"]', 'steam'); await delay(500);
    assert((await p.$eval('[data-filter="store"]', e => (e as HTMLSelectElement).value)) === 'steam', 'ストア絞り込みに失敗');
    await p.screenshot({ path: join(output, 'filtered.png') });
    return `4区分の空状態 ${counts.empty} 件とストア切替を確認`;
  });
  await check('reduced-motion on/off', async () => {
    for (const value of ['reduce', 'no-preference']) {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
      const actual = await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      assert(actual === (value === 'reduce'), `メディア設定が反映されません: ${value}`);
      const calls = await p.evaluate(async () => {
        const doc = document;
        const previous = doc.startViewTransition; let count = 0;
        if (previous) doc.startViewTransition = (...args: Parameters<Document['startViewTransition']>) => { count++; return previous.apply(doc, args); };
        document.querySelector<HTMLButtonElement>('[data-type="all"]')?.click();
        await new Promise(r => setTimeout(r, 400));
        if (previous) doc.startViewTransition = previous;
        return { supported: !!previous, count };
      });
      assert(value !== 'reduce' || calls.count === 0, JSON.stringify(calls));
      if (value === 'no-preference' && calls.supported) assert(calls.count > 0, JSON.stringify(calls));
    }
    return 'reduce は即時切替、通常時は対応 API を使用';
  });
  await check('フォーカス・見出し・lang', async () => {
    const status = await p.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-type="all"]'); button?.focus();
      const css = button && getComputedStyle(button);
      return { lang: document.documentElement.lang, headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(e => e.tagName), focus: document.activeElement === button, outline: css?.outlineStyle, shadow: css?.boxShadow };
    });
    assert(status.lang === 'ja' && status.headings[0] === 'H1' && status.headings.filter(x => x === 'H1').length === 1 && status.focus, JSON.stringify(status));
    assert(status.outline !== 'none' || status.shadow !== 'none', `フォーカス表示なし: ${JSON.stringify(status)}`);
    return JSON.stringify(status);
  });
  await check('配信物と SITE_URL', async () => {
    const absent = await p.evaluate(() => ({ url: !!document.querySelector('meta[property="og:url"]'), image: !!document.querySelector('meta[property="og:image"]'), twitter: !!document.querySelector('meta[name="twitter:image"]') }));
    assert(!absent.url && !absent.image && !absent.twitter, JSON.stringify(absent));
    const old = process.env.SITE_URL; process.env.SITE_URL = 'http://localhost:4173';
    const alternate = join(output, 'site-with-url');
    try { await build({ build: { outDir: alternate, emptyOutDir: true }, logLevel: 'silent' }); }
    finally { if (old === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = old; }
    const htmlPath = join(site, 'index.html'); const original = readFileSync(htmlPath);
    try {
      writeFileSync(htmlPath, readFileSync(join(alternate, 'index.html')));
      await p.goto('http://localhost:4173/', { waitUntil: 'networkidle0' });
      const tags = await p.evaluate(async () => {
        const names = ['link[rel="icon"][href="/favicon.ico"]', 'link[rel="icon"][href="/favicon.svg"]', 'link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:type"][content="website"]', 'meta[property="og:url"]', 'meta[property="og:image"]', 'meta[name="twitter:card"][content="summary_large_image"]', 'meta[name="twitter:image"]', 'meta[name="theme-color"][content="#0E1014"]'];
        const assets = ['/og.png', '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png'];
        return { missing: names.filter(x => !document.querySelector(x)), urls: Array.from(document.querySelectorAll<HTMLMetaElement>('meta[property="og:url"], meta[property="og:image"], meta[name="twitter:image"]')).map(x => x.content), assets: await Promise.all(assets.map(async x => [x, (await fetch(x)).status])) };
      });
      assert(!tags.missing.length && tags.urls.length === 3 && tags.urls.every(x => x.startsWith('http://localhost:4173/')) && tags.assets.every(x => x[1] === 200), JSON.stringify(tags));
      return JSON.stringify(tags);
    } finally { writeFileSync(htmlPath, original); }
  });
  await check('実タッチ: 外部リンクと戻る', async () => {
    await p.goto('http://localhost:4173/?type=all', { waitUntil: 'networkidle0' });
    const link = await p.$('.game-card__link'); assert(link, 'カードのリンクがありません');
    const href = await link.evaluate(e => (e as HTMLAnchorElement).href); assert(href.startsWith('https://example.com/'), '検証用リンクが不正です');
    await link.scrollIntoView(); const box = await link.boundingBox(); assert(box, 'タッチ座標がありません');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const navigation = p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await navigation; assert(p.url().startsWith('https://example.com/'), '外部リンクに遷移しません');
    device('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await p.waitForFunction(() => location.hostname === 'localhost', { timeout: 10_000 });
    return '実タッチで外部リンクへ遷移し、端末の戻るボタンで復帰';
  });
  await check('タップ領域', async () => {
    const small = await p.evaluate(() => Array.from(document.querySelectorAll('button, select, .game-card__claimed-label, .filters__claimed-label, a')).map(e => ({ label: (e.textContent ?? '').trim().slice(0, 40), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter(x => x.w < 44 || x.h < 44));
    assert(!small.length, JSON.stringify(small.slice(0, 20))); return '主要操作要素が 44 CSS px 以上';
  });
  await check('アクセシビリティ axe-core', async () => {
    await p.addScriptTag({ path: resolve('node_modules/axe-core/axe.min.js') });
    const violations: Array<{ theme: string; id: string; impact: string; count: number; nodes: Array<{ target: string[]; failureSummary?: string }> }> = [];
    for (const theme of ['dark', 'light']) {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await delay(1000);
      const found = await p.evaluate(async () => (await (window as unknown as { axe: { run: () => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[]; failureSummary?: string }> }> }> } }).axe.run()).violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, nodes: v.nodes })));
      violations.push(...found.map(v => ({ theme, ...v })));
    }
    writeFileSync(join(output, 'axe.json'), JSON.stringify(violations, null, 2));
    assert(!violations.some(v => v.impact === 'critical' || v.impact === 'serious'), JSON.stringify(violations.map(({ theme, id, impact, count }) => ({ theme, id, impact, count })))); return JSON.stringify(violations);
  });
  await check('文字コントラスト 4.5:1', async () => {
    await p.evaluate('globalThis.__name = (value) => value');
    const failures: unknown[] = [];
    for (const theme of ['dark', 'light']) {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await delay(1000);
      const found = await p.evaluate(() => {
        const parse = (color: string): number[] => (color.match(/[\d.]+/g) ?? []).map(Number);
        const blend = (fg: number[], bg: number[]): number[] => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)); };
        const lum = (rgb: number[]): number => rgb.slice(0, 3).reduce((v, c, i) => { const n = c / 255; return v + [0.2126, 0.7152, 0.0722][i] * (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4); }, 0);
        return Array.from(document.querySelectorAll('body *')).filter(e => Array.from(e.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())).map(e => {
          const css = getComputedStyle(e); let node: Element | null = e; const layers: number[][] = [];
          while (node) { layers.push(parse(getComputedStyle(node).backgroundColor)); node = node.parentElement; }
          let bg = [255, 255, 255]; for (const layer of layers.reverse()) if (layer.length >= 3) bg = blend(layer, bg);
          const color = parse(css.color); if (color.length < 3) return null; const fg = blend(color, bg);
          const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          return { text: (e.textContent ?? '').trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100 };
        }).filter((x): x is { text: string; ratio: number } => !!x && x.ratio < 4.5);
      });
      failures.push(...found.map(x => ({ theme, ...x })));
    }
    assert(!failures.length, JSON.stringify(failures.slice(0, 30))); return '表示中の文字の計算色を両テーマで測定';
  });
  await check('コンソールとネットワーク', async () => { assert(!errors.length && !failed.length, JSON.stringify({ errors, failed })); return '警告・エラー・通信失敗なし'; });
  await check('Slow 4G と Offline', async () => {
    await client.send('Network.enable');
    try {
      await client.send('Network.setCacheDisabled', { cacheDisabled: true });
      await client.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 400_000, uploadThroughput: 100_000 });
      const start = Date.now(); await p.goto('http://localhost:4173/?type=all', { waitUntil: 'networkidle0', timeout: 30_000 });
      const elapsed = Date.now() - start;
      const firstPaint = await p.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null);
      await p.setRequestInterception(true);
      const intercept = async (request: import('puppeteer-core').HTTPRequest) => {
        if (request.url().includes('/data/games.json')) {
          await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        }
        await request.continue().catch(() => {});
      };
      p.on('request', intercept);
      try {
        await p.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
        await p.waitForFunction(() => document.querySelector('[data-app-root] p')?.textContent?.includes('fetch'), { timeout: 10_000 });
      } finally { p.off('request', intercept); await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await p.setRequestInterception(false); }
      return `Slow 4G FCP ${firstPaint ?? '未取得'} ms（読込完了 ${elapsed} ms）、オフライン取得失敗を画面に表示`;
    } finally { await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await client.send('Network.setCacheDisabled', { cacheDisabled: false }); }
  });
  await check('Lighthouse', async () => {
    const lighthouse = (await import('lighthouse')).default;
    const run = await lighthouse('http://localhost:4173/?type=all', { port: 9222, disableStorageReset: true, onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], logLevel: 'error', output: 'json' });
    assert(run?.lhr, 'Lighthouse の結果がありません');
    writeFileSync(join(output, 'lighthouse.json'), JSON.stringify(run.lhr, null, 2));
    const lhr = run.lhr;
    const metrics = { scores: Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, v?.score])), lcp: lhr.audits['largest-contentful-paint']?.numericValue, cls: lhr.audits['cumulative-layout-shift']?.numericValue, tbt: lhr.audits['total-blocking-time']?.numericValue, speedIndexError: lhr.audits['speed-index']?.errorMessage };
    assert(metrics.scores.performance !== null, `Performance を算出できません: ${JSON.stringify(metrics)}`);
    return JSON.stringify(metrics);
  });
  await check('200件スクロール・ロングタスク・CLS・転送量', async () => {
    writeFileSync(join(site, 'data', 'games.json'), JSON.stringify(createDeviceFixture(new Date(), 200)));
    await p.goto('http://localhost:4173/?type=all', { waitUntil: 'networkidle0' });
    const metrics = await measureDevicePerformance(p);
    writeFileSync(join(output, 'performance.json'), JSON.stringify(metrics, null, 2));
    return JSON.stringify(metrics);
  });
}
async function cleanup(): Promise<void> {
  if (page) {
    try { if (savedStorage !== undefined) { if (!page.url().startsWith('http://localhost:4173/')) await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 10_000 }); await page.evaluate(value => value === null ? localStorage.removeItem('freegamehub:claimed') : localStorage.setItem('freegamehub:claimed', value), savedStorage); } } catch { record('localStorage 復元', 'fail', '復元できませんでした'); }
    try { await page.close(); } catch { /* already closed */ }
  }
  try { browser?.disconnect(); } catch { record('Chrome 接続解除', 'fail', '解除できませんでした'); }
  if (reverse) try { device('reverse', '--remove', 'tcp:4173'); } catch { record('reverse 解除', 'fail', '解除できませんでした'); }
  if (forward) try { device('forward', '--remove', 'tcp:9222'); } catch { record('forward 解除', 'fail', '解除できませんでした'); }
  server?.kill();
  if (before.night) {
    try { if (settingsChanged) restore(); after = snapshot(); record('端末設定の復元', JSON.stringify(before) === JSON.stringify(after) ? 'pass' : 'fail', JSON.stringify(before) === JSON.stringify(after) ? '実行前後が一致' : '実行前後が一致しません'); }
    catch (error) { record('端末設定の復元', 'fail', error instanceof Error ? error.message : String(error)); }
  }
  report();
  if (recovery && !results.some(r => r.status === 'fail' && ['端末設定の復元', 'localStorage 復元', 'reverse 解除', 'forward 解除'].includes(r.name))) { recovery.done = true; saveRecovery(); }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { interrupted = true; console.log('中断を受け付けました。設定を復元します。'); });
try { await main(); } catch (error) { record('実行', 'fail', error instanceof Error ? error.message : String(error)); } finally { await cleanup(); }
if (results.some(r => r.status === 'fail')) process.exitCode = 1;
