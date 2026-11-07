import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderTracePage} from './lib/index.js';
import {ui} from '../../lib/i18n.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const html=renderTracePage({traceLoad:{sessionId:'presentation-check'}});
assert.match(html,/<body class="geist-review trace-pending">/);
assert.ok(!html.includes('geist-review trace-pending context-trend-study'), 'Native viewport does not inherit fixed-height study layout');
assert.equal((html.match(/let studyShowTotal = false/g)||[]).length,1,'Native DSH receives the shared overlay once, default off');
assert.ok(html.includes('study-source-actions')&&html.includes('study-total-toggle'));
assert.ok(html.includes('compactTrendPolyline'));
for(const match of html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const shared=read('./lib/trace/shared/context-observation.js');
assert.equal(shared,read('../../view/assets/context-observation.js'),'DSH and portable hosts ship identical overlay logic');
const start=shared.indexOf('function studyStockLayer('),end=shared.indexOf('\n  // Translucent',start);
assert.ok(start>=0&&end>start);
const stock=shared.slice(start,end);
assert.equal(vm.runInNewContext('let studyShowTotal=false;const view="overview";'+stock+';studyStockLayer()'),'', 'Disabled trend returns before projection, series and SVG work');

// Exercise the shipped control markup: merely finding a label in the script
// does not prove the builder actually emitted its checkbox.
const renderer=read('./lib/trace/page.js');
const controls=renderer.match(/layerBox\.innerHTML=[\s\S]*?\.join\(''\);/);
assert.ok(controls,'Overview control markup is available');
for(const locale of ['zh-CN','en']){
  const layerBox={innerHTML:''};
  vm.runInNewContext(controls[0],{layerBox,overviewLayers:new Set(['duration','context','files']),ui:text=>ui(text,locale)});
  const keys=[...layerBox.innerHTML.matchAll(/data-br-layer="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(keys,['failures','duration','interruptions','context','files'],'All overview controls survive page generation in '+locale);
  assert.match(layerBox.innerHTML,/data-br-layer="context" checked/);
  assert.match(layerBox.innerHTML,/data-br-layer="files" checked/);
}
const arrangeStart=shared.indexOf('  const studyArrange = geistArrangeCaption;'),arrangeEnd=shared.indexOf('  function studyBindStock()',arrangeStart);
assert.ok(arrangeStart>=0&&arrangeEnd>arrangeStart);
const elements=new Map(),checkbox={},captionLabel={childNodes:[{nodeType:3,textContent:''}],querySelector:()=>null,after:node=>elements.set(node.id,node)};
elements.set('graph-caption',{querySelector:()=>({parentElement:captionLabel})});elements.set('canvas',{dataset:{}});
let created=0,refreshes=0;
const context=vm.createContext({ui:text=>ui(text,'en'),$:id=>elements.get(id),geistArrangeCaption(){},studySyncSources(){},studyBindStock(){},
  studyMeaning:{delta:'Context delta',total:'Total trend'},studyShowTotal:false,view:'overview',document:{createElement(){created++;return {style:{},querySelector:()=>checkbox};}},
  studyRefresh(){refreshes++;},reviewReturnOverview(){context.view='overview';}});
vm.runInContext(shared.slice(arrangeStart,arrangeEnd),context);
context.geistArrangeCaption();context.geistArrangeCaption();
assert.equal(created,1,'Redraws reuse the total-trend control');assert.equal(elements.get('canvas').dataset.contextTotal,'false');
checkbox.onchange({target:{checked:true}});assert.equal(refreshes,1);assert.equal(context.studyShowTotal,true);
context.view='path';context.geistArrangeCaption();assert.equal(elements.get('study-total-toggle').style.display,'none','Total trend is hidden only in action-path view');
context.view='overview';context.geistArrangeCaption();assert.equal(elements.get('study-total-toggle').style.display,'','Returning to overview restores the total-trend control');
console.log('PASS shared native presentation, staged body, multi-source controls, lazy disabled trend and renderer syntax');
