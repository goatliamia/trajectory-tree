import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSkillDescriptions } from './skill-description-candidates.mjs';

const skill=(name,description,origin='personal',body='')=>({name,description,body,provenance:{origin}});
const cases=[
  {name:'exact description copied into a user Skill',left:'Review pull requests for security vulnerabilities and report findings.',right:'Review pull requests for security vulnerabilities and report findings.',expected:'near-copy'},
  {name:'common abbreviation and task paraphrase',left:'Review PRs for security vulnerabilities and report findings.',right:'Audit pull requests for security vulnerabilities and report findings.',expected:'task-candidate'},
  {name:'Chinese task and concrete object',left:'检查数据库迁移的事务回滚行为，验证错误恢复。',right:'审查数据库迁移的事务回滚行为，测试错误恢复。',expected:'task-candidate'},
  {name:'same object but install versus inspect is not duplicate',left:'Install Docker containers in the production environment.',right:'Inspect Docker containers in the production environment.',expected:null},
  {name:'before versus after deployment is a different trigger',left:'Check database migrations before deployment for missing rollback steps.',right:'Check database migrations after deployment for missing rollback steps.',expected:null},
  {name:'read-only versus automatic edits is a constraint candidate',left:'Review pull requests for security vulnerabilities. Read-only; never modify files.',right:'Review pull requests for security vulnerabilities. Modify files to fix findings.',expected:'constraint-conflict'},
  {name:'negated action is not an aligned task',left:'Do not create Docker containers in the production environment.',right:'Create Docker containers in the production environment.',expected:'constraint-conflict'},
  {name:'generic descriptions and prompts do not indicate the same task',left:'Use when writing or changing a model-facing tool definition (name, description, parameter schema, or its system-prompt section), and when designing skills, context loading, or multi-step workflows, to make information discoverable and use context efficiently.',right:'Use when writing, reviewing, restoring, trimming, or auditing prose in the deepseek-harness repo, including deciding where documentation or comments are required across Markdown, JSDoc, code and test comments, prompts, descriptions, diagnostics, and CLI or UI strings.',expected:null},
  {name:'same topic with unrelated goals does not trigger',left:'Generate database migration scripts for schema changes.',right:'Explain database migration failure reports to stakeholders.',expected:null},
  {name:'different concrete objects with shared scaffolding',left:'Review database migration rollback behavior and report issues.',right:'Review browser layout accessibility behavior and report issues.',expected:null},
  {name:'shared boilerplate in a long description does not replace task evidence',left:'Review database migration rollback behavior. Follow common best practices, maintain a consistent tone, preserve existing conventions, and present clear actionable findings with evidence and concise explanations.',right:'Review browser layout accessibility behavior. Follow common best practices, maintain a consistent tone, preserve existing conventions, and present clear actionable findings with evidence and concise explanations.',expected:null},
];
for(const row of cases)test(row.name,()=>{
  const result=analyzeSkillDescriptions([skill('first',row.left),skill('second',row.right)]);
  assert.equal(result.pairs[0]?.kind??null,row.expected,JSON.stringify(result.pairs));
  if(row.expected){assert.equal(result.pairs[0].meaningConfirmed,false);assert.ok(result.pairs[0].evidence.left);}
});
test('official-official excluded; user-official still compared',()=>{
  const text='Review pull requests for security vulnerabilities.';
  const result=analyzeSkillDescriptions([skill('official-a',text,'official'),skill('official-b',text,'official'),skill('mine',text)]);
  assert.equal(result.excluded.official,1);assert.equal(result.pairs.length,2);
  assert.ok(result.pairs.every(pair=>pair.right==='mine'));
});
test('explicit workflow/reference links are not redundancy suggestions',()=>{
  const text='Configure Cordis bundle presets and plugin declarations.';
  const result=analyzeSkillDescriptions([skill('workflow',text,'personal','Read [reference](../reference/SKILL.md) first.'),skill('reference',text)]);
  assert.equal(result.excluded.reference,1);assert.equal(result.pairs.length,0);
});
test('equivalent but wholly different phrasing is an acknowledged retrieval limit',()=>{
  const result=analyzeSkillDescriptions([skill('a','Audit pull requests for security vulnerabilities.'),skill('b','Assess proposed patches for exploitable weaknesses.')]);
  assert.equal(result.pairs.length,0);assert.ok(result.limitation.includes('同义改写'));
});
