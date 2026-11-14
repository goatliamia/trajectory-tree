import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {visualTokenCss} from '../design/tokens.mjs';
import {toolColorCss} from '../lib/tool-colors.mjs';
import {toolFeedbackCss} from '../lib/tool-feedback.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const out=join(root,'plugin/analysis-view/lib/eval/workspace');
const native=join(root,'plugin/analysis-view/lib');
const check=process.argv.includes('--check'),seen=new Set(),records=[];
let changed=false;
function write(file,text){
  const expected=text.replaceAll('\r\n','\n');let current;
  try{current=readFileSync(file,'utf8').replaceAll('\r\n','\n');}catch{}
  if(current===expected)return;
  changed=true;if(check){console.error('Eval workspace resource differs: '+relative(root,file));return;}
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,expected);
}
const target=file=>file.startsWith(native+'/')||file.startsWith(native+'\\')?file:join(out,'runtime',relative(root,file));
function copy(file){
  file=resolve(file);if(seen.has(file))return;seen.add(file);
  if(relative(root,file).startsWith('..'))throw Error('Dependency escapes project: '+file);
  const text=readFileSync(file,'utf8');records.push({path:relative(root,file).replaceAll('\\','/'),sha256:createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex')});
  if(target(file)===file)return;
  const transformed=text.replace(/(\bfrom\s*|\bimport\s*|\bimport\(\s*)(['"])([^'"\n]+)\2/g,(all,prefix,quote,specifier)=>{
    if(!specifier.startsWith('.'))return all;
    const dependency=resolve(dirname(file),specifier);copy(dependency);
    const path=relative(dirname(target(file)),target(dependency)).replaceAll('\\','/');
    return prefix+quote+(path.startsWith('.')?path:'./'+path)+quote;
  });
  write(target(file),transformed);
}
for(const file of ['lib/dsh-current-preset.mjs','lib/context-diagnosis.mjs','analyzers/workspace-presets.mjs','analyzers/preset-context.mjs','analyzers/context-overlap.mjs','analyzers/eval-insights.mjs','analyzers/skill-overlap-demo.mjs','scripts/dsh-management.mjs','scripts/dsh-management-http.mjs'])copy(join(root,file));
const assets=join(root,'docs/demo/preset-context');
for(const entry of readdirSync(assets,{withFileTypes:true})){
  if(!entry.isFile()||!['.js','.css','.html'].includes(extname(entry.name))||entry.name==='trace-extension.js')continue;
  // Browser module imports are already relative; root-absolute API URLs are
  // resolved by the native bridge, keeping the standalone preview identical.
  write(join(out,'ui',entry.name),readFileSync(join(assets,entry.name),'utf8').replaceAll('/fonts/','./fonts/'));
}
for(const [name,content] of [
  ['tool-colors.js',readFileSync(join(root,'lib/tool-colors.mjs'),'utf8')],
  ['tool-feedback.js',readFileSync(join(root,'lib/tool-feedback.mjs'),'utf8')],
  ['tool-colors.css',toolColorCss()],['tool-feedback.css',toolFeedbackCss()],
  ['design/tokens.css',visualTokenCss()],['design/primitives.css',readFileSync(join(root,'design/primitives.css'),'utf8')],
])write(join(out,'ui',name),content);
write(join(out,'manifest.json'),JSON.stringify({schema:1,sources:records.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
if(check&&changed)process.exitCode=1;
