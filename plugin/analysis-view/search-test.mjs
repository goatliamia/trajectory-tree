// Host-half self-test: 按轮次分组的检索语义(大小写、轮次、prompt、scope、上限)+ 路由形状。
// 用法:node plugin/analysis-view/search-test.mjs
import { apply, logIdentity } from "./lib/index.js";
import { eventText, searchTurns } from "./lib/conversation-search.js";

let failed = 0;
const results = [];
const check = (name, condition, detail) => {
  results.push((condition ? "PASS " : "FAIL ") + name + (condition ? "" : "  " + JSON.stringify(detail === undefined ? "" : detail)));
  if (!condition) failed++;
};

const ev = (type, seq, data, time = seq * 10) => ({ type, seq, time, data });

const events = [
  ev("turn/start", 0, {}),
  ev("user/message", 1, { content: [{ type: "text", text: "帮我看一下 package.json 的构建脚本" }] }),
  ev("assistant/message", 2, { turn: 1, message: { content: [{ type: "text", text: "先读 package.json,再改 scripts.build" }] } }),
  ev("tool/call", 3, { turn: 1, name: "read", arguments: "{\"file_path\":\"package.json\"}" }),
  ev("tool/result", 4, { turn: 1, message: { content: [{ type: "text", text: "{\"scripts\":{\"build\":\"node build.mjs\"}}" }] } }),
  ev("turn/end", 5, { reason: { kind: "completed" } }),
  ev("turn/start", 6, {}),
  ev("tool/call", 7, { turn: 2, name: "read", arguments: "{\"file_path\":\"README.md\"}" }),
  ev("tool/result", 8, { turn: 2, message: { content: [{ type: "text", text: "read failed" }], isError: true }, error: { name: "FsError", code: "FS_NOT_OBSERVED" } }),
  ev("turn/end", 9, { reason: { kind: "error" } }),
];

check("eventText: 用户消息取正文", eventText(events[1]).includes("package.json"), eventText(events[1]));
check("eventText: 无文字事件返回空", eventText(events[0]) === "", eventText(events[0]));
check("eventText: 工具错误带码", eventText(events[8]).includes("FsError:FS_NOT_OBSERVED"), eventText(events[8]));

// 默认 scope=chat:只搜人和助手
const chat = searchTurns(events, "package.json");
check("chat: 只有一轮命中", chat.matchedTurns === 1 && chat.turns.length === 1, chat);
check("chat: 轮内两处(你说的 + 助手说的)", chat.turns[0].count === 2 && chat.turns[0].matches.length === 2, chat.turns[0]);
check("chat: 轮次编号与 prompt", chat.turns[0].turn === 1 && chat.turns[0].prompt.startsWith("帮我看一下"), chat.turns[0]);
check("chat: 大小写不敏感", searchTurns(events, "PACKAGE.JSON").totalMatches === 2, chat.totalMatches);

// scope=all:工具也搜
const all = searchTurns(events, "package.json", { scope: "all" });
check("all: 工具调用也算一处", all.totalMatches === 3 && all.turns[0].matches.length === 3, all.turns[0]);
check("all: 命中角色带工具", all.turns[0].matches.some((match) => match.role === "工具"), all.turns[0].matches);

// 只有工具命中的那轮
check("chat: 工具里的词不算对话", searchTurns(events, "README.md").matchedTurns === 0, "README.md");
const toolOnly = searchTurns(events, "README.md", { scope: "all" });
check("all: 第二轮只剩工具命中", toolOnly.matchedTurns === 1 && toolOnly.turns[0].turn === 2, toolOnly.turns);

// prompt 不因命中与否而丢
const assistantOnly = searchTurns(events, "scripts.build");
check("chat: 只命中助手那轮也带 prompt", assistantOnly.turns[0].prompt.startsWith("帮我看一下") && assistantOnly.turns[0].promptSeq === 1, assistantOnly.turns[0]);

// 上限按轮
const capped = searchTurns(events, "e", { scope: "all", limit: 1 });
check("limit: 只回一轮但 matchedTurns 照算", capped.turns.length === 1 && capped.matchedTurns >= 2, { turns: capped.turns.length, matched: capped.matchedTurns });

// 片段
const hit = searchTurns(events, "package.json").turns[0].matches[0];
check("片段: matchAt 指向命中词", hit.text.slice(hit.matchAt, hit.matchAt + 12).toLowerCase() === "package.json", hit);

const long = Array.from({ length: 24 }, (_, i) => {
  const turn = i + 1;
  return [
    ev("turn/start", i * 5, { turn }),
    ev("user/message", i * 5 + 1, { content: [{ type: "text", text: "Review the release" }] }),
    ev("assistant/message", i * 5 + 2, { message: { content: [
      { type: "text", text: "İ — RELEASE checks for src/[fixture].js" },
      { type: "reasoning", text: "private-thought" },
    ] } }),
    ev("user/message", i * 5 + 3, { source: { kind: "runtime-context" }, content: [{ type: "text", text: "runtime-only" }] }),
    ev("turn/end", i * 5 + 4, {}),
  ];
}).flat();
const first = searchTurns(long, "release");
const older = searchTurns(long, "release", { before: first.nextBefore });
const oldest = searchTurns(long, "release", { before: older.nextBefore });
const turns = [...first.turns, ...older.turns, ...oldest.turns].map(group => group.turn);
check("history: newest page starts at turn 24", first.turns[0].turn === 24 && first.nextBefore === 15);
check("history: all 24 matching turns are reachable without repeats", turns.join(",") === Array.from({ length: 24 }, (_, i) => 24 - i).join(",") && oldest.nextBefore === null);
check("history: each page counts the full matching session", [first, older, oldest].every(page => page.matchedTurns === 24 && page.totalMatches === 48));
const terms = searchTurns(long, 'release "src/[fixture].js"');
const excerpt = terms.turns[0].matches[0];
check("keywords: all terms within a message, escaped file path and Unicode offsets", terms.totalMatches === 24 &&
  excerpt.highlights.map(([start, end]) => excerpt.text.slice(start, end)).join("|") === "RELEASE|src/[fixture].js");
check("phrases: only the exact phrase matches", searchTurns(long, '"review the release"').totalMatches === 24 &&
  searchTurns(long, '"review release"').totalMatches === 0);
check("messages: reasoning and runtime-only injections are excluded", searchTurns(long, "private-thought", { scope: "all" }).totalMatches === 0 &&
  searchTurns(long, "runtime-only", { scope: "all" }).totalMatches === 0);

const log = logIdentity("session-x", events);
check("logIdentity: 12 位 id 与事件数", log.id.length === 12 && log.events === events.length, log);

/* ---------------- 路由 ---------------- */
const captured = {};
let observationOptions, released = 0;
const ctx = {
  get(name) {
    if (name === "webServer") return { register(route) { captured.route = route; return () => {}; } };
    if (name === "sessionQuery") {
      return { async observeSession(sessionId, options) {
        observationOptions = options;
        return { sessionId, events: sessionId === "long" ? long : events, [Symbol.dispose]() { released++; } };
      } };
    }
    return undefined;
  },
  effect(callback) { callback(); return () => {}; },
};
let searchEnabled;
apply(ctx, { conversationSearch: { get: () => searchEnabled } });
check("route: search uses the Analysis View route", captured.route?.path === "/analysis-view");

const fakeRes = () => ({
  status: 0,
  body: "",
  once() {},
  writeHead(status) { this.status = status; },
  end(body) { this.body = body; },
});
const call = async (url) => {
  const res = fakeRes();
  await captured.route.handler({ method: "GET", url, once() {} }, res);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
};

const search = "/analysis-view/search";
const found = await call(search + "?session=s1&q=package.json&limit=2");
check("route: enabled by default and returns matches grouped by turn", found.status === 200 && found.json.matchedTurns === 1 && found.json.turns.length === 1, found.json);
check("route: 轮里带 matches", found.json.turns[0].matches.every((match) => typeof match.seq === "number" && typeof match.text === "string" && typeof match.matchAt === "number"), found.json.turns[0].matches);
const tools = await call(search + "?session=s1&q=package.json&scope=all");
check("route: scope=all 多一处", tools.json.totalMatches === 3, tools.json.totalMatches);
const secondPage = await call(search + "?session=long&q=release&before=15&limit=10");
check("route: older pages use an exclusive turn cursor", secondPage.status === 200 &&
  secondPage.json.turns[0].turn === 14 && secondPage.json.nextBefore === 5 && secondPage.json.matchedTurns === 24);
check("route: reuses native observation without projection work and releases the lease",
  observationOptions.projectionMode === "none" && observationOptions.signal instanceof AbortSignal && released === 3);
check("route: invalid pagination is rejected", (await call(search + "?session=s1&q=x&before=NaN")).status === 400 &&
  (await call(search + "?session=s1&q=x&limit=2.5")).status === 400);
const missing = await call(search + "?q=x");
check("route: 缺 session 返回 400", missing.status === 400, missing.json);
const noQuery = await call(search + "?session=s1");
check("route: 缺 q 返回 400", noQuery.status === 400, noQuery.json);
const unknown = await call("/analysis-view/nope?session=s1");
check("route: 未知路径返回 404", unknown.status === 404, unknown.json);
searchEnabled = false;
check("route: hiding the pane disables new requests immediately",
  (await call(search + "?session=s1&q=package.json")).status === 404 && released === 3);

for (const line of results) console.log(line);
console.log(failed === 0 ? "\nALL PASS (" + results.length + " checks)" : "\n" + failed + " FAILED");
process.exit(failed === 0 ? 0 : 1);
