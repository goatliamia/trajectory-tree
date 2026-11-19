import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { summarizeUsage } from '../plugin/antigravity/sidecars/context_board/usage-data.mjs';

export async function captureAntigravity(browser, root, capture) {
  const names = ['账单导出与回归测试', '对照格式化结果', '修复空报表', '核对接口文档'];
  const modes = ['Model A (High)', 'Model A (Medium)', 'Model B (Orchestrator)'];
  const routes = [[0, 0, 0, 1], [1, 1, 1, 2], [2], [0, 2, 2, 2]];
  const chats = names.map((title, i) => ({
    id: 'cccccccc-cccc-4ccc-8ccc-' + String(i + 1).padStart(12, '0'), title, project: i < 2 ? 'api' : 'web', projectName:i < 2 ? 'API' : 'Web', parents: [], source: 'database',
    records: Array.from({ length: 18 + i * 11 }, (_, j) => {
      const route = routes[i][j % routes[i].length];
      return { at:Date.now() - (i + 1) * 86400000, mode: modes[route], responseModel: route === 2 ? 'model-b-worker' : 'model-a',
        inputTokens: 2800 + j * 270, cacheReadTokens: 3200 + j * 980,
        cacheWriteTokens: j % 7 ? 0 : 3200, outputTokens: 340 + j * 96,
        streamSeconds: j % 13 ? (340 + j * 96) / [45, 92, 71][route] : null, firstTokenSeconds: 0.54 + (j % 8) / 5 };
    }),
  }));
  const assets = join(root, 'plugin/antigravity/sidecars/context_board');
  const page = await browser.newPage({ viewport: { width: 1040, height: 810 }, deviceScaleFactor: 1.5 });
  try {
    const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
      ['/styles.css', ['styles.css', 'text/css']], ...['Geist', 'GeistMono'].map(f => {
        const file = 'fonts/' + f + '-Variable.woff2'; return ['/' + file, [file, 'font/woff2']];
      })]);
    await page.route('http://readme.invalid/**', route => {
      const url = new URL(route.request().url()), path = url.pathname;
      if (path === '/api/context') return route.fulfill({ json: { empty: true, conversations: [] } });
      if (path === '/api/usage') return route.fulfill({ json: summarizeUsage(chats, url.searchParams.get('mode'), Object.fromEntries(url.searchParams)) });
      if (path === '/preload.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
      const file = files.get(path);
      return file ? route.fulfill({ contentType: file[1], body: readFileSync(join(assets, file[0])) }) : route.abort();
    });
    await page.goto('http://readme.invalid/');
    await page.locator('#usage-conversations tr').nth(3).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const name = 'antigravity-usage.jpg';
    await page.locator('.shell').screenshot({ path: join(capture, name), type: 'jpeg', quality: 90 });
    return name;
  } finally { await page.close(); }
}

// Boot the installed DSH Web shell with a fresh, public profile and the plugins
// from this checkout. Browser locales exercise the host's own language switch.
export async function captureDsh(browser, root, capture) {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
  const sandbox = mkdtempSync(join(tmpdir(), 'trajectory-readme-'));
  const data = join(sandbox, 'profile-data'), profile = join(data, 'profiles/web');
  const project = join(sandbox, 'billing-api'), packages = join(profile, 'node_modules');
  let child;
  try {
    mkdirSync(project); mkdirSync(packages, { recursive: true });
    const skill = join(data, 'skills', 'csv-export');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: csv-export\ndescription: Verify CSV headers and row totals against the billing fixtures.\n---\nRun the export tests and inspect the generated header.\n');
    writeFileSync(join(data, 'AGENTS.md'), 'Use the billing fixtures when changing CSV exports. Verify headers, row totals and the empty-report case.\n');
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-analysis-view', 'dsh-trajectory-tools'];
    const dependencies = {};
    for (const name of bundles.slice(2)) {
      const directory = join(root, 'plugin', name.slice(4));
      symlinkSync(directory, join(packages, name), process.platform === 'win32' ? 'junction' : 'dir');
      dependencies[name] = 'file:' + directory;
    }
    writeFileSync(join(profile, 'cordis.yml'), '[]\n');
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies, dsh: { profile: { bundles } } }));
    child = spawn(process.execPath, [cli, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
      cwd: project, env: { ...process.env, DSH_HOME: data, DSH_AGENTS_HOME: join(sandbox, 'agents'), DSH_TELEMETRY_DISABLED: 'true' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const url = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(Error('DSH Web did not announce its local port')), 45000);
      let buffer = '';
      const listen = chunk => {
        buffer = (buffer + chunk).slice(-4096);
        const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.exec(buffer);
        if (match) { clearTimeout(timer); accept(match[0]); }
      };
      child.stdout.on('data', listen); child.stderr.on('data', listen);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('DSH Web exited during startup')); });
    });
    const captured = [];
    for (const [locale, suffix] of [['zh-CN', ''], ['en-US', '-en']]) {
      const page = await browser.newPage({ locale, colorScheme: 'light', viewport: { width: 1240, height: 860 }, deviceScaleFactor: 1.5 });
      try {
        const next = page.getByRole('button', { name: /^(Continue|继续)$/ });
        const close = page.getByRole('button', { name: /^(Close|关闭)$/ });
        await page.addLocatorHandler(next, async () => { await next.click(); }, { times: 1 });
        await page.addLocatorHandler(page.getByRole('button', { name: /^(Add API Key|添加 API Key|添加 API 密钥)$/ }), async () => { await close.first().click(); });
        await page.goto(url);
        await page.getByRole('button', { name: /^(Eval overview|Eval 总览)$/ }).click();
        const pane = page.locator('iframe[src*="/analysis-view/overview"]'), frame = pane.contentFrame();
        await frame.locator('.home-map-plot canvas.zoom-map-canvas').waitFor();
        await frame.getByRole('heading', { name: locale === 'zh-CN' ? '静态内容分布' : 'Static context composition', exact: true }).waitFor();
        await frame.locator('body').evaluate(() => document.fonts.ready);
        const preset = 'dsh-preset' + suffix + '.jpg';
        await frame.locator('section.home-composition').screenshot({ path: join(capture, preset), quality: 90, animations: 'disabled' });
        captured.push(preset);
      } finally { await page.close(); }
    }
    return captured;
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    if (dirname(sandbox) === resolve(tmpdir()) && basename(sandbox).startsWith('trajectory-readme-')) rmSync(sandbox, { recursive: true, force: true, maxRetries: 5 });
  }
}
