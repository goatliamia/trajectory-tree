import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { createPiSample } from '../../analyzers/pi-sample.mjs';
import { adaptPiSession } from '../../analyzers/pi-adapter.mjs';
import { renderTracePage } from '../../plugin/analysis-view/lib/index.js';
import { generateTraceView } from '../../view/generate.mjs';
import { datasetFromNative } from '../../plugin/portable-tools/sources.mjs';
import { writeHostEvalPage, portableRuntime } from '../../view/eval.mjs';
import { generateCommandView } from '../../view/commands.mjs';
import { buildEvalData } from '../../plugin/analysis-view/lib/eval/data.mjs';
import { createOverviewModels } from '../../plugin/analysis-view/lib/eval/overview/shared.mjs';
import { projectPortableOverview } from '../../view/overview.mjs';
import { evaluationReportTables } from '../../report/evaluation.mjs';
import { renderReport } from '../../report/render.mjs';
import { buildTracePayload } from '../../plugin/analysis-view/lib/trace-build.js';
import { createRuntimeMetrics } from '../../plugin/analysis-view/lib/eval-evidence.js';
import { diagnosisSource } from '../../plugin/analysis-view/lib/eval/data.mjs';
import { renderEvalPage } from '../../plugin/analysis-view/lib/eval/render.mjs';
import { renderOverviewPage } from '../../plugin/analysis-view/lib/eval/overview/render.mjs';
import { projectOverviewSession } from '../../plugin/analysis-view/lib/eval/overview/data.mjs';
import { overviewCategories } from '../../plugin/analysis-view/lib/eval/overview/shared.mjs';

const goalText = 'Check <limits> & results';
const secondGoalText = 'Review changed files';
const nativeDiff = '@@ -23,2 +23,2 @@\n-const value = "<old>";\n+const value = "<new>";\n export { value };\n';
const addedFile = '/sample/flag.js';
const addedLines = 510;
const assets = new Map();
let directory, server, origin, commandUrl, streamFixture;
const streaming = new Set();

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
  const commandSnapshot = structuredClone(snapshot);
  const command = (id, durationMs, exitCode, aggregatedOutput) => ({
    id, type: 'commandExecution', command: 'pwsh.exe -Command sample', durationMs, exitCode, aggregatedOutput,
    status: exitCode === 0 ? 'completed' : 'failed',
  });
  commandSnapshot.thread.turns[0].items.push(command('syntax', 380, 1,
    'ParserError:\nLine |\n  2 | rg needle src/{a.js,b.js}\n    | ~\n    | Missing argument in parameter list.'),
  command('return', 2400, 0, 'sample'));
  commandSnapshot.thread.turns.push({
    id: 't2', startedAt: start + 5, completedAt: start + 9, status: 'completed',
    items: [command('no-output', 100, 1, ''), command('unknown-output', 100, 1, 'sample')],
  });
  const commandPage = await generateCommandView({ host: 'codex', snapshot: commandSnapshot, apiOnly: true,
    locale: 'en', output: join(directory, 'commands.html') });
  commandUrl = pathToFileURL(commandPage.output).href;
  const shellSnapshot = structuredClone(commandSnapshot);
  const [powerShellCall, bashCall] = shellSnapshot.thread.turns[1].items;
  powerShellCall.exitCode = -1;
  bashCall.command = "bash -lc 'printf pwsh.exe'";
  shellSnapshot.thread.turns[1].items.push(command('same-arguments', 100, 0, 'sample'));
  const shellEval = await generateTraceView({ host: 'codex', snapshot: shellSnapshot, apiOnly: true, initialView: 'eval',
    locale: 'en', output: join(directory, 'eval-shell.html') });
  assets.set('/eval-shell', ['text/html; charset=utf-8', await readFile(shellEval.output)]);
  const directCode=await generateTraceView({host:'codex',snapshot:shellSnapshot,apiOnly:true,initialView:'code',locale:'en',output:join(directory,'eval-code-direct.html')});
  assets.set('/eval-code-direct',['text/html; charset=utf-8',await readFile(directCode.output)]);
  const programEvents=[],addProgram=(type,data)=>programEvents.push({type,data,seq:programEvents.length,time:programEvents.length*10});
  addProgram('turn/start',{turn:1});addProgram('step/start',{turn:1,step:1});
  addProgram('tool/call',{turn:1,step:1,callId:'ptc',name:'run_code',arguments:{code:'await tools.pwsh({command: "sample"})'}});
  addProgram('tool/ptc-dispatch-start',{turn:1,step:1,rootCallId:'ptc',subCallId:'ps',name:'pwsh',arguments:{command:'sample'}});
  addProgram('tool/ptc-dispatch',{turn:1,step:1,rootCallId:'ptc',subCallId:'ps',name:'pwsh',arguments:{command:'sample'},isError:true,content:[{type:'text',text:'ParserError:\nLine |\n 1 | sample\n | Missing expression.'}]});
  addProgram('tool/result',{turn:1,step:1,error:{code:'CODE_RUN_FAILED',message:'code run failed (timeout): elapsed budget expired'},message:{toolCallId:'ptc',isError:true,content:[{type:'text',text:'code run failed (timeout): elapsed budget expired'}]}});
  addProgram('step/end',{turn:1,step:1});addProgram('turn/end',{turn:1,reason:{kind:'completed'}});
  addProgram('turn/start',{turn:2});addProgram('step/start',{turn:2,step:1});
  for (const kind of ['exception','abort','worker-exit','invalid-output','output-limit','protocol','sandbox-unavailable']) {
    const callId='ptc-'+kind;
    addProgram('tool/call',{turn:2,step:1,callId,name:'run_code',arguments:{code:'sample()'}});
    addProgram('tool/result',{turn:2,step:1,error:{code:'CODE_RUN_FAILED',message:`code run failed (${kind}): recorded failure`},message:{toolCallId:callId,isError:true,content:[{type:'text',text:`code run failed (${kind}): recorded failure`}]}});
  }
  addProgram('step/end',{turn:2,step:1});addProgram('turn/end',{turn:2,reason:{kind:'completed'}});
  const programSession=buildTracePayload(programEvents,'browser-program').sessions[0];
  const programData=buildEvalData(programSession,createRuntimeMetrics(programSession,{events:programEvents}));
  assets.set('/eval-program',['text/html; charset=utf-8',renderEvalPage(programData,{mode:'dsh',locale:'en',diagnosis:diagnosisSource(programSession,programData)})]);
  const overviewModels=createOverviewModels();
  const overviewOne=projectOverviewSession('overview-a',programEvents,{},overviewModels,{stream:{}});
  const overviewTwo=projectOverviewSession('overview-b',programEvents.map(row=>({...row,time:row.time+86400000})),{},overviewModels,{stream:{}});
  for(const [index,session] of [overviewOne,overviewTwo].entries())session.project=index;
  const overviewNative={host:'dsh',projects:[{name:'Project A'},{name:'Project B'}],sessions:[overviewOne,overviewTwo],models:overviewModels.models,categories:overviewCategories,
    latest:overviewTwo.turns.at(-1).at,unread:0,more:false};
  assets.set('/overview-dsh',['text/html; charset=utf-8',renderOverviewPage({data:overviewNative,locale:'en'})]);
  streamFixture = overviewNative;
  assets.set('/overview-stream',['text/html; charset=utf-8',renderOverviewPage({locale:'en'})]);
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
  const reportSession = comparison.payload.sessions[0], catalog = createOverviewModels();
  const portableSession=projectPortableOverview(comparison,catalog);portableSession.project=0;
  assets.set('/overview-pi',['text/html; charset=utf-8',renderOverviewPage({locale:'en',data:{host:'pi',projects:[{name:'Sample'}],sessions:[portableSession],models:catalog.models,categories:overviewCategories,latest:portableSession.turns.at(-1).at,unread:0,more:false}})]);
  const reportData = evaluationReportTables(reportSession, buildEvalData(reportSession, portableRuntime(comparison.payload), { host: 'pi' }),
    projectPortableOverview(comparison, catalog), catalog.models, { host: 'pi', session: comparison.session, snapshot: 'browser-report', log: comparison.logId, cut: reportSession.lastSeq });
  const report = renderReport({ locale: 'en', template: 'diagnostic', datasets: reportData,
    markdown: '# Recorded evaluation\n\n## Tool results\n\n[[figure:tools]]\n\n## Error distribution\n\n[[figure:trend]]\n\n## Call composition\n\n[[figure:share]]',
    figures: { tools: { id: 'tools', type: 'table', data: 'tools', fields: { label: 'name', value: 'calls' }, series: ['calls', 'errorRate', 'durationP50Ms'], sort: 'descending' },
      trend: { id: 'trend', type: 'trend', data: 'turns', fields: { x: 'turn' }, series: ['errors'] },
      share: { id: 'share', type: 'donut', data: 'tools', fields: { label: 'name', value: 'calls' } } } });
  assets.set('/report', ['text/html; charset=utf-8', report.html]);
  for (const host of ['dsh', 'codex']) assets.set('/host-' + host, ['text/html; charset=utf-8', hostDocument('/' + host)]);
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const line = (response, value) => response.write(JSON.stringify(value)+'\n');
    if (path === '/analysis-view/overview-data') {
      res.writeHead(200, { 'content-type':'application/x-ndjson; charset=utf-8' });
      line(res,{type:'start',projects:streamFixture.projects,total:2,latest:streamFixture.latest,models:streamFixture.models,categories:streamFixture.categories});
      line(res,{type:'session',session:streamFixture.sessions[0],done:1,models:streamFixture.models});
      streaming.add(res);res.once('close',()=>streaming.delete(res));return;
    }
    if (path === '/overview-release' || path === '/overview-interrupt') {
      for (const response of streaming) {
        if (path === '/overview-release') {
          line(response,{type:'session',session:streamFixture.sessions[1],done:2,models:streamFixture.models});
          line(response,{type:'complete',models:streamFixture.models,categories:streamFixture.categories,unread:0});
        }
        response.end();
      }
      res.writeHead(200).end();return;
    }
    const asset = assets.get(path);
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

  const previousCanvasWidth = await canvas.evaluate(el => el.clientWidth);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForFunction(previousWidth => {
    const frame = document.querySelector('iframe');
    const doc = frame.contentDocument;
    const width = doc.getElementById('graph-scroll').clientWidth;
    return frame.contentWindow.innerWidth === 900 && width < previousWidth &&
      Math.abs(Number(doc.querySelector('#br-clip rect')?.getAttribute('width')) - width) <= 1;
  }, previousCanvasWidth);
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
  const record = trace.locator('.geist-tool-record').filter({ has: trace.locator('[data-result-diff]') });
  await record.locator('summary').click();
  await record.getByRole('button', { name: 'Compare changes' }).click();
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
    assert.equal(await page.locator('#error-caption').innerText(), locale === 'en' ? '2 / 2 attributed' : '2 / 2 已归因');
    const bashRow = page.locator('#error-matrix tr').filter({ has: page.getByRole('rowheader', { name: 'bash', exact: true }) });
    await bashRow.locator('button[data-cell]').click();
    assert.match(await page.locator('.error-attribution').innerText(), locale === 'en' ? /Verification failed.*Exit code 1/ : /验证未通过.*退出码 1/);
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

async function checkPowerShellDraft(page) {
  await page.goto(origin + '/eval-shell');
  await page.locator('#scope').selectOption('2');
  const ask = page.locator('#error-samples [data-diagnosis-failure]');
  const draft = page.locator('#draft');
  await page.locator('#error-example [data-condition]').filter({ hasText: 'EXIT_-1' }).click();
  const seq = Number(await ask.getAttribute('data-diagnosis-failure'));
  await ask.click();
  const powerShellDraft = await draft.inputValue();
  assert.ok(powerShellDraft.includes(`For #${seq}, read references/powershell.md`));
  assert.equal(JSON.parse(/trajectory_read\((\{[^\n]*?\})\)/.exec(powerShellDraft)[1]).seq, seq);
  await page.locator('#close-editor').click();
  await page.getByRole('button', { name: 'Ask about these errors', exact: true }).click();
  assert.ok((await draft.inputValue()).includes(`For #${seq}, read references/powershell.md`));
  await page.locator('#close-editor').click();
  await page.locator('#error-example [data-condition]').filter({ hasText: 'EXIT_1' }).click();
  await ask.click();
  assert.ok(!(await draft.inputValue()).includes('references/powershell.md'), 'Shell names in command text do not trigger routing');
}

async function checkCommands(page) {
  await page.goto(commandUrl);
  const select = (dimension, value) => page.locator('[data-filter="' + dimension + '"][data-value="' + value + '"]');
  const rows = page.locator('#rows [data-seq]');
  await select('turn', '1').click();
  await select('duration', '0').click();
  await select('reason', 'syntax').click();
  assert.equal(await page.locator('#active button').count(), 3, 'Turn, duration and reason filters compose');
  assert.equal(await rows.count(), 1);
  assert.match(await page.locator('.diagnosis').innerText(), /Runtime report L2\s+An argument is missing/);
  await page.locator('#mode-count').click();
  assert.equal(await page.locator('#mode-count').getAttribute('aria-pressed'), 'true');
  assert.equal(await select('duration', '0').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  assert.equal(await rows.count(), 4);
  await select('reason', 'unresolved-empty').click();
  assert.match(await page.locator('#details').innerText(), /contains no output to diagnose/);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  const syntax = rows.filter({ hasText: 'Shell syntax' });
  await syntax.locator('td').nth(3).click();
  assert.equal(await page.locator('#detail-title').textContent(), '#' + await syntax.getAttribute('data-seq'));
}

async function checkReport(page) {
  await page.goto(origin + '/report');
  assert.equal(await page.locator('.diagnostic-kicker [data-report-ui]').textContent(),'Session diagnosis');
  assert.match(await page.locator('.diagnostic-outline>summary').textContent(),/Contents.*sections/);
  const table = page.locator('[data-figure="tools"]');
  await table.locator('tbody tr').first().click();
  const panel = table.locator('.report-record');
  await panel.locator('summary').first().click();
  assert.ok(await panel.locator('.report-evidence-links button').count() > 0);
  const packet = JSON.parse(await panel.locator('.report-evidence-raw').textContent());
  assert.equal(packet.evidence[0].args.linked, true);
  assert.equal(packet.evidence[0].args.logId, packet.source.log);
  assert.ok(!Object.hasOwn(packet.evidence[0].args, 'format'));
  assert.equal(await page.locator('[data-figure="trend"] svg').count(), 1);
  const share = page.locator('[data-figure="share"]');
  const category = share.locator('.composition-item').last();
  const rowId = await category.getAttribute('data-row');
  await category.click();
  assert.equal(JSON.parse(await share.locator('.report-evidence-raw').textContent()).values.id, rowId);
  const sector = share.locator('svg [data-row]').first();
  await sector.focus();
  await page.keyboard.press('Enter');
  assert.equal(JSON.parse(await share.locator('.report-evidence-raw').textContent()).values.id, await sector.getAttribute('data-row'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Report tables scroll within the figure on narrow screens');
  await page.setViewportSize({ width: 1280, height: 860 });
}

async function checkCodeExecution(page) {
  await page.goto(origin+'/eval-shell');
  await page.locator('[data-ce-tab="code"]').click();
  await page.locator('#code-execution').waitFor({state:'visible'});
  assert.match(await page.locator('#ce-group-title').textContent(),/Shell syntax error/);
  assert.match(await page.locator('#ce-detail').innerText(),/L2/);
  assert.match(await page.locator('.ce-code-grid>section').nth(1).innerText(),/ParserError:/,'Code feedback comes from the frozen result record');
  await page.locator('#ce-ask-group').click();
  const draft=await page.locator('#draft').inputValue();
  assert.match(draft,/references\/code-execution\.md/);
  assert.match(draft,/"seqs":\[/);
  assert.match(draft,/"cut":/);
  assert.match(draft,/"logId":/);
  await page.locator('#close-editor').click();
  await page.locator('#ce-executor').selectOption('Shell');
  assert.equal(await page.locator('#ce-summary strong').first().textContent(),'1');
  await page.locator('#scope').selectOption('1');
  assert.match(await page.locator('#ce-group-title').textContent(),/No code execution errors/);
  await page.locator('#ce-executor').selectOption('');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Code analysis fits a narrow viewport');
  await page.setViewportSize({width:1280,height:860});
  await page.goto(origin+'/eval-program');
  await page.locator('[data-ce-tab="code"]').click();
  await page.locator('#ce-executor').selectOption('PTC');
  await page.locator('#scope').selectOption('1');
  assert.match(await page.locator('#ce-group-title').textContent(),/execution budget expired/);
  assert.match(await page.locator('.ce-related').innerText(),/PowerShell/);
  assert.equal(await page.locator('#ce-summary strong').first().textContent(),'1');
  await page.locator('#ce-ask-call').click();
  assert.match(await page.locator('#draft').inputValue(),/references\/code-execution\.md/);
  assert.ok(!(await page.locator('#draft').inputValue()).includes('"logId"'),'DSH keeps its native source arguments');
  await page.locator('#close-editor').click();
  await page.locator('#scope').selectOption('');
  assert.equal(await page.locator('#ce-groups .ce-group').count(),8);
  await page.setViewportSize({width:1280,height:600});
  const signalList=page.locator('#ce-groups');
  await signalList.scrollIntoViewIfNeeded();
  assert.equal(await signalList.evaluate(el=>el.scrollHeight>el.clientHeight),true,'Desktop failure signals have their own scroll viewport');
  await signalList.evaluate(el=>el.scrollTop=0);
  await signalList.hover();
  const pageScroll=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,220);
  await page.waitForFunction(()=>document.getElementById('ce-groups').scrollTop>0);
  assert.equal(await page.evaluate(()=>scrollY),pageScroll,'Scrolling signals keeps the selected detail in place');
  await signalList.locator('.ce-group').last().focus();
  await page.keyboard.press('Enter');
  assert.equal(await signalList.locator('.ce-group').last().getAttribute('aria-pressed'),'true','Keyboard can select a group beyond the first screen');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Many failure groups scroll inside the code analysis panel');
  assert.equal(await page.locator('#ce-groups').evaluate(el=>el.scrollWidth>el.clientWidth),true);
  await page.setViewportSize({width:1280,height:860});
}

async function checkFindings(page) {
  await page.goto(origin+'/eval-code-direct');
  await page.waitForFunction(()=>document.body.dataset.evalSection==='code');
  assert.equal(await page.locator('#code-execution').isVisible(),true,'Direct generation opens code execution');
  await page.goto(origin+'/eval-shell');
  await page.setViewportSize({width:1920,height:1080});
  assert.equal(await page.locator('.workspace').evaluate(el=>Math.round(el.getBoundingClientRect().width)),1920,'Session Eval uses the available width');
  await page.locator('[data-ce-findings]').click();
  assert.equal(await page.locator('section#eval-basis #time-basis').isVisible(),true,'Additional runtime metrics are directly visible');
  const board=page.locator('#eval-findings');
  await board.locator('.df-table tbody tr').first().click();
  await board.locator('[data-df-ask="overall"]').click();
  assert.match(await page.locator('#draft').inputValue(),/references\/disposition\.md/);
  assert.match(await page.locator('#draft').inputValue(),/"logId":/);
  await page.locator('#close-editor').click();
  await page.locator('#scope').selectOption('1');
  assert.equal(await board.locator('.df-table tbody tr').count(),1);
  await page.locator('[data-ce-tab="code"]').click();
  await page.locator('.ce-disposition [data-df-direction="repair"]').click();
  assert.match(await page.locator('#draft').inputValue(),/Where should it be fixed/);
  await page.locator('#close-editor').click();
  await page.goto(origin+'/overview-dsh');
  await page.locator('#overview-page').waitFor({state:'visible'});
  assert.equal(await page.locator('#session-page,[data-view="session"]').count(),0,'Duplicate single-session overview page is removed');
  const width=await page.locator('#overview-page').evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(width>=1850,'Global Eval uses the available width with normal gutters');
  const global=page.locator('#overview-findings');
  await global.locator('.df-table tbody tr').first().click();
  await global.locator('[data-df-ask="overall"]').click();
  let draft=await page.locator('#draft').inputValue();
  assert.match(draft,/overview-a/);assert.match(draft,/overview-b/);
  assert.ok(!draft.includes('"logId"'),'DSH keeps its native query contract');
  await page.locator('#close-editor').click();
  await page.locator('#project').selectOption('0');
  await global.locator('[data-df-ask="overall"]').click();
  draft=await page.locator('#draft').inputValue();
  assert.match(draft,/overview-a/);assert.ok(!draft.includes('overview-b'),'Scope filters constrain diagnosis sources');
  await page.locator('#close-editor').click();
  await global.locator('[data-df-view="directions"]').click();
  assert.equal(await global.locator('.df-cards>section').count(),4);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Global findings fit a narrow viewport');
  await page.goto(origin+'/overview-pi');
  await page.locator('#overview-page').waitFor({state:'visible'});
  await page.locator('#overview-findings [data-df-ask="overall"]').click();
  draft=await page.locator('#draft').inputValue();assert.match(draft,/"logId":/);
  assert.equal(await page.locator('#diagnosis-apply').isVisible(),false,'A global snapshot does not assume an active Pi binding');
  await page.locator('#close-editor').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Portable overview fits a narrow viewport');
  await page.setViewportSize({width:1280,height:860});
}

async function checkStreamingOverview(page) {
  await page.goto(origin+'/overview-stream');
  await page.locator('#overview-page').waitFor({state:'visible'});
  assert.match(await page.locator('#snapshot').textContent(),/1 \/ 2/,'Charts appear before the remaining session is released');
  await page.locator('#project').selectOption('0');
  await page.locator('#overview-findings [data-df-ask="overall"]').click();
  const originalDraft=await page.locator('#draft').inputValue();
  assert.match(originalDraft,/overview-a/);assert.ok(!originalDraft.includes('overview-b'));
  await page.request.get(origin+'/overview-release');
  await page.waitForFunction(()=>document.getElementById('overview-page').getAttribute('aria-busy')==='false');
  assert.match(await page.locator('#snapshot').textContent(),/Through/);
  assert.equal(await page.locator('#project').inputValue(),'0','Loading another project preserves the chosen scope');
  assert.equal(await page.locator('#draft').inputValue(),originalDraft,'An open diagnosis draft keeps its original source');
  await page.locator('#close-editor').click();
  await page.locator('#project').selectOption('all');
  await page.locator('#overview-findings [data-df-ask="overall"]').click();
  assert.match(await page.locator('#draft').inputValue(),/overview-b/,'Completed batches contribute their exact source records');
  await page.locator('#close-editor').click();
  await page.goto(origin+'/overview-stream');
  await page.locator('#overview-page').waitFor({state:'visible'});
  await page.request.get(origin+'/overview-interrupt');
  await page.waitForFunction(()=>document.getElementById('snapshot').textContent.includes('Loading interrupted'));
  assert.equal(await page.locator('#overview-page').isVisible(),true,'An interrupted stream retains the already loaded analysis');
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(name + ' opens the shared trace and Eval with scoped host actions', { timeout: 90_000 }, async t => {
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
    await checkPowerShellDraft(page);
    await checkTurnComparison(page);
    await checkCommands(page);
    await checkReport(page);
    await checkCodeExecution(page);
    await checkFindings(page);
    await checkStreamingOverview(page);
    assert.deepEqual(dshRequests, [], 'Frozen and portable pages do not request live DSH stages');
    assert.deepEqual(errors, [], 'No renderer errors');
  });
}
