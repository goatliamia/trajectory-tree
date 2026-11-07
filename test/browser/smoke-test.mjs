import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright';
import { createPiSample } from '../../analyzers/pi-sample.mjs';
import { adaptPiSession } from '../../analyzers/pi-adapter.mjs';
import { renderTracePage } from '../../plugin/analysis-view/lib/index.js';
import { generateTraceView } from '../../view/generate.mjs';

const goalText = 'Check <limits> & results';
const nativeDiff = '-old value\n+new value';
const assets = new Map();
let directory, server, origin;

function hostDocument(src) {
  return '<!doctype html><html lang="zh-CN"><body style="margin:0">' +
    '<iframe title="Trajectory" style="display:block;width:100%;height:100vh;border:0" src="' + src + '"></iframe>' +
    '<script>addEventListener("message", e => { if (e.origin === location.origin && ' +
    'e.data?.type === "analysis-trace-jump") window.lastJump = e.data.turn; });</script></body></html>';
}

before(async () => {
  directory = await mkdtemp(join(await realpath(tmpdir()), 'trajectory-browser-'));
  const dsh = adaptPiSession(createPiSample({ revision: 'browser-dsh' }));
  dsh.host = 'dsh';
  dsh.locale = 'zh-CN';
  const turns = dsh.sessions[0].turns;
  dsh.context.goal = { phase: 'complete', objective: goalText, markers: [
    { operation: 'create', time: turns[0].start, turn: turns[0].number, seq: 1 },
    { operation: 'complete', time: turns.at(-1).end, turn: turns.at(-1).number, seq: 2 },
  ] };
  assets.set('/dsh', ['text/html; charset=utf-8', renderTracePage(dsh)]);
  for (const name of ['Geist-Variable.woff2', 'GeistMono-Variable.woff2']) {
    const bytes = await readFile(new URL('../../plugin/analysis-view/lib/trace/fonts/' + name, import.meta.url));
    assets.set('/analysis-view/trace/fonts/' + name, ['font/woff2', bytes]);
  }

  const timestamp = '2026-01-01T00:00:00Z', start = Date.parse(timestamp) / 1000;
  const snapshot = { source: 'synthetic', capturedAt: timestamp, thread: {
    id: 'browser-codex', cwd: '/sample', createdAt: start, turns: [{
      id: 't1', startedAt: start, completedAt: start + 5, status: 'completed', items: [
        { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: '修改文件 <原文>' }] },
        { type: 'fileChange', id: 'f1', status: 'completed', changes: [
          { path: '/sample/value.js', kind: { type: 'update' }, diff: nativeDiff },
        ] },
      ],
    }],
  } };
  const transcript = join(directory, 'claude.jsonl');
  const event = { sessionId: 'browser-claude', timestamp, cwd: '/sample' };
  await writeFile(transcript, [
    { ...event, type: 'user', message: { content: 'Read the sample.' } },
    { ...event, type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'Read.' }] } },
  ].map(row => JSON.stringify(row)).join('\n'));
  const portable = [
    { host: 'pi', input: createPiSample({ revision: 'browser-pi' }) },
    { host: 'codex', snapshot, apiOnly: true },
    { host: 'claude', file: transcript },
  ];
  for (const spec of portable) {
    const view = await generateTraceView({ ...spec, locale: 'en', output: join(directory, spec.host + '.html') });
    assets.set('/' + spec.host, ['text/html; charset=utf-8', await readFile(view.output)]);
  }
  for (const host of ['dsh', 'codex']) assets.set('/host-' + host, ['text/html; charset=utf-8', hostDocument('/' + host)]);
  server = createServer((req, res) => {
    const asset = assets.get(new URL(req.url, 'http://localhost').pathname);
    if (!asset) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': asset[0] }).end(asset[1]);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server?.listening) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  if (directory) {
    const path = await realpath(directory);
    assert.equal(dirname(path), await realpath(tmpdir()));
    assert.ok(basename(path).startsWith('trajectory-browser-'));
    await rm(path, { recursive: true, force: true });
  }
});

async function checkDsh(page) {
  await page.goto(origin + '/host-dsh');
  const trace = page.frameLocator('iframe');
  const canvas = trace.locator('#graph-scroll');
  const goal = trace.locator('[data-goal-band]');
  await goal.waitFor({ state: 'attached' });
  assert.equal(await goal.locator('.goal-text').textContent(), goalText);
  await goal.press('Enter');
  assert.ok((await trace.locator('#drawer-body').textContent()).includes(goalText));
  await trace.locator('#drawer-close').click();

  const files = trace.locator('#graph-caption [data-br-layer="files"]');
  await files.uncheck();
  assert.equal(await trace.locator('#graph [data-file-group]:not(.actor-skill-material)').count(), 0);
  await files.check();
  assert.ok(await trace.locator('#graph [data-file-group]').count());

  const box = await canvas.boundingBox();
  assert.ok(box?.width > 300);
  const x = box.x + box.width * .65, y = box.y + box.height * .45;
  const width = await canvas.evaluate(el => el.scrollWidth);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -180);
  await page.waitForFunction(width => document.querySelector('iframe').contentDocument.getElementById('graph-scroll').scrollWidth > width, width);
  const left = await canvas.evaluate(el => el.scrollLeft);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  await page.mouse.up();
  assert.ok(await canvas.evaluate(el => el.scrollLeft) > left + 40);

  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe').contentDocument;
    return Math.abs(Number(doc.querySelector('#br-clip rect')?.getAttribute('width')) - doc.getElementById('graph-scroll').clientWidth) <= 1;
  });
  await trace.locator('#review-rounds').click();
  await trace.locator('[data-review-round-context="1"]').click();
  await trace.locator('[data-chat-jump="1"]').click();
  await page.waitForFunction(() => window.lastJump === 1);
  await trace.locator('#drawer-close').click();
  await trace.locator('#review-rounds').click();
  await trace.locator('[data-review-round-path="1"]').click();
  await trace.locator('#graph [data-step="0"]').waitFor({ state: 'visible' });
}

async function checkCodex(page) {
  await page.goto(origin + '/host-codex');
  const trace = page.frameLocator('iframe');
  // The branch group also spans empty SVG space. Use its actual pointer target.
  await trace.locator('#graph [data-tool-result] .br-hit').first().click();
  await trace.locator('[data-result-diff]').click();
  assert.equal(await trace.locator('#review-detail-body pre.excerpt').textContent(), nativeDiff);
  assert.equal(await trace.locator('[data-chat-jump]').count(), 0);
  assert.equal(await trace.locator('[data-br-layer="goal"]').count(), 0);
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(name + ' opens the shared trace and keeps host actions scoped', { timeout: 60_000 }, async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.setDefaultTimeout(10_000);
    const errors = [], dshRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/analysis-view/trace-data') dshRequests.push(request.url());
    });
    await checkDsh(page);
    await checkCodex(page);
    for (const host of ['pi', 'claude']) {
      await page.goto(origin + '/' + host);
      await page.locator('body.' + host + '-review #graph .br-trunk').waitFor({ state: 'attached' });
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.equal(await page.locator('#graph-caption [data-br-layer="files"]').count(), 1);
      assert.equal(await page.locator('[data-br-layer="goal"], [data-chat-jump]').count(), 0);
    }
    assert.deepEqual(dshRequests, [], 'Frozen and portable pages do not request live DSH stages');
    assert.deepEqual(errors, [], 'No renderer errors');
  });
}
