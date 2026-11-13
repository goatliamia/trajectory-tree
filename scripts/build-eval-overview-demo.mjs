import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { decodeZstdSession } from '../experiments/corpus/decode-session.mjs';
import { projectOverviewSession } from '../plugin/analysis-view/lib/eval/overview/data.mjs';
import { createOverviewModels, overviewCategories } from '../plugin/analysis-view/lib/eval/overview/shared.mjs';
import { enrichFindingPowerShell } from '../plugin/analysis-view/lib/eval/pwsh-evidence.mjs';
import { commandCrOptions } from '../analyzers/cr-pwsh.mjs';

const out=resolve('.dsh/preset-context-demo'),history=JSON.parse(readFileSync(join(out,'data.json'),'utf8'));
const local=createRequire(import.meta.url),sdk=createRequire(local.resolve('@deepseek-ai/dsh/package.json'));
const load=async name=>import(pathToFileURL(sdk.resolve(name)).href);
const [llm,stream,pressure]=await Promise.all([load('@deepseek-ai/dsh-llm'),load('@deepseek-ai/dsh-llm/assistant-stream'),
  import(pathToFileURL(join(dirname(sdk.resolve('@deepseek-ai/dsh-token-meter/package.json')),'lib/types/usage-projection.js')).href)]);
const runtime={stream:{...llm,...stream},pressure:pressure.contextPressureProjectionDefinition};
const catalog=createOverviewModels(),projects=[],sessions=[],failures=[];let done=0;
const cr=commandCrOptions(process.argv.slice(2));
for(const row of history.sessions){
  try{
    const records=decodeZstdSession(readFileSync(row.file)).toString('utf8').split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line));
    const header=records.find(record=>record.type==='session'),events=records.filter(record=>Number.isSafeInteger(record.seq)).sort((a,b)=>a.seq-b.seq);
    const inherited=header?.isSeeded?(events.find(event=>event.type==='session/end-seed')?.seq??Infinity)+1:0;
    const projection=projectOverviewSession(row.id,events,{cwd:row.cwd,inherited},catalog,runtime);
    if(!projection)continue;
    projection.findingCalls=await enrichFindingPowerShell(projection.findingCalls,events,cr);
    let project=projects.findIndex(p=>p.id===row.project);
    if(project<0){project=projects.length;projects.push({id:row.project,name:row.projectName});}
    sessions.push({...projection,project,preset:row.preset,title:row.title});
  }catch(error){failures.push({id:row.id,preset:row.preset,error:error.message});}
  finally{done++;if(done%10===0)console.log(JSON.stringify({stage:'native-eval',done,total:history.sessions.length}));}
}
const data={schema:'preset-eval-demo/1',host:'dsh',latest:history.generatedAt,capturedAt:Date.now(),projects,sessions,
  total:history.sessions.length,done:history.sessions.length,unread:failures.length,failures,models:catalog.models,categories:overviewCategories};
const target=join(out,'eval-data.json');writeFileSync(target+'.next',JSON.stringify(data));renameSync(target+'.next',target);
console.log(JSON.stringify({stage:'native-eval-complete',sessions:sessions.length,failures}));
