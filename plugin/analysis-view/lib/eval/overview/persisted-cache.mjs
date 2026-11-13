import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Derived summaries only. Persistence revisions, never live process sequence
// numbers, authorize reuse after a restart. Corruption is a cache miss.
export class OverviewDiskCache {
  constructor(root, version, {maxBytes=64*1024*1024,maxEntries=1024,maxEntryBytes=20*1024*1024}={}) {
    Object.assign(this,{root,version,maxBytes,maxEntries,maxEntryBytes});
    this.writes=Promise.resolve();this.inventory=null;
  }
  path(id,cwd){return join(this.root,createHash('sha256').update(JSON.stringify([id,cwd])).digest('hex')+'.json');}
  reusable(revision){return typeof revision==='string'&&revision!=='missing'&&!revision.startsWith('live:');}
  async get(id,cwd,revision,signal){
    if(!this.reusable(revision))return null;
    try{
      const file=this.path(id,cwd),info=await stat(file);
      if(info.size>this.maxEntryBytes)return null;
      const row=JSON.parse(await readFile(file,{encoding:'utf8',signal}));
      signal?.throwIfAborted();
      return row.version===this.version&&row.id===id&&row.cwd===cwd&&row.revision===revision&&Array.isArray(row.models)&&Object.hasOwn(row,'data')?row:null;
    }catch(error){signal?.throwIfAborted();return null;}
  }
  put(id,cwd,revision,data,models,signal){
    if(!this.reusable(revision))return Promise.resolve();
    const text=JSON.stringify({version:this.version,id,cwd,revision,data,models});
    if(Buffer.byteLength(text)>this.maxEntryBytes)return Promise.resolve();
    const operation=this.writes.catch(()=>{}).then(async()=>{
      signal?.throwIfAborted();
      await mkdir(this.root,{recursive:true});
      const file=this.path(id,cwd),temp=file+'.'+randomUUID()+'.tmp';
      try{
        await writeFile(temp,text,{mode:0o600,signal});
        signal?.throwIfAborted();await rename(temp,file);
        await this.prune({file,bytes:Buffer.byteLength(text),at:Date.now()});
      }finally{await unlink(temp).catch(()=>{});}
    });
    this.writes=operation;
    return operation.catch(()=>{signal?.throwIfAborted();});
  }
  async prune(updated){
    // Only hash-named files owned by this cache, never the session log tree.
    if(!this.inventory){
      this.inventory=new Map();
      for(const name of await readdir(this.root)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const file=join(this.root,name);const info=await stat(file).catch(()=>null);if(info)this.inventory.set(file,{file,bytes:info.size,at:info.mtimeMs});}
    }
    this.inventory.set(updated.file,updated);
    const rows=[...this.inventory.values()].sort((a,b)=>b.at-a.at);let bytes=0;
    for(const [index,row]of rows.entries()){bytes+=row.bytes;if(index>=this.maxEntries||bytes>this.maxBytes){await unlink(row.file).catch(()=>{});this.inventory.delete(row.file);}}
  }
}

export function restoreOverviewModels(data,models,catalog){
  if(data===null)return null;
  const copy=structuredClone(data),map=models.map((route,index)=>index===0?0:catalog.index({provider:route.provider,model:route.name}));
  const index=value=>map[value]??0;
  for(const turn of copy.turns??[]){turn.model=index(turn.model);for(const request of turn.requests??[])request.model=index(request.model);}
  for(const row of copy.occupancy?.actions??[])row[10]=index(row[10]);
  return copy;
}
