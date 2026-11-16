import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ui,resolveUiLocale} from '../../lib/i18n.mjs';

test('native sidebar follows host language without walking the DSH conversation',()=>{
  let changed;const events=new Map(),element={lang:'en',hasAttribute:()=>false};
  const context={translate:ui,resolveUiLocale,installUi(){throw Error('must not translate the shared DSH document');},document:{documentElement:element},
    location:{href:'http://localhost/'},localStorage:{getItem:()=>null},navigator:{languages:['zh-CN']},URL,
    addEventListener:(name,callback)=>events.set(name,callback),MutationObserver:class{constructor(callback){changed=callback;}observe(){}},window:{},parent:{}};
  context.parent=context.window;
  const source=readFileSync(new URL('./ui-locale.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replaceAll('export ','')+'\nresult={currentLocale,ui};';
  vm.runInNewContext(source,context);
  assert.equal(context.result.currentLocale(),'en');
  assert.equal(context.result.ui('当前上下文'),'Current context');
  const evidence='工具输出.js：原始中文内容';
  assert.equal(vm.runInNewContext('result.ui`<h2>当前上下文</h2><pre>${evidence}</pre>`',{...context,evidence}),'<h2>Current context</h2><pre>'+evidence+'</pre>');
  element.lang='zh-CN';changed();
  assert.equal(context.result.currentLocale(),'zh-CN');assert.equal(context.result.ui('当前上下文'),'当前上下文');
});
