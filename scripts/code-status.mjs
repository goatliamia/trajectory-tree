#!/usr/bin/env node
// 生成 docs/code-status.md：模块、依赖与复杂度的固定快照。
//
// 依赖来自 Code Relations（私有分析引擎）的 ts-scan；
// 复杂度由 scripts/code-complexity.mjs 用 TypeScript 语法树复算，
// 每次生成前先用 test/complexity/engine-baseline.json 核对口径。

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {pathToFileURL} from 'node:url';

import { measureFile } from './code-complexity.mjs';

const SOURCE_DIRS = ['analyzers', 'design', 'experiments', 'lib', 'plugin', 'report', 'scripts', 'skill', 'view', 'docs/demo/layout-review', 'docs/demo/preset-context'];
const SOURCE_EXT = /\.(mjs|js)$/;
const EXCLUDED = [
  /(^|\/)fixtures\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)tmp-/,
  /(^|\/)test-/,
  /-test\.mjs$/,
  /(^|\/)(?:test|tests)(?:\/|\.m?js$)/,
];
const FENCE = '```';
const BASELINE = 'test/complexity/engine-baseline.json';
// 由脚本生成、与别处源码重复的副本：计入模块体量，不参与函数与文件排名。
const GENERATED = [
  'plugin/analysis-view/lib/trace/page.js',
  'plugin/analysis-view/lib/trace/shared/',
  'plugin/analysis-view/lib/trace/models/',
  'plugin/analysis-view/lib/eval/workspace/',
  'plugin/analysis-view/lib/current-context/',
  'plugin/trajectory-tools/lib/inspect-models/',
];

function parseArgs(argv) {
  const options = { repo: process.cwd(), engine: '', python: '', typescript: '', out: 'docs/code-status.md', refresh: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--repo': options.repo = argv[++index]; break;
      case '--engine': options.engine = argv[++index]; break;
      case '--python': options.python = argv[++index]; break;
      case '--typescript': options.typescript = argv[++index]; break;
      case '--out': options.out = argv[++index]; break;
      case '--refresh': options.refresh = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function resolvePython(options) {
  if (options.python) return options.python;
  if (options.engine) {
    for (const candidate of [join(options.engine, '.venv', 'Scripts', 'python.exe'), join(options.engine, '.venv', 'bin', 'python3')]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function resolveTypeScript(options) {
  if (options.typescript) return options.typescript;
  if (!options.engine) throw new Error('需要 --typescript 或 --engine 提供 TypeScript 编译器');
  const candidate = join(options.engine, 'node_modules', 'typescript', 'lib', 'typescript.js');
  if (!existsSync(candidate)) throw new Error(`找不到 TypeScript 编译器：${candidate}`);
  return candidate;
}

export function selectSources(repo) {
  return git(repo, ['ls-files']).split(/\r?\n/).filter(Boolean)
    .filter((path) => SOURCE_DIRS.some((dir) => path.startsWith(`${dir}/`)))
    .filter((path) => SOURCE_EXT.test(path))
    .filter((path) => !EXCLUDED.some((pattern) => pattern.test(path)))
    .sort();
}

export function sourceFingerprint(repo,files){
  const hash=createHash('sha256');
  for(const file of files)hash.update(file+'\0').update(readFileSync(join(repo,file))).update('\0');
  return hash.digest('hex');
}

function writeConfig(dir, repo, files) {
  const config = {
    compilerOptions: { allowJs: true, checkJs: false, noEmit: true, noResolve: true, moduleDetection: 'force', module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', types: [] },
    files: files.map((file) => join(repo, file)),
  };
  const path = join(dir, 'jsconfig.json');
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return path;
}

function collectDependencies(options, repo, config, files, cache) {
  const path = join(cache, 'deps.json');
  const metaPath = join(cache, 'deps.meta.json');
  let engineHead = 'unknown';
  try { engineHead = git(options.engine, ['rev-parse', 'HEAD']); } catch { /* 引擎目录可能不是 Git 仓库 */ }
  // Hash the scanned bytes, not just the path list and uncommitted diff. A
  // clean checkout at a newer commit must not reuse an older dependency graph.
  const compilerHash=createHash('sha256').update(readFileSync(resolveTypeScript(options))).digest('hex');
  let previous;
  try{previous=JSON.parse(readFileSync(metaPath,'utf8'));}catch{}
  const fingerprint=createHash('sha256').update(sourceFingerprint(repo,files)).update(engineHead)
    .update(compilerHash).update(readFileSync(config))
    .update(readFileSync(join(repo,'scripts/code-scan.py'))).digest('hex');
  if (!options.refresh && existsSync(path) && existsSync(metaPath)) {
    try {
      if (JSON.parse(readFileSync(metaPath, 'utf8')).fingerprint === fingerprint) return readFileSync(path, 'utf8');
    } catch { /* 元数据损坏时重新扫描 */ }
  }
  const python = resolvePython(options);
  const typescript = resolveTypeScript(options);
  const scanArgs=['-B','-X','utf8',join(repo,'scripts/code-scan.py'),'--repo',repo,'--engine',options.engine,
    '--project',config,'--typescript',typescript,'--inventory',join(cache,'inventory.json'),'--out',cache];
  if(options.refresh||previous?.compilerHash&&previous.compilerHash!==compilerHash)scanArgs.push('--refresh');
  const result = spawnSync(python,scanArgs, {
    cwd: repo,
    stdio: ['ignore','pipe','inherit'],
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: options.engine, PYTHONUTF8: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ts-scan 失败（${result.status}）：\n${result.stderr || result.stdout}`);
  const output=readFileSync(join(cache,'scan.json'),'utf8');
  writeFileSync(path, output, 'utf8');
  writeFileSync(metaPath, `${JSON.stringify({ fingerprint, compilerHash, engineHead, files: files.length }, null, 2)}\n`, 'utf8');
  return output;
}

function parseDependencies(text) {
  if(text.trimStart().startsWith('{'))return JSON.parse(text);
  const rows = [];
  let coverage = null;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^(.+?)；(\d+) 对结果；(\d+) 项相关待解释条件/);
    if (header) {
      coverage = { status: header[1], pairs: Number(header[2]), pending: Number(header[3]) };
      continue;
    }
    const match = line.match(/^\s+(\S+?):\s+→\s+(\S+?)\s+（(\d+) 份见证）/);
    if (match) rows.push({ source: match[1], target: match[2], witnesses: Number(match[3]) });
  }
  return { rows, coverage };
}

function moduleOf(file) {
  for(const area of ['docs/demo/layout-review','docs/demo/preset-context'])if(file.startsWith(area+'/'))return area;
  const parts = file.split('/');
  if (parts[0] === 'plugin' && parts.length > 2) return `plugin/${parts[1]}`;
  return parts[0];
}

function countLines(repo, file) {
  const text = readFileSync(join(repo, file), 'utf8');
  if (!text) return 0;
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function isGenerated(file) {
  return GENERATED.some((prefix) => file === prefix || file.startsWith(prefix));
}

function selfCheck(ts, repo) {
  const fixture = JSON.parse(readFileSync(join(repo, BASELINE), 'utf8'));
  const expected = new Map(fixture.units.map((unit) => [`${unit.file}@${unit.start}`, unit.cyclomatic]));
  let checked = 0;
  for (const file of new Set(fixture.units.map((unit) => unit.file))) {
    for (const unit of measureFile(ts, repo, file)) {
      const key = `${unit.file}@${unit.start}`;
      if (!expected.has(key)) continue;
      checked += 1;
      if (unit.cyclomatic !== expected.get(key)) {
        throw new Error(`圈复杂度口径偏离引擎：${key} 期望 ${expected.get(key)}，得到 ${unit.cyclomatic}（${unit.name}）`);
      }
    }
  }
  if (checked !== expected.size) throw new Error(`口径基线未全部核对：${checked}/${expected.size}`);
  return checked;
}function aggregate({ repo, files, deps, units }) {
  const modules = new Map();
  const moduleFor = (file) => {
    const key = moduleOf(file);
    if (!modules.has(key)) modules.set(key, { key, files: [], lines: 0, complexity: 0, max: 0, functions: 0, fanIn: 0, fanOut: 0 });
    return modules.get(key);
  };
  const fileComplexity = new Map();
  const fileFunctions = new Map();
  for (const unit of units) {
    fileComplexity.set(unit.file, (fileComplexity.get(unit.file) || 0) + unit.cyclomatic);
    fileFunctions.set(unit.file, (fileFunctions.get(unit.file) || 0) + 1);
  }
  for (const file of files) {
    const entry = moduleFor(file);
    entry.files.push(file);
    entry.lines += countLines(repo, file);
    entry.functions += fileFunctions.get(file) || 0;
    entry.complexity += fileComplexity.get(file) || 0;
    entry.max = Math.max(entry.max, fileComplexity.get(file) || 0);
  }

  const fanIn = new Set();
  const fanOut = new Set();
  const edges = new Map();
  const surfaceModules = new Set(modules.keys());
  const outside = [];
  for (const row of deps.rows) {
    const from = moduleOf(row.source);
    const to = moduleOf(row.target);
    if (!surfaceModules.has(from) || !surfaceModules.has(to)) {
      outside.push(row);
      continue;
    }
    fanOut.add(row.source);
    fanIn.add(row.target);
    const key = `${from}\u0000${to}`;
    const edge = edges.get(key) || { from, to, pairs: 0, witnesses: 0, examples: [] };
    edge.pairs += 1;
    edge.witnesses += row.witnesses;
    if (edge.examples.length < 2) edge.examples.push(`${row.source} → ${row.target}`);
    edges.set(key, edge);
  }
  for (const entry of modules.values()) {
    entry.fanIn = entry.files.filter((file) => fanIn.has(file)).length;
    entry.fanOut = entry.files.filter((file) => fanOut.has(file)).length;
  }

  const authored = units.filter((unit) => !isGenerated(unit.file));
  const buckets = [
    { label: '1–5', min: 1, max: 5 },
    { label: '6–10', min: 6, max: 10 },
    { label: '11–20', min: 11, max: 20 },
    { label: '21–40', min: 21, max: 40 },
    { label: '41+', min: 41, max: Infinity },
  ].map((bucket) => ({ ...bucket, count: authored.filter((unit) => unit.cyclomatic >= bucket.min && unit.cyclomatic <= bucket.max).length }));

  const sorted = authored.map((unit) => unit.cyclomatic).sort((left, right) => left - right);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const topUnits = [...authored].sort((left, right) => right.cyclomatic - left.cyclomatic || left.file.localeCompare(right.file)).slice(0, 12);
  const topFiles = [...fileComplexity.entries()]
    .filter(([file]) => !isGenerated(file))
    .map(([file, complexity]) => ({ file, complexity, functions: fileFunctions.get(file) || 0, lines: countLines(repo, file) }))
    .sort((left, right) => right.complexity - left.complexity || left.file.localeCompare(right.file))
    .slice(0, 10);

  return {
    modules: [...modules.values()].sort((left, right) => right.lines - left.lines),
    edges: [...edges.values()].sort((left, right) => right.pairs - left.pairs),
    outside,
    surfaceModules,
    buckets,
    median,
    topUnits,
    topFiles,
    totals: {
      files: files.length,
      lines: [...modules.values()].reduce((sum, entry) => sum + entry.lines, 0),
      functions: units.length,
      complexity: [...modules.values()].reduce((sum, entry) => sum + entry.complexity, 0),
      complexityAuthored: units.filter((unit) => !isGenerated(unit.file)).reduce((sum, unit) => sum + unit.cyclomatic, 0),
      pairs: deps.coverage?.pairs ?? deps.rows.length,
      pending: deps.coverage?.pending ?? 0,
      status: deps.coverage?.status || 'unknown',
    },
  };
}

function number(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function nodeId(module) {
  return `m_${module.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function render({ snapshot, selfChecked }, report) {
  const { totals } = report;
  const lines = [];
  const moduleEdges = report.edges.filter((edge) => edge.from !== edge.to);
  const internalEdges = report.edges.filter((edge) => edge.from === edge.to);
  const drawn = moduleEdges.filter((edge) => edge.pairs >= 2);

  lines.push('# 代码状态', '');
  lines.push('<!-- 由 scripts/code-status.mjs 生成，请勿手改。 -->', '');
  lines.push(`快照：${snapshot.date} · 提交 \`${snapshot.commit}\`${snapshot.dirty ? ' · 含未提交改动' : ''}`);
  lines.push('');
  lines.push(`源码面：${number(totals.files)} 个文件 · ${number(totals.lines)} 行 · ${number(totals.functions)} 个函数或方法`);
  lines.push('');
  lines.push(`依赖：${number(totals.pairs)} 对文件级值依赖 · ${moduleEdges.length} 组跨模块方向 · ${internalEdges.length} 组模块内部方向`);
  lines.push('');
  lines.push(`复杂度：圈复杂度合计 ${number(totals.complexity)}，其中手写部分 ${number(totals.complexityAuthored)} · 中位数 ${report.median} · 最高 ${report.topUnits[0]?.cyclomatic ?? 0}`);
  lines.push('');

  lines.push('## 模块', '');
  lines.push('| 模块 | 文件 | 行 | 函数 | 圈复杂度 | 单文件最高 | 扇入 | 扇出 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const entry of report.modules) {
    lines.push(`| \`${entry.key}\` | ${entry.files.length} | ${number(entry.lines)} | ${number(entry.functions)} | ${number(entry.complexity)} | ${number(entry.max)} | ${entry.fanIn} | ${entry.fanOut} |`);
  }
  lines.push(`| **合计** | **${totals.files}** | **${number(totals.lines)}** | **${number(totals.functions)}** | **${number(totals.complexity)}** | | | |`);
  lines.push('');
  lines.push('扇入、扇出按文件计：模块内至少有一个文件被别的文件依赖，或被依赖，就计一次。');
  lines.push('');
  lines.push('轨迹页及模型/共享资源、Eval workspace 与当前上下文安装资源是生成副本，计入发行体量，但不进手写函数与文件排名。正式 UI 的 `docs/demo/layout-review/` 与 `docs/demo/preset-context/` 源码参与排名。');
  lines.push('');

  lines.push('## 模块依赖', '');
  if (moduleEdges.length) {
    lines.push(`${FENCE}mermaid`, 'graph LR');
    for (const entry of report.modules) {
      lines.push(`  ${nodeId(entry.key)}["${entry.key}<br/>${entry.files.length} 文件"]`);
    }
    for (const edge of drawn) lines.push(`  ${nodeId(edge.from)} -->|${edge.pairs}| ${nodeId(edge.to)}`);
    lines.push(FENCE, '');
    lines.push(`图上画 ${drawn.length} 组至少两对文件的跨模块依赖；下表按文件对列出前 ${Math.min(12, moduleEdges.length)} 组。`, '');
    const single = moduleEdges.filter((edge) => edge.pairs < 2);
    if (single.length) {
      lines.push(`另有 ${single.length} 组只有一对文件，未画入图：${single.map((edge) => `\`${edge.from} → ${edge.to}\``).join('、')}。`, '');
    }
  } else {
    lines.push('没有跨模块依赖记录。', '');
  }
  lines.push('| 依赖 | 文件对 | 见证 | 例子 |');
  lines.push('| --- | ---: | ---: | --- |');
  for (const edge of moduleEdges.slice(0, 12)) {
    lines.push(`| \`${edge.from}\` → \`${edge.to}\` | ${edge.pairs} | ${number(edge.witnesses)} | ${edge.examples.map((example) => `\`${example}\``).join('；')} |`);
  }
  lines.push('');
  if (internalEdges.length) {
    const internalPairs = internalEdges.reduce((sum, edge) => sum + edge.pairs, 0);
    lines.push(`模块内部依赖 ${number(internalPairs)} 对，占全部文件对的 ${Math.round((internalPairs / Math.max(1, totals.pairs)) * 100)}%。`, '');
  }
  if (report.outside.length) {
    const outsideModules = new Set();
    for (const row of report.outside) {
      const from = moduleOf(row.source);
      const to = moduleOf(row.target);
      if (!report.surfaceModules.has(from)) outsideModules.add(from);
      if (!report.surfaceModules.has(to)) outsideModules.add(to);
    }
    lines.push(`另有 ${report.outside.length} 对涉及源码面之外的目录（${[...outsideModules].map((name) => `\`${name}/\``).join('、')}），没有画进图里。`, '');
  }

  lines.push('## 复杂度', '');
  lines.push('分布与排名只看手写单元。', '');
  lines.push('| 圈复杂度 | 函数 |');
  lines.push('| --- | ---: |');
  for (const bucket of report.buckets) lines.push(`| ${bucket.label} | ${number(bucket.count)} |`);
  lines.push('');
  lines.push('最高的函数或方法：', '');
  lines.push('| 单元 | 位置 | 圈复杂度 | 行 |');
  lines.push('| --- | --- | ---: | ---: |');
  for (const unit of report.topUnits) lines.push(`| \`${unit.name}\` | \`${unit.file}:${unit.line}\` | ${unit.cyclomatic} | ${number(unit.lines)} |`);
  lines.push('');
  lines.push('复杂度合计最高的文件：', '');
  lines.push('| 文件 | 函数 | 合计 | 行 |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const entry of report.topFiles) lines.push(`| \`${entry.file}\` | ${entry.functions} | ${number(entry.complexity)} | ${number(entry.lines)} |`);
  lines.push('');

  lines.push('## 口径与边界', '');
  lines.push(`- 源码面是 git 跟踪的 ${SOURCE_DIRS.map((dir) => `\`${dir}/\``).join('、')} 下的 \`.js\` 与 \`.mjs\`，排除测试、fixtures、dist、node_modules 与 \`tmp-*\`。`);
  lines.push('- 依赖取 `ts_file_value_dependencies`：值引用经声明落到文件，见证数表示支撑该文件对的引用条数。模块请求与投影路径另计，不并入这里。');
  lines.push('- 圈复杂度按 ESLint classic 口径：每个函数以 1 为基线，显式判定、逻辑运算、可选链和带初值的参数各加一。嵌套函数单独计算。');
  lines.push('- 「手写部分」指排除生成副本后的圈复杂度合计，与函数排名使用同一批单元。');
  lines.push(`- 本次生成前用引擎基线核对了 ${selfChecked} 个单元，口径一致才写出本页。`);
  lines.push(`- 另有 ${number(totals.pending)} 条静态模块请求指向外部或未纳入的来源（\`${totals.status}\`），包括 Node 内建库与宿主 SDK；不是 ${number(totals.pending)} 个缺陷，也不表示不存在依赖。`);
  lines.push('- CR 按每个消费者的完整所选静态 import/export 闭包分批观察；动态分派和浏览器拼装脚本的运行时全局关系未供给。未读绑定只是复核线索，不直接判定可删除。');
  lines.push('- 分析只读源码，不执行项目代码。');
  lines.push('');
  lines.push('复跑：', '');
  lines.push(`${FENCE}sh`, 'node scripts/code-status.mjs --engine ../code-relations', FENCE, '');
  lines.push('本页是显式运行脚本得到的固定快照，不在 Eval 打开或宿主启动时扫描。', '');
  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('node scripts/code-status.mjs --engine <code-relations> [--repo .] [--python <exe>] [--out docs/code-status.md] [--refresh]\n');
    return;
  }
  if (!options.engine) throw new Error('需要 --engine 指向 code-relations 仓库');
  options.engine=resolve(options.engine);
  if(options.typescript)options.typescript=resolve(options.typescript);

  const repo = resolve(options.repo);
  const cache = join(repo, '.dsh', 'code-status');
  mkdirSync(cache, { recursive: true });

  const require = createRequire(import.meta.url);
  const ts = require(resolveTypeScript(options));
  const selfChecked = selfCheck(ts, repo);

  const files = selectSources(repo);
  const config = writeConfig(cache, repo, files);
  writeFileSync(join(cache,'inventory.json'),JSON.stringify(files.map(file=>{
    const bytes=readFileSync(join(repo,file)),source=ts.createSourceFile(file,bytes.toString('utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
    if(source.parseDiagnostics.length)throw Error('Source parse error: '+file);
    return {path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),module:ts.isExternalModule(source),generated:isGenerated(file)};
  })));
  process.stderr.write(`CR dependency scan: ${files.length} tracked source files\n`);
  const deps = parseDependencies(collectDependencies(options, repo, config, files, cache));
  const units = files.flatMap((file) => measureFile(ts, repo, file));
  const commit = git(repo, ['rev-parse', '--short', 'HEAD']);
  const scannedAt=new Date().toISOString();
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(scannedAt));
  const changedSources=new Set(git(repo,['diff','--name-only','HEAD']).split(/\r?\n/));
  const snapshot = {
    date,scannedAt,
    commit,
    dirty: files.some(file=>changedSources.has(file)),
  };

  const report = aggregate({ repo, files, deps, units });
  const markdown = render({ snapshot, selfChecked }, report);
  const out = resolve(repo, options.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdown, 'utf8');
  writeFileSync(join(cache, 'summary.json'), `${JSON.stringify({
    snapshot,
    totals: report.totals,
    topUnits:report.topUnits,topFiles:report.topFiles,edges:report.edges,
    scan:{contexts:deps.contexts,seconds:deps.seconds,engine:deps.engine,scope:deps.scope},
    modules: report.modules.map((entry) => ({ module: entry.key, files: entry.files.length, lines: entry.lines, functions: entry.functions, complexity: entry.complexity })),
  }, null, 2)}\n`, 'utf8');
  rmSync(join(cache, 'jsconfig.json'), { force: true });
  process.stdout.write(`${relative(repo, out)}：${report.totals.files} 个文件，${report.totals.functions} 个函数，${report.totals.pairs} 对依赖\n`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main();
