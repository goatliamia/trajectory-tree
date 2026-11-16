import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionBody,compositionModel} from '../docs/demo/preset-context/home-composition.js';
import {skillMapModel,renderSkillCatalog} from '../docs/demo/preset-context/skill-visuals.js';
import {toggleZoomFocus} from '../docs/demo/preset-context/zoom-treemap.js';
import {evalRoute,evalTabs} from '../docs/demo/preset-context/eval-navigation.js';

test('a second double-click returns to the exact view before entering the item',()=>{
  const before={x:230,y:140,k:1.4},focused={x:410,y:200,k:3.2};
  const entered=toggleZoomFocus([],'one',before,focused);
  const restored=toggleZoomFocus(entered.path,'one',{x:450,y:270,k:6.4},{x:0,y:0,k:12.8});
  assert.deepEqual(restored.camera,before,'panning or wheel zoom inside the item must not turn return into another zoom');
  assert.deepEqual(restored.path,[]);
  assert.deepEqual(before,{x:230,y:140,k:1.4});
});

test('a focused view returns even if the next double-click lands on another tile or empty space',()=>{
  const overview={x:400,y:220,k:1},focused={x:120,y:160,k:2},a=toggleZoomFocus([],'one',overview,focused);
  assert.deepEqual(toggleZoomFocus(a.path,'another',focused,{x:180,y:240,k:4}).camera,overview);
  assert.deepEqual(toggleZoomFocus(a.path,null,focused,focused).camera,overview);
});

test('window links land inside diagnosis and preserve the requested dimension',()=>{
  assert.deepEqual(Object.keys(evalTabs),['home','skills','diagnosis']);
  assert.deepEqual(evalRoute('window'),{tab:'diagnosis',diagnosisScope:'window'});
  assert.deepEqual(evalRoute('diagnosis','window'),{tab:'diagnosis',diagnosisScope:'window'});
  assert.deepEqual(evalRoute('diagnosis','context'),{tab:'diagnosis',diagnosisScope:'context'});
  assert.deepEqual(evalRoute('missing','missing'),{tab:'home',diagnosisScope:'records'});
});

test('context zoom preserves static area and previews only the Skill catalog',()=>{
  const preset={tools:[{name:'read',description:'Read a file',staticParameters:{type:'object'},measuredTokens:80,provenance:{origin:'official'}}],
    skills:[{name:'guide',description:'Choose a workflow',body:'BODY LOADED ONLY WHEN INVOKED',measuredTokens:20,provenance:{origin:'personal'}}],
    statistics:{categories:[{id:'tools',label:'工具定义'},{id:'skills',label:'Skill 目录'}]}};
  const scene=compositionModel(preset).layout(800,400),cells=scene.groups.flatMap(g=>g.cells);
  assert.equal(cells.length,2);
  for(const cell of cells)assert.ok(Math.abs(cell.w*cell.h/(800*400)-cell.tokens/100)<1e-8);
  const catalog=cells.find(c=>c.kind==='skills');
  assert.match(compositionBody(preset,catalog),/Choose a workflow/);
  assert.doesNotMatch(compositionBody(preset,catalog),/BODY LOADED/);
  assert.equal(JSON.parse(compositionBody(preset,cells.find(c=>c.kind==='tools'))).name,'read');
});

test('Skill Catalog is one separate tile and never contributes a body-read count',()=>{
  const skills=[{name:'one',description:'First',body:'First body',bodyTokens:100,catalogTokens:7},{name:'two',description:'Second',body:'Second body',bodyTokens:50,catalogTokens:3}];
  const model=skillMapModel(skills,new Map([['one',4],['two',2]])),catalog=model.items.filter(r=>r.catalog);
  assert.equal(catalog.length,1);assert.equal(catalog[0].weight,10);assert.equal(catalog[0].reads,null);
  assert.equal(model.total,160);assert.equal(model.totalReads,6);
  const scene=model.layout(900,350),directory=scene.groups.find(g=>g.id==='skill-directory'),bodies=scene.groups.find(g=>g.id==='skill-bodies');
  assert.equal(directory.cells.length,1);assert.equal(bodies.cells.length,2);
  assert.ok(directory.y+directory.h<bodies.y,'the directory stays above the body area');
  for(const cell of bodies.cells)assert.ok(Math.abs(cell.w*cell.h/(bodies.w*bodies.h)-cell.weight/150)<1e-8,'body area excludes the independent catalog');
  assert.match(model.getBody(catalog[0]),/First/);assert.match(model.getBody(catalog[0]),/Second/);assert.doesNotMatch(model.getBody(catalog[0]),/body/);
  const changed=skillMapModel(skills,new Map([['two',1]]));
  assert.deepEqual(changed.items.map(r=>[r.id,r.weight]),model.items.map(r=>[r.id,r.weight]),'usage changes colors, never token areas');
});

test('body reading filters preserve the catalog and complete detail entry',()=>{
  const skills=[{name:'read',description:'Used',bodyTokens:20,catalogTokens:3},{name:'unread',description:'Not used',bodyTokens:10,catalogTokens:2}];
  const model=skillMapModel(skills,new Map([['read',1]]),{skillActivity:'read'});
  assert.equal(model.items.find(r=>r.name==='read').dim,false);assert.equal(model.items.find(r=>r.name==='unread').dim,true);
  assert.ok(!model.items.find(r=>r.catalog).dim);
  const html=renderSkillCatalog([{name:'<script>name</script>',description:'<img src=x>',catalogTokens:5}]);
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
});
