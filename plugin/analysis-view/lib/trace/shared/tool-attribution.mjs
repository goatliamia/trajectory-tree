// Cause evidence is independent of the recorded host outcome.
export const failureCategories = [
  ['文件修改保护', 'File edit protection', ['FS_NOT_OBSERVED', 'FS_STALE_VERSION']],
  ['文件与编辑目标', 'Files and edit targets', ['FS_NOT_FOUND', 'FS_NOT_TEXT', 'FS_EDIT_NOT_FOUND', 'COMMAND_FILE_BUSY', 'FS_NOT_REGULAR_FILE', 'FS_AMBIGUOUS_EDIT', 'FS_REPLACE_FAILED']],
  ['服务与访问', 'Services and access', ['SESSION_QUERY_PERSISTENCE_FAILED', 'SEARCH_FAILED', 'WEB_UNSUPPORTED_CONTENT_TYPE',
    'WEB_PROVIDER_ERROR', 'WEB_REDIRECT_BLOCKED', 'COMMAND_APP_SERVER_EXITED', 'COMMAND_RESPONSE_BODY_UNAVAILABLE',
    'COMMAND_OFFLINE_DEPENDENCY', 'COMMAND_CIM_UNAVAILABLE', 'APPROVAL_UNAVAILABLE', 'TOOL_CONTEXT_UNAVAILABLE',
    'UNKNOWN_TOOL', 'TOOL_ACTIVATION_FAILED', 'browser-unavailable', 'HOST_SANDBOX_SETUP_FAILED', 'SEARCH_RAW_OUTPUT_OVERFLOW']],
  ['调用超时', 'Timeouts', ['TOOL_TIMEOUT', 'COMMAND_TIMEOUT', 'CODE_TIMEOUT']],
  ['中止与取消', 'Aborts and cancellations', ['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'CODE_ABORTED', 'APPROVAL_CANCELLED', 'WEB_ABORTED', 'ASK_CANCELLED', 'JOB_WAIT_ABORTED']],
  ['结果待确认', 'Unconfirmed outcomes', ['TOOL_OUTCOME_UNKNOWN', 'JOB_NOT_FOUND', 'COMMAND_EXTERNAL_FEEDBACK']],
  ['代码执行失败', 'Code execution failed', ['CODE_RUN_FAILED', 'COMMAND_RUNTIME_ERROR', 'COMMAND_ENCODING_ERROR',
    'CODE_EXCEPTION', 'CODE_WORKER_EXIT', 'CODE_INVALID_OUTPUT', 'CODE_OUTPUT_LIMIT', 'CODE_PROTOCOL']],
  ['原因待确认', 'Cause unclassified', []],
  ['命令语法与参数', 'Command syntax and arguments', ['COMMAND_SYNTAX', 'COMMAND_PATTERN', 'COMMAND_ARGUMENT', 'COMMAND_NOT_FOUND', 'CODE_SYNTAX', 'INVALID_ARGS', 'SEARCH_INVALID_PATTERN']],
  ['权限受阻', 'Access denied', ['COMMAND_PERMISSION', 'TOOL_PERMISSION', 'CODE_SANDBOX_UNAVAILABLE', 'APPROVAL_REJECTED']],
  ['连接失败', 'Connection failures', ['COMMAND_CONNECTION_DENIED', 'COMMAND_CONNECTION_FAILED']],
  ['验证未通过', 'Verification failures', ['COMMAND_TEST_FAILED']],
  ['工具接口契约', 'Tool interface contracts', ['INVALID_TOOL_OUTPUT', 'UNSUPPORTED_SCHEMA']],
  ['附件与图像', 'Attachments and images', ['TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE', 'UNSUPPORTED_IMAGE_TYPE',
    'INVALID_IMAGE_BASE64', 'INVALID_IMAGE', 'IMAGE_TYPE_MISMATCH', 'IMAGE_TOO_LARGE', 'IMAGE_TOO_MANY_PIXELS',
    'IMAGE_DIMENSION_TOO_LARGE', 'INVALID_FILE_BASE64', 'INVALID_ATTACHMENT_REF', 'ATTACHMENT_CORRUPT',
    'ATTACHMENT_WRITE_FAILED', 'ATTACHMENT_NOT_FOUND', 'ATTACHMENT_READ_FAILED',
    'ATTACHMENT_PROJECTION_UNSUPPORTED', 'ATTACHMENT_FILES_UNSUPPORTED']],
];
const categories = new Map(failureCategories.flatMap(([, , codes], index) => codes.map(code => [code, index])));
export const failureCategoryIndex = code => categories.get(code) ?? 7;

export const failureLabels = {
  INVALID_ARGS: ['调用参数不符合声明', 'Arguments do not match the tool schema'],
  SEARCH_INVALID_PATTERN: ['搜索表达式无效', 'Invalid search pattern'],
  SEARCH_RAW_OUTPUT_OVERFLOW: ['搜索返回超过上限', 'Search output exceeds its limit'],
  FS_NOT_REGULAR_FILE: ['目标不是普通文件', 'Target is not a regular file'],
  FS_AMBIGUOUS_EDIT: ['替换目标不唯一', 'Ambiguous edit target'],
  FS_REPLACE_FAILED: ['文件替换失败', 'File replacement failed'],
  HOST_SANDBOX_SETUP_FAILED: ['沙箱或权限环境准备失败', 'Sandbox or permission setup failed'],
  'browser-unavailable': ['浏览器能力不可用', 'Browser capability unavailable'],
  WEB_ABORTED: ['网页请求被中止', 'Web request aborted'],
  ASK_CANCELLED: ['交互询问已取消', 'User question cancelled'],
  JOB_WAIT_ABORTED: ['后台任务等待被中止', 'Background job wait aborted'],
  JOB_NOT_FOUND: ['后台任务身份未找到', 'Background job identity not found'],
  COMMAND_EXTERNAL_FEEDBACK: ['外部程序反馈待核对', 'External program feedback needs review'],
  APPROVAL_REJECTED: ['审批被用户拒绝', 'Approval rejected by user'],
  APPROVAL_CANCELLED: ['审批已取消', 'Approval cancelled'],
  APPROVAL_UNAVAILABLE: ['审批服务或通道不可用', 'Approval service or channel unavailable'],
  TOOL_CONTEXT_UNAVAILABLE: ['工具所需运行上下文缺失', 'Required tool context unavailable'],
  UNKNOWN_TOOL: ['工具未注册或不可直接调用', 'Tool unregistered or not directly callable'],
  TOOL_ACTIVATION_FAILED: ['工具可用性判断失败', 'Tool availability check failed'],
  INVALID_TOOL_OUTPUT: ['工具返回值违反契约', 'Tool output violates its contract'],
  UNSUPPORTED_SCHEMA: ['工具声明的 Schema 不受支持', 'Tool schema is unsupported'],
  TOO_MANY_IMAGES: ['图像数量超过限制', 'Too many images'],
  IMAGES_TOO_LARGE: ['图像总量超过限制', 'Images exceed the total size limit'],
  UNSUPPORTED_IMAGE_TYPE: ['图像类型不受支持', 'Unsupported image type'],
  INVALID_IMAGE_BASE64: ['图像 Base64 无效', 'Invalid image Base64'],
  INVALID_IMAGE: ['图像内容无效', 'Invalid image'],
  IMAGE_TYPE_MISMATCH: ['图像类型与内容不符', 'Image type does not match its content'],
  IMAGE_TOO_LARGE: ['图像大小超过限制', 'Image exceeds the size limit'],
  IMAGE_TOO_MANY_PIXELS: ['图像像素数超过限制', 'Image exceeds the pixel limit'],
  IMAGE_DIMENSION_TOO_LARGE: ['图像尺寸超过限制', 'Image dimensions exceed the limit'],
  INVALID_FILE_BASE64: ['文件 Base64 无效', 'Invalid file Base64'],
  INVALID_ATTACHMENT_REF: ['附件引用无效', 'Invalid attachment reference'],
  ATTACHMENT_CORRUPT: ['附件数据损坏', 'Attachment data is corrupt'],
  ATTACHMENT_WRITE_FAILED: ['附件写入失败', 'Attachment write failed'],
  ATTACHMENT_NOT_FOUND: ['附件未找到', 'Attachment not found'],
  ATTACHMENT_READ_FAILED: ['附件读取失败', 'Attachment read failed'],
  ATTACHMENT_PROJECTION_UNSUPPORTED: ['附件投递格式不受支持', 'Attachment projection is unsupported'],
  ATTACHMENT_FILES_UNSUPPORTED: ['文件附件不受支持', 'File attachments are unsupported'],
  FS_NOT_OBSERVED: ['文件保护要求先读取', 'File guard requires an observed read'],
  FS_STALE_VERSION: ['文件版本已变化', 'File version changed'],
  FS_EDIT_NOT_FOUND: ['找不到待替换文本', 'Replacement target not found'],
  FS_NOT_FOUND: ['文件未找到', 'File not found'],
  FS_NOT_TEXT: ['文件不是文本', 'File is not text'],
  SESSION_QUERY_PERSISTENCE_FAILED: ['历史记录读取失败', 'Could not read session history'],
  TOOL_TIMEOUT: ['工具调用超时', 'Tool call timed out'],
  CODE_RUN_FAILED: ['代码执行失败', 'Code execution failed'],
  SEARCH_FAILED: ['搜索失败', 'Search failed'],
  WEB_UNSUPPORTED_CONTENT_TYPE: ['网页内容类型不支持', 'Unsupported web content type'],
  WEB_PROVIDER_ERROR: ['网页服务报错', 'Web provider error'],
  WEB_REDIRECT_BLOCKED: ['网页重定向受阻', 'Web redirect blocked'],
  ABORTED: ['执行中止', 'Aborted'],
  ABORTED_BEFORE_DISPATCH: ['调度前取消', 'Cancelled before dispatch'],
  TOOL_OUTCOME_UNKNOWN: ['宿主报告结果未知', 'Host reports an unknown outcome'],
  COMMAND_SYNTAX: ['脚本语法错误', 'Shell syntax error'],
  COMMAND_PATTERN: ['搜索表达式无效', 'Invalid search pattern'],
  COMMAND_ARGUMENT: ['命令参数错误', 'Invalid command arguments'],
  COMMAND_NOT_FOUND: ['命令未找到', 'Command not found'],
  COMMAND_PERMISSION: ['程序访问被拒绝', 'Program access denied'],
  TOOL_PERMISSION: ['工具访问被拒绝', 'Tool access denied'],
  COMMAND_CONNECTION_DENIED: ['连接受权限限制', 'Connection blocked by permissions'],
  COMMAND_CONNECTION_FAILED: ['程序连接失败', 'Program connection failed'],
  COMMAND_ENCODING_ERROR: ['程序编码错误', 'Program encoding error'],
  COMMAND_TEST_FAILED: ['验证未通过', 'Verification failed'],
  COMMAND_RUNTIME_ERROR: ['子程序报错', 'Child program error'],
  COMMAND_TIMEOUT: ['子程序等待超时', 'Child program timed out'],
  COMMAND_FILE_BUSY: ['文件被其他进程占用', 'File in use by another process'],
  COMMAND_APP_SERVER_EXITED: ['App Server 在读取完成前退出', 'App Server exited before the read completed'],
  COMMAND_RESPONSE_BODY_UNAVAILABLE: ['浏览器响应正文已被清除', 'Browser response body evicted'],
  COMMAND_OFFLINE_DEPENDENCY: ['离线缓存缺少依赖包', 'Dependency missing from offline store'],
  COMMAND_CIM_UNAVAILABLE: ['无法访问 CIM 资源', 'CIM resource inaccessible'],
  LOOKUP_NO_MATCH: ['疑似搜索未命中', 'Likely no search matches'],
  LOOKUP_COMMAND: ['疑似未找到命令', 'Command lookup may have found nothing'],
  UNCLASSIFIED_OUTPUT: ['有返回，原因待确认', 'Output present, cause unclassified'],
  NO_OUTPUT: ['无文字返回', 'No text output'],
  CODE_SYNTAX: ['程序语法或转换失败', 'Program syntax or transform failed'],
  CODE_EXCEPTION: ['程序抛出异常', 'Program exception'],
  CODE_TIMEOUT: ['程序运行预算到期', 'Program execution budget expired'],
  CODE_ABORTED: ['程序运行被中止', 'Program run aborted'],
  CODE_WORKER_EXIT: ['程序运行环境退出', 'Program worker exited'],
  CODE_INVALID_OUTPUT: ['程序返回值不符合 JSON 契约', 'Program result is not lossless JSON'],
  CODE_OUTPUT_LIMIT: ['程序输出超过运行时上限', 'Program output limit exceeded'],
  CODE_PROTOCOL: ['程序运行时协议错误', 'Program runtime protocol error'],
  CODE_SANDBOX_UNAVAILABLE: ['程序所需沙箱不可用', 'Required program sandbox unavailable'],
};
export const failureMessages = {
  ...Object.fromEntries(failureCategories.map(([zh, en]) => [zh, en])),
  ...Object.fromEntries(Object.values(failureLabels)),
  '退出码': 'Exit code',
  '脚本位置': 'Script location',
  '把每个完整路径作为独立参数传入': 'Pass each full path as a separate argument',
  '已归因': 'attributed',
  '候选原因': 'tentative',
  '待定位': 'unclassified',
};

function describeFailure(attribution) {
  if (!attribution) return '';
  const ui = globalThis.__trajectoryUi ?? (text => text);
  const { label, program, exitCode, evidence, site, guidance } = attribution;
  return [ui(label), program, exitCode == null ? null : ui('退出码') + ' ' + exitCode,
    site?.line ? ui('脚本位置') + ' L' + site.line + (site.column ? ':' + site.column : '') : null,
    evidence, guidance ? ui(guidance) : null].filter(Boolean).join(' · ');
}

export function summarizeFailureAttributions(attributions) {
  const counts = { confirmed: 0, candidate: 0, unclassified: 0, noOutput: 0 };
  for (const attribution of attributions) {
    if (attribution?.certainty === 'confirmed') counts.confirmed++;
    else if (attribution?.certainty === 'candidate') counts.candidate++;
    else if (attribution?.basis === 'no-output') counts.noOutput++;
    else counts.unclassified++;
  }
  return counts;
}

function describeFailureCoverage({ confirmed, candidate, unclassified, noOutput }) {
  const ui = globalThis.__trajectoryUi ?? (text => text);
  const format = new Intl.NumberFormat(globalThis.__trajectoryLocale ?? 'zh-CN');
  const total = confirmed + candidate + unclassified + noOutput;
  if (!total) return '';
  const parts = [`${format.format(confirmed)} / ${format.format(total)} ${ui('已归因')}`];
  for (const [count, label] of [[candidate, '候选原因'], [unclassified, '待定位'], [noOutput, '无文字返回']]) {
    if (count) parts.push(`${format.format(count)} ${ui(label)}`);
  }
  return parts.join(' · ');
}

export const failureViewRuntime = () => [
  ['__trajectoryFailureText', describeFailure], ['__trajectoryFailureCounts', summarizeFailureAttributions],
  ['__trajectoryFailureCoverageText', describeFailureCoverage],
].map(([name, fn]) => 'globalThis.' + name + ' = ' + fn.toString() + ';\n').join('');

export const isShellTool = name => /^(?:commandExecution|bash|pwsh|powershell|shell|terminal|exec_command)$/i.test(name ?? '');
export const isProgramTool = name => /^run_?code$/i.test(name ?? '');
export function powerShellEdition(executable) {
  const name = String(executable ?? '').trim().replace(/^["']|["']$/g, '').split(/[\\/]/).at(-1);
  if (/^pwsh(?:\.exe)?$/i.test(name)) return 'Core';
  if (/^powershell(?:\.exe)?$/i.test(name)) return 'Desktop';
  return null;
}

export function commandPowerShellEdition(command) {
  if (Array.isArray(command)) return powerShellEdition(command[0]);
  const launcher = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s"']+))(?=\s|$)/.exec(command ?? '');
  return powerShellEdition(launcher?.[1] ?? launcher?.[2] ?? launcher?.[3]);
}

// Recover exact PowerShell text only from recorded argv or a tool's explicit
// shell input. A rendered Codex command line is useful for labels, not parsing.
export function powerShellScript(command, tool, shell) {
  if (Array.isArray(command)) {
    const edition = powerShellEdition(command[0]), text = command.at(-1);
    return edition && command.length >= 3 && /^-(?:command|c)$/i.test(command.at(-2)) && typeof text === 'string'
      ? { edition, text } : null;
  }
  const recorded = powerShellEdition(shell), toolEdition = powerShellEdition(tool);
  if ((recorded || toolEdition) && typeof command === 'string') {
    return { edition: recorded ?? (toolEdition === 'Desktop' ? 'Desktop' : null), text: command };
  }
  // Bash can launch a PowerShell child with a single literal argument.
  if (typeof command === 'string' && /^bash$/i.test(tool ?? '')) {
    const match = /^(pwsh(?:\.exe)?|powershell(?:\.exe)?)(?:\s+-(?:NoProfile|NoLogo|NonInteractive))*\s+-(?:Command|c)\s+'([^']*)'\s*$/i.exec(command.trim());
    if (match) return { edition: powerShellEdition(match[1]), text: match[2] };
  }
  return null;
}

const decolor = text => String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const sourceText = command => {
  if (Array.isArray(command)) return command.at(-1);
  if (typeof command !== 'string') return '';
  const match = commandPowerShellEdition(command) && /\s-(?:Command|c)\s+([\s\S]+)$/i.exec(command);
  return match ? match[1].replace(/^["']|["']$/g, '') : command;
};
const bounded = value => typeof value === 'string' && value.length > 32768
  ? value.slice(0, 16384) + '\n' + value.slice(-16384) : value;
const programIn = (source, name) => new RegExp('(?:^|[;|{\\r\\n])\\s*(?:&\\s*)?(?:' + name + ')(?:\\.exe)?(?=[\\s;|]|$)', 'i').test(source);
const genericCodes = new Set(['CODE_RUN_FAILED', 'TOOL_OUTCOME_UNKNOWN']);
const nativeCodeAliases = new Map([
  ['ENOENT', 'FS_NOT_FOUND'], ['EACCES', 'TOOL_PERMISSION'], ['EPERM', 'TOOL_PERMISSION'],
  ['ETIMEDOUT', 'TOOL_TIMEOUT'],
]);

function resultCode(value, text, shell) {
  if (Number.isInteger(value)) return value;
  if (!shell) return null;
  const header = /^(?:Exit code\s*[:=]?|(?:Process |Command )?exited with code)\s*(-?\d+)\b/i.exec(text);
  const footer = /(?:^|\n)Command exited with code (-?\d+)\s*$/i.exec(text);
  const number = Number((header ?? footer)?.[1]);
  return Number.isSafeInteger(number) ? number : null;
}

export function candidateAttribution(code, program, exitCode, evidence, site) {
  return { code, label: failureLabels[code][0], certainty: 'candidate', basis: 'script-and-exit',
    program, exitCode, evidence, ...(site ? { site } : {}) };
}

function jsonFailure(lines, detected) {
  for (const line of lines) {
    if (!line.startsWith('{') || line.length > 4096 || !line.includes('"error"')) continue;
    try {
      const row = JSON.parse(line);
      if (row.ok === false && row.error === 'Codex App Server exited before completing the read') {
        return detected('COMMAND_APP_SERVER_EXITED', row.error, 'Codex App Server');
      }
      if (typeof row.error === 'string' && /\b(?:timed out|timeout|ETIMEDOUT)\b/i.test(row.error)) {
        const method = /\bthread\/(?:read|items\/list|turns\/list)\b/.exec(row.error)?.[0];
        return detected('COMMAND_TIMEOUT', method ? method + ' timed out' : 'error: timed out', 'Node');
      }
    } catch {}
  }
  return null;
}

export function legacyParserDiagnostic(lines) {
  const index = lines.findIndex(line => /^\+\s*CategoryInfo\s*:\s*ParserError:/i.test(line));
  if (index < 0) return null;
  const id = /^\+\s*FullyQualifiedErrorId\s*:\s*([A-Za-z][A-Za-z0-9_]{0,80})\b/i.exec(lines[index + 1] ?? '')?.[1];
  return id ? { index, id } : null;
}

// Windows PowerShell 5.1 and Core, including localized/wrapped messages.
// Only stable identifiers are extracted; the message is not a root-cause proof.
export function powerShellDiagnosticIds(text) {
  return [...new Set([...String(text??'').matchAll(/^\s*\+\s*FullyQualifiedErrorId\s*:\s*([A-Za-z][A-Za-z0-9_.-]{0,79})(?=\s*(?:,|$))/gm)].map(match=>match[1]))];
}

// Keep the runtime's own failure kind separate from an inferred root cause.
function programFailure(runtime, detected) {
  const match = /^(?:Error:\s*)?code run failed \((exception|timeout|abort|worker-exit|invalid-output|output-limit|protocol|sandbox-unavailable)\):\s*([^\n]*)/i.exec(runtime);
  if (!match) return null;
  const kind = match[1].toLowerCase(), message = match[2].trim();
  const exception = /^(?:Error:\s*)?([A-Za-z][A-Za-z0-9]*(?:Error|Exception))\b/.exec(message)?.[1];
  const codes = { exception: /^(?:SyntaxError|IndentationError|TabError|TransformError)$/.test(exception ?? '') ? 'CODE_SYNTAX' : 'CODE_EXCEPTION',
    timeout: 'CODE_TIMEOUT', abort: 'CODE_ABORTED', 'worker-exit': 'CODE_WORKER_EXIT', 'invalid-output': 'CODE_INVALID_OUTPUT',
    'output-limit': 'CODE_OUTPUT_LIMIT', protocol: 'CODE_PROTOCOL', 'sandbox-unavailable': 'CODE_SANDBOX_UNAVAILABLE' };
  return { ...detected(codes[kind], message.slice(0, 220) || kind, 'PTC', 'runtime-kind'), runtimeKind: kind,
    ...(exception ? { exception } : {}) };
}

function failureLocation(runtime, program) {
  if (program === 'PowerShell') {
    const line = /^\s*(\d+)\s*\|/m.exec(runtime)?.[1];
    return line ? { line: Number(line), source: 'recorded-output' } : undefined;
  }
  const stack = /^\s*at\s+(?:[^()\n]*\()?((?:file:\/\/\/|[A-Z]:[\\/]|\/)[^()\n]+?\.(?:[cm]?[jt]sx?|py)):(\d+)(?::(\d+))?\)?\s*$/im.exec(runtime);
  if (stack) return { file: stack[1].slice(0, 240), line: Number(stack[2]), ...(stack[3] ? { column: Number(stack[3]) } : {}), source: 'runtime-stack' };
  const python = /^\s*File "([^"\n]+)", line (\d+)/m.exec(runtime);
  return python ? { file: python[1].slice(0, 240), line: Number(python[2]), source: 'runtime-stack' } : undefined;
}

function recordedFailure(runtime, source, shell, detected) {
  if (shell) {
    const node = programIn(source, 'node'), python = programIn(source, 'python(?:3)?|py'), git = programIn(source, 'git');
    const lines = runtime.split(/\r?\n/).map(line => line.trim());
    const legacyGrammar = legacyParserDiagnostic(lines);
    if (legacyGrammar || lines.some(line => /^ParserError:/i.test(line))) {
      return detected('COMMAND_SYNTAX', legacyGrammar?.id ?? 'ParserError', 'PowerShell');
    }
    const ids = powerShellDiagnosticIds(runtime);
    const argument = ids.find(id=>/^(?:NamedParameterNotFound|PositionalParameterNotFound|ParameterArgumentValidationError|ParameterBindingException|AmbiguousParameter|MissingMandatoryParameter)$/.test(id));
    if (argument) return { ...detected('COMMAND_ARGUMENT', argument, 'PowerShell'), pattern: argument };
    if (ids.includes('CommandNotFoundException')) {
      const name = /(?:The term\s+['"]([^'"]+)['"]|无法将[“"']([^”"']+)[”"'])/.exec(runtime);
      return { ...detected('COMMAND_NOT_FOUND', 'CommandNotFoundException', 'PowerShell'),
        ...(name ? { pattern: 'CommandNotFoundException:'+(name[1]??name[2]).slice(0,100) } : {}) };
    }
    if (ids.some(id=>id==='PathNotFound'||id==='FileOpenFailure')) return detected('FS_NOT_FOUND', ids.includes('PathNotFound')?'PathNotFound':'FileOpenFailure', 'PowerShell');
    const runtimeId = ids.find(id=>/^(?:ArgumentOutOfRangeException|NullArray|MethodInvocationException|InvalidOperation)$/.test(id));
    if (runtimeId) return {...detected('COMMAND_RUNTIME_ERROR',runtimeId,'PowerShell'),pattern:runtimeId};
    if (/\b(?:error TS\d+):/m.test(runtime)) {
      const code=/\berror (TS\d+):/.exec(runtime)[1];
      return {...detected('COMMAND_TEST_FAILED',code,'TypeScript'),pattern:code};
    }
    if (/(?:^|\n)(?:python(?:\.exe)?\s*:\s*)?Traceback \(most recent call last\):/m.test(runtime)) {
      const error = [...runtime.matchAll(/^(\w+(?:Error|Exception)):\s*(.+)$/gm)].at(-1);
      if (error) return {...detected(/^Unicode(?:Encode|Decode)Error$/.test(error[1])?'COMMAND_ENCODING_ERROR':error[1]==='PermissionError'?'COMMAND_PERMISSION':'COMMAND_RUNTIME_ERROR',error[1],'Python'),exception:error[1],pattern:error[1]};
    }
    if (/\bERR_SQLITE_ERROR\b/.test(runtime) && /(?:^|\n)(?:Error:|\s+code:)/m.test(runtime)) return detected('COMMAND_RUNTIME_ERROR','ERR_SQLITE_ERROR','SQLite');
    if (/^(?:ssh\s*:\s*)?bash:.*(?:syntax error|unexpected EOF)/m.test(runtime)) return {...detected('COMMAND_SYNTAX','Remote Bash syntax','bash'),layer:'remote-shell',pattern:'remote-bash-quoting'};
    if (/^(?:ssh\s*:\s*)?sed:.*Unmatched/m.test(runtime)) return {...detected('COMMAND_PATTERN','Unmatched grouping expression','sed'),pattern:'sed:unmatched-group'};
    if (/^(?:ssh\s*:\s*)?awk:.*(?:syntax|backslash)/m.test(runtime)) return {...detected('COMMAND_PATTERN','awk expression syntax','awk'),pattern:/backslash/.test(runtime)?'awk:backslash':'awk:syntax'};
    if (/^rg:\s*regex parse error:/im.test(runtime)) return detected('COMMAND_PATTERN', 'rg: regex parse error', 'rg');
    if (/^rg:.*\(os error (?:2|3|123)\)/im.test(runtime)) return detected('FS_NOT_FOUND', 'rg: file or path error', 'rg');
    if (/^Get-Content\s*:.*(?:cannot find|找不到|不存在)/im.test(runtime)) return detected('FS_NOT_FOUND', 'Get-Content: path not found', 'PowerShell');
    if (/^rg:.*\(os error (?:5|13)\)/im.test(runtime)) return detected('COMMAND_PERMISSION', 'rg: permission denied', 'rg');
    if (/(?:^|\n)\s*(?:\|\s*)?(?:The term .{1,400} is not recognized as a name of a cmdlet|CommandNotFoundException\b)/i.test(runtime)) {
      return detected('COMMAND_NOT_FOUND', 'CommandNotFoundException', 'PowerShell');
    }
    if (/(?:^|\n)\s*(?:[A-Za-z]+-[A-Za-z]+:\s*)?(?:Cannot bind (?:argument|parameter)|A parameter cannot be found that matches parameter name)\b/i.test(runtime)) {
      return detected('COMMAND_ARGUMENT', 'PowerShell parameter binding', 'PowerShell');
    }
    if (lines.includes('Line |') && /The process cannot access the file .{1,512} because it is being used by another process\./i.test(runtime)) {
      return detected('COMMAND_FILE_BUSY', 'File is being used by another process', 'PowerShell');
    }
    if (lines.includes('Get-CimInstance:') && lines.includes('| 无法从客户端中访问 CIM 资源。')) {
      return detected('COMMAND_CIM_UNAVAILABLE', 'Get-CimInstance', 'PowerShell');
    }
    if (/^\[?ERR_PNPM_NO_OFFLINE_TARBALL\]?(?=\s|:)/m.test(runtime)) {
      return detected('COMMAND_OFFLINE_DEPENDENCY', 'ERR_PNPM_NO_OFFLINE_TARBALL', 'pnpm');
    }
    if (git) {
      if (/^fatal:.*(?:failed to connect|could not resolve host|connection refused|connection reset)/im.test(runtime)) {
        return detected('COMMAND_CONNECTION_FAILED', 'git: connection failed', 'git');
      }
      if (/^fatal:.*(?:permission denied|access is denied)/im.test(runtime)) return detected('COMMAND_PERMISSION', 'git: permission denied', 'git');
      if (/\bdiff\b[^;|\r\n]{0,120}\s--check\b/.test(source) &&
          /^.+:\d+:\s+(?:trailing whitespace|new blank line at EOF|space before tab in indent)\./m.test(runtime)) {
        return detected('COMMAND_TEST_FAILED', 'git diff --check: whitespace', 'git');
      }
    }
    if (python && /^Traceback \(most recent call last\):/m.test(runtime)) {
      const encoding = /^(Unicode(?:Encode|Decode)Error):/m.exec(runtime)?.[1];
      if (encoding) return detected('COMMAND_ENCODING_ERROR', encoding, 'Python');
      if (/^PermissionError:/m.test(runtime)) return detected('COMMAND_PERMISSION', 'PermissionError', 'Python');
    }
    if (python && /^Unexpected key\(s\) in SKILL\.md frontmatter: .+\. Allowed properties are:/m.test(runtime)) {
      return detected('COMMAND_TEST_FAILED', 'Unsupported SKILL.md frontmatter keys', 'Skill validator');
    }
    if (node || /^node:(?:internal|net|fs|events|assert)\b/m.test(runtime)) {
      const blocked = /\bconnect (?:EACCES|EPERM)\b/i.exec(runtime)?.[0];
      if (blocked) return detected('COMMAND_CONNECTION_DENIED', blocked, 'Node');
      const denied = /\b(?:listen|spawn(?:Sync)?|open|read|write) (?:EACCES|EPERM)\b/i.exec(runtime)?.[0];
      if (denied) return detected('COMMAND_PERMISSION', denied, 'Node');
      const structured = jsonFailure(lines, detected);
      if (structured) return structured;
      if (/^ToolArgsError:\s+invalid\b/m.test(runtime) && /\bcode:\s*['"]INVALID_ARGS['"]/m.test(runtime)) {
        return detected('COMMAND_ARGUMENT', 'ToolArgsError · INVALID_ARGS', 'Node');
      }
      if (/^(?:locator|page)\.\w+:.*(?:is not a valid selector|Failed to execute ['"]querySelector)/im.test(runtime)) {
        return detected('COMMAND_ARGUMENT', 'Playwright: invalid selector', 'Playwright');
      }
      if (/^(?:locator|page)\.\w+:\s+.*expected (?:string|number|boolean), got (?:object|undefined|null|number|boolean|array)\b/im.test(runtime)) {
        return detected('COMMAND_ARGUMENT', 'Playwright argument type mismatch', 'Playwright');
      }
      if (/^response\.(?:body|json|text):.*Request content was evicted from inspector cache/im.test(runtime)) {
        return detected('COMMAND_RESPONSE_BODY_UNAVAILABLE', 'Request content was evicted from inspector cache', 'Playwright');
      }
      if (/^(?:Error:\s*)?(?:locator|page)\.\w+:.*(?:timed out|timeout)\b/im.test(runtime)
          || /waiting for locator[^\n]*\n[\s\S]{0,300}timeout|timeout[^\n]*\n[\s\S]{0,300}waiting for locator/i.test(runtime)) {
        return detected('COMMAND_TIMEOUT', 'Playwright locator timeout', 'Playwright');
      }
      if (/^(?:AssertionError\b|\s*(?:✖ |not ok \d|#\s*fail\s+[1-9]))/m.test(runtime)
          || /\bnode\b[^\r\n]{0,160}\s--test\b/i.test(source) && (/\bAssertionError\b/.test(runtime) || /^FAIL\b/m.test(runtime))) {
        return detected('COMMAND_TEST_FAILED', 'Node test failure', 'Node');
      }
      if ((/^Expected values to be strictly (?:deep-equal|equal):\s*$/m.test(runtime) && /^\s*\+\s*actual\b.*-\s*expected\b/m.test(runtime))
          || (/^The expression evaluated to a falsy value:\s*$/m.test(runtime) && /^\s*assert\.(?:ok|strictEqual|deepStrictEqual)\(/m.test(runtime))) {
        return detected('COMMAND_TEST_FAILED', 'Node assertion failed', 'Node');
      }
      if (/^(?:Error|TypeError|ReferenceError|RangeError|SyntaxError)(?: \[[A-Z_]+\])?:\s+\S/m.test(runtime)
          && /(?:^|\n)\s+at (?:.*\(|file:\/\/\/|node:)/m.test(runtime)) {
        return detected('COMMAND_RUNTIME_ERROR', 'Node runtime stack', 'Node');
      }
    }
    if (/^(?:TimeoutError:|Timed out\b|command timed out\b)/im.test(runtime)) {
      return detected('COMMAND_TIMEOUT', 'Timed out');
    }
  } else if (/^(?:File not found|No such file or directory|ENOENT\b|找不到文件|文件不存在)/im.test(runtime)) {
    return detected('FS_NOT_FOUND', 'File not found');
  } else if (/^(?:Permission denied|Access is denied|EACCES\b|EPERM\b|拒绝访问)/im.test(runtime)) {
    return detected('TOOL_PERMISSION', 'Permission denied');
  } else if (/^(?:TimeoutError:|Timed out\b|Tool timed out\b)/im.test(runtime)) {
    return detected('TOOL_TIMEOUT', 'Timed out');
  }
  return null;
}

export function attributeToolFailure({ status, tool, output, stderr, error, exitCode, interrupted, command }) {
  if (status !== 'error') return undefined;
  const shell = isShellTool(tool);
  const text = decolor(bounded(output)).trim();
  const diagnostic = typeof stderr === 'string' ? decolor(bounded(stderr)).trim() : '';
  const message = decolor(bounded(typeof error === 'string' ? error : error?.message)).trim();
  const runtime = message && !text.includes(message) ? message + '\n' + text : text;
  const exit = resultCode(exitCode ?? error?.exitCode, text, shell);
  const exitOnly = shell && /^(?:Exit code\s*[:=]?|(?:Process |Command )?exited with code)\s*-?\d+\s*$/i.test(runtime);
  const outputRecorded = !!diagnostic || !!runtime && !exitOnly;
  const detected = (code, evidence, program, basis = 'runtime-output') => ({
    code, label: failureLabels[code][0], certainty: 'confirmed', basis, exitCode: exit,
    ...(program ? { program } : {}), evidence,
    ...(powerShellDiagnosticIds(diagnostic || runtime).length ? { diagnosticIds: powerShellDiagnosticIds(diagnostic || runtime) } : {}),
    ...(failureLocation(diagnostic || runtime, program) ? { site: failureLocation(diagnostic || runtime, program) } : {}),
  });
  const nativeCode = nativeCodeAliases.get(error?.code) ?? error?.code;
  if (categories.has(nativeCode) && !genericCodes.has(nativeCode)) {
    const missing = nativeCode==='INVALID_ARGS' && /missing required property ["']([^"']+)["']/.exec(runtime);
    return {...detected(nativeCode, error.code, null, 'native-code'),...(missing?{pattern:'missing-required:'+missing[1],evidence:'缺少必填参数 '+missing[1]}:{})};
  }
  if (interrupted === true) return detected('ABORTED', 'interrupted', null, 'native-status');
  if (shell && /^(?:Error:\s*)?sandbox-local windows-acl temp grant materialization failed/m.test(runtime)) return {...detected('HOST_SANDBOX_SETUP_FAILED','临时授权准备及清理失败','DSH'),pattern:'sandbox:temporary-grant'};
  if (shell && /^(?:Error:\s*)?SetNamedSecurityInfoW failed \(Win32 \d+\): grantWrite/m.test(runtime)) return {...detected('HOST_SANDBOX_SETUP_FAILED','SetNamedSecurityInfoW / grantWrite','DSH'),pattern:'acl:grantWrite'};
  if (/^(?:Error:\s*)?ReplaceFileW EIO \(Win32 \d+\):/m.test(runtime)) return detected('FS_REPLACE_FAILED','ReplaceFileW EIO');
  if (/^job_(?:output|kill)$/i.test(tool??'') && /^(?:Error:\s*)?unknown job\b/m.test(runtime)) return detected('JOB_NOT_FOUND','Unknown job');
  if (/^job_output$/i.test(tool??'') && /^(?:Error:\s*)?wait aborted\s*$/m.test(runtime)) return detected('JOB_WAIT_ABORTED','Wait aborted');

  if (isProgramTool(tool) && nativeCode === 'CODE_RUN_FAILED') {
    const observedProgram = programFailure(runtime, detected);
    if (observedProgram) return observedProgram;
  }

  const source = bounded(sourceText(command)) ?? '';
  const observed = (diagnostic && recordedFailure(diagnostic, source, shell, (code, evidence, program) =>
    detected(code, evidence, program, 'native-stderr'))) || recordedFailure(runtime, source, shell, detected);
  if (observed) return observed;
  if (shell && powerShellDiagnosticIds(diagnostic || runtime).includes('NativeCommandError')) return {...detected('COMMAND_EXTERNAL_FEEDBACK','NativeCommandError','PowerShell'),certainty:'candidate'};
  if (shell && exit === 1 && !outputRecorded && /^rg(?:\.exe)?[ \t]+(?:[^;|&<>(){}\r\n\x60$"']|"[^"\r\n\x60$]*"|'[^'\r\n]*')+$/i.test(source.trim())
      && !/(?:^|\s)(?:--no-messages|-s)(?=\s|$)/.test(source)) {
    return candidateAttribution('LOOKUP_NO_MATCH', 'rg', exit, 'rg · exit 1');
  }

  const code = nativeCode === 'TOOL_OUTCOME_UNKNOWN' ? nativeCode : outputRecorded ? 'UNCLASSIFIED_OUTPUT' : 'NO_OUTPUT';
  return { code, label: failureLabels[code][0], certainty: 'unknown', basis: outputRecorded ? 'unclassified-output' : 'no-output', exitCode: exit };
}

// Presentation may retain the host's more specific code for a record whose
// cause is still unknown. Candidate classifications do not enter cause totals.
export function failureCondition(attribution, nativeCode) {
  return attribution?.certainty === 'confirmed' ? attribution.code :
    typeof nativeCode === 'string' && !nativeCode.startsWith('TOOL_ERROR:') ? nativeCode : 'TOOL_ERROR';
}
