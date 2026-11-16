import {ui as translate,resolveUiLocale,installUi} from './i18n.mjs';

const workspace=typeof document!=='undefined'&&document.documentElement.hasAttribute('data-trajectory-workspace');
function resolve(){
  if(typeof document==='undefined')return 'zh-CN';
  let query,stored,host=workspace?null:document;
  try{query=new URL(location.href).searchParams.get('lang');}catch{}
  try{stored=localStorage.getItem('trajectory-language');}catch{}
  try{if(parent!==window&&parent.location.origin===location.origin)host=parent.document;}catch{}
  return resolveUiLocale({query,stored,host:host?.documentElement.lang,languages:[...(navigator.languages??[]),navigator.language]});
}
let language=resolve();
export const currentLocale=()=>language;
export function ui(text,...values){
  if(Array.isArray(text)&&Object.hasOwn(text,'raw')){
    const pattern=text.map((part,index)=>part+(index<values.length?'\ue000'+index+'\ue001':'')).join('');
    const localized=language==='en'?pattern.replace(/第\s*(\ue000\d+\ue001)\s*轮/g,'Turn $1').replace(/第\s*(\ue000\d+\ue001)\s*步/g,'Step $1'):pattern;
    return translate(localized,language).replace(/\ue000(\d+)\ue001/g,(_,index)=>String(values[Number(index)]));
  }
  return translate(text,language);
}
if(typeof document!=='undefined'){
  // Only the dedicated Eval document contains a static authored shell. A native
  // sidebar shares DSH's document, so it must never walk that document's text.
  if(workspace)installUi(undefined,false);
  const refresh=()=>{language=resolve();};
  addEventListener('storage',event=>{if(event.key==='trajectory-language'||event.key===null)refresh();});
  addEventListener('languagechange',refresh);
  let host=workspace?null:document;
  try{if(parent!==window&&parent.location.origin===location.origin)host=parent.document;}catch{}
  if(host)new MutationObserver(refresh).observe(host.documentElement,{attributes:true,attributeFilter:['lang']});
}
