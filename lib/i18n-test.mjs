import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ui, normalizeLocale, resolveUiLocale, withUiLocale, i18nRuntime, i18nModuleSource } from './i18n.mjs';
import { hostCapabilities } from './host-capabilities.mjs';
import { MESSAGES_A } from './i18n-catalog-a.mjs';
import { MESSAGES_B } from './i18n-catalog-b.mjs';
import { MESSAGES_C } from './i18n-catalog-c.mjs';
import { MESSAGES_D } from './i18n-catalog-d.mjs';
import { presentCallFact } from '../docs/demo/layout-review/step-insight.mjs';

assert.equal(normalizeLocale('en-US'),'en');assert.equal(normalizeLocale('zh-Hans'),'zh-CN');assert.equal(normalizeLocale('auto'),null);
assert.throws(()=>normalizeLocale('fr'),/Language/);
assert.equal(resolveUiLocale({query:'zh',preferred:'en',stored:'en',host:'en',languages:['en-US']}),'zh-CN');
assert.equal(resolveUiLocale({stored:'zh',host:'en',languages:['en-US']}),'zh-CN');
assert.equal(resolveUiLocale({host:'zh',languages:['en-US']}),'zh-CN','The host language wins over browser language');
assert.equal(resolveUiLocale({query:'auto',preferred:'en',stored:'en',host:'zh'}),'zh-CN','Auto removes fixed export and saved overrides');
assert.equal(resolveUiLocale({preferred:'auto',stored:'en',host:'zh'}),'zh-CN','An explicit CLI auto setting bypasses the saved manual choice');
assert.equal(resolveUiLocale({query:'en',preferred:'auto',host:'zh'}),'en','A page URL can override the export auto mode');
assert.equal(resolveUiLocale({languages:['ja-JP','en-GB','zh-CN']}),'en','Match the first supported browser preference');
assert.equal(resolveUiLocale({languages:['ja-JP']}),'en');
assert.equal(ui('未记录'),'未记录');assert.equal(ui('未记录','en'),'Not recorded');
const native = '工具输出，D:\\中文\\修改文件.js <script>原文</script>';
const result = withUiLocale('en',()=>ui`<strong>工具输出</strong>${native}`);
assert.equal(result,'<strong>Tool output</strong>'+native,'Interpolated native text is never translated or rewritten');
assert.equal(withUiLocale('en',()=>ui`第 ${3} 轮 / 第 ${2} 步`),'Turn 3 / Step 2');
const storedFact={seq:1,title:'旧说明',outcome:'原说明',detail:'原详情',preview:{before:native,after:native},tone:'normal',operation:{family:'read'},target:'/中文/工具输出.js',resultSeq:2};
const savedLocale=globalThis.__trajectoryLocale;
try {
  globalThis.__trajectoryLocale='en';
  const localized=presentCallFact({seq:1,name:'read',target:storedFact.target,args:{text:JSON.stringify({path:storedFact.target}),omitted:0},result:{text:native,omitted:0},status:'returned',resultSeq:2},storedFact);
  assert.ok(localized.title.includes('工具输出.js'),'A filename resembling a translation key is preserved');
  assert.deepEqual({...localized,title:storedFact.title,outcome:storedFact.outcome,detail:storedFact.detail},storedFact,'Language only changes presentation text, retaining previews and operation evidence');
} finally { if(savedLocale===undefined)delete globalThis.__trajectoryLocale;else globalThis.__trajectoryLocale=savedLocale; }
assert.throws(()=>withUiLocale('en',()=>{throw Error('render failure');}));
assert.equal(ui('未记录'),'未记录','A failed render cannot leak its locale');
assert.equal(withUiLocale('en',()=>withUiLocale('zh-CN',()=>ui('未记录'))),'未记录');
for(const [key,value] of Object.entries({...MESSAGES_A,...MESSAGES_B,...MESSAGES_C,...MESSAGES_D})) {
  assert.equal(typeof value,'string',key);assert.ok(!/[\u3400-\u9fff]/.test(value),'Untranslated catalog entry: '+key);
}
new vm.Script(i18nRuntime('en'));
const generated = await import('data:text/javascript;base64,'+Buffer.from(i18nModuleSource()).toString('base64'));
assert.equal(generated.ui('未记录','en'),'Not recorded','The self-contained DSH model dependency uses the same catalog');
for(const host of ['codex','pi','claude']) {
  const cap=hostCapabilities({host,context:{current:null}});
  assert.equal(cap.chatJump,false);assert.equal(cap.childHistory,'unavailable');assert.equal(cap.contextComposition,'unavailable');
}
assert.equal(hostCapabilities({traceCapabilities:{history:true}}).history,true);
assert.equal(hostCapabilities({}).chatJump,true);
assert.equal(hostCapabilities({host:'codex',traceCapabilities:{chatJump:true,history:true}}).chatJump,false,'Stale DSH capabilities cannot enable its bridge in another host');
console.log('I18n: locale normalization, complete catalogs, scoped rendering, preserved evidence and host capability boundaries passed.');
