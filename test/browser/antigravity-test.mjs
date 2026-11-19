import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createContextApi } from '../../plugin/antigravity/sidecars/context_board/main.mjs';

test('chromium: Antigravity uses user turns, preserves chart focus on resize and shows per-conversation mode shares', async t => {
  const root = mkdtempSync(join(tmpdir(), 'trajectory-turn-ui-'));
  t.after(() => {
    if (dirname(root) === resolve(tmpdir()) && basename(root).startsWith('trajectory-turn-ui-')) rmSync(root, { recursive: true, force: true });
  });
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const logs = join(root, 'brain', id, '.system_generated/logs');
  mkdirSync(logs, { recursive: true });
  const rows = Array.from({length: 92}, (_, seq) =>
    seq === 0 || seq === 81 ? {step_index: seq, type: 'USER_INPUT'} :
      {step_index: seq, type: 'PLANNER_RESPONSE', model_display_name: seq <= 80 ? 'Example (High)' : 'Example (Medium)',
        created_at: new Date().toISOString(), model: 'example-response', input_tokens: 90, output_tokens: 10,
        tool_calls:[{name:seq < 81 ? 'read_file':'write_file'}]});
  writeFileSync(join(logs, 'transcript_full.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
  const api = createContextApi({dirs: [root], conversationId: id});
  const assets = new URL('../../plugin/antigravity/sidecars/context_board/', import.meta.url);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 920, height: 800}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://sidecar.invalid/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, query = Object.fromEntries(url.searchParams);
    if (path === '/api/context') return route.fulfill({json: await api.context(query)});
    if (path === '/api/usage') return route.fulfill({json: await api.usage(query)});
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
  await page.getByRole('tab', {name: '趋势与对照'}).click();
  assert.equal(await page.locator('[data-chart-turn]').count(), 2);
  await page.locator('[data-chart-turn="2"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.setViewportSize({width: 820, height: 800});
  await page.waitForFunction(() => document.querySelector('.turn-plot svg').getBoundingClientRect().width < 820);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#inline-turn tbody tr').length === 80);
  assert.equal(await page.locator('#tab-curve').getAttribute('aria-selected'), 'true');
  await page.locator('[data-chart-turn="2"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#inline-turn tbody tr').length === 10);
  await page.getByRole('tab',{name:/工具 Eval/}).click();
  assert.equal(await page.locator('.eval-tools tbody tr').count(),2);
  await page.locator('#step-turn').selectOption('2');
  await page.waitForFunction(() => document.querySelectorAll('.step-row').length === 10);
  assert.match(await page.locator('.eval-tools').innerText(),/write_file/);
  assert.doesNotMatch(await page.locator('.eval-tools').innerText(),/read_file/);
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
  assert.deepEqual(errors, []);
});
