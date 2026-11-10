// Right sidebar for finding recorded messages and jumping to their turns.
window.__ModuleLoader__.load({
  id: "dsh-conversation-search",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    let clientCtx = null;
    const t = (zh, en) => /^zh(?:-|$)/i.test(document.documentElement.lang || window.navigator?.language || "") ? zh : en;
    const turnLabel = turn => t("第 " + turn + " 轮", "Turn " + turn);
    const roles = {
      "user/message": ["你", "You"],
      "assistant/message": ["助手", "Assistant"],
      "tool/call": ["工具", "Tool"],
      "tool/result": ["工具返回", "Tool result"],
      "tool/ptc-dispatch": ["工具", "Tool"],
    };

    const CSS = `
.cs-root{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;box-sizing:border-box;padding:12px;color:var(--dsw-alias-label-primary);font-size:13px}
.cs-field{display:flex;align-items:center;gap:8px;height:36px;flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:0 10px;color:var(--dsw-alias-label-secondary)}
.cs-field:focus-within{border-color:var(--dsw-alias-brand-primary)}
.cs-field svg{flex:none}
.cs-input{width:100%;min-width:0;height:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.cs-input::placeholder{color:var(--dsw-alias-label-secondary)}
.cs-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:10px 0 8px}
.cs-filters{display:inline-flex;gap:8px}
.cs-filter,.cs-more,.cs-retry{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.cs-filter{min-height:26px;padding:2px 3px;border-bottom:2px solid transparent;font-size:12px;white-space:nowrap}
.cs-filter[aria-pressed="true"]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.cs-meta,.cs-note{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}
.cs-note{margin:0 0 8px}
.cs-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--dsw-alias-border-l1)}
.cs-turn{display:block;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);padding:10px 6px;cursor:pointer;font:inherit;color:inherit}
.cs-turn:hover,.cs-more:hover{background:var(--dsw-alias-bg-layer-2)}
.cs-root button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.cs-turn-head{display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-bottom:4px;font-size:12px;font-weight:600}
.cs-count{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400;white-space:nowrap}
.cs-prompt,.cs-text{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.cs-prompt{-webkit-line-clamp:1;color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:6px}
.cs-match{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;margin-top:4px;line-height:1.5}
.cs-role{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.cs-text{-webkit-line-clamp:2;min-width:0;font-size:12px;white-space:pre-line}
.cs-text mark{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:inherit;font-weight:650;border-radius:2px}
.cs-empty{padding:24px 6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;text-align:center}
.cs-more{display:block;width:100%;min-height:34px;color:var(--dsw-alias-brand-primary);font-size:12px}
.cs-more:disabled{opacity:.6;cursor:default}
.cs-retry{padding:0 4px;color:var(--dsw-alias-brand-primary)}
.cs-target{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
`;

    function ensureStyle() {
      if (document.getElementById("dsh-conversation-search-style")) return;
      const element = document.createElement("style");
      element.id = "dsh-conversation-search-style";
      element.textContent = CSS;
      document.head.appendChild(element);
    }

    function marked(match, query) {
      const parts = [];
      let start = 0;
      const ranges = match.highlights ?? [[match.matchAt, match.matchAt + query.length]];
      for (const [from, to] of ranges) {
        if (from < start || to > match.text.length || from >= to) continue;
        parts.push(match.text.slice(start, from), h("mark", { key: from }, match.text.slice(from, to)));
        start = to;
      }
      parts.push(match.text.slice(start));
      return parts;
    }

    function chatRow(turn) {
      return [...document.querySelectorAll('[data-chat-turn="' + turn + '"]')]
        .find(row => row.getClientRects().length > 0);
    }

    function waitForRow(turn, signal) {
      const existing = chatRow(turn);
      if (existing || signal.aborted) return Promise.resolve(existing);
      return new Promise(resolve => {
        const observer = new MutationObserver(() => {
          const row = chatRow(turn);
          if (row) finish(row);
        });
        const timer = setTimeout(() => finish(undefined), 1500);
        function cancel() { finish(undefined); }
        function finish(row) {
          observer.disconnect();
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          resolve(row);
        }
        observer.observe(document.body, { childList: true, subtree: true });
        signal.addEventListener("abort", cancel, { once: true });
      });
    }

    async function reveal(sessionId, group, openView, signal) {
      try { openView?.("chat", ""); } catch { /* Older hosts keep the current view. */ }
      let row = chatRow(group.turn);
      if (!row) {
        const sessions = clientCtx?.sessions ?? clientCtx?.get?.("sessions");
        const session = sessions?.binding?.(sessionId)?.session;
        const seq = group.startSeq ?? group.promptSeq ?? group.matches[0]?.seq;
        if (session && Number.isSafeInteger(seq)) {
          try { await session.loadThrough?.(seq); } catch { /* The row may already be available. */ }
        }
        row = await waitForRow(group.turn, signal);
      }
      if (!row || signal.aborted) return false;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("cs-target");
      setTimeout(() => row.classList.remove("cs-target"), 1400);
      return true;
    }

    function SearchPane({ sessionId, openView }) {
      React.useEffect(ensureStyle, []);
      const [query, setQuery] = React.useState("");
      const [composing, setComposing] = React.useState(false);
      const [scope, setScope] = React.useState("chat");
      const [state, setState] = React.useState({ phase: "idle", data: null });
      const [notice, setNotice] = React.useState("");
      const [retry, setRetry] = React.useState(0);
      const request = React.useRef(null);
      const needle = query.trim();

      async function fetchPage(job, before) {
        if (job.loading || job.signal.aborted) return;
        job.loading = true;
        if (before != null) setState(previous => ({ ...previous, phase: "paging" }));
        const params = new URLSearchParams({ session: sessionId, q: needle, scope });
        if (before != null) params.set("before", String(before));
        try {
          const response = await fetch("/conversation-search/search?" + params, { signal: job.signal, cache: "no-store" });
          if (!response.ok) throw new Error("Search failed");
          const result = await response.json();
          if (job.signal.aborted) return;
          if (!result.ok || !Array.isArray(result.turns)) throw new Error("Invalid search result");
          setState(previous => ({
            phase: "ready",
            data: before != null ? { ...result, turns: [...(previous.data?.turns ?? []), ...result.turns] } : result,
          }));
        } catch {
          if (!job.signal.aborted) setState(previous => ({ ...previous, phase: "error" }));
        } finally {
          job.loading = false;
        }
      }

      React.useEffect(() => {
        setNotice("");
        const ready = Boolean(sessionId && needle && !composing);
        setState({ phase: ready ? "loading" : "idle", data: null });
        if (!ready) return;
        const controller = new AbortController();
        const job = { signal: controller.signal, loading: false };
        request.current = job;
        const timer = setTimeout(() => fetchPage(job), 220);
        return () => {
          clearTimeout(timer);
          controller.abort();
          if (request.current === job) request.current = null;
        };
      }, [sessionId, needle, scope, retry, composing]);

      const data = state.data && state.data.session === sessionId && state.data.query === needle && state.data.scope === scope ? state.data : null;
      const busy = state.phase === "loading" || state.phase === "paging";
      const meta = data ? t(data.matchedTurns + " 轮 · " + data.totalMatches + " 条匹配",
        data.matchedTurns + " turns · " + data.totalMatches + " matches") : busy ? t("搜索中…", "Searching…") : "";

      async function jump(group) {
        const job = request.current;
        if (!job) return;
        setNotice("");
        const found = await reveal(sessionId, group, openView, job.signal);
        if (!found && !job.signal.aborted) setNotice(t("切到对话后再点一次结果。", "Open the conversation, then select the result again."));
      }

      const cards = (data?.turns ?? []).map(group => h("button", {
        key: group.turn, type: "button", className: "cs-turn", onClick: () => jump(group),
        title: t("跳到" + turnLabel(group.turn), "Jump to " + turnLabel(group.turn)),
      },
      h("div", { className: "cs-turn-head" },
        h("span", null, turnLabel(group.turn)),
        h("span", { className: "cs-count" }, t(group.count + " 条匹配", group.count + " matches"))),
      group.prompt && !group.matches.some(match => match.seq === group.promptSeq)
        ? h("div", { className: "cs-prompt" }, group.prompt) : null,
      group.matches.map(match => h("div", { key: match.seq, className: "cs-match" },
        h("span", { className: "cs-role" }, t(...(roles[match.type] ?? ["记录", "Record"]))),
        h("span", { className: "cs-text" }, marked(match, data.query))))));

      const empty = !sessionId ? t("先打开一个会话。", "Open a conversation first.")
        : data && !data.turns.length ? t("没找到匹配。可以少输几个词，或选择「含工具」。", "No matches. Try fewer words or include tools.")
        : !needle ? t("用空格分隔关键词，用引号匹配完整短语。", "Separate keywords with spaces. Quote an exact phrase.")
        : null;

      return h("section", { className: "cs-root", "aria-label": t("对话搜索", "Conversation search") },
        h("label", { className: "cs-field" },
          h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
            h("circle", { cx: 6.8, cy: 6.8, r: 4.3, stroke: "currentColor", strokeWidth: 1.3 }),
            h("path", { d: "m10 10 3.4 3.4", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" })),
          h("input", {
            className: "cs-input", type: "search", value: query, autoFocus: true, maxLength: 240, disabled: !sessionId,
            placeholder: t("搜索当前会话", "Search this conversation"), "aria-label": t("搜索当前会话", "Search this conversation"),
            onChange: event => setQuery(event.target.value),
            onCompositionStart: () => setComposing(true),
            onCompositionEnd: event => { setComposing(false); setQuery(event.currentTarget.value); },
            onKeyDown: event => { if (event.key === "Escape" && query && !composing) { event.stopPropagation(); setQuery(""); } },
          })),
        h("div", { className: "cs-bar" },
          h("div", { className: "cs-filters", role: "group", "aria-label": t("搜索范围", "Search scope") },
            [["chat", t("消息", "Messages")], ["all", t("含工具", "Include tools")]].map(([id, label]) => h("button", {
              key: id, type: "button", className: "cs-filter", "aria-pressed": scope === id, onClick: () => setScope(id),
            }, label))),
          h("span", { className: "cs-meta", role: "status" }, meta)),
        notice ? h("p", { className: "cs-note", role: "status" }, notice) : null,
        state.phase === "error" ? h("p", { className: "cs-note", role: "status" },
          t("搜索未完成。", "Search could not finish."),
          !data ? h("button", { type: "button", className: "cs-retry", onClick: () => setRetry(value => value + 1) }, t("重试", "Retry")) : null) : null,
        h("div", { className: "cs-list", "aria-busy": busy },
          empty ? h("div", { className: "cs-empty" }, empty) : null,
          cards,
          data?.nextBefore != null ? h("button", {
            type: "button", className: "cs-more", disabled: busy,
            onClick: () => request.current && fetchPage(request.current, data.nextBefore),
          }, state.phase === "paging" ? t("正在加载…", "Loading…") : t("加载更早的结果", "Load older results")) : null));
    }

    return {
      inject: ["slots", "sidebarRightTabs", "sessions"],
      apply(ctx) {
        clientCtx = ctx;
        ctx.sidebarRightTabs.register({
          id: "dsh-conversation-search",
          kind: "conversation-search",
          title: () => t("对话搜索", "Conversation search"),
          guide: [{
            id: "conversation-search",
            order: 30,
            title: () => t("对话搜索", "Conversation search"),
            description: () => t("搜索当前会话的全部历史，点击结果回到对应轮次。", "Search the full conversation and jump to the matching turn."),
          }],
        });
        ctx.slots?.inject("sidebar.right.pane.tab", () => ctx.slots.register({
          name: "sidebar.right.pane.tab",
          key: "dsh-conversation-search",
          inject: sessionId => typeof sessionId === "string" ? { sessionId } : {},
        }, SearchPane));
      },
    };
  },
});
