import test from 'node:test';
import assert from 'node:assert/strict';
import {compareContextItems,contextTextItems,contextOverlap} from './context-overlap.mjs';
const text='Before changing the configuration, read the current project instructions and record the previous value for verification.';
const item=(id,body,extra={})=>({id,name:id,kind:'instructions',origin:'personal',phase:'startup',text:body,...extra});
test('continuous copied text is located across whitespace and arbitrary prefix offsets',()=>{
  const r=compareContextItems([item('a','前面的材料。\n'+text+'\n本文件的独有要求。'),item('b','An unrelated introduction.\n'+text.replaceAll(' ','  ')+'\nAnother distinct workflow.')]);
  assert.equal(r.pairs.length,1);const p=r.pairs[0],m=p.matches[0];assert.equal(p.kind,'fragments');
  assert.ok(p.leftCoverage<1&&p.rightCoverage<1);assert.ok(r.items[0].text.slice(m.left.start,m.left.end).includes(text));
  assert.equal(m.left.line,2);assert.equal(m.right.line,2);
});
test('three copies use per-source interval unions, not summed pair counts',()=>{
  const r=compareContextItems(['a','b','c'].map(id=>item(id,text)));
  assert.equal(r.pairs.length,3);assert.equal(r.summary.matchedCharacters,text.length*3);
  assert.ok(r.pairs.every(p=>p.kind==='same'&&p.leftCoverage===1&&p.rightCoverage===1));
});
test('references remain evidence and official Skill pairs are excluded',()=>{
  const personal=item('a',text+'\nSee `b`.',{kind:'skills',skillName:'a'}),official=item('b',text,{kind:'skills',skillName:'b',origin:'official'});
  const r=compareContextItems([personal,official]);assert.equal(r.pairs.length,1);assert.equal(r.pairs[0].reference,true);
  assert.equal(compareContextItems([{...personal,origin:'official'},official]).pairs.length,0);
});
test('shared vocabulary and reversed conditions do not become semantic equivalence',()=>{
  const r=compareContextItems([item('a','Read files before editing; do not update the configuration.'),item('b','Update configuration before reading files; do not edit source.')]);
  assert.equal(r.pairs.length,0);
  const q=compareContextItems([item('a',text+' Never write files.'),item('b',text+' Always write files.')]);
  assert.equal(q.pairs[0].kind,'fragments');assert.ok(q.pairs[0].leftCoverage<1);
});
test('current fields retain loading phase and do not claim runtime co-presence',()=>{
  const preset={id:'ptc',toolMode:'PTC',instructions:[{name:'AGENTS.md',body:text}],skills:[{name:'a',description:text,body:text}],tools:[{name:'read',description:text}],injections:[{name:'plugin',body:text,template:true}]};
  const items=contextTextItems(preset);assert.equal(items.find(i=>i.kind==='skills').phase,'on-demand');assert.equal(items.find(i=>i.kind==='tools').phase,'tool-directory');
  assert.equal(items.find(i=>i.kind==='injections').evidence,'static-fragment');
  const r=contextOverlap({presets:[preset]},'ptc');assert.equal(r.coverage.runtimeObserved,false);
  assert.equal(contextTextItems({...preset,instructions:[{name:'AGENTS.md',body:text,truncated:{bytes:10}}]}).filter(i=>i.kind==='instructions').length,0);
});
test('source excerpts preserve Unicode character boundaries',()=>{
  const sentence='🧭项目说明必须保持当前工作目录、插件来源和适用条件。'.repeat(5);
  const r=compareContextItems([item('a','前言 '+sentence),item('b',sentence+' 后记')]);
  const p=r.pairs[0];assert.ok(p);const m=p.matches[0];assert.equal(r.items[0].text.slice(m.left.start,m.left.end),r.items[1].text.slice(m.right.start,m.right.end));
});
test('highly repetitive bodies have bounded fingerprint postings and retain a verified match',()=>{
  const repeated='Repeated instruction. '.repeat(500);
  const r=compareContextItems([item('a',repeated),item('b',repeated)]);
  assert.equal(r.pairs.length,1);assert.equal(r.pairs[0].kind,'same');assert.equal(r.method.limitedItems.length,2);
});
