import {createMcpServer,StdioServerTransport} from '../portable-tools/mcp.mjs';
import {fileService} from '../portable-tools/runtime.mjs';
import {TOOLS} from '../portable-tools/tools.mjs';
import {codexViewTool} from './view-tool.mjs';

// A plugin server may outlive one chat. Bind every evidence/view request by its
// explicit session ID instead of inheriting a stale launching chat's environment.
const service=fileService({host:'codex',bindThread:false});
const catalog=service.catalog;service.catalog=(args,signal)=>{if(!args.cwd)throw Error('Specify cwd when listing conversations from the plugin server');return catalog(args,signal);};
const toolDefinitions=TOOLS.map(({name,description,inputSchema})=>({name,description,inputSchema:structuredClone(inputSchema)}));
toolDefinitions.find(t=>t.name==='trajectory_search').inputSchema.properties.cwd.description='列出会话（view=sessions）时必须指定要查询的工作目录。';
const server=createMcpServer(service,{additionalTools:[codexViewTool],toolDefinitions});
await server.connect(new StdioServerTransport());
for(const event of ['SIGINT','SIGTERM'])process.once(event,async()=>{service.dispose();await server.close();});
