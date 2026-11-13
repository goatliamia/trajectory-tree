// Authored examples run through the real checks. Kept separate from local snapshots.
import { analyzeSkillDescriptions } from './skill-description-candidates.mjs';
import { skillToolRepetition } from './preset-skill-management.mjs';

const skill = (name, description, body = '') => ({ name, description, body, provenance: { origin: 'personal' } });

export function skillOverlapExamples() {
  const sameTask = [
    skill('sample-pr-review', 'Review pull requests for security vulnerabilities and report findings.'),
    skill('sample-pr-audit', 'Audit PRs for security vulnerabilities and report findings.'),
  ];
  const conflict = [
    skill('sample-readonly', 'Review pull requests for security vulnerabilities. Read-only; never modify files.'),
    skill('sample-autofix', 'Review pull requests for security vulnerabilities. Modify files to fix findings.'),
  ];
  const statement = 'Read a UTF-8 text file at the supplied path and return its content with line numbers.';
  const tool = { name: 'sample_read_file', description: statement, package: '示例工具' };
  const guide = skill('sample-file-guide', 'Inspect a configuration file before proposing changes.', statement + '\nRead the project configuration before proposing a change. Compare the relevant options and explain the impact.');
  return {
    synthetic: true,
    examples: [
      { id: 'trigger', title: '触发重合', skills: sameTask, analysis: analyzeSkillDescriptions(sameTask) },
      { id: 'conflict', title: '约束冲突', skills: conflict, analysis: analyzeSkillDescriptions(conflict) },
      { id: 'repetition', title: '工具说明复述', skills: [guide], tool, analysis: skillToolRepetition([guide], [tool]) },
    ],
  };
}
