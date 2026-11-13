import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { staticReader, STATIC_UNKNOWN } from '../analyzers/static-declaration.mjs';

function visit(node, fn, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (node.type) fn(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(child => visit(child, fn, node));
    else if (value && typeof value === 'object') visit(value, fn, node);
  }
}
const property = (object, key) => object?.type === 'ObjectExpression' ? object.properties.find(p => p.type === 'Property' && (p.key.name ?? p.key.value) === key)?.value : undefined;
const string = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null;
function literalStrings(node) { const values=[]; visit(node, n => { const value=string(n); if(value && value.length>=35 && value.length<20000)values.push(value); }); return [...new Set(values)]; }

// Read source syntax only. Do not activate plugins or evaluate their providers.
export function scanContributions(code, metadata, parse, options = {}) {
  let ast; try { ast = parse(code, { ecmaVersion:'latest', sourceType:'module', locations:true }); } catch { return { rows: [], parsed:false }; }
  const constants = new Map();
  visit(ast,node=>{if(node.type==='VariableDeclarator'&&node.id.type==='Identifier') {if(constants.has(node.id.name))constants.set(node.id.name,null);else constants.set(node.id.name,node.init);}});
  const resolve = node => node?.type === 'Identifier' ? constants.get(node.name) : node;
  const parents=new WeakMap();visit(ast,(node,parent)=>{if(parent)parents.set(node,parent);});
  const readStatic=staticReader(ast,parents,visit,options);
  const modelFacing=node=>{for(let i=0;i<5&&node;i++,node=parents.get(node)){
    if(node.type==='ObjectExpression'&&['user','system','developer'].includes(string(property(node,'role'))))return true;
    if(node.type==='CallExpression'){
      const name=node.callee.type==='Identifier'?node.callee.name:node.callee.type==='MemberExpression'?node.callee.property.name:'';
      if(['createUserMessage','createSystemMessage','createDeveloperMessage','inject','steer','followup','send'].includes(name))return true;
      if(name==='append'&&['user/message','system/message','developer/message'].includes(string(node.arguments[0])))return true;
    }
  }return false;};
  const rows=[];
  visit(ast,node=>{
    if(node.type==='Property'&&(node.key.name??node.key.value)==='source'){
      const object=resolve(node.value), id=string(resolve(property(object,'kind')));
      if(id&&!['user','model','tool','system-prompt'].includes(id))rows.push({...metadata,kind:'producer',name:id,line:node.loc.start.line,fragments:[],modelFacing:modelFacing(node),code:code.slice(node.start,Math.min(node.end,node.start+900)),basis:'installed-source-producer'});
    }
    if(node.type!=='CallExpression')return;
    const callee=node.callee, member=callee.type==='MemberExpression'?callee.property.name:null;
    const receiver=callee.type==='MemberExpression'?code.slice(callee.object.start,callee.object.end):'';
    let kind;
    if(member==='register'&&/(?:^|\.)tools$/.test(receiver))kind='tool';
    else if(['section','context'].includes(member)&&(/(?:^|\.)systemPrompt$/.test(receiver)||receiver==='this'&&metadata.package==='@deepseek-ai/dsh-system-prompt'))kind=member;
    if(!kind)return;
    let object=resolve(node.arguments[0]);
    const spec=object?.type==='CallExpression'&&object.callee.type==='Identifier'&&object.callee.name==='defineTool';
    if(spec)object=resolve(object.arguments[0]);
    const name=string(resolve(property(object,'name')));if(!name)return;
    const description=readStatic(property(object,'description')),parameters=readStatic(property(object,'parameters')),text=readStatic(property(object,'text'));
    rows.push({...metadata,kind,name,line:node.loc.start.line,description:typeof description==='string'?description:null,
      ...(kind==='tool'?{staticParameters:parameters===STATIC_UNKNOWN?null:parameters,parametersKind:spec?'spec':'schema',staticComplete:typeof description==='string'&&parameters!==STATIC_UNKNOWN}:{}),
      ...(kind!=='tool'?{staticText:typeof text==='string'?text:null}:{}),
      fragments:kind==='tool'?[]:literalStrings(property(object,'text')),
      code:code.slice(node.start,Math.min(node.end,node.start+1200)),basis:'installed-source-registration'});
  });
  return {rows,parsed:true};
}

export function buildSourceInventory({ dshRoot, profileRoot }) {
  const require = createRequire(join(dshRoot,'package.json')), {parse}=require('acorn');
  const roots = new Set(), failures=[];
  const official=join(dshRoot,'node_modules','@deepseek-ai');
  for(const item of readdirSync(official,{withFileTypes:true}))if(item.isDirectory()||item.isSymbolicLink())roots.add(join(official,item.name));
  const profile=JSON.parse(readFileSync(join(profileRoot,'package.json'),'utf8'));
  for(const name of Object.keys(profile.dependencies??{}))roots.add(join(profileRoot,'node_modules',name));
  const packages=[],seen=new Set(),contributions=[];
  for(const entry of roots){
    let root,manifest;
    try{root=realpathSync(entry);if(seen.has(root))continue;seen.add(root);manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));}catch{continue;}
    const candidates=[manifest.main,'lib/index.js','index.js'].filter(Boolean).map(file=>join(root,file));
    const file=candidates.find(existsSync);if(!file)continue;
    const code=readFileSync(file,'utf8');if(!/systemPrompt\.(?:section|context)|tools\.register|source\s*:/.test(code))continue;
    const meta={package:manifest.name,version:manifest.version,file,relativeFile:relative(root,file)};
    const found=scanContributions(code,meta,parse);
    if(!found.parsed)failures.push({package:manifest.name,reason:'Source syntax not supported'});
    if(found.rows.length){packages.push({...meta,contributions:found.rows.length});contributions.push(...found.rows);}
  }
  return { packages, contributions, failures, basis:'Current installed source only; no runtime plugin activation and no historical version claim.' };
}

export function associateSource(item, inventory, fullText='') {
  const candidates=inventory.contributions;
  if(item.category==='tools'||item.kind==='tool'){
    const owners=candidates.filter(row=>row.kind==='tool'&&row.name===item.name);
    const matching=owners.filter(row=>row.description&&row.description===item.description);
    const chosen=matching.length?matching:owners;
    return { basis:matching.length?'name-and-description-match':'registered-name-match', historicalOwnerConfirmed:false, candidates:chosen.map(row=>({package:row.package,version:row.version,file:row.file,line:row.line,name:row.name,kind:row.kind})), ambiguous:new Set(chosen.map(row=>row.package)).size>1 };
  }
  const names=new Set((item.sections??[]).map(section=>section.name));
  const matched=candidates.filter(row=>row.kind==='context'&&names.has(row.name)||row.kind==='section'&&row.fragments.some(text=>fullText.includes(text))||row.kind==='producer'&&item.producer!=='plugin'&&row.name===item.producer);
  return {basis:names.size?'recorded-section-name-match':'exact-source-fragment-match',historicalOwnerConfirmed:false,recordedPublisher:item.recordedPlugin??null,
    candidates:matched.map(row=>({package:row.package,version:row.version,file:row.file,line:row.line,name:row.name,kind:row.kind}))};
}
