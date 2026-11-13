import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {visualTokenCss} from '../design/tokens.mjs';
import {i18nModuleSource} from '../lib/i18n.mjs';
const root=new URL('../',import.meta.url),output=new URL('../plugin/analysis-view/lib/trace/shared/',import.meta.url),check=process.argv.includes('--check');
const assets={
 'context-observation.js':readFileSync(new URL('view/assets/context-observation.js',root),'utf8'),
 'context-observation.css':readFileSync(new URL('view/assets/context-observation.css',root),'utf8'),
 'context-trend-geometry.js':readFileSync(new URL('lib/context-trend-geometry.mjs',root),'utf8').replaceAll('export function ','function '),
 'visual-tokens.css':visualTokenCss({legacyAliases:true}),
 'i18n.mjs':i18nModuleSource(),
 'host-capabilities.mjs':readFileSync(new URL('lib/host-capabilities.mjs',root),'utf8'),
 'io-outcome.mjs':readFileSync(new URL('plugin/trajectory-tools/lib/io-outcome.js',root),'utf8'),
 'tool-attribution.mjs':readFileSync(new URL('plugin/trajectory-tools/lib/tool-attribution.js',root),'utf8'),
 'tool-intervals.mjs':readFileSync(new URL('plugin/trajectory-tools/lib/tool-intervals.js',root),'utf8'),
 'tool-call-checks.mjs':readFileSync(new URL('plugin/trajectory-tools/lib/tool-call-checks.js',root),'utf8'),
 'official-stats.mjs':readFileSync(new URL('plugin/trajectory-tools/lib/official-stats.js',root),'utf8'),
 'request-context.mjs':readFileSync(new URL('plugin/trajectory-tools/lib/request-context.js',root),'utf8'),
 'usage.mjs':readFileSync(new URL('plugin/trajectory-tools/lib/usage.js',root),'utf8').replace('./inspect-models/cache-efficiency.js','../../cache-efficiency.js'),
 'scope-index.mjs':readFileSync(new URL('lib/scope-index.mjs',root),'utf8'),
 'tool-colors.mjs':readFileSync(new URL('lib/tool-colors.mjs',root),'utf8'),
 'tool-feedback.mjs':readFileSync(new URL('lib/tool-feedback.mjs',root),'utf8'),
};
let changed=false;
for(const [name,content] of Object.entries(assets)){
 const expected=content.replaceAll('\r\n','\n');
 const targets=[new URL(name,output),...(['context-observation.js','context-observation.css'].includes(name)?[new URL('docs/demo/layout-review/'+name,root)]:[])];
 for(const target of targets){
  let current;try{current=readFileSync(target,'utf8');}catch{}
  if(current?.replaceAll('\r\n','\n')===expected)continue;changed=true;
  if(check)console.error('View resource differs: '+target.pathname);else{mkdirSync(new URL('./',target),{recursive:true});writeFileSync(target,expected);}
 }
}
if(check&&changed)process.exitCode=1;
await import('./sync-eval-workspace.mjs');
