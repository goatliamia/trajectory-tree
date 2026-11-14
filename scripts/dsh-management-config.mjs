// The standalone preview edits DSH's native configuration. It never constructs
// a pretend live PluginManager or claims that saving a file applied a teardown.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readDshBundles, sourceForModule } from './read-dsh-bundles.mjs';
import { flattenConfiguredRows, configuredContribution } from '../analyzers/preset-current.mjs';
import { scanContributions } from './preset-source-inventory.mjs';
import { POLICY_MODULE, POLICY_ID } from '../plugin/analysis-view/lib/skill-policy.js';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export async function textFile(file) { try { return await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
export async function loadManagementSdk(anchor) {
  const local = createRequire(import.meta.url);
  anchor ??= local.resolve('@deepseek-ai/dsh/package.json');
  const sdk = createRequire(anchor), load = name => import(pathToFileURL(sdk.resolve(name)).href);
  const [boot, manager, operations, atomic, include] = await Promise.all([
    load('@deepseek-ai/dsh-app-boot'), load('@deepseek-ai/dsh-plugin-manager'),
    load('@deepseek-ai/dsh-plugin-manager/operations'), load('@deepseek-ai/dsh-atomic-write'),load('@deepseek-ai/cordis-plugin-include'),
  ]);
  return { anchor, sdk, boot, manager, operations, atomic, include, nativeYaml:sdk('js-yaml'), yaml:sdk('yaml'), parse:sdk('acorn').parse };
}

export async function readComposition(api, {home, profileRoot}) {
  const manifestFile=join(profileRoot,'package.json'), patchFile=join(profileRoot,'cordis.patch.yml');
  const manifest=JSON.parse(await readFile(manifestFile,'utf8')), layers=[], files=[manifestFile,patchFile,join(home,'cordis.patch.yml'),api.anchor];
  for (const name of manifest.dsh?.profile?.bundles??[]) {
    const dir=api.boot.resolveBundleDir('dsh',name,api.anchor,profileRoot);
    const meta=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
    const paths=api.boot.bundlePatchPaths(dir,meta.dsh.bundle);files.push(join(dir,'package.json'),...paths);
    layers.push(paths.flatMap(file=>api.boot.loadOverlayPatches('dsh',file)));
  }
  const bundleLayers=[...layers];
  if(await textFile(patchFile)!==null)layers.push(api.boot.loadOverlayPatches('dsh',patchFile));
  const profileEntries=api.boot.composeEntries(layers);
  const homePatches=await textFile(join(home,'cordis.patch.yml'))===null?[]:api.boot.loadOverlayPatches('dsh',join(home,'cordis.patch.yml'));
  layers.push(homePatches);
  const entries=api.boot.composeEntries(layers), fingerprint=hash(await Promise.all([...new Set(files)].sort().map(async file=>[file,await realpath(file).catch(()=>null),await textFile(file)])));
  const bundles=readDshBundles(api.manager.PluginManager,{profileRoot,installAnchor:api.anchor});
  return {manifest,manifestFile,patchFile,entries,profileEntries,bundles,fingerprint,bundleLayers,homePatches};
}
export function allEntries(rows) { return rows.flatMap(row=>[row,...(row.group&&Array.isArray(row.config)?allEntries(row.config):[])]); }
const toolFlags={
  '@deepseek-ai/dsh-tool-fs':{read:'read',read_image:'readImage',write:'write',edit:'edit',apply_patch:'applyPatch'},
  '@deepseek-ai/dsh-tool-web':{web_search:'search',web_fetch:'fetch'},
};
export async function configurationTargets(api, config, profileRoot, preset) {
  const presetRow=allEntries(config.entries).find(r=>r.name==='@deepseek-ai/dsh-agent-preset'&&r.config?.id===preset);
  if(!presetRow)throw new Error('预设已变化，请刷新配置');
  const env={platform:process.platform,profile:true};
  const host=flattenConfiguredRows(config.entries,'host',env), own=flattenConfiguredRows(presetRow.config.plugins??[],'preset',env);
  const ownNames=new Set(own.map(r=>r.name)), rows=[...host.filter(r=>!ownNames.has(r.name)),...own];
  const profileRequire=createRequire(join(profileRoot,'package.json')), targets=[];
  for(const row of rows){
    let file;for(const require of [profileRequire,api.sdk]){try{file=require.resolve(row.name);break;}catch{}}
    if(!file)continue;
    const source=await readFile(file,'utf8');
    const found=scanContributions(source,{file,package:row.name},api.parse,{config:row.config??{}}).rows.filter(r=>r.kind==='tool');
    // These official modules register factory results / locally repeated `tool`
    // variables. Their names are checked against the installed source, not guessed.
    const factoryNames={'@deepseek-ai/dsh-tool-pwsh':['pwsh'],'@deepseek-ai/dsh-tool-fs-search':['glob','grep']};
    for(const name of factoryNames[row.name]??[])if(source.includes(`name: "${name}"`)||source.includes(`name: '${name}'`))found.push({name,kind:'tool'});
    const tools=[...new Map(found.map(t=>[t.name,t])).values()];
    const provenance=sourceForModule(row.name,config.bundles,row.scope==='preset'?presetRow.id:undefined);
    for(const tool of tools){
      const flag=toolFlags[row.name]?.[tool.name];
      const enabled=configuredContribution(tool,row)&&!(row.name==='@deepseek-ai/dsh-tool-web'&&tool.name==='web_search'&&row.config?.search===false);
      const parent=row.scope==='preset'?presetRow:null;
      const basis=parent?allEntries(config.profileEntries).find(r=>r.id===parent.id):allEntries(config.profileEntries).find(r=>r.id===row.id);
      const protectedRow=tool.name==='run_code'||/dsh-(?:plugin-manager|client-ui-plugin-manager|analysis-view|trajectory-tools)(?:\/|$)/.test(row.name);
      targets.push({id:hash(['tool',preset,row.scope,row.id,tool.name]),kind:'tool',name:tool.name,enabled,
        source:row.name,origin:provenance.origin,bundle:provenance.bundle,
        scope:parent?`${preset} 预设`:'web 配置下的所有预设',
        affected:flag?[tool.name]:tools.map(t=>t.name),
        method:flag?'DSH 工具配置':'DSH 提供插件开关',
        reason:protectedRow?'保留管理入口与执行通道':row.status==='conditional'?'动态配置，请在 DSH 中管理':flag&&row.status==='disabled'?'提供插件已停用，请先在 DSH 中启用提供插件':!basis?'配置来自更高优先级覆盖，请在原配置中修改':null,
        _row:row,_parent:parent,_basis:basis,_flag:flag});
    }
  }
  for(const bundle of config.bundles.filter(b=>b.installed||b.enabled))targets.push({
    id:hash(['bundle',bundle.name]),kind:'bundle',name:bundle.meta?.name?.zh??bundle.name,
    source:bundle.name,origin:bundle.official||bundle.availability==='installation'?'official':'plugin',enabled:bundle.enabled,
    scope:'web 配置下的所有预设',affected:bundle.rows.map(r=>r.moduleName),method:'DSH 插件包选择',
    reason:bundle.name==='dsh-analysis-view'?'请从 DSH 插件管理停用轨迹树':bundle.readOnlyReason==='management-required'?'DSH 管理所需插件，不能停用':bundle.error?'插件清单无法完整读取，请在 DSH 中管理':null,_bundle:bundle,
  });
  return targets;
}

// Preserve !!js as inert YAML scalars. No plugin expressions execute here.
export function yamlNode(document, value, yaml) {
  if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.__jsExpr==='string'){
    const node=new yaml.Scalar(value.__jsExpr);node.tag='tag:yaml.org,2002:js';return node;
  }
  const node=document.createNode(value);
  if(Array.isArray(value))node.items=value.map(v=>yamlNode(document,v,yaml));
  else if(value&&typeof value==='object')for(const pair of node.items)pair.value=yamlNode(document,value[pair.key.value],yaml);
  return node;
}
export function parsePatch(text, yaml) {
  // Match dsh-config-editor: the editable YAML tree keeps expression scalars as
  // strings. The official Include schema decodes them for Cordis composition.
  const doc=yaml.parseDocument(text??'[]\n',{customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>value}]});
  if(doc.errors.length||!yaml.isSeq(doc.contents))throw new Error('DSH 配置无法安全编辑，请先修复配置文件');
  return doc;
}
export function toolPatch(api, config, target, enabled) {
  const row=target._row,parent=target._parent,basis=target._basis;
  const replacement=structuredClone(basis);
  const edited=parent?allEntries(replacement.config.plugins).find(r=>r.id===row.id&&r.name===row.name):replacement;
  if(!edited)throw new Error('工具配置位置已变化，请刷新');
  // Home/launch overlays may replace the complete config; do not make a dormant edit.
  if(hash(parent?.config??row.config??{})!==hash(basis.config??{}))throw new Error('此项被全局覆盖配置接管，请在 DSH 原配置中修改');
  if(target._flag){edited.config={...edited.config,[target._flag]:enabled};if(enabled&&row.status==='disabled')throw new Error('提供插件已停用，请先启用提供插件');}
  else edited.disabled=!enabled;
  return parent?{id:parent.id,name:parent.name,config:replacement.config}:
    target._flag?{id:row.id,name:row.name,config:edited.config}:{id:row.id,name:row.name,disabled:!enabled};
}

export function toolEnabledIn(entries,target){
  const env={platform:process.platform,profile:true},parent=target._parent;
  const root=parent?allEntries(entries).find(r=>r.id===parent.id)?.config?.plugins??[]:entries;
  const row=flattenConfiguredRows(root,parent?'preset':'host',env).find(r=>r.id===target._row.id&&r.name===target._row.name);
  return !!row&&configuredContribution({kind:'tool',name:target.name},row)&&!(row.name==='@deepseek-ai/dsh-tool-web'&&target.name==='web_search'&&row.config?.search===false);
}

export function presetSkillPatch(config,preset,skill,enabled){
  const current=allEntries(config.entries).find(r=>r.name==='@deepseek-ai/dsh-agent-preset'&&r.config?.id===preset);
  const basis=current&&allEntries(config.profileEntries).find(r=>r.id===current.id&&r.name===current.name);
  if(!basis||hash(current.config)!==hash(basis.config))throw new Error('此预设由更高优先级配置接管，请在原配置中修改');
  const next=structuredClone(basis.config),rows=next.plugins;
  if(!Array.isArray(rows))throw new Error('预设插件配置不是可编辑列表');
  const at=rows.findIndex(r=>r.id===POLICY_ID||r.name===POLICY_MODULE);
  const old=at<0?null:rows[at];
  if(old&&(old.name!==POLICY_MODULE||old.disabled===true||!Array.isArray(old.config?.disabled)))throw new Error('此预设的 Skill 策略需先核对');
  const disabled=(old?.config.disabled??[]).filter(s=>(typeof s==='string'?s:s.name)!==skill.name);
  if(!enabled)disabled.push({name:skill.name,description:skill.description||'Disabled in this preset.'});
  if(disabled.length){const policy={id:POLICY_ID,name:POLICY_MODULE,config:{disabled}};if(at<0)rows.push(policy);else rows[at]=policy;}
  else if(at>=0)rows.splice(at,1);
  return {id:current.id,name:current.name,config:next};
}

export function applyOwnedPatch(api,config,before,patch){
  const document=parsePatch(before,api.yaml),marker='trajectory-tree: capability controls';
  const existing=document.contents.items.findLastIndex(n=>api.yaml.isMap(n)&&n.commentBefore?.includes(marker)&&n.get('id')===patch.id);
  const node=yamlNode(document,patch,api.yaml);node.commentBefore=marker;
  if(existing<0)document.add(node);else document.contents.items[existing]=node;
  const after=String(document),patches=api.nativeYaml.load(after,{schema:api.include.entryListSchema});
  const entries=api.boot.composeEntries([...config.bundleLayers,patches,config.homePatches]);
  return {after,entries};
}
