import { randomBytes } from 'node:crypto';
export function managementHttp(service,{origin,onSaved=async()=>{}}){
  const token=randomBytes(32).toString('hex');
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/management/'))return false;
    const send=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}).end(JSON.stringify(data));
    const expected=origin();
    if(req.headers.host!==new URL(expected).host||req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==expected){send(403,{error:'请从本机 Eval 页面发起操作'});return true;}
    try{
      if(req.method==='GET'&&url.pathname==='/api/management/inventory'){
        const preset=url.searchParams.get('preset');if(!preset||preset.length>100)throw Error('缺少预设');
        send(200,{...await service.list(preset),token});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/management/skill-scopes'){
        const name=url.searchParams.get('name');if(!name||name.length>120)throw Error('缺少 Skill 名称');
        send(200,{...await service.skillScopes(name),token});return true;
      }
      if(req.method!=='POST'){send(405,{error:'不支持的操作'});return true;}
      if(req.headers.origin!==expected||req.headers['x-trajectory-token']!==token||req.headers['content-type']!=='application/json'){send(403,{error:'操作凭据已失效，请刷新页面'});return true;}
      const buffers=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>16384)throw Error('操作内容过大');buffers.push(chunk);}
      const body=JSON.parse(Buffer.concat(buffers).toString('utf8'));
      if(!body||typeof body!=='object'||Array.isArray(body))throw Error('操作格式错误');
      if(url.pathname==='/api/management/preview'){
        if(Object.keys(body).some(k=>!['preset','id','enabled'].includes(k))||typeof body.preset!=='string'||body.preset.length>100||!/^[a-f0-9]{64}$/.test(body.id))throw Error('加载项标识无效');
        send(200,await service.preview(body));
      }else if(url.pathname==='/api/management/commit'){
        if(Object.keys(body).length!==1||typeof body.token!=='string'||body.token.length>80)throw Error('确认凭据无效');
        const result=await service.commit(body.token);
        try{await onSaved();}catch{result.refreshWarning=true;}
        send(200,result);
      }else send(404,{error:'操作不存在'});
    }catch(error){send(409,{error:error.message??'操作未完成'});}
    return true;
  };
}
