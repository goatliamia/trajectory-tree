// Resolve only known configuration predicates. Never evaluate arbitrary !!js.
export function configuredEnablement(disabled, { platform = process.platform, profile = true } = {}) {
  if (disabled === undefined || disabled === false) return 'enabled';
  if (disabled === true) return 'disabled';
  const expression = disabled?.__jsExpr?.trim();
  const comparison = expression?.match(/^process\.platform\s*(===|!==)\s*['"]([^'"]+)['"]$/);
  if (comparison) {
    const equal = platform === comparison[2];
    return (comparison[1] === '===' ? equal : !equal) ? 'disabled' : 'enabled';
  }
  if (/^!ctx\.get\(['"]profileContext['"]\)$/.test(expression ?? '')) return profile ? 'enabled' : 'disabled';
  return 'conditional';
}

export function flattenConfiguredRows(entries, scope, environment, inherited = 'enabled') {
  return entries.flatMap(row => {
    const own = configuredEnablement(row.disabled, environment);
    const status = inherited === 'disabled' || own === 'disabled' ? 'disabled' : inherited === 'conditional' || own === 'conditional' ? 'conditional' : 'enabled';
    if (row.name === '@deepseek-ai/dsh-agent-preset') return [];
    if (row.group && Array.isArray(row.config)) return flattenConfiguredRows(row.config, scope, environment, status);
    return row.name ? [{ ...row, scope, status }] : [];
  });
}

export function winningSkillCandidates(candidates, {includeDisabled=false}={}) {
  const winners = new Map();
  for (const candidate of [...candidates].sort((a,b) => a.rank - b.rank)) if (!winners.has(candidate.name)) winners.set(candidate.name, candidate);
  return [...winners.values()].filter(row => includeDisabled||row.invocation?.modelInvocable !== false).sort((a,b) => a.name.localeCompare(b.name));
}

export function configuredContribution(contribution, row) {
  const config=row.config??{}, key=contribution.kind==='section'?contribution.name.replace(/^tool:/,''):contribution.name;
  if(row.name==='@deepseek-ai/dsh-system-prompt'&&contribution.name==='harness:identity'&&config.includeHarnessIdentity===false)return false;
  const fsFlags={read:'read',read_image:'readImage',write:'write',edit:'edit',apply_patch:'applyPatch'};
  if(row.name==='@deepseek-ai/dsh-tool-fs'&&fsFlags[key]){
    if(config[fsFlags[key]]===false)return false;
    if(key==='apply_patch'&&config.applyPatch!==true)return false;
  }
  if(row.name==='@deepseek-ai/dsh-tool-web'&&key==='web_fetch'&&config.fetch===false)return false;
  if(row.name==='@deepseek-ai/dsh-tool-web'&&key==='web_search'&&config.search===false)return false;
  return row.status!=='disabled';
}
