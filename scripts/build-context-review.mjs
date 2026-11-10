import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadSession } from '../analyzers/load-session.mjs';
import { readRequestContext, requestContextSource } from '../plugin/trajectory-tools/lib/request-context.js';
import { traceContext } from '../plugin/analysis-view/lib/trace-context.js';
import { contextByTurn } from '../docs/demo/layout-review/context-model.mjs';

const output = resolve('.dsh/layout-review');
const html = readFileSync(join(output, 'installed-trace.html'), 'utf8');
const trace = JSON.parse(html.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const main = trace.sessions.find(session => session.id === trace.mainSession);
const file = process.argv[2] || join(process.env.USERPROFILE, '.dsh/sessions/--D-projects-sql~0020event--', main.id, 'session.v4.jsonl.zstd');
const log = loadSession(file);
if (log.id !== main.id) throw new Error('Session identity mismatch');
const events = log.events.filter(event => event.seq <= main.lastSeq);
const series = await readRequestContext(events);
const data = traceContext(events, { sessions: [main] }, series);
const { requests, boundaries, retryStarted } = data;
if (!requests.length) throw new Error('The trace snapshot has no reconstructable request composition');
writeFileSync(join(output, 'context-data.json'), JSON.stringify({
  session: main.id, cutoffSeq: main.lastSeq, eventCount: events.length, source: { name: requestContextSource }, ...data,
}));
const turns = contextByTurn(requests);
const audit = { graphTurns: main.turns.length, contextTurns: turns.length, requests: requests.length,
  firstTurn: turns[0], lastTurn: turns.at(-1), largestDecrease: turns.reduce((best, turn) => turn.decrease > best.decrease ? turn : best),
  boundaries: boundaries.length, retryStarted: retryStarted.length };
writeFileSync(join(output, 'context-audit.json'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ graphTurns: audit.graphTurns, contextTurns: audit.contextTurns, requests: audit.requests,
  lastTurn: turns.at(-1).turn, lastDelta: turns.at(-1).net, boundaries: audit.boundaries, retryStarted: audit.retryStarted }));
