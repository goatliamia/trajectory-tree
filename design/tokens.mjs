// Trajectory Tree visual source of truth. Source colors match the final Geist
// render layer of the existing path view, not its pre-theme model defaults.
export const CONTEXT_SERIES = [
  ['system','系统提示','#8053e3'],['tools','工具定义','#d49b00'],['user','用户输入','#44a56b'],
  ['inject','运行时注入','#c442a7'],['skill','技能内容','#e66d26'],['assistant','模型输出（含思考）','#5b9fe8'],['tool','工具输出','#3ab4a4'],
];
export const VISUAL_TOKENS = {
  surface:'#ffffff',canvas:'#fafafa',ink:'#171717',muted:'#666666',line:'#e6e6e6',grid:'#ededed',soft:'#f5f5f5',
  action:'#0068d6',metric:'#3485ed',success:'#087b58',error:'#c72b31',warning:'#b87800',retry:'#8745d9',changePulse:'#c72b31',
  request:{uncachedInputTokens:'#f59a36',cacheReadTokens:'#3485ed',cacheWriteTokens:'#9561dd',outputTokens:'#1aaa91'},
  font:{sans:"Geist,'Segoe UI','Microsoft YaHei',sans-serif",mono:"GeistMono,'Geist Mono',Consolas,'Microsoft YaHei',monospace"},
  type:{body:14,label:12,meta:11,section:18,title:28,metric:28},
  space:[4,8,12,16,24,32,40],radius:{control:6,popover:12},
  opacity:{source:1,area:.22,inactive:.18},motion:{feedback:140,mark:550,fracture:650,insert:850,hold:1000},
};

const DARK_TOKENS = { surface:'#0a0a0a', canvas:'#151515', ink:'#ededed', muted:'#a1a1a1', line:'#303030', grid:'#292929', soft:'#222222' };
// Dark context series: the seven hues re-balanced for a near-black surface. They
// match the path view's own dark block, which a light-only alias emission used to
// override once the tokens were injected last.
const DARK_CONTEXT = { system:'#a78bfa', tools:'#eab308', user:'#4fc77a', inject:'#e879c6', skill:'#fb923c', assistant:'#4c9fff', tool:'#21c4ad' };
export function visualTokenCss({legacyAliases=false}={}){
  const t=VISUAL_TOKENS,vars=[];
  for(const key of ['surface','canvas','ink','muted','line','grid','soft','action','metric','success','error','warning','retry','changePulse'])vars.push('--tt-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+t[key]);
  for(const [key,,color]of CONTEXT_SERIES)vars.push('--tt-context-'+key+':'+color);
  for(const [key,color]of Object.entries(t.request))vars.push('--tt-request-'+key+':'+color);
  vars.push('--tt-font-sans:'+t.font.sans,'--tt-font-mono:'+t.font.mono);
  for(const [key,value]of Object.entries(t.type))vars.push('--tt-type-'+key+':'+value+'px');
  for(const value of t.space)vars.push('--tt-space-'+value+':'+value+'px');
  for(const [key,value]of Object.entries(t.radius))vars.push('--tt-radius-'+key+':'+value+'px');
  for(const [key,value]of Object.entries(t.opacity))vars.push('--tt-opacity-'+key+':'+value);
  for(const [key,value]of Object.entries(t.motion))vars.push('--tt-motion-'+key+':'+value+'ms');
  if(legacyAliases){
    for(const [key,,color]of CONTEXT_SERIES)vars.push('--chart-'+key+':'+color);
    for(const [alias,key]of Object.entries({surface:'surface',ink:'ink',muted:'muted',line:'line',grid:'grid',soft:'soft',accent:'action',sans:'font-sans',mono:'font-mono'}))vars.push('--'+alias+':var(--tt-'+key+')');
  }
  // 亮暗两套都输出:只给亮色时,后注入的 legacy 别名会把 dark 变量覆盖回白色。
  // 分类色同理——只发亮色会让页面在深色下继续用亮色七类色。
  const dark = [
    ...Object.entries(DARK_TOKENS).map(([key, value]) => '--tt-' + key + ':' + value),
    ...CONTEXT_SERIES.map(([key]) => '--tt-context-' + key + ':' + DARK_CONTEXT[key]),
    ...(legacyAliases ? CONTEXT_SERIES.map(([key]) => '--chart-' + key + ':' + DARK_CONTEXT[key]) : []),
  ].join(';');
  return ':root{' + vars.join(';') + '}\n@media (prefers-color-scheme: dark){:root{' + dark + '}}\n';
}
