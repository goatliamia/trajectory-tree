import {mkdir,writeFile,rename,unlink,readdir,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {contextOverlap} from '../analyzers/context-overlap.mjs';

export async function prepareContextDiagnosis(snapshot,{preset,itemIds=null},root,signal){
  if(typeof preset!=='string'||preset.length>100||itemIds!==null&&(!Array.isArray(itemIds)||itemIds.length>500||itemIds.some(id=>typeof id!=='string'||id.length>200)))throw Error('诊断选区无效');
  const data=contextOverlap(snapshot,preset);
  const ids=itemIds===null?new Set(data.items.map(i=>i.id)):new Set(itemIds);
  if(!ids.size||[...ids].some(id=>!data.items.some(i=>i.id===id)))throw Error('加载项已变化，请刷新后重新选择');
  const selected=data.items.filter(i=>ids.has(i.id)),pairs=data.pairs.filter(p=>ids.has(p.left)&&ids.has(p.right));
  const byId=new Map(selected.map(i=>[i.id,i]));
  const record={schema:'trajectory-context-selection/1',capturedAt:data.capturedAt,preparedAt:Date.now(),workspace:data.workspace,
    preset,hostVersion:snapshot.dshVersion,basis:'current-configuration',runtimeObserved:false,
    items:selected,pairs,method:data.method};
  const text=JSON.stringify(record),id=createHash('sha256').update(text).digest('hex'),path=join(root,id+'.json'),temp=path+'.'+randomUUID()+'.tmp';
  signal?.throwIfAborted();await mkdir(root,{recursive:true});
  try{await writeFile(temp,text,{mode:0o600,signal});signal?.throwIfAborted();await rename(temp,path);}
  finally{await unlink(temp).catch(()=>{});}
  const rows=[];
  for(const name of await readdir(root)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const file=join(root,name),info=await stat(file).catch(()=>null);if(info)rows.push({file,at:info.mtimeMs});}
  rows.sort((a,b)=>b.at-a.at);for(const row of rows.slice(64))await unlink(row.file).catch(()=>{});
  const pairSummaries=pairs.slice(0,8).map(p=>{
    const left=byId.get(p.left),right=byId.get(p.right);
    return {id:p.id,characters:p.characters,reference:Boolean(p.reference),
      left:{id:left.id,name:left.name,kind:left.kind,phase:left.phase,path:left.path??left.package??'',coverage:p.leftCoverage},
      right:{id:right.id,name:right.name,kind:right.kind,phase:right.phase,path:right.path??right.package??'',coverage:p.rightCoverage},
      matches:p.matches.slice(0,3).map(m=>({characters:m.characters,
        leftLines:'L'+m.left.line+(m.left.endLine!==m.left.line?'–'+m.left.endLine:''),
        rightLines:'L'+m.right.line+(m.right.endLine!==m.right.line?'–'+m.right.endLine:''),
        excerpt:left.text.slice(m.left.start,Math.min(m.left.end,m.left.start+140)).replace(/\s+/g,' ').trim()}))};
  });
  return {id,path,capturedAt:record.capturedAt,preset,workspace:record.workspace,count:selected.length,pairs:record.pairs.length,
    items:selected.map(({id,name,kind,phase,path,package:owner,field,hash,tokens,characters,origin})=>({id,name,kind,phase,path,package:owner,field,hash,tokens:tokens??null,characters:characters??null,origin:origin??null})),
    pairSummaries};
}
