export const nativeWorkspace=()=>window.__trajectoryWorkspace?.native===true;
export function apiUrl(path){
  const base=window.__trajectoryWorkspace?.base;
  const url=new URL((base??'')+path,location.origin),workspace=new URL(location.href).searchParams.get('workspace');
  if(workspace)url.searchParams.set('workspace',workspace);
  if(!url.searchParams.has('period'))url.searchParams.set('period',new URL(location.href).searchParams.get('period')??'7');return url.href;
}
export const apiFetch=(path,options)=>fetch(apiUrl(path),options);

export function sendDiagnosisDraft(prompt,sessionId){
  if(!nativeWorkspace()||window.parent===window)return Promise.resolve(false);
  const requestId=crypto.randomUUID();
  return new Promise(resolve=>{
    const done=applied=>{clearTimeout(timer);window.removeEventListener('message',receive);resolve(applied);};
    const receive=event=>{const message=event.data;if(event.origin!==location.origin||event.source!==window.parent||message?.type!=='analysis-diagnosis-ack'||message.requestId!==requestId)return;done(message.applied===true);};
    const timer=setTimeout(()=>done(false),4000);window.addEventListener('message',receive);
    window.parent.postMessage({type:'analysis-diagnosis-draft',sessionId,prompt,requestId},location.origin);
  });
}

export async function wireDraftActions(root,{prompt,preferredSession}={}){
  const field=typeof prompt==='function'?prompt:()=>root.querySelector('textarea')?.value??'';
  const actions=document.createElement('div');actions.className='diagnosis-delivery';
  const status=document.createElement('span');status.role='status';
  const copy=document.createElement('button');copy.type='button';copy.className='tt-button';copy.textContent='复制草稿';
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(field());status.textContent='已复制';}catch{root.querySelector('textarea')?.select();status.textContent='请复制选中的文字';}};
  actions.append(copy,status);root.append(actions);
  if(!nativeWorkspace())return;
  try{
    const response=await apiFetch('/api/conversations');if(!response.ok)throw Error();
    const {sessions}=await response.json();if(!root.isConnected||!sessions.length)return;
    const label=document.createElement('label');label.textContent='目标对话';
    const select=document.createElement('select');select.setAttribute('aria-label','填入草稿的目标对话');
    for(const session of sessions){const option=document.createElement('option');option.value=session.id;option.textContent=session.title;select.append(option);}
    if(sessions.some(s=>s.id===preferredSession))select.value=preferredSession;
    label.append(select);
    const fill=document.createElement('button');fill.type='button';fill.className='tt-button diagnosis-fill';fill.textContent='填入对话';
    fill.onclick=async()=>{fill.disabled=true;status.textContent='';const applied=await sendDiagnosisDraft(field(),select.value);status.textContent=applied?'已填入，尚未发送':'未能填入，可复制草稿';fill.disabled=false;};
    actions.prepend(label,fill);
  }catch{status.textContent='目标对话暂时不可读，可复制草稿';}
}
