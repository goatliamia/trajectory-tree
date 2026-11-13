// DSH 0.2.2-rc.2 StatsTable.tsx TOOL_TONES / toneIndex and stats.module.css.
// These identify tools, independently of call outcome and context provenance.
const fixedToolTones = { read:0, glob:1, grep:1, edit:2, write:2, apply_patch:2,
  pwsh:4, powershell:4, shell:4, bash:4, web_fetch:5, web_search:5, ask_user_question:3,
  todo_write:7, subagent:5, subagent_fork:5 };
export function toolToneIndex(name) {
  if (name == null) return 7;
  if (Object.hasOwn(fixedToolTones, name)) return fixedToolTones[name];
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) % 9973;
  return hash % 8;
}
export function toolColor(name) { return `var(--tt-tool-tone-${toolToneIndex(name)})`; }
export function toolNameHtml(name, label = name ?? '?') {
  const text = String(label).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<span class="tt-tool-name" data-tool-tone="${toolToneIndex(name)}">${text}</span>`;
}
export function toolColorRuntime() {
  return `(()=>{const fixedToolTones=${JSON.stringify(fixedToolTones)};${toolToneIndex.toString()}\n${toolColor.toString()}\n${toolNameHtml.toString()}\nObject.assign(globalThis,{__trajectoryToolTone:toolToneIndex,__trajectoryToolColor:toolColor,__trajectoryToolName:toolNameHtml});})();`;
}
export function toolColorCss() {
  const aliases=['state-business-primary','state-success-primary','state-warn-primary','state-error-secondary',
    'brand-primary-new-colorprimary-new-color','state-success-secondary','state-warn-label','label-caption'];
  // Exact fallbacks from dsh-client-ui-theme/styles/design-platform.css.
  const light=['#4176e6','#22c55e','#f59e0b','#f25a5a','#4176e6','#4ed17e','#dd8629','#adb2b8'];
  const dark=['#7aaaff','#22c55e','#f59e0b','#f25a5a','#5686fe','#4ed17e','#dd8629','#81858c'];
  const values=colors=>colors.map((color,i)=>`--tt-tool-fallback-${i}:${color};`).join('');
  const tones=aliases.map((alias,i)=>`--tt-tool-tone-${i}:var(--dsw-alias-${alias},var(--tt-tool-fallback-${i}));`).join('');
  return `:root{${values(light)}}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){${values(dark)}}}
:root[data-theme="dark"],body[data-ds-dark-theme]{${values(dark)}}
:root,body{${tones}--tt-duration-ttft:color-mix(in srgb,var(--tt-tool-tone-0) 50%,transparent);--tt-duration-decode:var(--tt-tool-tone-0);--tt-duration-tool:var(--tt-tool-tone-2);--tt-duration-rest:var(--tt-tool-tone-7);}
${aliases.map((_,i)=>`[data-tool-tone="${i}"]{--tt-tool-color:var(--tt-tool-tone-${i});}`).join('\n')}
.tt-tool-name{color:var(--tt-tool-color);font-weight:500}
`;
}
