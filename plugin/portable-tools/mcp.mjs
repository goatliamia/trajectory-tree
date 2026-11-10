import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TOOLS, executeTool } from './tools.mjs';
import { fileService, sourceOptions } from './runtime.mjs';
import { COMMAND_TOOL, executeCommandTool } from './command-diagnosis.mjs';
import { commandCrOptions } from '../../analyzers/cr-pwsh.mjs';

export function createMcpServer(service, { commandCr } = {}) {
  const dedicated = commandCr !== undefined;
  const tools = dedicated ? [COMMAND_TOOL] : TOOLS;
  const server = new Server({ name: dedicated ? 'trajectory-commands' : 'trajectory-evidence', version: '0.2.2' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const { name, arguments: args = {} } = request.params;
      if (!tools.some(tool => tool.name === name)) throw Error('Unknown tool');
      const result = dedicated ? await executeCommandTool(service, args, commandCr, extra.signal) : await executeTool(service, name, args, extra.signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.onclose = () => service.dispose();
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), spec = sourceOptions(args), commandMode = args.includes('--commands');
    const commandCr = commandMode ? commandCrOptions(args) : undefined;
    const service = fileService({ ...spec, commandDiagnostics: commandMode }, { rebuildSnapshots: commandMode });
    const server = createMcpServer(service, { commandCr });
    await server.connect(new StdioServerTransport());
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, async () => { service.dispose(); await server.close(); });
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
