import {generateTraceView} from '../../view/generate.mjs';
import {serveViewFile} from '../../view/serve.mjs';

export const codexViewTool={
  definition:{name:'trajectory_view',description:'为指定 Codex 对话生成轨迹树、会话 Eval 或代码执行视图，返回本机可打开的链接。读取已保存记录，不调用模型。',
    inputSchema:{type:'object',properties:{session:{type:'string',minLength:1,maxLength:256,description:'原生对话 ID。当前对话可从 CODEX_THREAD_ID 取得；不默认选择最近对话。'},
      view:{type:'string',enum:['trace','eval','code'],default:'trace'},language:{type:'string',enum:['auto','zh-CN','en'],default:'auto'}},required:['session'],additionalProperties:false}},
  async call(args,signal){
    if(!args||typeof args.session!=='string'||!args.session.trim()||args.session.length>256||Object.keys(args).some(key=>!['session','view','language'].includes(key)))throw Error('Provide a Codex session ID');
    const view=args.view??'trace',locale=args.language??'auto';
    if(!['trace','eval','code'].includes(view)||!['auto','zh-CN','en'].includes(locale))throw Error('Invalid view or language');
    const result=await generateTraceView({host:'codex',thread:args.session,initialView:view,locale},{signal});
    signal?.throwIfAborted();const served=await serveViewFile(result.output);
    const facts={host:'codex',view,session:args.session,file:result.output,url:served.url,totals:result.totals};
    return {structuredContent:facts,content:[{type:'text',text:JSON.stringify(facts)},
      {type:'resource_link',uri:served.url,name:view==='trace'?'轨迹树':view==='code'?'代码执行':'会话 Eval',mimeType:'text/html',description:'本机交互视图，可在浏览器或 Codex 预览面板打开。'}]};
  },
};
