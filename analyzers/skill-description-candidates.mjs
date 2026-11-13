// Conservative, description-only candidate retrieval. No learned weights,
// network requests, model runtime, or index service. Scores are not semantic
// probabilities: a shared phrase AND compatible task evidence must pass gates.
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stop = new Set('a an the of for to in on and or with by from as at is are be this that it its when use using used skill skills tool tools agent agents deepseek harness including into through only more such any each your their what which how then than can should would will do does also all some has have task tasks 的 了 和 与 在 对 为 是 用于 使用 进行 可以 需要 以及 一个 这个 相关 通过 是否'.split(' '));
const generic = new Set('code file text repository project prompt description instruction document output input content workflow task agent skill tool system コード 代码 文件 项目 仓库 提示词 描述 内容 工具 技能'.split(' '));
const actions = {
  inspect: ['inspect','inspection','review','audit','check','analyze','analysis','examine','审查','检查','分析','审核'],
  create: ['create','creation','generate','generation','write','author','build','创建','生成','编写'],
  edit: ['edit','modify','modification','fix','repair','update','rewrite','apply','修改','修复','更新'],
  test: ['test','verify','verification','validate','validation','测试','验证','校验'],
  install: ['install','installation','setup','configure','configuration','安装','配置'],
  explain: ['explain','explanation','summarize','summary','describe','解释','总结','说明'],
  optimize: ['optimize','optimization','tune','speed','优化','调优'],
  search: ['search','find','locate','discover','查找','搜索','定位'],
};
const labels = {inspect:'检查 / 分析',create:'创建 / 生成',edit:'编辑 / 修复',test:'测试 / 验证',install:'安装 / 配置',explain:'解释 / 总结',optimize:'优化',search:'查找'};
const actionByWord = new Map(Object.entries(actions).flatMap(([key,values]) => values.map(value => [value,key])));
const irregular = new Map(Object.entries({writing:'write',written:'write',creating:'create',generating:'generate',modifying:'modify',applying:'apply',analyzing:'analyze',analysing:'analyze',optimized:'optimize',optimizing:'optimize',configuring:'configure',using:'use',files:'file',repositories:'repository',descriptions:'description',instructions:'instruction',documents:'document',queries:'query',deployment:'deploy',deployments:'deploy'}));
function stem(word) {
  if(irregular.has(word))return irregular.get(word);
  if(actionByWord.has(word))return word;
  if(/^[a-z]+$/.test(word)) {
    for(const suffix of ['ing','ed','s'])if(word.length>suffix.length+3&&word.endsWith(suffix)){
      const base=word.slice(0,-suffix.length);
      if(actionByWord.has(base))return base;
      if(actionByWord.has(base+'e'))return base+'e';
      if(suffix==='s'&&!/(ss|us|is)$/.test(word))return base;
    }
  }
  return word;
}
function words(text) {
  const normalized=String(text??'').normalize('NFKC').toLowerCase()
    .replace(/\bprs?\b/g,'pull request').replace(/\bpull[- ]requests?\b/g,'pull request').replace(/\bread[- ]only\b/g,'readonly');
  return [...segmenter.segment(normalized)].filter(row=>row.isWordLike).map(row=>stem(row.segment));
}
function features(tokens) {
  const result=new Set(tokens.filter(word=>!stop.has(word)).map(word=>'w:'+word));
  for(let i=0;i<tokens.length-1;i++)if(!stop.has(tokens[i])&&!stop.has(tokens[i+1]))result.add('p:'+tokens[i]+' '+tokens[i+1]);
  return result;
}
function profile(skill) {
  const sentences=String(skill.description??'').split(/[.!?。！？;；]+/).map(words),tokens=sentences.flat(),positive=new Set(),negative=new Set();
  const frames=[];let offset=0;
  for(const sentence of sentences){
    sentence.forEach((word,index)=>{const action=actionByWord.get(word);if(!action)return;
      const next=sentence.findIndex((word,after)=>after>index&&actionByWord.has(word));
      frames.push({action,start:offset+index+1,end:offset+Math.min(index+11,next<0?sentence.length:next)});
    });offset+=sentence.length;
  }
  tokens.forEach((word,index)=>{const key=actionByWord.get(word);if(!key)return;
    const negated=tokens.slice(Math.max(0,index-3),index).some(token=>['not','never','without','avoid','禁止','不要','不','不得'].includes(token));
    (negated?negative:positive).add(key);
  });
  if(tokens.includes('readonly')||/只读|不修改/.test(skill.description??''))negative.add('edit');
  const phases=[...String(skill.description??'').toLowerCase().matchAll(/\b(before|after)\s+(?:the\s+)?([\w-]+)/g)].map(([,phase,object])=>({phase,object:stem(object)}));
  const canonical=tokens.map(word=>actionByWord.get(word)?'@'+actionByWord.get(word):word);
  return {tokens,positive,negative,frames,phases,features:features(canonical)};
}
function referenced(from,to){
  // A named link is evidence of a dependency, not evidence of duplication.
  const body=String(from.body??''),name=to.name;
  return body.includes('`'+name+'`')||body.includes('/'+name+'/SKILL.md')||body.includes('['+name+'](');
}
function anchors(a,b,sharedActions) {
  const phrases=[];
  for(let width=3;width>=2;width--)for(let i=0;i<=a.tokens.length-width;i++){
    const tokens=a.tokens.slice(i,i+width);
    if(tokens.some(word=>stop.has(word)||actionByWord.has(word)))continue;
    if(!tokens.some(word=>!generic.has(word)&&(word.length>2||/^[\p{Script=Han}]{2,}$/u.test(word))))continue;
    const text=tokens.join(' '),leftActions=a.frames.filter(frame=>frame.start<=i&&frame.end>=i+width&&sharedActions.has(frame.action));
    if(!leftActions.length)continue;
    const match=b.tokens.some((_,index)=>b.tokens.slice(index,index+width).join(' ')===text&&
      b.frames.some(frame=>frame.start<=index&&frame.end>=index+width&&leftActions.some(left=>left.action===frame.action)));
    if(match&&!phrases.some(phrase=>phrase.includes(text)))phrases.push(text);
  }
  return [...new Set(phrases)].slice(0,5);
}
function excerpt(description,anchor){
  const sentences=String(description??'').split(/(?<=[.!?。！？;；])\s*/);
  const relevant=sentences.find(sentence=>words(sentence).join(' ').includes(anchor));
  return (relevant??String(description??'')).slice(0,500);
}

export function analyzeSkillDescriptions(skills) {
  const profiles=skills.map(profile),frequency=new Map();
  for(const row of profiles)for(const word of row.features)frequency.set(word,(frequency.get(word)??0)+1);
  const weight=word=>1+Math.log((skills.length+1)/((frequency.get(word)??0)+1));
  const mass=set=>[...set].reduce((sum,word)=>sum+weight(word)**2,0);
  const pairs=[],excluded={official:0,reference:0,phase:0,weak:0};let compared=0;
  for(let i=0;i<skills.length;i++)for(let j=i+1;j<skills.length;j++){
    const left=skills[i],right=skills[j],a=profiles[i],b=profiles[j];
    if(left.provenance?.origin==='official'&&right.provenance?.origin==='official'){excluded.official++;continue;}
    compared++;
    if(referenced(left,right)||referenced(right,left)){excluded.reference++;continue;}
    const shared=[...a.features].filter(word=>b.features.has(word));
    const cosine=mass(shared)/Math.sqrt(mass(a.features)*mass(b.features)||1);
    const coverage=Math.min(shared.length/(a.features.size||1),shared.length/(b.features.size||1));
    // Broad words cannot open a candidate. Phrase evidence ties the task to an
    // object; normalization handles morphology and PR/pull-request spelling.
    const aligned=[...a.positive].filter(key=>b.positive.has(key));
    const conflicts=[...new Set([...a.negative].filter(key=>b.positive.has(key)).concat([...b.negative].filter(key=>a.positive.has(key))))];
    const objects=anchors(a,b,new Set([...aligned,...conflicts]));
    if(a.phases.some(x=>b.phases.some(y=>x.object===y.object&&x.phase!==y.phase))){excluded.phase++;continue;}
    const exact=a.tokens.length>=5&&a.tokens.join(' ')===b.tokens.join(' ');
    const conflict=objects.length&&conflicts.length&&cosine>=.4&&coverage>=.3;
    const close=objects.length&&aligned.length&&cosine>=.56&&coverage>=.4;
    if(!exact&&!conflict&&!close){excluded.weak++;continue;}
    const kind=conflict?'constraint-conflict':exact?'near-copy':'task-candidate';
    pairs.push({left:left.name,right:right.name,kind,score:cosine,coverage,
      shared:objects,references:[],basis:'description-task-and-phrase-evidence',meaningConfirmed:false,
      evidence:{objects,actions:aligned.map(key=>labels[key]),conflicts:conflicts.map(key=>labels[key]),
        left:excerpt(left.description,objects[0]??''),right:excerpt(right.description,objects[0]??'')},
      reason:conflict?'同一对象的操作约束可能相反':exact?'描述规范化后相同':'任务动作与具体对象同时接近'});
  }
  return {pairs:pairs.sort((a,b)=>b.score-a.score).slice(0,24),compared,excluded,
    method:'phrase-task-gated-sparse-retrieval/2',scope:'current-descriptions',
    limitation:'保守筛选可核对的近似描述和约束线索；无共享表达的同义改写、跨语言等价仍可能漏检。'};
}
