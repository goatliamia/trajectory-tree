import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { scanContributions } from '../scripts/preset-source-inventory.mjs';
import { configuredEnablement, configuredPresets, flattenConfiguredRows, configuredContribution } from '../analyzers/preset-current.mjs';
import { contentHash } from '../analyzers/preset-context.mjs';
import { summarizeCurrentPreset } from '../analyzers/preset-statistics.mjs';
import { readDshBundles, sourceForModule } from '../scripts/read-dsh-bundles.mjs';
import { buildSkillManagement } from '../analyzers/preset-skill-management.mjs';
import { readConfiguredSkills } from './dsh-skill-catalog.mjs';
import { mergeWorkspaceConfigurations } from '../analyzers/workspace-presets.mjs';

export async function collectCurrentPreset({cwd=process.cwd(),history=null,...options}={}) {
  return (await createPresetCollector(options))(cwd,history);
}
export async function collectCurrentWorkspaces({workspaces,...options}) {
  const collect=await createPresetCollector(options),snapshots=[];
  for(const workspace of workspaces)snapshots.push({...await collect(workspace.path),workspace});
  return mergeWorkspaceConfigurations(snapshots);
}
async function createPresetCollector({home=join(homedir(),'.dsh'),profileRoot=join(home,'profiles','web'),anchor,overlays=[],profile='web'}={}) {
home=resolve(home);profileRoot=resolve(profileRoot);
anchor ??= createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
const sdk=createRequire(anchor);
const load=name=>import(pathToFileURL(sdk.resolve(name)).href);
const [boot,instructions,filesystem,meter,toolSchema,pluginManager]=await Promise.all([load('@deepseek-ai/dsh-app-boot'),load('@deepseek-ai/dsh-agent-instructions'),load('@deepseek-ai/dsh-skill-filesystem'),load('@deepseek-ai/dsh-token-meter/estimate'),load('@deepseek-ai/dsh-tools'),load('@deepseek-ai/dsh-plugin-manager')]);
const bundleInventory=readDshBundles(pluginManager.PluginManager,{profileRoot,installAnchor:anchor});
const {parse}=sdk('acorn'),profileManifest=JSON.parse(readFileSync(join(profileRoot,'package.json'),'utf8')),layers=[],issues=[],files=[];
for(const name of profileManifest.dsh?.profile?.bundles??[]){
  try { const root=boot.resolveBundleDir('context-preview',name,anchor,profileRoot),manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
    const paths=boot.bundlePatchPaths(root,manifest.dsh.bundle);files.push(...paths);layers.push(paths.flatMap(file=>boot.loadOverlayPatches('context-preview',file)));
  } catch(error){issues.push({package:name,message:error.message});}
}
for(const file of [join(profileRoot,'cordis.patch.yml'),join(home,'cordis.patch.yml')])if(existsSync(file)){files.push(file);layers.push(boot.loadOverlayPatches('context-preview',file));}
if(overlays.length)layers.push(overlays);
const entries=boot.composeEntries(layers,message=>issues.push({kind:'patch-diagnostic',message})),declarations=configuredPresets(entries);
const env={platform:process.platform,profile:true},hostRows=flattenConfiguredRows(entries,'host',env).filter(row=>row.status!=='disabled');
const defaultRow=hostRows.find(row=>row.name==='@deepseek-ai/dsh-agent-preset-registry'),requestedDefault=defaultRow?.config?.selectedDefault??defaultRow?.config?.default;
const defaultPreset=declarations.some(row=>row.config.id===requestedDefault)?requestedDefault:declarations[0]?.config.id??null;
const profileRequire=createRequire(join(profileRoot,'package.json')),packageCache=new Map(),registryCache=new Map();
function resolveModule(specifier){
  if(packageCache.has(specifier))return packageCache.get(specifier);
  let file;for(const require of [profileRequire,sdk]){try{file=require.resolve(specifier);break;}catch{}}
  if(!file){packageCache.set(specifier,null);return null;}
  let root=dirname(file);while(!existsSync(join(root,'package.json'))&&dirname(root)!==root)root=dirname(root);
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));const result={file,root,package:manifest.name,version:manifest.version};packageCache.set(specifier,result);return result;
}
function registrations(row){
  const module=resolveModule(row.name);if(!module)return [];
  const key=module.file+':'+contentHash(row.config??{});
  if(!registryCache.has(key)){const text=readFileSync(module.file,'utf8');registryCache.set(key,scanContributions(text,module,parse,{config:row.config??{}}));}
  return registryCache.get(key).rows.filter(item=>configuredContribution(item,row)).map(item=>({...item,entry:row.id,scope:row.scope,status:row.status,provenance:sourceForModule(row.name,bundleInventory,row.presetEntryId)}));
}
const estimate=text=>meter.estimateContent([{type:'text',text}]);
const statFile=file=>{const stat=statSync(file);return {modifiedAt:stat.mtimeMs,bytes:stat.size};};
return async(cwd,history=null)=>{
cwd=resolve(cwd);
const presets=[];
for(const declaration of declarations.sort((a,b)=>(a.config.order??0)-(b.config.order??0))){
  const config=declaration.config,ownRows=flattenConfiguredRows(config.plugins??[],'preset',env).filter(row=>row.status!=='disabled').map(row=>({...row,presetEntryId:declaration.id})),rows=[...hostRows,...ownRows];
  const ownPackages=new Set(ownRows.map(row=>row.name));
  const effective=rows.filter(row=>row.scope==='preset'||!ownPackages.has(row.name));
  const collected=effective.flatMap(registrations),persona=ownRows.find(row=>row.name==='@deepseek-ai/dsh-persona')?.config??{};
  const toolMap=new Map();
  for(const item of collected.filter(row=>row.kind==='tool')){
    const prior=toolMap.get(item.name);if(prior?.scope==='preset'&&item.scope==='host')continue;
    const configured=effective.find(row=>row.id===item.entry&&row.scope===item.scope);
    toolMap.set(item.name,{...item,description:typeof configured?.config?.description==='string'?configured.config.description:item.description});
  }
  const currentInstructions=[],instructionRow=ownRows.find(row=>row.name==='@deepseek-ai/dsh-agent-instructions');let instructionText=null,instructionWarnings=[];
  if(instructionRow){
    const options={...instructionRow.config,cwd,dshHome:home,maxBytes:instructionRow.config?.maxBytes??65536};
    const discovered=await instructions.discoverBaselineInstructionFiles(options),rendered=await instructions.loadBaselineInstructions(options);
    instructionText=rendered?.text??'';
    for(const file of discovered){try{const body=readFileSync(file.absolutePath,'utf8'),truncated=rendered?.truncated.find(row=>row.displayPath===file.displayPath),omitted=rendered?.omitted.some(row=>row.displayPath===file.displayPath);
      currentInstructions.push({name:basename(file.absolutePath),path:file.absolutePath,displayPath:file.displayPath,body,tokens:estimate(body),hash:contentHash(body),...statFile(file.absolutePath),scope:file.displayPath.startsWith('~/')?'个人指令':'项目指令',truncated:truncated??null,omitted:Boolean(omitted),package:'@deepseek-ai/dsh-agent-instructions'});
    }catch(error){instructionWarnings.push({path:file.absolutePath,message:error.message});}}
  }
  const {skills,disabledSkills,skillIssues,skillsEnabled}=await readConfiguredSkills(effective,ownRows,{filesystem,sdk,home,cwd,estimate});
  const system=[];
  if(typeof persona.prefix==='string'&&persona.prefix)system.push({name:persona.complete?'完整系统提示':'预设身份前缀',body:persona.prefix,package:'@deepseek-ai/dsh-persona',kind:'persona',scope:'preset',tokens:estimate(persona.prefix),template:persona.prefix.includes('{{'),provenance:sourceForModule('@deepseek-ai/dsh-agent-preset',bundleInventory)});
  if(!persona.complete){
    const unique=new Set(typeof persona.prefix==='string'?['deployment:persona-prefix','deployment:persona-suffix']:[]);for(const item of collected.filter(row=>row.kind==='section')){if(unique.has(item.name)||item.staticText==='')continue;unique.add(item.name);system.push({...item,body:item.staticText??item.fragments.join('\n\n'),template:true,tokens:null});}
  }
  if(typeof persona.suffix==='string'&&persona.suffix)system.push({name:'预设后置说明',body:persona.suffix,package:'@deepseek-ai/dsh-persona',kind:'persona',scope:'preset',tokens:estimate(persona.suffix),template:persona.suffix.includes('{{')});
  const injectionMap=new Map();for(const item of collected.filter(row=>(row.kind==='context'||row.kind==='producer'&&row.modelFacing)&&!['plugin','skill-catalog','skill-invocation','agent-instructions'].includes(row.name))){
    if(persona.includeRuntimeContext===false&&item.kind==='context')continue;
    const key=item.package+':'+item.kind+':'+item.name;if(!injectionMap.has(key))injectionMap.set(key,{...item,body:item.staticText??item.fragments.join('\n\n')});
  }
  const modules=effective.map(row=>{const module=resolveModule(row.name);return {id:row.id,name:row.name,scope:row.scope,status:row.status,package:module?.package??row.name,version:module?.version??null,file:module?.file??null};});
  presets.push({id:config.id,name:config.name??config.id,description:config.description??'',order:config.order,isDefault:config.id===defaultPreset,toolMode:ownRows.some(row=>row.name==='@deepseek-ai/dsh-tool-executor-ptc')?'PTC':'直接工具',
    instructions:currentInstructions,instructionText,instructionWarnings,skills,disabledSkills,skillIssues,tools:[...toolMap.values()].sort((a,b)=>a.name.localeCompare(b.name)),system,injections:[...injectionMap.values()],modules,
    instructionBudget:instructionRow?.config?.maxBytes??null,instructionsEnabled:Boolean(instructionRow),skillsEnabled,completePrompt:Boolean(persona.complete)});
  const preset=presets.at(-1);
  for(const row of preset.instructions)row.provenance={origin:'personal',basis:'current-instruction-file',scope:row.scope};
  for(const row of [...preset.skills,...preset.disabledSkills])row.provenance=row.package?sourceForModule(row.package,bundleInventory):{origin:'personal',basis:'filesystem-skill-provider',scope:row.sourceLabel};
  preset.statistics=summarizeCurrentPreset(preset,history,{estimate,estimateTool:definition=>meter.estimateToolsTokens({tools:[definition]}),parametersToSchema:toolSchema.parameterSchemaSpecToJsonSchema});
  preset.skillManagement=buildSkillManagement(preset);
}
const data={schema:'preset-current/1',capturedAt:Date.now(),profile,workspace:{name:basename(cwd),path:cwd},defaultPreset,dshVersion:JSON.parse(readFileSync(anchor,'utf8')).version,presets,bundleInventory,
  coverage:{basis:'当前磁盘内容计量；同模式历史只作为当前能力的使用背景',runtimeObserved:false,historyAsOf:history?.generatedAt??null,configFiles:files,issues,conditionalRows:hostRows.filter(row=>row.status==='conditional').map(row=>row.name)}};
return data;
};
}
