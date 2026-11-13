const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy={
  trigger:{title:'两个入口，都指向 PR 安全审查',summary:'相同任务可能同时命中两个 Skill，选择依据不清楚。',action:'区分适用场景或产出，例如一个负责提交前检查，另一个负责合并前审查；正文也相近时，再考虑合并。',tags:['对象：Pull request','任务：安全审查','产出：问题清单'],labels:['入口 A','入口 B'],captions:['审查 PR 安全漏洞，报告发现','审计 PR 安全漏洞，报告发现']},
  conflict:{title:'同样的审查任务，修改权限相反',summary:'一个要求只读，另一个要求修改文件。共同触发时，执行边界可能冲突。',action:'在描述中区分“只审查”和“按授权修复”，把是否允许修改放到选择入口。',tags:['共同任务：PR 安全审查','待核对：编辑 / 修复'],labels:['只读审查','自动修复'],captions:['只读；禁止修改文件','修改文件，修复发现的问题']},
  repetition:{title:'Skill 重复了工具已经说明的事实',summary:'这段读取能力说明与工具定义相同，没有增加任务条件。',action:'保留“先读配置、比较选项、解释影响”的流程，删去对读取工具的重复介绍。',tags:['原文长句命中','来源：工具描述'],labels:['Skill 正文','工具说明'],captions:['这段话出现在 Skill 正文中','同一段话已由工具提供']},
};

function marked(text,id){
  const regex=id==='conflict'?/(Read-only; never modify files\.|Modify files to fix findings\.)/gi:id==='trigger'?/(pull requests|PRs|security vulnerabilities|report findings)/gi:null;
  if(!regex)return e(text);
  return String(text).split(regex).map((part,index)=>index%2?`<mark>${e(part)}</mark>`:e(part)).join('');
}

export function renderOverlapExamples(payload,selected='trigger'){
  if(!payload?.synthetic)return '';
  const example=payload.examples.find(row=>row.id===selected)??payload.examples[0],c=copy[example.id];
  const pair=example.analysis.pairs?.[0],match=example.analysis.checks?.[0]?.matches[0];
  if(!pair&&!match)return '';
  const rows=example.id==='repetition'?[{name:example.skills[0].name,text:match.excerpt},{name:example.tool.name,text:example.tool.description}]:example.skills.map(s=>({name:s.name,text:s.description}));
  return `<section class="overlap-examples" data-example="${example.id}"><div class="overlap-demo-heading"><span class="demo-label">演示案例</span><span>示例内容经过同一检查程序，不计入本地结果</span></div>
  <div class="overlap-example-tabs" role="group" aria-label="选择重合分析示例">${payload.examples.map((row,index)=>`<button data-skill-action="overlap-example" data-example="${row.id}" aria-pressed="${row.id===example.id}"><small>0${index+1}</small>${e(row.title)}<span>↗</span></button>`).join('')}</div>
  <div class="overlap-case-title"><span>${e(example.title)} · 待核对</span><h3>${e(c.title)}</h3><p>${e(c.summary)}</p></div>
  <div class="overlap-evidence-tags">${c.tags.map(tag=>`<span>${e(tag)}</span>`).join('')}</div>
  <div class="overlap-evidence-pair">${rows.map((row,index)=>`<section><div class="overlap-evidence-label"><i>${index?'B':'A'}</i><span>${e(c.labels[index])}</span></div><code>${e(row.name)}</code><blockquote>${example.id==='repetition'?`<mark>${e(row.text)}</mark>`:marked(row.text,example.id)}</blockquote><p>${e(c.captions[index])}</p></section>`).join('')}</div>
  <div class="overlap-recommendation"><span>建议核对</span><p>${e(c.action)}</p></div>
  <details class="overlap-example-method"><summary>为什么列出这一项</summary><p>${example.id==='repetition'?'同一条工具长句经大小写、空格与标点规范化后，完整出现在 Skill 正文中。':`动作与具体对象同时匹配${pair.evidence.conflicts.length?'，并检出相反的修改约束':''}。命中的对象表达：${e(pair.evidence.objects.join('、'))}。`}</p><p>程序提供核对线索，最终是否合并需结合正文职责判断。官方 Skill 之间不做比较。</p></details></section>`;
}

function exampleSummaries(payload){
  if(!payload?.synthetic)return '';
  return `<div class="overlap-example-overview"><div class="overlap-demo-heading"><span class="demo-label">演示案例</span><span>以下示例不计入本地结果</span></div><div class="overlap-example-cards">${payload.examples.map((row,index)=>`<button data-skill-action="show-overlap-example" data-example="${row.id}"><span class="example-number">0${index+1}</span><strong>${e(row.title)}</strong><p>${e(copy[row.id].summary)}</p><span class="example-open">原文与判断依据 <b>↗</b></span></button>`).join('')}</div></div>`;
}

export function renderOverlapOverview(){
  return '<section class="co-skill-entry"><div><span class="visual-kicker">当前预设 · 加载项</span><h3>上下文重合</h3><p>把 Skill 和项目指令、系统提示、工具说明一起对照。</p></div><button class="text-action" data-skill-action="context-overlap">查看相同片段与来源 ↗</button></section>';
}
