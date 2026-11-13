import { renderOverviewPage } from '../plugin/analysis-view/lib/eval/overview/render.mjs';

// Reuse the real overview projector, findings, filters and evidence drawers.
// This wrapper only selects a section for the prototype's Eval navigation.
export function renderEvalDemo(data,{preset,view='window'}={}){
  const sessions=data.sessions.filter(session=>session.preset===preset);
  const failures=data.failures.filter(row=>row.preset===preset);
  const selected={...data,sessions,total:sessions.length+failures.length,done:sessions.length+failures.length,unread:failures.length};
  const section=view==='diagnosis'?'overview-findings':'window-section';
  const theme=`<link rel="stylesheet" href="/design/tokens.css"><style>
    :root{--ink:var(--tt-ink);--sub:var(--tt-muted);--muted:var(--tt-muted);--light:var(--tt-muted);--line:var(--tt-line);--line-strong:var(--tt-line);--grid:var(--tt-line);--blue:var(--tt-action);--blue-strong:var(--tt-action);--blue-soft:var(--tt-canvas);--surface:var(--tt-surface);--accent:var(--tt-action);color-scheme:light dark}
    html,body{background:var(--tt-surface);min-height:0;height:auto}body{color:var(--tt-ink)}
    .masthead,#overview-loading,#overview-page>.intro,#overview,.section:not(#${section}),.native-links{display:none!important}
    .container{width:100%;margin:0;padding:0;max-width:none}#overview-page{padding:0!important}
    .section{border:0;padding:24px 0 0}.section h2{font-size:22px;font-weight:550}.filters{gap:10px;padding:0 0 16px}
    .filters label{border-radius:6px;background:var(--tt-surface)}select,input,textarea{background:var(--tt-surface);color:var(--tt-ink)}
    .overview-findings{margin-top:0}#overview-findings>.findings-heading{margin-top:0}.retained-count{font-size:11px;color:var(--tt-muted);margin:0 0 14px;line-height:1.7}
    .drawer,.drawer-top,.drawer-body,.diagnosis-editor{background:var(--tt-surface);color:var(--tt-ink)}
    html:has(dialog[open]),body:has(dialog[open]){background:transparent}body:has(dialog[open]) #overview-page{visibility:hidden}
    html:has(#diagnosis-editor:not([hidden])),body:has(#diagnosis-editor:not([hidden])){background:transparent}
    body:has(#diagnosis-editor:not([hidden])) #overview-page{visibility:hidden}
    body:has(#diagnosis-editor:not([hidden])):before{content:'';position:fixed;inset:0;background:#0005;z-index:290}
    body #diagnosis-editor{--line:var(--tt-line);--ink:var(--tt-ink);--muted:var(--tt-muted);--action:var(--tt-action);background:var(--tt-surface);font-family:var(--tt-font-sans);top:0!important;left:auto!important;right:0;bottom:0;width:min(640px,100vw);max-height:none;height:100dvh;border-radius:0;padding:24px;display:flex;flex-direction:column}
    body #diagnosis-editor textarea,body #diagnosis-editor input,body #diagnosis-editor button{background:var(--tt-surface);color:var(--tt-ink)}
    body #diagnosis-editor textarea{flex:1;min-height:120px;resize:none}body #diagnosis-editor .editor-head h2{font-size:18px}body #diagnosis-editor .intents{margin:20px 0 14px}body #diagnosis-editor .editor-actions{margin-top:16px}
    body #diagnosis-editor .intents button[aria-pressed=true]{color:var(--tt-ink);background:var(--tt-soft);border-color:var(--tt-muted)}
    @media(prefers-color-scheme:dark){:root{--blue:var(--tt-metric);--blue-strong:var(--tt-metric);--accent:var(--tt-metric)}}
    @media(max-width:560px){.filters{gap:8px}.filters label{padding:0 6px}.filter-note{width:100%}}
  </style>`;
  const bridge=`<script>
    window.__trajectoryDiagnosisOptions.allowApply=false;
    const sendHeight=()=>parent.postMessage({type:'eval-demo-height',height:Math.ceil(document.getElementById('overview-page').getBoundingClientRect().height)+30},location.origin);
    new ResizeObserver(sendHeight).observe(document.getElementById('overview-page'));sendHeight();
    const sendModal=()=>parent.postMessage({type:'eval-demo-modal',open:Boolean(document.querySelector('dialog[open],#diagnosis-editor:not([hidden])'))},location.origin);
    for(const element of document.querySelectorAll('dialog,#diagnosis-editor'))new MutationObserver(sendModal).observe(element,{attributes:true,attributeFilter:['open','hidden']});
  </script>`;
  return renderOverviewPage({data:selected,locale:'zh-CN'}).replace('</head>',theme+'</head>')
    .replace('<main class="container" id="overview-page" hidden>','<main class="container" id="overview-page" hidden><p class="retained-count">'+sessions.length+' 个同预设会话已纳入'+(failures.length?' · '+failures.length+' 条记录无法解析，未纳入统计':'')+'。</p>')
    .replace('allowApply:true','allowApply:false').replace('</body>',bridge+'</body>');
}
