import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosisWorkspace} from './diagnosis-workspace.mjs';
import {buildDiagnosisDraft} from '../docs/demo/preset-context/diagnosis-review.js';
import {renderDiagnosisWorkspace} from '../plugin/analysis-view/lib/eval/workspace/ui/diagnosis-workspace.js';

const at=Date.parse('2026-11-16T10:00:00+08:00');
function fixture(){return {latest:at,failures:[],projects:[{name:'one'}],models:[{name:'model-a',provider:'host'},{name:'model-b',provider:'host'}],categories:[],sessions:[
  {id:'a',title:'A',preset:'cordis',project:0,cut:100,turns:[{no:1,at,errors:[],requests:[{seq:2,model:0,input:200,window:[1000],ttft:100,output:50,type:'tools'}]}],
    findingCalls:[{seq:3,result:4,turn:1,tool:'edit',status:'error',code:'FS_NOT_OBSERVED',certainty:'confirmed'},
      {seq:5,result:6,turn:1,tool:'edit',status:'error',code:'FS_NOT_OBSERVED',certainty:'confirmed'},
      {seq:90,result:91,turn:1,tool:'edit',status:'error',code:'UNKNOWN_TYPE',certainty:'unknown'}],
    occupancy:{names:['edit','read'],actions:[[3,2,1,1,0,1,200,1000,4,0,0,500],[5,2,1,1,0,1,200,1000,6,0,0,900],[7,2,1,1,0,0,600,1000,8,0,0,100],[9,2,1,1,1,0,600,1000,10,0,0,5000]]}},
  {id:'b',title:'B',preset:'cordis',project:0,cut:50,turns:[{no:1,at,errors:[],requests:[{seq:2,model:1,input:700,window:[1000],ttft:900,output:80,type:'tools'}]}],
    findingCalls:[{seq:3,result:4,turn:1,tool:'edit',status:'error',code:'FS_NOT_OBSERVED',certainty:'confirmed'}],
    occupancy:{names:['edit'],actions:[[3,2,1,1,0,1,700,1000,4,0,1,3000]]}}
]};}

test('window filtering joins the exact recorded call and retains missing evidence separately',()=>{
  const data=fixture(),all=diagnosisWorkspace(data,{preset:'cordis'});
  const guarded=all.groups.find(g=>g.code==='FS_NOT_OBSERVED');
  const filtered=diagnosisWorkspace(data,{preset:'cordis',focus:guarded.key,windowFrom:50,windowTo:100});
  assert.equal(filtered.selection.total,1);
  assert.equal(filtered.selection.records[0].session,'b','the same seq in another session has its own occupancy');
  assert.equal(filtered.selection.records[0].contextWindow.ratio,70);
  assert.equal(all.groups.find(g=>g.kind==='unclassified').count,1,'missing occupancy is not zero or silently discarded');
  assert.equal(diagnosisWorkspace(data,{preset:'cordis',focus:'all',windowFrom:0,windowTo:5}).selection.total,0);
});

test('the histogram keeps its reference population while the selected range filters clues and records',()=>{
  const data=fixture(),initial=diagnosisWorkspace(data,{preset:'cordis',model:'0'}),focus=initial.groups.find(g=>g.code==='FS_NOT_OBSERVED').key;
  const selected=diagnosisWorkspace(data,{preset:'cordis',model:'0',focus,windowFrom:50,windowTo:100});
  assert.equal(selected.selection.key,focus);
  assert.equal(selected.selection.total,0);
  assert.equal(selected.groups.find(g=>g.key===focus).count,0,'the matrix keeps the unselected reference row');
  assert.deepEqual(selected.groups.map(g=>g.key),initial.groups.map(g=>g.key),'brushing does not reorder the reference rows');
  assert.equal(selected.groups.find(g=>g.key===focus).window.bins[4],2);
  assert.equal(selected.groups.find(g=>g.key===focus).window.selected[4],0);
  assert.equal(selected.histogram.reduce((sum,b)=>sum+b.count,0),4);
  assert.equal(selected.histogram[4].selected,2,'the selected clue stays visible at its recorded location');
});

test('related requests are deduplicated and comparisons never mix other tools or models',()=>{
  const data=fixture(),tool=diagnosisWorkspace(data,{preset:'cordis',model:'0'}),focus=tool.groups.find(g=>g.code==='FS_NOT_OBSERVED').key;
  const requests=diagnosisWorkspace(data,{preset:'cordis',model:'0',focus,metric:'ttft'});
  assert.equal(requests.selection.total,2,'the two actual feedback records remain selected');
  assert.equal(requests.selection.metric.n,1,'one request shared by two calls is one timing sample');
  const comparison=diagnosisWorkspace(data,{preset:'cordis',model:'0',focus,metric:'elapsed'}).comparisons[0];
  assert.equal(comparison.tool,'edit');assert.equal(comparison.model,0);
  assert.equal(comparison.baseline.n,1);assert.equal(comparison.baseline.value,100);
});

test('a 100 percent reading is included while outside-capacity readings remain unclassified',()=>{
  const data=fixture();data.sessions[0].occupancy.actions.push([20,2,1,1,0,2,1000,1000,null,0,0,null],[21,2,1,1,0,0,1050,1000,22,0,0,100]);
  const view=diagnosisWorkspace(data,{preset:'cordis',focus:'all',windowFrom:95,windowTo:100,metric:'errors'});
  assert.equal(view.selection.total,1);assert.equal(view.selection.records[0].seq,20);
  assert.equal(view.selection.metric.value,null,'an unknown result is not a successful return');
  assert.equal(view.summary.mismatch,1);
});

test('the draft carries the same window selection and exact request locations',()=>{
  const view=diagnosisWorkspace(fixture(),{preset:'cordis',metric:'ttft',focus:'all',windowFrom:0,windowTo:30});
  const draft=buildDiagnosisDraft({group:view.selection.group,preset:'cordis',sources:view.selection.sources});
  assert.match(draft,/窗口范围：0–30%/);
  assert.match(draft,/请求 #2/);assert.match(draft,/"session":"a"/);assert.doesNotMatch(draft,/"session":"b"/);
  assert.match(draft,/"view":"context"/);assert.doesNotMatch(draft,/工具状态 undefined/);
  const compared=buildDiagnosisDraft({group:{...view.selection.group,contextSelection:{...view.selection.group.contextSelection,unit:'ms',comparisonBasis:'同模型的其余记录',comparisonRows:view.comparisons}},preset:'cordis',sources:view.selection.sources});
  assert.match(compared,/对照范围：同模型的其余记录/);assert.match(compared,/对照 未记录，n=0/);
});

test('the disposition matrix remains the primary surface and escapes session labels',()=>{
  const data=fixture();data.sessions[0].title='<script>title</script>';
  const result=diagnosisWorkspace(data,{preset:'cordis',model:'0'}),html=renderDiagnosisWorkspace(result,{});
  assert.match(html,/四类诊断处置矩阵/);assert.equal((html.match(/class="disposition-direction-head"/g)??[]).length,4);
  assert.match(html,/data-investigation-detail="window" >/);assert.doesNotMatch(html,/dw-workspace|dw-clues|diagnosis-scope/);
  assert.doesNotMatch(html,/<h2>诊断<\/h2>|diagnosis-chart-toolbar|diagnosis-chart-heading/,'chart controls have one compact header');
  assert.match(html,/disposition-cell-plot/);assert.match(html,/observation-window-plot/);
  assert.doesNotMatch(html,/disposition-observation-axis|frequency-track/);
  assert.doesNotMatch(html,/数量对比|dw-comparison|dw-curve|dw-window-svg/,'the old charts are not embedded in a popup');
  const heatmap=renderDiagnosisWorkspace(result,{observation:'sessions'});
  assert.doesNotMatch(heatmap,/<script>title/);assert.match(heatmap,/&lt;script&gt;title&lt;\/script&gt;/);
});

test('window filtering updates matrix cells and keeps long calls in their own feedback mode',()=>{
  const data=fixture();
  data.sessions[1].findingCalls.push({seq:22,result:23,turn:1,tool:'edit',status:'returned',durationMs:60000});
  data.sessions[1].occupancy.actions.push([22,2,1,1,0,0,700,1000,23,0,1,60000]);
  const result=diagnosisWorkspace(data,{preset:'cordis',windowFrom:50,windowTo:100,focus:'all'});
  const group=result.groups.find(g=>g.code==='FS_NOT_OBSERVED');
  assert.equal(group.count,1);assert.equal(group.baseCount,3);
  assert.equal(group.window.bins.reduce((sum,count)=>sum+count,0),3);
  assert.equal(group.window.selected.reduce((sum,count)=>sum+count,0),1);
  assert.deepEqual(group.cells.map(cell=>cell.count),[0,1]);
  assert.equal(group.cells.reduce((sum,cell)=>sum+cell.count,0),group.count);
  assert.ok(result.groups.every(g=>g.kind!=='wait'));
  const waits=diagnosisWorkspace(data,{preset:'cordis',windowFrom:50,windowTo:100,mode:'wait'});
  assert.equal(waits.groups.length,1);assert.equal(waits.groups[0].kind,'wait');
  assert.equal(waits.selection.records[0].seq,22);
});

test('out-of-range feedback remains visible but cannot be diagnosed as an empty selection',()=>{
  const result=diagnosisWorkspace(fixture(),{preset:'cordis',windowFrom:30,windowTo:50,focus:'all'});
  const html=renderDiagnosisWorkspace(result,{});
  assert.equal(result.matrix.records,0);assert.equal(result.matrix.totalRecords,4);
  assert.match(html,/outside-window/);assert.match(html,/data-window-count="0" data-window-total="3"/);
  assert.match(html,/data-direction="repair" disabled/);assert.match(html,/1 条未记录/);
  const missing=result.groups.find(group=>group.kind==='unclassified');
  assert.equal(missing.window.missing,1);assert.equal(missing.window.measured,0);assert.equal(missing.window.min,null);
});

test('changing the observed metric preserves the exact call-window selection',()=>{
  const data=fixture(),options={preset:'cordis',focus:'all',windowFrom:50,windowTo:100};
  const elapsed=diagnosisWorkspace(data,{...options,metric:'elapsed'}),ttft=diagnosisWorkspace(data,{...options,metric:'ttft'});
  assert.deepEqual(ttft.selection.records.map(row=>[row.session,row.seq]),elapsed.selection.records.map(row=>[row.session,row.seq]));
  assert.equal(ttft.selection.total,3);assert.equal(ttft.selection.metric.n,2,'two calls linked to one request count once');
  const call=ttft.selection.records.find(row=>row.session==='a'&&row.seq===7);
  assert.equal(call.contextWindow.ratio,60);assert.equal(call.requestRecord.contextWindow.ratio,20);
  assert.equal(ttft.groups.find(group=>group.code==='FS_NOT_OBSERVED').count,1);
});

test('the main-chart observation uses exact per-group samples and a full-range reference',()=>{
  const data=fixture(),elapsed=diagnosisWorkspace(data,{preset:'cordis',metric:'elapsed',windowFrom:50,windowTo:100}),group=elapsed.groups.find(row=>row.code==='FS_NOT_OBSERVED');
  assert.deepEqual(group.observation.selected,{value:3000,n:1});assert.deepEqual(group.observation.all,{value:3000,n:3});
  const requests=diagnosisWorkspace(data,{preset:'cordis',model:'0',metric:'ttft'}).groups.find(row=>row.code==='FS_NOT_OBSERVED');
  assert.deepEqual(requests.observation.selected,{value:100,n:1});
  const missing=elapsed.groups.find(row=>row.kind==='unclassified');assert.deepEqual(missing.observation.all,{value:null,n:0});
  const html=renderDiagnosisWorkspace(elapsed,{observation:'elapsed'});
  assert.match(html,/data-observation="elapsed"/);assert.match(html,/3 秒/);assert.doesNotMatch(html,/dw-curve/);
});

test('a heatmap cell prepares only the chosen session with the same window constraints',()=>{
  const initial=diagnosisWorkspace(fixture(),{preset:'cordis'}),group=initial.groups.find(g=>g.code==='FS_NOT_OBSERVED');
  const selected=diagnosisWorkspace(fixture(),{preset:'cordis',focus:group.key,focusSession:'b',windowFrom:50,windowTo:100});
  assert.equal(selected.selection.total,1);assert.equal(selected.selection.group.sessions,1);
  assert.deepEqual(selected.selection.sources.map(source=>source.session),['b']);
  assert.equal(selected.selection.group.entries[0].contextWindow.ratio,70);
});
