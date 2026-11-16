import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceFingerprint,selectSources} from '../../scripts/code-status.mjs';

test('a clean-commit byte change invalidates the scan even with the same paths',()=>{
  const root=mkdtempSync(join(tmpdir(),'code-status-'));
  try{
    writeFileSync(join(root,'same.mjs'),'export const value=1;');
    const before=sourceFingerprint(root,['same.mjs']);
    assert.equal(before,sourceFingerprint(root,['same.mjs']));
    writeFileSync(join(root,'same.mjs'),'export const value=2;');
    assert.notEqual(before,sourceFingerprint(root,['same.mjs']));
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('the source inventory covers the formal UI and excludes regression fixtures',()=>{
  const files=selectSources(process.cwd());
  assert.ok(files.includes('docs/demo/preset-context/skill-manager.js'));
  assert.ok(files.includes('docs/demo/layout-review/preserved.js'));
  assert.ok(!files.includes('plugin/portable-tools/test.mjs'));
  assert.ok(!files.some(file=>file.startsWith('test/')));
});
