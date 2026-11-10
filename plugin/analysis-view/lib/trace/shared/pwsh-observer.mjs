import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';

import { candidateAttribution } from './tool-attribution.mjs';

const protocol = 'pwsh-syntax/1';
export const commandBatchLimit = 12;

export function commandCrOptions(args) {
  const option = key => {
    const index = args.indexOf(key);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw Error('Missing value for ' + key);
    return value;
  };
  return { root: option('--cr-root') ?? process.env.TRAJECTORY_CR_ROOT,
    pwsh: option('--pwsh') ?? process.env.TRAJECTORY_CR_PWSH };
}

async function findPowerShell(configured, edition) {
  if (configured) return resolve(configured);
  const name = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';
  if (edition !== 'Desktop') {
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      if (!isAbsolute(directory)) continue;
      const executable = resolve(directory, name);
      try { await access(executable, constants.X_OK); return executable; } catch {}
    }
  }
  const systemRoot = process.env.SystemRoot ?? '';
  if (edition !== 'Core' && process.platform === 'win32' && isAbsolute(systemRoot)) {
    const executable = resolve(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    try { await access(executable, constants.X_OK); return executable; } catch {}
  }
  return null;
}

// Only the configured CR provider is launched. Historical text travels on stdin.
async function runProvider(executable, provider, observer, files, signal) {
  return new Promise((resolveResult, reject) => {
    const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', observer], {
      cwd: dirname(provider), encoding: 'utf8', windowsHide: true, timeout: 12000,
      maxBuffer: 6 * 1024 * 1024, signal,
      env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' },
    }, (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolveResult(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    });
    child.stdin?.on('error', () => {});
    // Both observer generations use pwsh-syntax/1. Older workers read text.
    child.stdin?.end(JSON.stringify({ files: files.map(file => ({ ...file,
      source_b64: Buffer.from(file.text, 'utf8').toString('base64'),
    })) }));
  });
}

export async function observePowerShell(files, config, signal, edition) {
  signal?.throwIfAborted();
  if (!config?.root) return { state: 'not-configured', files: new Map() };
  if (!files.length) return { state: 'no-source', files: new Map() };
  const provider = resolve(config.root, 'code_relations/providers/pwsh_syntax.ps1');
  try { await access(provider, constants.R_OK); } catch { return { state: 'provider-unavailable', files: new Map() }; }
  const executable = await findPowerShell(config.pwsh, edition);
  if (!executable) return { state: 'pwsh-unavailable', files: new Map() };
  try {
    const observer = await readFile(provider, { encoding: 'utf8', signal });
    const response = await runProvider(executable, provider, observer, files, signal);
    if (response?.protocol !== protocol || !Array.isArray(response.files) || response.files.length !== files.length ||
        response.files.some((entry, index) => entry.path !== files[index].path)) {
      return { state: 'protocol-mismatch', files: new Map() };
    }
    return { state: 'observed', runtime: response.runtime?.version, edition: response.runtime?.edition,
      files: new Map(response.files.map(entry => [entry.path, entry])) };
  } catch {
    signal?.throwIfAborted();
    return { state: 'provider-failed', files: new Map() };
  }
}

const decolor = text => String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
export const commandEvidenceExcerpt = text => decolor(text).trim()
  .replace(/((?:[?&]|\b)(?:token|access_token|refresh_token|api[_-]?key|password|secret)["']?\s*[=:]\s*["']?)[^\s"'&#<>]+/gi, '$1[redacted]')
  .replace(/(\bBearer\s+|\bsk-)[a-z0-9._~+/=-]+/gi, '$1[redacted]')
  .slice(0, 300);

function commandSite(node) {
  return { name: node.command_name == null ? null : commandEvidenceExcerpt(node.command_name),
    line: node.span?.line, column: node.span?.column };
}

function terminalLookup(nodes, source, row) {
  if (row.exitCode !== 1 || row.status !== 'error' || row.attribution?.certainty === 'confirmed') return null;
  if (nodes.some(node => /^(?:ExitStatement|ThrowStatement|ReturnStatement|PipelineChain)Ast$/.test(node.kind))) return null;
  const root = nodes.findIndex(node => node.kind === 'ScriptBlockAst' && node.parent == null);
  const block = nodes.findIndex(node => node.kind === 'NamedBlockAst' && node.parent === root);
  if (root < 0 || block < 0) return null;
  const tail = nodes.findLastIndex(node => node.parent === block);
  if (nodes[tail]?.kind !== 'PipelineAst') return null;
  const commands = nodes.filter(node => node.kind === 'CommandAst' && node.parent === tail);
  const [head, ...rest] = commands;
  const name = head?.command_name?.toLowerCase().replace(/\.exe$/, '');
  if (!name || !rest.every(node => /^(?:Select-Object|select)$/i.test(node.command_name ?? ''))) return null;
  const { start, end } = nodes[tail].span;
  if (nodes.some(node => /RedirectionAst$/.test(node.kind) && node.span.start >= start && node.span.end <= end)) return null;
  const text = source.slice(head.span.start, head.span.end);
  if (name === 'rg' && !/(?:^|\s)(?:--no-messages|-s)(?=\s|$)/.test(text)) {
    return candidateAttribution('LOOKUP_NO_MATCH', 'rg', row.exitCode, 'rg · exit 1', commandSite(head));
  }
  if (name === 'get-command' && /-ErrorAction\s+(?:SilentlyContinue|Ignore)\b/i.test(text)) {
    return candidateAttribution('LOOKUP_COMMAND', 'Get-Command', row.exitCode, 'Get-Command · -ErrorAction', commandSite(head));
  }
  return null;
}

function syntaxHint(error, text) {
  const offset = error.span?.start;
  if (error.error_id !== 'MissingArgument' || !Number.isInteger(offset) || text[offset] !== ',') return undefined;
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  const line = text.slice(start, end < 0 ? undefined : end).trimEnd();
  // Match a simple unquoted path list only when the parser points inside it.
  const paths = /(?:^|[ \t])(?:[\w.:/\\-]+[/\\])\{[\w./\\-]+(?:,[\w./\\-]+)+\}[\w./\\-]*(?=$|[ \t;|)])/g;
  for (const match of line.matchAll(paths)) {
    if (offset - start > match.index && offset - start < match.index + match[0].length) return 'brace-path-list';
  }
  return undefined;
}

function applySyntax(entry, observed, file) {
  const { row, source } = entry;
  const syntax = row.syntax;
  const parsed = observed.files.get(file.path);
  syntax.sha256 = createHash('sha256').update(source.text).digest('hex');
  if (!parsed) { syntax.state = observed.state; return; }
  if (parsed.unavailable || !Array.isArray(parsed.diagnostics) || !Array.isArray(parsed.nodes)) {
    syntax.state = 'pending'; return;
  }
  syntax.state = parsed.diagnostics.length ? 'recovered' : 'parsed';
  syntax.runtime = observed.runtime;
  syntax.edition = observed.edition;
  const matchingEdition = !source.edition || !observed.edition || source.edition === observed.edition;
  syntax.diagnostics = parsed.diagnostics.slice(0, 6).map(error => ({
    id: commandEvidenceExcerpt(error.error_id), message: commandEvidenceExcerpt(error.message), line: error.span?.line, column: error.span?.column,
    incomplete: !!error.incomplete_input, hint: syntaxHint(error, source.text),
  }));
  if (syntax.state !== 'parsed') {
    const { id, line, column, hint } = syntax.diagnostics[0];
    if (matchingEdition && row.attribution?.code === 'COMMAND_SYNTAX') row.attribution = { ...row.attribution, site: { line, column }, evidence: id,
      ...(hint === 'brace-path-list' ? { guidance: '把每个完整路径作为独立参数传入' } : {}) };
    return;
  }
  const commands = parsed.nodes.filter(node => node.kind === 'CommandAst').sort((a, b) => a.span.start - b.span.start);
  syntax.commands = commands.slice(0, 12).map(commandSite);
  syntax.commandCount = commands.length;
  const lookup = matchingEdition ? terminalLookup(parsed.nodes, source.text, row) : null;
  if (lookup) row.attribution = lookup;
  if (row.cause?.program || row.attribution?.program) {
    const sites = commands.filter(node => node.command_name?.toLowerCase().replace(/\.exe$/, '') === (row.cause?.program || row.attribution?.program).toLowerCase());
    if (sites.length === 1) {
      const site = commandSite(sites[0]);
      if (row.cause) row.cause.site = site;
      if (matchingEdition && row.attribution?.certainty === 'confirmed') row.attribution = { ...row.attribution, site };
    }
  }
}

export async function observeCommandEntries(selected, cr, signal) {
  let bytes = 0;
  const pending = new Map();
  for (const entry of selected) {
    if (!entry.source) continue;
    const size = Buffer.byteLength(entry.source.text);
    if (size > 16 * 1024 || bytes + size > 64 * 1024) {
      entry.row.syntax.state = 'input-budget'; continue;
    }
    bytes += size;
    const edition = cr?.pwsh ? null : entry.source.edition;
    if (!pending.has(edition)) pending.set(edition, []);
    pending.get(edition).push({ entry, file: { path: 'call-' + entry.row.seq + '.ps1', text: entry.source.text } });
  }
  const observations = [];
  for (const [edition, batch] of pending) {
    const observation = await observePowerShell(batch.map(row => row.file), cr, signal, edition);
    observations.push(observation);
    for (const { entry, file } of batch) applySyntax(entry, observation, file);
  }
  return observations.find(observation => observation.state === 'observed') ?? observations[0] ?? await observePowerShell([], cr, signal);
}
