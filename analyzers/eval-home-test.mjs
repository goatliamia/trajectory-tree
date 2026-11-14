import test from 'node:test';
import assert from 'node:assert/strict';
import {tileLayout} from '../docs/demo/preset-context/treemap.js';
import {instructionSummary,composition,compositionGroups} from '../docs/demo/preset-context/home-overview.js';

test('treemap preserves measured areas without merging or inflating small categories',()=>{
  for(const weights of [[83,69,9.6,7.4,.91],[1],[0,0],[7,2,1]]){
    const total=weights.reduce((a,b)=>a+b,0),cells=tileLayout(weights.map((weight,id)=>({id,weight})),1000,280);
    assert.equal(cells.length,weights.filter(w=>w>0).length);
    for(const c of cells){
      assert.ok(Math.abs(c.w*c.h/(1000*280)-c.weight/total)<1e-8);
      assert.ok(c.x>=-1e-8&&c.y>=-1e-8&&c.x+c.w<=1000+1e-8&&c.y+c.h<=280+1e-8);
      for(const d of cells)if(d.id!==c.id)assert.ok(Math.min(c.x+c.w,d.x+d.w)-Math.max(c.x,d.x)<1e-8||Math.min(c.y+c.h,d.y+d.h)-Math.max(c.y,d.y)<1e-8);
    }
  }
});
test('instruction summary separates shared files from workspace-specific sources',()=>{
  const p={scopeAllWorkspaces:true,instructions:[{scope:'个人指令',workspaceIds:['a','b']},{scope:'项目指令',workspaceIds:['a']},{scope:'项目指令',workspaceIds:['a']},{scope:'项目指令',workspaceIds:['b']}]};
  const s=instructionSummary(p);assert.equal(s.personal.length,1);assert.equal(s.project.length,3);assert.equal(s.workspaces,2);
});
test('unknown and zero-size content remain labeled outside the measured area',()=>{
  const p={tools:[{measuredTokens:100,provenance:{origin:'official'}}],system:[{measuredTokens:null,provenance:{origin:'official'}}],skills:[{measuredTokens:0,provenance:{origin:'personal'}}],statistics:{total:100,categories:[{id:'tools',label:'工具定义'},{id:'system',label:'系统提示'},{id:'skills',label:'Skill 目录'}]}};
  const html=composition(p,{tools:{color:'tools'},system:{color:'system'},skills:{color:'skill'}});
  assert.equal((html.match(/class="home-composition-tile"/g)??[]).length,1);assert.match(html,/系统提示/);assert.match(html,/1 项待组装/);assert.match(html,/Skill 目录/);
});

test('composition separates ownership within one content category and keeps the token total',()=>{
  const row=(origin,measuredTokens)=>({provenance:{origin},measuredTokens});
  const p={tools:[row('official',80),row('plugin',20)],skills:[{variants:[row('official',5),row('personal',15)]}],statistics:{categories:[{id:'tools',label:'工具定义'},{id:'skills',label:'Skill 目录'}]}};
  const groups=compositionGroups(p),by=id=>groups.find(g=>g.id===id);
  assert.equal(by('official').tokens,85);assert.equal(by('personal').tokens,15);assert.equal(by('plugin').tokens,20);
  assert.equal(groups.reduce((sum,g)=>sum+g.tokens,0),120);
  const html=composition(p,{});assert.match(html,/data-origin="official" data-composition-key="official:tools"/);assert.match(html,/data-origin="plugin" data-composition-key="plugin:tools"/);
});
