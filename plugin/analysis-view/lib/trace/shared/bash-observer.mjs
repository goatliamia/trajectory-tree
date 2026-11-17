import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { diagnosticFrame } from './tool-feedback.mjs';
import { failureLabels } from './tool-attribution.mjs';

// The CR provider owns noexec startup isolation and diagnostic interpretation.
// Only captured UTF-8 command bytes cross this bridge; no command is executed.
const bridge = `
import base64, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from code_relations.bash import scan
request = json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='trajectory-bash-') as directory:
    root = Path(directory)
    for item in request['files']:
        (root / item['path']).write_bytes(base64.b64decode(item['source_b64'], validate=True))
    model = scan(root, bash=request.get('bash'))
    checks = model.objects.get('BashCheck', {})
    diagnostics = list(model.objects.get('BashDiagnostic', {}).values())
    files = []
    for item in request['files']:
        path = item['path']
        artifact = model.objects.get('Artifact', {}).get(path, {})
        check = checks.get(path + '#syntax-check')
        files.append({'path': path, 'sha256': artifact.get('sha256'), 'check': check,
            'diagnostics': [row for row in diagnostics if row.get('file') == path]})
    print(json.dumps({'protocol': 'trajectory-cr-bash/1', 'provider': model.world['context']['provider'],
        'runtime': model.world['context']['runtime'], 'files': files, 'issues': len(model.issues)}, ensure_ascii=True))
`;

export async function observeBash(files, config, signal) {
  signal?.throwIfAborted();
  if (!config?.root) return { state: 'not-configured', files: new Map() };
  if (!files.length) return { state: 'no-source', files: new Map() };
  const root = resolve(config.root);
  try { await access(resolve(root, 'code_relations/bash.py')); }
  catch { return { state: 'provider-unavailable', files: new Map() }; }
  try {
    const result = await new Promise((accept, reject) => {
      const child = execFile(config.python || 'python', ['-I', '-B', '-c', bridge, root], {
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 12000, maxBuffer: 2 * 1024 * 1024, signal,
      }, (error, stdout) => {
        if (error) { reject(error); return; }
        try { accept(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(JSON.stringify({ bash: config.bash, files: files.map(file => ({ path: file.path,
        source_b64: Buffer.from(file.text, 'utf8').toString('base64') })) }));
    });
    if (result.protocol !== 'trajectory-cr-bash/1' || result.provider !== 'bash-syntax/1' ||
        !Array.isArray(result.files) || result.files.length !== files.length || result.files.some((row, index) =>
          row.path !== files[index].path || row.sha256 !== createHash('sha256').update(files[index].text).digest('hex'))) {
      return { state: 'protocol-mismatch', files: new Map() };
    }
    return { state: 'observed', language: 'bash', runtime: result.runtime?.version, provider: result.provider,
      files: new Map(result.files.map(row => [row.path, row])) };
  } catch {
    signal?.throwIfAborted();
    return { state: 'provider-failed', files: new Map() };
  }
}

export function applyBashSyntax(entry, observed, file, excerpt) {
  const { row, source } = entry, parsed = observed.files.get(file.path), syntax = row.syntax;
  syntax.sha256 = createHash('sha256').update(source.text).digest('hex');
  syntax.language = 'bash';
  if (!parsed?.check || !Array.isArray(parsed.diagnostics)) { syntax.state = parsed ? 'pending' : observed.state; return; }
  const errors = parsed.diagnostics.filter(item => item.severity === 'error');
  syntax.state = errors.length ? 'recovered' : parsed.diagnostics.length ? 'warning' : 'parsed';
  syntax.runtime = observed.runtime;
  syntax.exitCode = parsed.check.exit_code;
  syntax.diagnostics = parsed.diagnostics.slice(0, 6).map(item => ({ message: excerpt(item.message),
    line: item.line, severity: item.severity,
    frame: Number.isSafeInteger(item.line) && item.line > 0 && item.line <= source.text.split('\n').length
      ? diagnosticFrame(source.text, { line: item.line, message: item.message, origin: 'bash-noexec', kind: 'syntax' }) : null }));
  if (!errors.length) return;
  const first = errors[0];
  // A current parser finding is evidence about the captured source, not proof
  // of the historical process's exit cause or of a failed task.
  const frames = syntax.diagnostics.filter(item => item.severity === 'error' && item.frame).map(item => item.frame);
  const recorded = row.attribution?.code === 'COMMAND_SYNTAX' && row.attribution?.program === 'Bash';
  if (row.status === 'error' && (recorded || row.attribution?.certainty !== 'confirmed')) {
    row.attribution = { ...row.attribution, code: 'COMMAND_SYNTAX', label: failureLabels.COMMAND_SYNTAX[0], program: 'Bash',
      certainty: recorded ? row.attribution.certainty : 'candidate', basis: recorded ? row.attribution.basis : 'cr-bash-noexec',
      evidence: excerpt(first.message), ...(Number.isSafeInteger(first.line) ? { site: { line: first.line } } : {}),
      codeFrames: frames };
  }
}
