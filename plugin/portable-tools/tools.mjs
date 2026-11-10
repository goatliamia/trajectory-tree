import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { IO_OUTCOMES } from '../trajectory-tools/lib/io-outcome.js';
import { CUT_DESCRIPTION, INSPECT_DESCRIPTIONS, TOOL_DESCRIPTIONS } from '../trajectory-tools/lib/tool-descriptions.js';

const string = { type: 'string', minLength: 1 }, integer = { type: 'integer', minimum: 0 };
const turns = { type: 'object', properties: { from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 } }, required: ['from', 'to'], additionalProperties: false };
const focus = { type: 'object', properties: { tool: string, file: string, skill: string }, minProperties: 1, maxProperties: 1, additionalProperties: false };
const common = {
  session: { ...string, description: '原生会话 ID，已绑定来源时可省略。' },
  snapshot: { ...string, description: '沿用返回的快照。' },
  logId: { ...string, description: '图表或取证指针给出的日志标识。' },
  cut: { ...integer, description: CUT_DESCRIPTION },
};
const page = {
  cursor: { ...string, description: '续查时传回游标。' },
  limit: { type: 'integer', minimum: 1, maximum: 20 },
  turns,
  includeSelf: { type: 'boolean', description: '是否包含轨迹取证工具的记录，默认 false。' },
};
const definitions = [
  ['trajectory_inspect', {
    ...page,
    seqs: { type: 'array', minItems: 1, maxItems: 500, items: integer, description: '仅 io。按图表给出的调用序号筛选。省略 groupBy 可看逐次调用。' },
    outcome: { enum: IO_OUTCOMES, description: INSPECT_DESCRIPTIONS.outcome },
    samples: { type: 'boolean', description: INSPECT_DESCRIPTIONS.samples },
    format: { enum: ['summary', 'data'], description: 'summary 摘要（默认），data 原始顺序的表格。repeats 仅支持 summary。' },
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'summary 1–20 项，默认 6。data 默认 250 行。' },
    view: { enum: ['overview', 'latency', 'cost', 'repeats', 'io', 'context'], description: INSPECT_DESCRIPTIONS.view },
    focus,
    groupBy: { enum: ['turn', 'tool', 'file', 'definition'], description: '摘要中 overview/io 可按 turn/tool/file 分组，latency/cost 可按 turn，cost 的 definition 查看定义。表格仅 io 可按 tool/file 分组。' },
    sort: { enum: ['time', 'wall', 'input', 'output', 'returned', 'count', 'change'], description: 'data 仅 time。' },
  }],
  ['trajectory_search', {
    ...page,
    view: { enum: ['sessions', 'events', 'catalog', 'cost'], description: 'events 字面命中（默认），catalog 类型计数，sessions 会话清单，cost 用量。' },
    query: { ...string, description: 'events 使用的字面词。' },
    cwd: { ...string, description: '仅用于未绑定来源的 Codex sessions，默认当前目录。' },
  }],
  ['trajectory_read', {
    seq: integer,
    linked: { type: 'boolean', description: '附带关联调用、返回和后续记录。' },
    field: { enum: ['body', 'arguments', 'result', 'text', 'parameters', 'description'] },
    offset: integer,
    maxChars: { type: 'integer', minimum: 100, maximum: 24000 },
  }],
  ['trajectory_graph', {
    seq: integer,
    mode: { enum: ['relations', 'lineage'], description: 'relations 记录关系，lineage 会话父子关系。' },
  }],
];
export const TOOLS = definitions.map(([name, properties]) => {
  const inputSchema = { type: 'object', properties: { ...common, ...properties }, additionalProperties: false };
  const parameters = Type.Unsafe(inputSchema), validator = Compile(parameters);
  return { name, description: TOOL_DESCRIPTIONS[name], inputSchema, parameters, validate(args) { if (!validator.Check(args)) throw Error('Invalid ' + name + ' parameters: ' + JSON.stringify([...validator.Errors(args)].slice(0, 2))); } };
});
export async function executeTool(service, name, args = {}, signal) {
  const tool = TOOLS.find(t => t.name === name); if (!tool) throw Error('Unknown tool');
  tool.validate(args); return service.call(name, args, signal);
}
