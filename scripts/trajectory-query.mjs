import { readFile } from 'node:fs/promises';
import { fileService, sourceOptions } from '../plugin/portable-tools/runtime.mjs';
import { executeTool, TOOLS } from '../plugin/portable-tools/tools.mjs';
import { COMMAND_TOOL, executeCommandTool } from '../plugin/portable-tools/command-diagnosis.mjs';
import { commandCrOptions } from '../analyzers/cr-pwsh.mjs';
const argv = process.argv.slice(2), option = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
if (argv.includes('--help')) {
  console.log('node scripts/trajectory-query.mjs --host pi|codex|claude --file <native-session.jsonl|official-snapshot.json> [--thread ID] [--capture file] [--leaf ID] [--api-only] [--tool schema|trajectory_inspect|trajectory_read|trajectory_search|trajectory_graph|trajectory_command_diagnose] [--request args.json | --args JSON]\nCommand diagnosis accepts [--cr-root PATH] [--pwsh PATH]. Add --commands to --tool schema for its schema.');
} else if (option('--tool') === 'schema') {
  const tools = argv.includes('--commands') ? [COMMAND_TOOL] : TOOLS;
  console.log(JSON.stringify({tools:tools.map(({name,description,inputSchema})=>({name,description,inputSchema}))}));
} else {
  let service;
  try {
    const name = option('--tool') || 'trajectory_inspect', commandMode = name === COMMAND_TOOL.name;
    const spec = sourceOptions(argv);
    service = fileService({ ...spec, commandDiagnostics: commandMode }, { rebuildSnapshots: true });
    const args = JSON.parse(option('--request') ? await readFile(option('--request'), 'utf8') : option('--args') || '{}');
    console.log(JSON.stringify(commandMode ? await executeCommandTool(service, args, commandCrOptions(argv)) : await executeTool(service, name, args)));
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
  finally { service?.dispose(); }
}
