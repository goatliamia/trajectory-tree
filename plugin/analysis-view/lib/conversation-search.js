// Search recorded messages in one session. Return recent matching turns and an older-page cursor.

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

export function parseSearchParams(params) {
  const query = (params.get("q") || "").trim();
  if (!query) return { error: "missing q" };
  if (query.length > MAX_QUERY_CHARS) return { error: "query too long" };
  const limit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  const before = params.has("before") ? Number(params.get("before")) : undefined;
  if (!Number.isSafeInteger(limit) || limit < 1) return { error: "invalid limit" };
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) return { error: "invalid before" };
  return { query, limit, before, scope: params.get("scope") === "all" ? "all" : "chat" };
}
