import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scanContributions } from '../scripts/preset-source-inventory.mjs';
import { attachCurrentUsage, summarizeCurrentPreset } from './preset-statistics.mjs';

const local=createRequire(import.meta.url),sdk=createRequire(local.resolve('@deepseek-ai/dsh/package.json')),{parse}=sdk('acorn');
const scan=code=>scanContributions(code,{package:'example-plugin'},parse).rows;
const empty=()=>({id:'current',tools:[],skills:[],system:[],instructions:[],injections:[]});
const estimators={estimate:text=>text.length,estimateTool:tool=>tool.description.length+JSON.stringify(tool.parameters).length,parametersToSchema:parameters=>parameters};

test('tool volume reads only its model-facing declaration, never its executor or returned text',()=>{
  const declaration=tail=>`const description = 'A small tool'; const parameters = {type:'object',properties:{}}; ctx.tools.register({name:'tool',description,parameters,execute:async()=>{${tail}}});`;
  const left=scan(declaration(`return 'short'`))[0],right=scan(declaration(`process.exit(2); return '${'very long tool result'.repeat(100)}'`))[0];
  const measure=row=>summarizeCurrentPreset({...empty(),tools:[row]},null,estimators).total;
  assert.equal(measure(left),measure(right));assert.equal(left.staticComplete,true);
  assert.deepEqual(left.staticParameters,{type:'object',properties:{}});
});

test('literal declarations respect lexical shadowing and leave runtime functions unknown',()=>{
  const rows=scan(`const description='outer';
    { const description='inner'; ctx.tools.register({name:'inner',description,parameters:{}}); }
    function install(description) {ctx.tools.register({name:'shadow',description,parameters:{}});}
    ctx.tools.register({name:'dynamic',description:readFromRuntime(),parameters:readSchema()});
    {ctx.tools.register({name:'tdz',description,parameters:{}}); const description='later';}`);
  assert.equal(rows.find(row=>row.name==='inner').description,'inner');
  for(const name of ['shadow','dynamic','tdz'])assert.equal(rows.find(row=>row.name===name).description,null);
  assert.equal(rows.find(row=>row.name==='dynamic').staticParameters,null);
});

test('static configuration defaults and template fields are read without executing plugin setup',()=>{
  const code="const Config={limit:Schema.number().default(3)}; const prefix='Find'; ctx.tools.register({name:'lookup',description:()=>`${prefix} up to ${config.limit} items`,parameters:{}});";
  assert.equal(scan(code)[0].description,'Find up to 3 items');
  assert.equal(scanContributions(code,{package:'example'},parse,{config:{limit:7}}).rows[0].description,'Find up to 7 items');
});

test('current composition counts catalogue descriptions, not every Skill body or historical version',()=>{
  const preset={...empty(),system:[{name:'system',staticText:'text',package:'p'}],tools:[{name:'dynamic',staticParameters:null,description:null,package:'p'}],
    skills:[{name:'one',catalogTokens:10,bodyTokens:800,package:'p'}],instructions:[{tokens:6,bytes:40,omitted:true,package:'p'}],injections:[{name:'event',staticText:null,package:'q'}]};
  const stats=summarizeCurrentPreset(preset,null,estimators);
  assert.equal(stats.total,20);assert.equal(stats.skillBodies,800);assert.equal(stats.pending,2);
  assert.equal(stats.categories.find(row=>row.id==='tools').tokens,null);
  assert.equal(stats.categories.find(row=>row.id==='instructions').tokens,6); // current file size, with budget condition separate
  assert.equal(stats.instructions.truncated,1);
  assert.equal(stats.categories.reduce((n,row)=>n+(row.share??0),0),1);
  assert.equal(stats.plugins.reduce((n,row)=>n+row.tokens,0),stats.total);
  assert.equal(stats.plugins.find(row=>row.name==='q').tokens,null);
});

test('fragments inside a dynamic prompt are inspectable but do not count as a fully known prompt',()=>{
  const preset={...empty(),system:[{name:'conditional',kind:'section',staticText:null,body:'one possible branch'}]};
  const stats=summarizeCurrentPreset(preset,null,estimators);
  assert.equal(stats.total,0);assert.equal(stats.pending,1);assert.equal(stats.categories[0].tokens,null);
});

test('usage joins only current names within the selected mode and latest session limit',()=>{
  const preset={...empty(),tools:[{name:'live'}],skills:[{name:'catalog'}]};
  const sessions=[
    {id:'latest',preset:'current',createdAt:3,lastAt:4,tools:[{name:'live',requests:1,calls:2},{name:'removed',requests:1,calls:999}],skills:[{name:'catalog',catalogs:1,loads:0}]},
    {id:'old',preset:'current',createdAt:1,lastAt:2,tools:[{name:'live',requests:1,calls:100}],skills:[]},
    {id:'other',preset:'other-mode',createdAt:5,lastAt:6,tools:[{name:'live',requests:1,calls:999}],skills:[]},
  ];
  const range=attachCurrentUsage(preset,{sessions,generatedAt:10},1);
  assert.equal(preset.tools[0].usage.count,2);assert.equal(preset.tools[0].usage.sessions,1);
  assert.equal(preset.tools[0].usage.lastUsedSessionAt,4);assert.equal(preset.tools.length,1);
  assert.deepEqual(range,{sessions:1,limit:1,asOf:10,from:3,to:4});
});

test('unused needs repeated visibility; absent declarations such as PTC are not zero-use evidence',()=>{
  const preset={...empty(),tools:[{name:'idle'},{name:'ptc'},{name:'new'}],skills:[{name:'used'}]};
  const sessions=Array.from({length:4},(_,i)=>({id:String(i),preset:'current',createdAt:i,lastAt:i,
    tools:[{name:'idle',requests:1,calls:0},{name:'ptc',requests:0,calls:0}],skills:[{name:'used',catalogs:1,loads:i===0?1:0}]}));
  const stats=summarizeCurrentPreset(preset,{sessions},estimators);
  assert.equal(stats.tools.unused,1);assert.equal(preset.tools[0].usage.unusedCandidate,true);
  assert.equal(preset.tools[1].usage.unusedCandidate,false);assert.equal(preset.tools[2].usage.unobserved,true);
  assert.equal(stats.skills.unused,0);assert.equal(stats.skills.used,1);
});
