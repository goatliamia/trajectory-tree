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
import { datasetFromNative } from '../../plugin/portable-tools/sources.mjs';
import { writeHostEvalPage } from '../../view/eval.mjs';

const goalText = 'Check <limits> & results';
const secondGoalText = 'Review changed files';
const nativeDiff = '@@ -23,2 +23,2 @@\n-const value = "<old>";\n+const value = "<new>";\n export { value };\n';
const addedFile = '/sample/flag.js';
const addedLines = 510;
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
  dsh.context.goal = { id: 'a', phase: 'completed', objective: goalText, goals: [
    { id: 'a', objective: goalText, phase: 'completed' }, { id: 'b', objective: secondGoalText, phase: 'completed' },
  ], markers: [
    { goalId: 'a', operation: 'create', time: turns[0].start, turn: turns[0].number, seq: 1 },
    { goalId: 'a', operation: 'complete', time: turns[2].end, turn: turns[2].number, seq: 2 },
    { goalId: 'b', operation: 'create', time: turns[4].start, turn: turns[4].number, seq: 3 },
    { goalId: 'b', operation: 'complete', time: turns.at(-1).end, turn: turns.at(-1).number, seq: 4 },
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
          { path: addedFile, kind: { type: 'add' }, diff: Array.from({ length: addedLines }, (_, i) => 'export const flag' + i + ' = true;\n').join('') },
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
  for (const locale of ['en', 'zh-CN']) {
    const name = 'eval-' + locale;
    const view = await generateTraceView({ ...portable[0], initialView: 'eval', locale, output: join(directory, name + '.html') });
    assets.set('/' + name, ['text/html; charset=utf-8', await readFile(view.output)]);
  }
  const comparison = datasetFromNative('pi', portable[0].input);
  for (const [index, turn] of comparison.payload.sessions[0].turns.entries()) turn.durationMs = (index + 1) * 1000;
  const comparisonView = writeHostEvalPage(comparison, join(directory, 'eval-comparison.html'), { locale: 'en' });
  assets.set('/eval-comparison', ['text/html; charset=utf-8', await readFile(comparisonView.output)]);
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
  await trace.locator('[data-goal-band="4"] .br-hit').click();
  assert.equal(await trace.locator('#drawer-body dd').first().textContent(), secondGoalText);
  assert.match(await trace.locator('#drawer-description').textContent(), /seq 4$/);
  await trace.locator('#drawer-close').click();
  await trace.locator('[data-goal-marker="1"]').press('Enter');
  assert.equal(await trace.locator('#drawer-body dd').first().textContent(), goalText);
  assert.match(await trace.locator('#drawer-description').textContent(), /seq 1$/);
  await trace.locator('#drawer-close').click();
  await trace.locator('[data-goal-marker="3"] .br-hit').click();
  assert.equal(await trace.locator('#drawer-body dd').first().textContent(), secondGoalText);
  assert.match(await trace.locator('#drawer-description').textContent(), /seq 3$/);
  await trace.locator('[data-chat-jump="5"]').click();
  await page.waitForFunction(() => window.lastJump === 5);
  await trace.locator('[data-goal-select="4"]').click();
  assert.match(await trace.locator('#drawer-description').textContent(), /seq 4$/);
  await trace.locator('#drawer-close').click();

  const segment = trace.locator('#graph [data-context-turn="2"] [data-context-segment="skill"]');
  const mark = await segment.boundingBox();
  assert.ok(mark);
  await page.mouse.move(mark.x + mark.width / 2, mark.y + mark.height / 2);
  await page.mouse.down();
  await trace.locator('#graph-scroll.diagnosis-holding').waitFor();
  await page.mouse.up();
  await trace.locator('#diagnosis-confirm').click();
  const contextDraft = await trace.locator('#draft').inputValue();
  assert.match(contextDraft, /"view":"context"/);
  assert.match(contextDraft, /"turns":\{"from":1,"to":2\}/);
  await trace.locator('#close-editor').click();

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
  const patch = trace.locator('#review-patch-view');
  const picker = trace.getByRole('combobox', { name: 'Select changed file' });
  assert.equal(await patch.locator('.review-diff-row.remove .review-diff-line-number').first().textContent(), '23');
  assert.equal(await patch.locator('.review-diff-row.add .review-diff-line-number').nth(1).textContent(), '23');
  assert.equal(await patch.locator('.review-diff-row.add code').textContent(), 'const value = "<new>";');
  await trace.getByRole('button', { name: 'Raw patch' }).click();
  assert.equal(await patch.locator('pre.excerpt').textContent(), nativeDiff);
  await trace.getByRole('button', { name: 'Line diff' }).click();
  await picker.selectOption('1');
  assert.equal(await trace.locator('#review-patch-path').textContent(), 'Added file');
  assert.equal(await picker.locator('option:checked').textContent(), addedFile);
  assert.equal(await patch.locator('.review-diff-row.add .review-diff-line-number').nth(1).textContent(), '1');
  assert.ok(await trace.locator('.review-patch-scroller').evaluate(el => el.scrollHeight > el.clientHeight));
  await trace.getByRole('button', { name: 'Show more lines' }).click();
  assert.equal(await patch.locator('.review-diff-row.add').count(), addedLines);
  await trace.locator('#review-detail-close').click();
  await trace.locator('[data-result-file="1"]').click();
  await trace.locator('[data-history-round="1"] summary').click();
  await trace.locator('[data-history-diff]').click();
  assert.equal(await picker.inputValue(), '1', 'Opening from history selects the file that was clicked');
  await trace.locator('#review-detail-back').click();
  assert.equal(await trace.locator('[data-history-round="1"]').getAttribute('open'), '');
  assert.equal(await trace.locator('[data-chat-jump]').count(), 0);
  assert.equal(await trace.locator('[data-br-layer="goal"]').count(), 0);
}

async function checkEval(page) {
  const queries = [];
  for (const [locale, title, fullSession, question, scope] of [
    ['en', 'Tool comparison', 'Full session', 'Ask about tool timing', 'Scope: session'],
    ['zh-CN', '工具对照', '整段会话', '问工具耗时', '范围为会话'],
  ]) {
    await page.goto(origin + '/eval-' + locale);
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(await page.locator('#scope option[value=""]').textContent(), fullSession);
    await page.locator('#scope').selectOption('1');
    await page.locator('#tool-rows').getByRole('button', { name: /^read[,，]/ }).click();
    await page.getByRole('button', { name: question, exact: true }).click();
    const draft = await page.locator('#draft').inputValue();
    assert.ok(draft.includes(scope));
    assert.equal(await page.locator('#diagnosis-apply').isVisible(), true, 'Pi provides a draft command');
    queries.push(JSON.parse(draft.match(/trajectory_inspect\((\{[^\n]*?\})\)/)[1]));
  }
  const [query, translated] = queries;
  assert.deepEqual(query, translated, 'Localized drafts preserve the same evidence coordinates');
  assert.ok(Number.isSafeInteger(query.cut) && query.logId, 'Eval draft identifies its frozen source');
  assert.deepEqual(query.turns, { from: 1, to: 1 });
  assert.deepEqual(query.focus, { tool: 'read' });
}

async function checkTurnComparison(page) {
  await page.goto(origin + '/eval-comparison');
  const cards = page.locator('#usage-examples button');
  const point = number => page.locator('.usage-point[data-usage-turn="' + number + '"]');
  const paired = () => cards.evaluateAll(buttons => buttons.map(button => Number(button.dataset.usageTurn)));
  const initial = await paired();
  assert.equal(initial.length, 2);
  await point(2).click();
  assert.deepEqual(await paired(), [2, initial[1]], 'A chart point replaces the active side');
  await cards.nth(1).click();
  await point(3).click();
  assert.deepEqual(await paired(), [2, 3], 'Either side can be selected and replaced');
  assert.equal(await point(3).getAttribute('aria-pressed'), 'true');
  assert.ok(await point(2).evaluate(element => element.classList.contains('is-peer')));
  const line = page.locator('#usage-peer-link line');
  const x = async number => point(number).evaluate(element => parseFloat(element.style.left));
  const y = async number => point(number).evaluate(element => 100 - parseFloat(element.style.bottom));
  assert.equal(await page.locator('#usage-peer-link').isVisible(), true);
  assert.equal(Number(await line.getAttribute('x1')), await x(2));
  assert.equal(Number(await line.getAttribute('x2')), await x(3));
  assert.equal(Number(await line.getAttribute('y1')), await y(2));
  assert.equal(Number(await line.getAttribute('y2')), await y(3));
  await page.getByRole('button', { name: 'Compare these turns', exact: true }).click();
  const draft = await page.locator('#draft').inputValue();
  const query = JSON.parse(draft.match(/trajectory_inspect\((\{[^\n]*?\})\)/)[1]);
  assert.deepEqual(query.turns, { from: 2, to: 3 }, 'The draft uses the new comparison pair');
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(name + ' opens the shared trace and Eval with scoped host actions', { timeout: 60_000 }, async t => {
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
    await checkEval(page);
    await checkTurnComparison(page);
    assert.deepEqual(dshRequests, [], 'Frozen and portable pages do not request live DSH stages');
    assert.deepEqual(errors, [], 'No renderer errors');
  });
}
