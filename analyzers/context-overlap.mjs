import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text).digest('hex').slice(0,20);
export const contextKinds = {system:'系统提示',instructions:'AGENTS.md / 项目指令',tools:'工具说明',catalog:'Skill 目录',skills:'Skill 正文',injections:'插件注入'};
const isSkill = item => item.kind==='skills'||item.kind==='catalog';

// One entry per native text field. Registration/source observations are metadata,
// not additional prompt occurrences. No code or dynamic producer is executed.
export function contextTextItems(preset) {
  const items=[],seen=new Set();
  const add=(row,kind,field,text,extra={})=>{
    if(typeof text!=='string'||!text.trim()||row.omitted||row.status==='disabled')return;
    const path=row.path||row.file||'',identity=[kind,path,row.package||'',row.name,field].join('\0');
    if(seen.has(identity))return;seen.add(identity);
    items.push({id:hash(identity),name:row.displayPath||row.name,kind,field,path,package:row.package||null,
      origin:row.provenance?.origin||'unknown',phase:kind==='skills'?'on-demand':kind==='injections'?'dynamic':'startup',
      evidence:row.template||row.staticComplete===false||kind==='injections'?'static-fragment':'current-file',
      sourceLine:row.line||null,version:row.version||null,modifiedAt:row.modifiedAt||null,
      skillName:isSkill({kind})?row.name:null,reads:row.usage?.count??row.usage?.events?.length??null,
      ...(row.workspaceIds?{workspaceIds:row.workspaceIds,workspaceNames:row.workspaceNames}:{}),
      text,contentHash:hash(text),...extra});
  };
  for(const row of preset.instructions||[]) {
    // An omitted/truncated file is not reconstructed from its full disk body.
    if(row.truncated)continue;
    add(row,'instructions','body',row.body);
  }
  for(const row of preset.system||[])add(row,'system','body',row.body);
  for(const row of preset.injections||[])add(row,'injections','body',row.body);
  for(const row of (preset.skills||[]).flatMap(skill=>skill.variants??[skill])){
    add(row,'catalog','description',row.description);
    if(row.whenToUse)add(row,'catalog','whenToUse',row.whenToUse);
    add(row,'skills','body',row.body);
  }
  for(const row of preset.tools||[]) {
    const phase=preset.toolMode==='PTC'?'tool-directory':'startup';
    add(row,'tools','description',row.description,{phase});
    const visit=(value,path)=>{if(!value||typeof value!=='object')return;
      for(const [key,child]of Object.entries(value)){
        const own=path+'/'+key;
        if(key==='description'&&typeof child==='string')add(row,'tools',own,child,{phase});
        else if(child&&typeof child==='object')visit(child,own);
      }
    };visit(row.staticParameters,'parameters');
  }
  return items;
}

// Whitespace only: retain case, negation, operators, numbers and punctuation.
// Positions map back to the unchanged source, including UTF-16/Unicode offsets.
function normalize(text) {
  const chars=[],starts=[],ends=[];let offset=0;
  for(const char of text){const end=offset+char.length;
    if(/\s/u.test(char)){
      if(chars.length&&chars.at(-1)!==' '){chars.push(' ');starts.push(offset);ends.push(end);}
      else if(chars.length)ends[ends.length-1]=end;
    }else{chars.push(char);starts.push(offset);ends.push(end);}offset=end;
  }
  if(chars.at(-1)===' '){chars.pop();starts.pop();ends.pop();}
  return {chars,starts,ends};
}

// Winnowing selects stable fingerprints of copied passages. Verify every seed
// against the actual characters, then extend to the maximal shared span.
function fingerprints(chars,k=24,window=12) {
  if(chars.length<k)return [];
  const hashes=[];let power=1,value=0;
  for(let i=1;i<k;i++)power=Math.imul(power,31)>>>0;
  for(let i=0;i<chars.length;i++){
    value=(Math.imul(value,31)+chars[i].codePointAt(0))>>>0;
    if(i>=k)value=(value-Math.imul(chars[i-k].codePointAt(0),Math.imul(power,31)))>>>0;
    if(i>=k-1)hashes.push(value);
  }
  const result=[];let last=-1;
  for(let start=0;start<=Math.max(0,hashes.length-window);start++){
    let selected=start;
    for(let i=start;i<Math.min(hashes.length,start+window);i++)if(hashes[i]<=hashes[selected])selected=i;
    if(selected!==last){result.push([hashes[selected],selected]);last=selected;}
  }
  return result;
}
function merge(ranges) {
  const result=[];
  for(const range of ranges.slice().sort((a,b)=>a[0]-b[0]||b[1]-a[1])){
    const last=result.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else result.push([...range]);
  }return result;
}
const size=ranges=>merge(ranges).reduce((n,[a,b])=>n+b-a,0);
function sourceRange(item,profile,start,end) {
  const from=profile.starts[start],to=profile.ends[end-1];
  return {start:from,end:to,line:item.text.slice(0,from).split('\n').length,endLine:item.text.slice(0,to).split('\n').length};
}
function references(left,right){
  return Boolean(right.skillName&&(left.text.includes('`'+right.skillName+'`')||left.text.includes('/'+right.skillName+'/SKILL.md')));
}

export function compareContextItems(input,{minCharacters=64}={}) {
  const items=input.map(item=>({...item})),profiles=items.map(item=>normalize(item.text));
  const index=new Map(),candidates=new Map(),limited=new Set();let excludedOfficial=0;
  profiles.forEach((profile,i)=>{
    items[i].characters=profile.chars.length;
    const frequencies=new Map();
    for(const [key,at]of fingerprints(profile.chars)){
      const count=(frequencies.get(key)||0)+1;frequencies.set(key,count);
      if(count>64){limited.add(items[i].id);continue;}
      if(!index.has(key))index.set(key,[]);index.get(key).push({i,at});
    }
  });
  for(const positions of index.values())for(let a=0;a<positions.length;a++)for(let b=a+1;b<positions.length;b++){
    const first=positions[a],second=positions[b];if(first.i===second.i)continue;
    const l=first.i<second.i?first:second,r=first.i<second.i?second:first,key=l.i+':'+r.i;
    if(items[l.i].workspaceIds&&items[r.i].workspaceIds&&!items[l.i].workspaceIds.some(id=>items[r.i].workspaceIds.includes(id)))continue;
    if(isSkill(items[l.i])&&isSkill(items[r.i])&&items[l.i].origin==='official'&&items[r.i].origin==='official')continue;
    let candidate=candidates.get(key);if(!candidate){candidate={l:l.i,r:r.i,seeds:new Map()};candidates.set(key,candidate);}
    const diagonal=l.at-r.at;
    // Equal diagonals describe one possible alignment; retain ordered seeds.
    if(!candidate.seeds.has(diagonal))candidate.seeds.set(diagonal,[]);
    candidate.seeds.get(diagonal).push([l.at,r.at]);
  }
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(isSkill(items[i])&&isSkill(items[j])&&items[i].origin==='official'&&items[j].origin==='official')excludedOfficial++;
  const pairs=[],itemRanges=new Map();
  for(const {l,r,seeds}of candidates.values()){
    const a=profiles[l],b=profiles[r],spans=[];
    for(const positions of seeds.values()){
      let covered=-1;
      for(const [x,y]of positions.sort((a,b)=>a[0]-b[0])){
        if(x<covered)continue;
        if(!a.chars.slice(x,x+24).every((char,i)=>char===b.chars[y+i]))continue;
        let startA=x,startB=y,endA=x+24,endB=y+24;
        while(startA>0&&startB>0&&a.chars[startA-1]===b.chars[startB-1]){startA--;startB--;}
        while(endA<a.chars.length&&endB<b.chars.length&&a.chars[endA]===b.chars[endB]){endA++;endB++;}
        covered=endA;
        while(startA<endA&&a.chars[startA]===' '){startA++;startB++;}
        while(endA>startA&&a.chars[endA-1]===' '){endA--;endB--;}
        if(endA-startA>=minCharacters&&/[\p{L}\p{N}]/u.test(a.chars.slice(startA,endA).join('')))spans.push({a:[startA,endA],b:[startB,endB]});
      }
    }
    const unique=spans.sort((a,b)=>(b.a[1]-b.a[0])-(a.a[1]-a.a[0])).filter((span,i,all)=>!all.slice(0,i).some(other=>other.a[0]<=span.a[0]&&other.a[1]>=span.a[1]&&other.b[0]<=span.b[0]&&other.b[1]>=span.b[1]));
    if(!unique.length)continue;
    const leftChars=size(unique.map(s=>s.a)),rightChars=size(unique.map(s=>s.b));
    for(const [id,ranges]of [[items[l].id,unique.map(s=>s.a)],[items[r].id,unique.map(s=>s.b)]])itemRanges.set(id,[...(itemRanges.get(id)||[]),...ranges]);
    const same=a.chars.join('')===b.chars.join('');
    pairs.push({id:hash(items[l].id+':'+items[r].id),left:items[l].id,right:items[r].id,
      kind:same?'same':leftChars===a.chars.length||rightChars===b.chars.length?'contains':'fragments',
      characters:Math.min(leftChars,rightChars),leftCoverage:leftChars/a.chars.length,rightCoverage:rightChars/b.chars.length,
      reference:references(items[l],items[r])||references(items[r],items[l]),
      matches:unique.map(s=>({characters:s.a[1]-s.a[0],left:sourceRange(items[l],a,...s.a),right:sourceRange(items[r],b,...s.b)}))});
  }
  for(const item of items)item.matchedCharacters=size(itemRanges.get(item.id)||[]);
  return {items,pairs:pairs.sort((a,b)=>b.characters-a.characters),
    summary:{items:items.length,pairs:pairs.length,involved:items.filter(i=>i.matchedCharacters).length,
      characters:items.reduce((n,i)=>n+i.characters,0),matchedCharacters:items.reduce((n,i)=>n+i.matchedCharacters,0),
      fragments:pairs.reduce((n,p)=>n+p.matches.length,0),excludedOfficial},
    method:{id:'verified-contiguous-text/1',minCharacters,normalization:'whitespace-only',models:false,frequentFingerprintLimit:64,limitedItems:[...limited],
      metrics:'Matched characters are interval unions per text field; no deletion or token-saving estimate.'}};
}

export function contextOverlap(snapshot,presetId) {
  const preset=snapshot.presets.find(p=>p.id===presetId);if(!preset)throw Error('Unknown preset');
  const result=compareContextItems(contextTextItems(preset));
  return {...result,preset:preset.id,workspace:snapshot.workspace,capturedAt:snapshot.capturedAt,
    coverage:{basis:'current-configuration',runtimeObserved:false,
      partial:result.items.filter(i=>i.evidence==='static-fragment').length,
      omittedInstructions:(preset.instructions||[]).filter(i=>i.omitted||i.truncated).length,
      kinds:contextKinds}};
}
