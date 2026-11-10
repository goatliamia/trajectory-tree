import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {DIAGNOSIS_SKILLS,QUERY_SKILL} from '../skill/catalog.mjs';
const check=process.argv.includes('--check');let changed=false;
function emit(path,wanted){
 const file=new URL('../'+path,import.meta.url);let actual;try{actual=readFileSync(file,'utf8');}catch{}
 if(actual===wanted)return;changed=true;
 if(check)console.error('Skill resource differs: '+path);else{mkdirSync(new URL('./',file),{recursive:true});writeFileSync(file,wanted);}
}
function files(path){return readdirSync(new URL('../'+path,import.meta.url),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path+'/'+entry.name):[path+'/'+entry.name]);}
function dshFrontmatter(text, skill) {
 const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
 if (!frontmatter.test(text)) throw new Error('Missing skill frontmatter: ' + skill.name);
 return text.replace(frontmatter, () => [
  '---',
  'name: ' + skill.name,
  'description: ' + JSON.stringify(skill.description),
  'whenToUse: ' + JSON.stringify(skill.whenToUse),
  '---',
  '',
 ].join('\n'));
}
const hosts={
 project:{base:'.agents/skills',prefix:'../../../'},
 codex:{base:'plugin/codex/skills',prefix:'../../../../'},
 pi:{base:'plugin/portable-tools/skills',prefix:'../../../../'},
 claude:{base:'plugin/claude/skills',prefix:'../../../../'},
 dsh:{base:'plugin/trajectory-tools/skills',prefix:'../../',dsh:true},
 'dsh-project':{base:'.dsh/skills',prefix:'../../../',dsh:true},
};
for(const [host,{base,prefix,dsh}]of Object.entries(hosts))for(const skill of dsh?[...DIAGNOSIS_SKILLS,QUERY_SKILL]:DIAGNOSIS_SKILLS){
 for(const path of files('skill/'+skill.name)){
  let text=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  if(path.endsWith('/SKILL.md')){
   if(dsh)text=dshFrontmatter(text,skill);
   if(['codex','pi','claude'].includes(host))text=text.replace(/^description: /m,'description: '+({codex:'Codex',pi:'Pi',claude:'Claude Code'}[host])+'：');
   text=text.replaceAll('../../report/',prefix+'report/');
   if (['codex', 'claude'].includes(host)) {
    const source = host === 'claude' ? ' --file "<transcript_path>"' : '';
    const binding = host === 'claude' ? '优先使用草稿中的 transcript 路径，其次使用会话绑定提供的路径。' : '默认当前会话，指定会话加 `--thread ID`。';
    text += '\n未连接取证工具时，将查询的参数对象写入 `args.json`。用 Node 运行本目录相对路径 `' +
      prefix + 'scripts/trajectory-query.mjs --host ' + host + source + ' --tool <工具名> --request <args.json>`。' +
      binding + '工具声明用 `--tool schema` 获取。\n';
   }
   if(!dsh)text+='\n需要 HTML 报告时读[组件用法]('+prefix+'report/AUTHORING.md)；其中报告 CLI 位于本目录相对路径 `'+prefix+'scripts/trajectory-report.mjs`。\n';
  }
  emit(base+'/'+skill.name+path.slice(('skill/'+skill.name).length),text);
 }
}
emit('plugin/trajectory-tools/skills/catalog.json',JSON.stringify({query:QUERY_SKILL,diagnostics:DIAGNOSIS_SKILLS},null,2)+'\n');
emit('plugin/trajectory-tools/report/WRITING.md',readFileSync(new URL('../report/WRITING.md',import.meta.url),'utf8'));
if(check&&changed)process.exitCode=1;
