import { attributeToolFailure, failureLabels, powerShellScript } from '../trace/shared/tool-attribution.mjs';

// DSH pwsh deliberately returns non-zero process exits without setting isError.
// Keep this rendered execution feedback separate from the host tool outcome.
const marker = /^\[(?:exit code: -?\d+|timed out after \d+ms|stopped: [^\r\n]+|killed by signal: [^\r\n]+|sandbox: [^\r\n]+)\]$/;
const clean = value => String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
export const commandExcerpt = value => clean(value).trim()
  .replace(/((?:[?&]|\b)(?:token|access_token|refresh_token|api[_-]?key|password|secret)["']?\s*[=:]\s*["']?)[^\s"'&#<>]+/gi, '$1[redacted]')
  .replace(/(\bBearer\s+|\bsk-)[a-z0-9._~+/=-]+/gi, '$1[redacted]').slice(0, 300);

export function dshPowerShellEvidence(call, callEvent, resultEvent) {
  if (!/^(pwsh|powershell)$/i.test(call.name)) return null;
  let args = callEvent?.data?.arguments;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
  const source = powerShellScript(args?.command ?? args?.cmd, call.name, args?.shell);
  const data = resultEvent?.data, content = data?.message?.content ?? data?.content;
  const text = clean(Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n') : '');
  const lines = text.trimEnd().split(/\r?\n/), markers = [];
  while (lines.length && marker.test(lines.at(-1))) markers.unshift(lines.pop());
  const tail = markers.join('\n'), exit = /\[exit code: (-?\d+)\]/.exec(tail);
  const exitCode = exit ? Number(exit[1]) : null;
  const stopped = /\[stopped: ([^\r\n]+)\]/.exec(tail)?.[1] ?? null;
  const signal = /\[killed by signal: ([^\r\n]+)\]/.exec(tail)?.[1] ?? null;
  const timeoutMs = /\[timed out after (\d+)ms\]/.exec(tail)?.[1];
  const denied = /\[sandbox: file access denied under [^\r\n]+ mode\]/.test(tail);
  const feedback = exitCode != null && exitCode !== 0 || stopped != null || signal != null || timeoutMs != null || denied;
  const body = lines.join('\n'), stderr = body.split(/(?:^|\n)\[stderr\]\r?\n/).slice(1).join('\n');
  let attribution;
  if (feedback && call.status !== 'error') {
    const code = stopped || signal ? 'ABORTED' : timeoutMs ? 'COMMAND_TIMEOUT' : denied ? 'TOOL_PERMISSION' : null;
    attribution = code ? { code, label: failureLabels[code][0], certainty: 'confirmed', basis: 'dsh-pwsh-marker', exitCode, evidence: commandExcerpt(tail) }
      : attributeToolFailure({ status: 'error', tool: call.name, command: source?.text, exitCode,
        output: body.trim() === '(no output)' ? '' : body, stderr });
    if (attribution?.basis === 'native-stderr') attribution = { ...attribution, basis: 'dsh-pwsh-stderr' };
  }
  return { source, attribution, command: {
    source: source ? { excerpt: commandExcerpt(source.text), characters: source.text.length } : null,
    edition: source?.edition ?? null, workdir: commandExcerpt(args?.workdir ?? args?.cwd ?? data?.meta?.cwd) || null,
    ...(feedback ? { feedback: { basis: 'dsh-pwsh-render', exitCode, stopped, signal,
      timeoutMs: timeoutMs == null ? null : Number(timeoutMs), sandboxDenied: denied,
      outputTruncated: text.includes('[output truncated; full output:') } } : {}),
  } };
}
