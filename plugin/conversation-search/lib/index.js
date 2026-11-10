// Search recorded messages in one session. Return recent matching turns and an older-page cursor.

import { createHash } from "node:crypto";

const ROUTE_PATH = "/conversation-search";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const MAX_QUERY_CHARS = 240;
const MATCHES_PER_TURN = 3;
const PROMPT_CHARS = 120;
const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 120;

const TOOL_TYPES = new Set(["tool/call", "tool/result", "tool/ptc-dispatch"]);

const ROLE = {
  "user/message": "你",
  "assistant/message": "助手",
  "tool/call": "工具",
  "tool/result": "工具结果",
  "tool/ptc-dispatch": "工具",
};

function blocksText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(block => block?.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}

function isChat(event) {
  if (event.type === "assistant/message") return true;
  if (event.type !== "user/message") return false;
  const kind = (event.data?.source ?? event.data?.message?.source)?.kind;
  return kind == null || kind === "user";
}

/** 一条事件里可检索的文字。没有文字的事件(step 起止之类)不参与。 */
export function eventText(event) {
  const data = event?.data ?? {};
  switch (event?.type) {
    case "user/message":
      return blocksText(data.content ?? data.message?.content);
    case "assistant/message":
      return blocksText(data.message?.content ?? data.content);
    case "tool/call":
    case "tool/ptc-dispatch": {
      const args = typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments);
      return [data.name, args, blocksText(data.content)].filter(Boolean).join("\n");
    }
    case "tool/result": {
      const error = data.error;
      const head = error ? [error.name, error.code].filter(Boolean).join(":") : "";
      return [head, blocksText(data.message?.content ?? data.content)].filter(Boolean).join("\n");
    }
    default:
      return "";
  }
}

function queryPatterns(query) {
  const terms = [...query.matchAll(/"([^"]+)"|“([^”]+)”|[^\s"“”]+/gu)]
    .map(match => (match[1] ?? match[2] ?? match[0]).trim()).filter(Boolean);
  return [...new Set(terms.length ? terms : [query])].map(term =>
    new RegExp(term.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&"), "iu"));
}

function matchRanges(text, patterns) {
  const ranges = [];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) return null;
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges.sort((left, right) => left[0] - right[0]);
}

function snippet(text, ranges) {
  const [at, last] = ranges[0];
  let start = Math.max(0, at - SNIPPET_BEFORE);
  let end = Math.min(text.length, last + SNIPPET_AFTER);
  // Preserve whole Unicode characters at the excerpt boundaries.
  if (/[\uDC00-\uDFFF]/.test(text[start] ?? "")) start--;
  if (/[\uDC00-\uDFFF]/.test(text[end] ?? "")) end++;
  const lead = start > 0 ? 1 : 0;
  const highlights = [];
  for (const [from, to] of ranges) {
    if (from >= end) break;
    const range = [from - start + lead, Math.min(end, to) - start + lead];
    const previous = highlights.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else highlights.push(range);
  }
  return {
    text: (lead ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""),
    matchAt: at - start + lead,
    highlights,
  };
}

/**
 * All terms must occur in the same message. The exclusive turn cursor
 * keeps older pages stable when newer turns are appended to the session.
 */
export function searchTurns(events, needle, options = {}) {
  const limit = Number.isSafeInteger(options.limit) ? Math.min(Math.max(options.limit, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const includeTools = options.scope === "all";
  const before = options.before ?? Infinity;
  const recent = [];
  const query = needle.trim();
  if (!query) return { turns: [], totalMatches: 0, matchedTurns: 0, nextBefore: null };
  const patterns = queryPatterns(query);
  let current = null;
  let ordinal = 0;
  let totalMatches = 0;
  let matchedTurns = 0;

  function finishTurn() {
    if (!current?.count) return;
    matchedTurns++;
    if (current.turn >= before) return;
    recent.push(current);
    if (recent.length > limit + 1) recent.shift();
  }

  for (const event of events || []) {
    if (!event || !Number.isSafeInteger(event.seq) || (event.surfaceOp && typeof event.surfaceOp === "object")) continue;
    if (event.type === "turn/start") {
      finishTurn();
      const recorded = event.data?.turn;
      ordinal++;
      current = { turn: Number.isSafeInteger(recorded) && recorded > 0 ? recorded : ordinal,
        startSeq: event.seq, prompt: "", promptSeq: null, count: 0, matches: [] };
      continue;
    }
    if (event.type === "turn/end") {
      finishTurn();
      current = null;
      continue;
    }
    if (!current || !(isChat(event) || (includeTools && TOOL_TYPES.has(event.type)))) continue;
    const text = eventText(event);
    if (!text) continue;
    if (event.type === "user/message" && current.prompt === "") {
      current.prompt = text.length <= PROMPT_CHARS ? text : text.slice(0, PROMPT_CHARS) + "…";
      current.promptSeq = event.seq;
    }
    const ranges = matchRanges(text, patterns);
    if (!ranges) continue;
    current.count++;
    totalMatches++;
    if (current.turn >= before) continue;
    current.matches.unshift({
      seq: event.seq,
      type: event.type,
      role: ROLE[event.type] || event.type,
      time: event.time,
      ...snippet(text, ranges),
    });
    if (current.matches.length > MATCHES_PER_TURN) current.matches.pop();
  }
  finishTurn();
  const turns = recent.slice(-limit).reverse();
  return { turns, totalMatches, matchedTurns, nextBefore: recent.length > limit ? turns.at(-1).turn : null };
}

export function logIdentity(sessionId, events) {
  const first = (events || []).find((event) => event && typeof event.seq === "number");
  const parts = [sessionId, first ? first.seq : -1, first ? first.type : "", first ? first.time : 0].join("|");
  return { id: createHash("sha256").update(parts).digest("hex").slice(0, 12), events: (events || []).length };
}

function disposeObservation(observation) {
  const dispose = observation && (observation[Symbol.dispose] || observation.dispose);
  if (typeof dispose === "function") {
    try {
      dispose.call(observation);
    } catch {
      /* 释放失败不影响这次读取 */
    }
  }
}

async function loadEvents(ctx, sessionId, signal) {
  const query = ctx.get("sessionQuery");
  if (query && typeof query.observeSession === "function") {
    const observation = await query.observeSession(sessionId, { projectionMode: "none", signal });
    try {
      signal.throwIfAborted();
      return observation.events || [];
    } finally {
      disposeObservation(observation);
    }
  }
  const sessions = ctx.get("sessions");
  const live = sessions && typeof sessions.get === "function" ? sessions.get(sessionId) : undefined;
  if (live && typeof live.snapshotEvents === "function") return live.snapshotEvents();
  const persistence = ctx.get("sessionPersistence");
  if (persistence && typeof persistence.open === "function") {
    const handle = await persistence.open(sessionId, "read", { signal });
    try {
      const result = await handle.read(0, undefined, { signal });
      return (result && result.events) || [];
    } finally {
      if (handle && typeof handle.close === "function") await handle.close();
    }
  }
  throw new Error("no session source available (sessionQuery/sessions/sessionPersistence)");
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ": session load timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const inject = ["webServer"];

export function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) return;
  ctx.effect(() => webServer.register({
    kind: "prefix",
    path: ROUTE_PATH,
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      try {
        const url = new URL(req.url || "/", "http://localhost");
        if (req.method !== "GET") return send(404, { error: "not found" });
        if (url.pathname !== ROUTE_PATH + "/search") return send(404, { error: "not found" });
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return send(400, { error: "missing session" });
        const query = (url.searchParams.get("q") || "").trim();
        if (query === "") return send(400, { error: "missing q" });
        if (query.length > MAX_QUERY_CHARS) return send(400, { error: "query too long" });
        const scope = url.searchParams.get("scope") === "all" ? "all" : "chat";
        const limit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
        const beforeParam = url.searchParams.get("before");
        const before = beforeParam === null ? undefined : Number(beforeParam);
        if (!Number.isSafeInteger(limit) || limit < 1) return send(400, { error: "invalid limit" });
        if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) return send(400, { error: "invalid before" });
        const events = await withTimeout(loadEvents(ctx, sessionId, AbortSignal.timeout(5000)), 5000, "conversation-search");
        const log = logIdentity(sessionId, events);
        const found = searchTurns(events, query, { limit, scope, before });
        return send(200, {
          ok: true,
          session: sessionId,
          log,
          query,
          scope,
          totalMatches: found.totalMatches,
          matchedTurns: found.matchedTurns,
          returnedTurns: found.turns.length,
          truncated: found.nextBefore !== null,
          nextBefore: found.nextBefore,
          turns: found.turns,
        });
      } catch (error) {
        return send(500, { error: String((error && error.message) || error) });
      }
    },
  }), "conversation-search: search route");
}
