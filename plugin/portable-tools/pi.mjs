import { TOOLS, executeTool } from './tools.mjs';
import { PortableService } from './service.mjs';
import { datasetFromNative } from './sources.mjs';
import { dirname } from 'node:path';
import {generateTraceView} from '../../view/generate.mjs';
import {generateOverviewView} from '../../view/overview.mjs';
import {serveViewFile,openViewBrowser} from '../../view/serve.mjs';

const trajectoryUsage = '用法：/trajectory [--eval | --overview | --code] [--lang en|zh-CN|auto] [--no-open] 或 /trajectory --draft <内容>';

function readEvalDraft(encoded) {
  if (!encoded || encoded.length > 16 * 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error('无效的 Eval 草稿命令。');
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) throw Error('无效的 Eval 草稿命令。');
  let draft;
  try { draft = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw Error('无效的 Eval 草稿命令。'); }
  if (typeof draft?.session !== 'string' || !draft.session || typeof draft.prompt !== 'string' ||
      !draft.prompt.trim() || Buffer.byteLength(draft.prompt, 'utf8') > 8 * 1024) throw Error('无效的 Eval 草稿命令。');
  return draft;
}

// The extension reads session evidence and only stages drafts on explicit user commands.
export default function trajectoryExtension(pi) {
  const sessions = new Map(), timing = new Map();
  function viewInput(ctx){
    const manager=ctx.sessionManager,id=manager.getSessionId(),active=new Set(pi.getActiveTools());
    return {header:{type:'session',version:3,id,cwd:ctx.cwd},entries:manager.getEntries(),leafId:manager.getLeafId(),
      capture:[...(timing.get(id)?.values()||[])].flat(),source:{name:'Pi read-only SessionManager',file:manager.getSessionFile()},
      scope:{source:'pi-sdk-current-scope',observedAt:new Date().toISOString(),systemPrompt:ctx.getSystemPrompt(),
        tools:pi.getAllTools().map(t=>({name:t.name,description:t.description,parameters:t.parameters,active:active.has(t.name),exposure:t.exposure,reachesTools:t.reachesTools,source:t.source})),
        model:ctx.model?.id,provider:ctx.model?.provider,contextWindow:ctx.model?.contextWindow??null}};
  }
  function observe(event, ctx) {
    const session = ctx.sessionManager.getSessionId();
    if (!timing.has(session)) timing.set(session, new Map());
    const calls = timing.get(session), list = calls.get(event.toolCallId) || [];
    list.push({ observedAt: Date.now(), event: { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, durationMs: event.durationMs } });
    calls.set(event.toolCallId, list.slice(-2));
    while (calls.size > 2000) calls.delete(calls.keys().next().value);
    while (timing.size > 2) timing.delete(timing.keys().next().value);
  }
  pi.on('tool_execution_start', observe); pi.on('tool_execution_end', observe);
  pi.on('session_shutdown', () => { for (const entry of sessions.values()) entry.service.dispose(); sessions.clear(); timing.clear(); });
  pi.registerCommand?.('trajectory',{
    description:'打开当前分支的轨迹树或 Eval、项目总览，或载入 Eval 草稿',
    async handler(args,ctx){
      const flags = args.trim().split(/\s+/).filter(Boolean);
      if (flags[0] === '--draft') {
        if (flags.length !== 2) { ctx.ui.notify(trajectoryUsage, 'warning'); return; }
        try {
          const draft = readEvalDraft(flags[1]);
          if (draft.session !== ctx.sessionManager.getSessionId()) throw Error('草稿属于另一个 Pi 会话。请切换到原会话。');
          // RPC can emit set_editor_text, but its getEditorText always returns an empty string.
          if (ctx.mode !== 'tui' || !ctx.hasUI || typeof ctx.ui.setEditorText !== 'function' || typeof ctx.ui.getEditorText !== 'function') {
            ctx.ui.notify('当前客户端无法载入 Eval 草稿。可在 Eval 页面复制提示词。', 'warning');
          } else if (ctx.ui.getEditorText()) {
            ctx.ui.notify('已保留输入框中的草稿。可在 Eval 页面复制提示词。', 'warning');
          } else {
            ctx.ui.setEditorText(draft.prompt);
            ctx.ui.notify('Eval 草稿已载入输入框。', 'info');
          }
        } catch (error) { ctx.ui.notify(error.message, 'warning'); }
        return;
      }
      const langAt = flags.indexOf('--lang');
      const locale = langAt < 0 ? undefined : flags.splice(langAt, 2)[1];
      const english = (locale === 'auto' || !locale ? Intl.DateTimeFormat().resolvedOptions().locale : locale).startsWith('en');
      if ((langAt >= 0 && !['en', 'zh-CN', 'auto'].includes(locale)) || new Set(flags).size !== flags.length
          || flags.some(flag => !['--eval', '--overview', '--code', '--no-open'].includes(flag)) || flags.filter(flag=>['--eval','--overview','--code'].includes(flag)).length>1) {
        ctx.ui.notify(trajectoryUsage, 'warning'); return;
      }
      try{
        const codeView = flags.includes('--code'), evalView = flags.includes('--eval') || codeView;
        const input = viewInput(ctx), overview = flags.includes('--overview');
        const view = overview ? await generateOverviewView({ host: 'pi', input, locale,
          directory: input.source.file ? dirname(input.source.file) : undefined })
          : await generateTraceView({ host: 'pi', input, locale, initialView: codeView ? 'code' : evalView ? 'eval' : undefined });
        const { url } = await serveViewFile(view.output);
        if (!flags.includes('--no-open')) await openViewBrowser(url);
        const title = overview ? (english ? 'Eval overview' : 'Eval 总览') : codeView ? (english ? 'Code execution' : '代码执行') : evalView ? 'Eval' : (english ? 'Trajectory Tree' : '轨迹树');
        ctx.ui.notify(title + ' · ' + url, 'info');
      }catch(error){ctx.ui.notify('轨迹树：'+error.message,'error');}
    },
  });
  for (const tool of TOOLS) pi.registerTool({ name: tool.name, label: tool.name, description: tool.description, parameters: tool.parameters,
    async execute(_callId, args, signal, _onUpdate, ctx) {
      const id = ctx.sessionManager.getSessionId();
      let entry = sessions.get(id);
      if (!entry) {
        entry = { ctx };
        entry.service = new PortableService({ catalog: () => [{ session: id, host: 'pi', source: 'current selected branch' }], load: async session => {
          if (session && !['current', id].includes(session)) throw Error('Use the current Pi session; bind other files through CLI/MCP');
          const current = entry.ctx, manager = current.sessionManager;
          if (manager.getSessionId() !== id) throw Error('Pi session switched; request a new inspection');
          return datasetFromNative('pi', viewInput(current));
        } });
        sessions.set(id, entry);
        while (sessions.size > 1) { const old = sessions.keys().next().value; sessions.get(old).service.dispose(); sessions.delete(old); }
      }
      entry.ctx = ctx;
      const result = await executeTool(entry.service, tool.name, args, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { snapshot: result.snapshot, host: 'pi', session: id } };
    },
  });
}
