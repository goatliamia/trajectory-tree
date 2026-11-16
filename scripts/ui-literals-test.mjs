import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {compileUiLiterals} from './ui-literals.mjs';
import {ui,withUiLocale} from '../lib/i18n.mjs';

test('UI compilation translates authored markup without translating interpolated evidence',()=>{
  const native='工具输出.js\n修复实现：原始日志内容。';
  const source='const render = value => `<h2>当前上下文</h2><pre>${value}</pre>` + "工具输出"; render(input);';
  const compiled=compileUiLiterals(source).replace(/^import[^\n]+\n/,'');
  const translated=withUiLocale('en',()=>vm.runInNewContext(compiled,{__ttUi:ui,input:native}));
  assert.equal(translated,'<h2>Current context</h2><pre>'+native+'</pre>Tool output');
  assert.equal(withUiLocale('zh-CN',()=>vm.runInNewContext(compiled,{__ttUi:ui,input:native})),'<h2>当前上下文</h2><pre>'+native+'</pre>工具输出');
});
test('UI compilation keeps keys and dynamic evidence stable and emits valid JavaScript',()=>{
  const source='const labels={"工具输出":"当前上下文"}; labels["工具输出"];';
  const compiled=compileUiLiterals(source).replace(/^import[^\n]+\n/,'');
  new vm.Script(compiled);
  assert.match(compiled,/{"工具输出":__ttUi\("当前上下文"\)}/);
  assert.equal(withUiLocale('en',()=>vm.runInNewContext(compiled,{__ttUi:ui})),'Current context');
  const semantic=compileUiLiterals('data==="工具输出" && ["工具输出"].includes(data);').replace(/^import[^\n]+\n/,'');
  assert.equal(withUiLocale('en',()=>vm.runInNewContext(semantic,{__ttUi:ui,data:'工具输出'})),true);
  assert.equal(compileUiLiterals('export const value = input;'),'export const value = input;');
  assert.equal(compileUiLiterals('import value from "./中文文件.js"; export {value};'),'import value from "./中文文件.js"; export {value};');
});
