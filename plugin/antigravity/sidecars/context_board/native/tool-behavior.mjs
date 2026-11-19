// Presentation semantics. Native names/arguments remain available for evidence.
const toolAliases = {Read:'read',Write:'write',Edit:'edit',MultiEdit:'multi_edit',Grep:'grep',Glob:'glob',Bash:'bash',WebSearch:'web_search',WebFetch:'web_fetch',AskUserQuestion:'ask_user_question',TodoWrite:'todo_write',Task:'subagent'};
export function canonicalToolName(name) { return toolAliases[name] || name; }
export function commandIntent(command) {
  let body = Array.isArray(command) ? String(command.at(-1) || '') : String(command || '');
  const wrapper = body.match(/^\s*(?:&\s*)?["']?(?:[^\r\n"']*[\\/])?(?:pwsh|powershell)(?:\.exe)?["']?\s+[\s\S]*?-Command\s+([\s\S]*)$/i);
  if (wrapper) {body=wrapper[1].trim();if (/^["']/.test(body) && body.at(-1)===body[0]) body=body.slice(1,-1);}
  const head = body.trim().match(/^(?:&\s*)?(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;|]+))\s*([\s\S]*)$/);
  const verb = (head?.[1] || head?.[2] || head?.[3] || '').split(/[\\/]/).at(-1).replace(/\.exe$/i,'').toLowerCase(), rest=head?.[4] || '';
  const options = rest.replace(/"(?:\\.|`.|[^"\\])*"|'(?:''|[^'])*'/g,'');
  if (['rg','grep','select-string'].includes(verb) || verb==='git' && /^grep\b/.test(rest)) return {family:'search',tool:verb==='rg' && /(?:^|\s)--files(?:\s|$)/.test(options)?'glob':'grep'};
  if (['get-childitem','ls','dir'].includes(verb)) return {family:'search',tool:'glob'};
  if (['get-content','gc','cat','head','tail'].includes(verb)) return {family:'read',tool:'read'};
  return {family:'command'};
}
export function toolVisualFamily(call) {
  const declared=call.classification?.family || call.semanticFamily;
  if (declared) return declared;
  const name=canonicalToolName(call.name || call.nativeName || '');
  let args=call.args || call.arguments || {};
  if (args?.text != null) {try{args=JSON.parse(args.text);}catch{args={};}}
  if (['read','read_file','read_text_file','read_image'].includes(name)) return 'read';
  if (['edit','multi_edit','write','write_file','apply_patch'].includes(name)) return 'write';
  if (['grep','glob','search','trajectory_search','trajectory_read','session_search','session_event_search'].includes(name)) return 'search';
  if (['web_search','web_fetch','fetch_url'].includes(name)) return 'web';
  if (['pwsh','powershell','bash','shell','terminal','exec_command','commandExecution'].includes(name)) return commandIntent(args.command ?? args.cmd).family;
  if (/^run_?code$/i.test(name)) return 'command';
  if (/^(job_|get_terminal|write_stdin)/.test(name)) return 'process';
  if (['subagent','subagent_fork','send_message','list_agents','team_task_update','update_goal','create_goal','get_goal','todo_write'].includes(name)) return 'coordination';
  const kind=call.classification?.kind || call.semanticKind;
  return ({read:'read',write:'write',run:'command',query:'search'})[kind] || 'other';
}
export function toolBehaviorRuntime() {
  return `(()=>{const toolAliases=${JSON.stringify(toolAliases)};${canonicalToolName.toString()}\n${commandIntent.toString()}\n${toolVisualFamily.toString()}\nObject.assign(globalThis,{__trajectoryCanonicalTool:canonicalToolName,__trajectoryToolFamily:toolVisualFamily});})();`;
}
