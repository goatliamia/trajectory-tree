import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createContextApi } from '../../plugin/antigravity/sidecars/context_board/main.mjs';

test('chromium: Antigravity loads both native views through the sidecar bridge and retains mode shares', async t => {
  const root = mkdtempSync(join(tmpdir(), 'trajectory-turn-ui-'));
  t.after(() => {
    if (dirname(root) === resolve(tmpdir()) && basename(root).startsWith('trajectory-turn-ui-')) rmSync(root, { recursive: true, force: true });
  });
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const logs = join(root, 'brain', id, '.system_generated/logs');
  mkdirSync(logs, { recursive: true });
  const now = Date.now();
  const rows = Array.from({length: 92}, (_, seq) =>
    seq === 0 || seq === 81 ? {step_index: seq, type: 'USER_INPUT', created_at: new Date(now - (92 - seq) * 1000).toISOString()} :
      {step_index: seq, type: 'PLANNER_RESPONSE', model_display_name: seq <= 80 ? 'Example (High)' : 'Example (Medium)',
        created_at: new Date(now - (92 - seq) * 1000).toISOString(), model: 'example-response', input_tokens: 90, output_tokens: 10,
        tool_calls:[{name:seq < 81 ? 'read_file':'write_file'}]});
  writeFileSync(join(logs, 'transcript_full.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
  const api = createContextApi({dirs: [root], conversationId: id});
  const assets = new URL('../../plugin/antigravity/sidecars/context_board/', import.meta.url);
  const browser = await chromium.launch(process.env.TRAJECTORY_BROWSER_CHANNEL ? {channel: process.env.TRAJECTORY_BROWSER_CHANNEL} : {});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 920, height: 800}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(conversationId => {
    if (window === window.top) window.sidecar = { conversationId, fetch: (...args) => fetch(...args) };
  }, id);
  const traceRequested = Promise.withResolvers(), releaseTrace = Promise.withResolvers();
  t.after(() => releaseTrace.resolve());
  let firstTrace = true;
  await page.route('http://sidecar.invalid/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, query = Object.fromEntries(url.searchParams);
    if (path === '/api/context') return route.fulfill({json: await api.context(query)});
    if (path === '/api/usage') return route.fulfill({json: await api.usage(query)});
    if (path === '/trace') {
      if (firstTrace) {
        firstTrace = false;
        traceRequested.resolve();
        await releaseTrace.promise;
      }
      return route.fulfill({contentType: 'text/html', body: await api.traceHtml(query)});
    }
    if (path === '/eval') return route.fulfill({contentType: 'text/html', body: await api.evalHtml(query)});
    if (path === '/preload.js') return route.fulfill({contentType: 'text/javascript', body: ''});
    const files = {'/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/styles.css': ['styles.css','text/css'],
      '/fonts/Geist-Variable.woff2': ['fonts/Geist-Variable.woff2','font/woff2'], '/fonts/GeistMono-Variable.woff2': ['fonts/GeistMono-Variable.woff2','font/woff2']};
    const file = files[path];
    return file ? route.fulfill({contentType: file[1], body: readFileSync(new URL(file[0], assets))}) : route.abort();
  });
  await page.goto('http://sidecar.invalid');
  await page.waitForFunction(() => document.querySelector('#m-win').textContent === '90');
  assert.equal(await page.locator('#m-occupancy').innerText(), '—');
  assert.equal(await page.locator('#m-tps').innerText(), '—');
  const traceTab = page.getByRole('tab', {name: '轨迹树'});
  const evalTab = page.getByRole('tab', {name: '单对话 Eval'});
  const trace = page.frameLocator('#frame-trace'), evaluation = page.frameLocator('#frame-eval');
  const dataOf = async (frameName, id) => {
    const selector = '#frame-' + frameName;
    await page.waitForFunction(({selector, id}) => document.querySelector(selector)?.srcdoc.includes('id="' + id + '"'), {selector, id});
    return page.locator(selector).evaluate((frame, id) => {
      const doc = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
      return JSON.parse(doc.getElementById(id).textContent);
    }, id);
  };
  await traceTab.click();
  await traceRequested.promise;
  await evalTab.click();
  await evaluation.getByRole('heading', {name: '缓存与压缩', exact: true}).waitFor();
  const original = await dataOf('eval', 'eval-data');
  assert.equal(original.cut, 91);
  assert.equal(original.cacheCompaction.summary.requestsWithUsage, 90);
  assert.deepEqual(original.turns[1].metrics.tools.map(tool => [tool.name, tool.unknown]), [['write_file', 10]]);
  releaseTrace.resolve();
  await traceTab.click();
  await trace.getByRole('button', {name: '符号说明'}).click();
  await trace.getByRole('button', {name: /Antigravity 数据依据/}).click();
  await trace.getByText('Antigravity 数据依据', {exact: true}).waitFor();
  const tree = await dataOf('trace', 'trace-data');
  assert.equal(tree.mainSession, id);
  assert.deepEqual(tree.sessions[0].turns.map(turn => turn.steps.length), [80, 10]);
  assert.equal(tree.sessions[0].lastSeq, original.cut);
  await page.getByRole('tab', {name:'用量总览'}).click();
  const cell = page.locator('[data-heat-model="Example"][data-heat-mode=""]');
  await cell.click();
  assert.equal(await page.locator('.model-head').innerText(),'Example');
  assert.match(await cell.innerText(), /100%/);
  assert.match(await page.locator('#heat-detail').innerText(), /example-response/);
  assert.match(await page.locator('#heat-detail').innerText(), /88\.9%/);
  assert.match(await page.locator('#heat-detail').innerText(), /11\.1%/);
  await page.getByLabel('细分模式').check();
  await page.locator('[data-heat-model="Example"][data-heat-mode="中强度"]').click();
  assert.match(await page.locator('.matrix-selection').innerText(), /1,000 Token/);
  assert.equal(await page.locator('.model-head').getAttribute('colspan'),'2');
  const filter = page.getByRole('combobox', {name:'模式', exact:true});
  assert.equal(await page.locator('#usage-days').inputValue(),'7');
  await filter.selectOption('中强度');
  await page.waitForFunction(() => document.querySelector('#matrix-split-label').hidden && document.querySelector('#u-total').textContent === '1,000');
  assert.match(await cell.innerText(), /11\.1%/);
  assert.equal(await page.locator('#u-total').innerText(), '1,000');
  await page.setViewportSize({width:1850,height:850});
  assert.ok(await page.locator('.usage-heading').evaluate(el => el.getBoundingClientRect().x < 24 && el.clientWidth > 1780));
  assert.ok((await page.locator('.usage-charts').boundingBox()).y < (await page.locator('.usage-history').boundingBox()).y);
  await page.setViewportSize({width:320,height:800});
  assert.equal(await page.locator('.main').evaluate(el => el.scrollWidth <= innerWidth), true);
  const total = page.locator('td.matrix-total');
  await total.scrollIntoViewIfNeeded();
  assert.equal(await total.evaluate(el => {
    const r=el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
  }), true, 'mobile token total must be visible above the row header');
  for (let i = 0; i < 23; i++) {
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-' + String(i).padStart(12,'0');
    const folder = join(root,'brain',other,'.system_generated/logs');
    mkdirSync(folder,{recursive:true});
    writeFileSync(join(folder,'transcript.jsonl'),JSON.stringify({step_index:1,type:'PLANNER_RESPONSE',
      created_at:new Date().toISOString(),model_display_name:'Route ' + i%6,input_tokens:100,output_tokens:12}));
  }
  await page.setViewportSize({width:750,height:800});
  await page.locator('#usage-days').selectOption('30');
  await page.waitForFunction(() => document.querySelectorAll('.model-head').length === 7);
  assert.equal(await page.locator('.chat-heading').count(),10);
  await page.getByRole('button',{name:'下一页'}).click();
  await page.getByRole('button',{name:'下一页'}).click();
  assert.equal(await page.locator('.chat-heading').count(),4);
  assert.ok(await page.locator('.main').evaluate(el => el.scrollWidth <= innerWidth));

  const chat = page.locator('[data-usage-chat]').first();
  const selectedId = await chat.getAttribute('data-usage-chat');
  assert.notEqual(selectedId, id);
  await chat.click();
  assert.equal((await dataOf('trace', 'trace-data')).mainSession, selectedId);
  await evalTab.click();
  assert.equal((await dataOf('eval', 'eval-data')).codeExecution.session, selectedId);
  const reload = page.waitForRequest(request => new URL(request.url()).pathname === '/eval' && new URL(request.url()).searchParams.has('t'));
  await page.locator('#refresh-embed').click();
  assert.equal(new URL((await reload).url()).searchParams.get('session'), selectedId);
  assert.equal((await dataOf('eval', 'eval-data')).codeExecution.session, selectedId);
  assert.deepEqual(errors, []);
});
