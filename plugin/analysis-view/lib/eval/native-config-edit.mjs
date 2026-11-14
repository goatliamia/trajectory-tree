import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';

// The native editor owns the profile lock, schema validation, YAML preservation,
// Loader reconciliation and rollback. Do not wrap it in another profile lock.
export async function editNativeConfig(ctx,change,source){
  const editor=ctx.get('configEditor');
  if(!editor)throw Error('DSH 配置编辑服务尚未就绪，请稍后重试');
  // entries() already returns only unique profile ids; Loader may normalize the
  // module name to a file URL, so the persisted spelling is not its identity.
  const entry=editor.entries().find(row=>row.options.id===change.patch.id);
  if(!entry)throw Error('预设配置已变化，请刷新后重试');
  await editor.edit(entry,current=>{
    let text=null;try{text=readFileSync(editor.documentPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(text!==change.before||!isDeepStrictEqual(current,change.currentConfig))throw Error('配置已变化，请刷新并重新确认');
    if(source&&readFileSync(source.path,'utf8')!==source.text)throw Error('Skill 正文已变化，请重新确认');
    return structuredClone(change.patch.config);
  });
}
