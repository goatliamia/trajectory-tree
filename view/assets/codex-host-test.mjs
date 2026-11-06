import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ui } from '../../lib/i18n.mjs';

const calls = [[0,10],[20,30],[25,35]].map(([start,end],seq) => ({seq,start,end,durationMs:end-start,timingSource:'local-rollout',status:'returned',name:'run'}));
const context = vm.createContext({
  ui: text => ui(text,'en'),
  data:{evidence:{}}, session:{turns:[{number:1,steps:[{number:1,calls},{number:2,calls:[{seq:4,start:0,end:0,timingSource:'ordinal-only',status:'unknown',name:'run',durationMs:null}]}]}]},
  header(){}, geistRenderContextOverview(){}, reviewOpenStepDetail(){}, geistArrangeCaption(){}, reviewRenderStepSummary(){},
  geistStatsByStep:new Map(), document:{createElement:()=>({})},
});
vm.runInContext(readFileSync(new URL('./codex-host.js',import.meta.url),'utf8'),context);
assert.equal(context.geistStatsByStep.get('1:1').toolWall,25,'Coverage unions overlaps and excludes idle gaps');
assert.equal(context.geistStatsByStep.get('1:1').tool,30,'Native cumulative duration stays separate');
assert.equal(context.geistStatsByStep.get('1:2').toolWall,null);
assert.equal(context.geistStatsByStep.get('1:2').tool,null,'Unknown duration does not become zero');
assert.equal(context.geistStatsByStep.get('1:2').toolPending,1);
console.log('Codex host: interval union, cumulative duration and missing-timing semantics passed.');
