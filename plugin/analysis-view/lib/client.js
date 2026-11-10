// dsh-analysis-view — 「分析」标签的客户端半边。
// 版面:轮次 / 花费 / 工具 / incident / 按需解读;数据全部来自 /analysis-view/digest。
window.__ModuleLoader__.load({
  id: "dsh-analysis-view",
  factory: (require) => {
    const React = require("react");
    const cmUi = (zh, en) => { let stored; try { stored = window.localStorage?.getItem("trajectory-language"); } catch {} const candidates = [stored, window.document?.documentElement?.lang, ...(window.navigator?.languages || []), window.navigator?.language]; const language = candidates.find(value => typeof value === "string" && /^(?:en|zh)(?:-|$)/i.test(value)) || "en"; return /^en(?:-|$)/i.test(language) ? en : zh; };
    function useLocaleRefresh() {
      const [, refresh] = React.useState(0);
      React.useEffect(() => {
        const root = window.document?.documentElement, Observer = window.MutationObserver;
        const update = () => refresh(value => value + 1);
        const observer = root && Observer ? new Observer(update) : null;
        observer?.observe(root, { attributes: true, attributeFilter: ["lang"] });
        const onStorage = event => { if (event.key === "trajectory-language" || event.key === null) update(); };
        window.addEventListener?.("storage", onStorage);
        return () => { observer?.disconnect(); window.removeEventListener?.("storage", onStorage); };
      }, []);
    }

    /* 样式 */
    const STYLE_ID = "dsh-analysis-view-style";
    const CSS = `
.av-root{--av-accent:color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-state-success-primary));padding:16px;overflow:auto;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.av-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.av-root.av-trace{padding:0;overflow:hidden;min-height:0;height:100%;display:flex;flex-direction:column}.av-root.av-trace .av-trace-frame{flex:1 1 auto;width:100%;height:100%;min-height:0;border:0;border-radius:0;display:block;background:var(--dsw-alias-bg-layer-1)}.av-trace-frame{width:100%;height:calc(100vh - 210px);min-height:420px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.av-title{margin:0;font-size:14px;font-weight:500;letter-spacing:.01em}
.av-meta{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-live{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none}
.av-live.stale{background:var(--dsw-alias-state-warn-primary)}
.av-live.dead{background:var(--dsw-alias-state-idle-primary)}
.av-spacer{flex:1}
.av-btn{font:inherit;font-size:12px;line-height:1;padding:5px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.av-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.av-btn:disabled{opacity:.55;cursor:default}
.av-btn.primary{border-color:var(--av-accent);color:var(--av-accent)}
.av-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px;overflow:hidden}
.av-kpi{padding:10px 14px;min-width:0;border-left:1px solid var(--dsw-alias-border-l1)}
.av-kpi:first-child{border-left:0}
.av-kpi-num{font-size:20px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.2}
.av-kpi-num.warn{color:var(--dsw-alias-state-warn-primary)}
.av-kpi-num.bad{color:var(--dsw-alias-state-error-primary)}
.av-kpi-label{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:760px){.av-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.av-kpi:nth-child(4){border-left:0}.av-kpi:nth-child(n+4){border-top:1px solid var(--dsw-alias-border-l1)}}
.av-section{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:12px;margin-bottom:12px}
.av-section-head{display:flex;align-items:baseline;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.av-section-title{font-size:13px;font-weight:500;margin:0}
.av-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
.av-strip{display:flex;align-items:stretch;gap:2px;height:28px}
.av-strip.scroll{overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;padding-bottom:3px;cursor:grab;scrollbar-width:thin}
.av-strip.scroll:active{cursor:grabbing}
.av-strip.scroll .av-seg{flex:0 0 14px;width:14px}
.av-seg{position:relative;border-radius:4px;background:var(--dsw-alias-bg-layer-2);border:0;padding:0;min-width:14px;cursor:default;overflow:hidden}
.av-seg.ok{background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}
.av-seg.warn{background:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}
.av-seg.bad{background:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
.av-seg.clickable{cursor:pointer}
.av-seg.clickable:hover{outline:1px solid var(--dsw-alias-border-l2);outline-offset:1px}
.av-seg-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.av-legend{display:flex;gap:12px;margin-top:8px;flex-wrap:wrap}
.av-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.av-swatch{width:8px;height:8px;border-radius:2px;flex:none}
.av-cost-head{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:12px;margin-bottom:10px}
.av-cost-cell{min-width:0}
.av-cost-num{font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}
.av-cost-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.av-cost-money{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}






.av-cost-rows{max-height:240px;overflow-y:auto;scrollbar-width:thin;overscroll-behavior:contain;padding-right:4px}
.av-cost-row{display:grid;grid-template-columns:34px minmax(0,1fr) minmax(52px,.42fr) 44px;align-items:center;gap:8px;margin-bottom:4px;border-radius:4px;cursor:pointer}
.av-cost-row:hover{background:var(--dsw-alias-bg-layer-2)}
.av-cost-row:focus-visible{outline:2px solid var(--av-accent);outline-offset:-2px}
.av-cost-turn{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-track{display:flex;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.av-fill{height:100%}
.av-fill.hit{background:var(--dsw-alias-state-success-primary);opacity:.55}
.av-fill.miss{background:var(--dsw-alias-state-error-primary);opacity:.8}
.av-fill.out{background:var(--av-accent);opacity:.75}
.av-rate{font-size:11px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-rate.warn{color:var(--dsw-alias-state-warn-primary)}
.av-donut{position:relative;width:112px;height:112px;flex:none}
.av-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none}
.av-donut-num{font-size:16px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.av-legend-col{flex:1;min-width:0;max-height:150px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:3px;padding-right:2px}
/* 不画滚动条:上下留一道渐隐的阴影,提示"这里还有内容"。内容到底/到顶时阴影自然消失。 */
.av-legend-col,.av-cost-rows,.av-incident-list{scrollbar-width:none;background:
  linear-gradient(var(--dsw-alias-bg-layer-1) 40%,transparent) top/100% 16px no-repeat local,
  linear-gradient(transparent,var(--dsw-alias-bg-layer-1) 60%) bottom/100% 16px no-repeat local,
  radial-gradient(farthest-side at 50% 0,color-mix(in srgb,var(--dsw-alias-label-secondary) 22%,transparent),transparent) top/100% 10px no-repeat scroll,
  radial-gradient(farthest-side at 50% 100%,color-mix(in srgb,var(--dsw-alias-label-secondary) 22%,transparent),transparent) bottom/100% 10px no-repeat scroll}
.av-legend-col::-webkit-scrollbar,.av-cost-rows::-webkit-scrollbar,.av-incident-list::-webkit-scrollbar{display:none}
.av-flow-side{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.av-leg{display:flex;align-items:center;gap:8px;background:transparent;border:0;border-radius:6px;padding:3px 5px;font:inherit;color:inherit;cursor:pointer;text-align:left}
.av-leg:hover{background:var(--dsw-alias-bg-layer-2)}
.av-leg[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);outline:1px solid var(--dsw-alias-border-l1);outline-offset:-1px}
.av-leg-name{font-size:12px}
.av-leg-num{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-leg-err{font-size:11px;color:var(--dsw-alias-state-error-primary)}
.av-tool-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}
.av-flow-card{min-width:0;display:flex;flex-direction:column;gap:8px}
.av-flow-head{display:flex;align-items:baseline;gap:8px;min-width:0;height:18px}
.av-flow-title{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.av-flow-meta{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.av-flow-body{display:flex;gap:14px;align-items:flex-start;min-width:0}
.av-donut-sm{width:112px;height:112px;flex:none}
.av-donut-sm .av-donut-num{font-size:15px}
.av-leg-static{cursor:default}
.av-leg-static:hover{background:transparent}
.av-stat-line{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px;font-variant-numeric:tabular-nums}
@media (max-width:760px){.av-tool-flow{grid-template-columns:minmax(0,1fr)}}
.av-bad{color:var(--dsw-alias-state-error-primary)}
.av-incident-list{max-height:360px;overflow-y:auto;scrollbar-width:thin;overscroll-behavior:contain;padding-right:4px}
.av-incident{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px 10px 14px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-1)}
.av-incident:last-child{margin-bottom:0}
.av-bar{position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--dsw-alias-state-idle-primary)}
.av-bar.high{background:var(--dsw-alias-state-error-primary)}
.av-bar.mid{background:var(--dsw-alias-state-warn-primary)}
.av-incident-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.av-incident-title{font-size:13px;font-weight:500}
.av-badge{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;line-height:16px}
.av-detail{font-size:12px;color:var(--dsw-alias-label-secondary);margin:3px 0 8px}
.av-why{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:2px 16px;font-size:12px}
.av-why-key{color:var(--dsw-alias-label-secondary);font-size:11px;display:block}
.av-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;align-items:center}
.av-chip{font:inherit;font-size:11px;line-height:16px;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-variant-numeric:tabular-nums}
.av-chip:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.av-chip:disabled{cursor:default;opacity:.6}
.av-skel{background:var(--dsw-alias-bg-layer-2);border-radius:6px}
.av-skel.line{height:10px;margin-bottom:8px}
.av-notice{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.av-empty{padding:32px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;min-height:120px;display:flex;align-items:center;justify-content:center}
.av-btn:focus-visible,.av-seg:focus-visible,.av-chip:focus-visible{outline:2px solid var(--av-accent);outline-offset:1px}
.av-btn,.av-seg,.av-chip{transition:background-color .14s ease,border-color .14s ease,color .14s ease}
@media (prefers-reduced-motion:reduce){.av-btn,.av-seg,.av-chip{transition-duration:.01ms}}
.av-interp{font-size:13px;white-space:pre-wrap}
.av-foot{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-eval-turn{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 6px;min-width:0;max-width:100%}
.av-eval-counts{display:flex;gap:8px 16px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.av-eval-list{display:grid;gap:0;list-style:none;margin:0;padding:0}
.av-eval-list li{border-top:1px solid var(--dsw-alias-border-l1);padding:10px 0;display:grid;gap:5px}
.av-eval-item{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.av-eval-item strong{overflow-wrap:anywhere;font-weight:550}
.av-eval-group{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 0}
.av-eval-group>summary{cursor:pointer;overflow-wrap:anywhere}
.av-eval-group>summary span{margin-inline-start:10px;color:var(--dsw-alias-label-secondary);font-size:12px}
.av-eval-records{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.av-eval-proof>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.av-eval-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(145px,100%),1fr));gap:10px 14px;margin:12px 0}
.av-eval-metrics dt{color:var(--dsw-alias-label-secondary);font-size:12px}
.av-eval-metrics dd{margin:3px 0 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.av-eval-list code{overflow-wrap:anywhere}
`;
    const ensureStyle = () => {
      if (typeof document === "undefined") return () => {};
      if (document.getElementById(STYLE_ID) !== null) return () => {};
      const el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = CSS;
      document.head.appendChild(el);
      return () => { if (el.parentNode) el.parentNode.removeChild(el); };
    };

    let clientCtx = null;

    /** 等对话里那一轮的行出现(切视图是异步的)。 */
    function waitForChatTurn(turn, ms) {
      const selector = '[data-chat-turn="' + turn + '"]';
      const found = document.querySelector(selector);
      if (found !== null) return Promise.resolve(found);
      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const row = document.querySelector(selector);
          if (row !== null) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(row);
          }
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, ms);
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    /** 和对话搜索同一条路:切到「对话」→ 需要时按 seq 加载那一页 → 滚到该轮。 */
    async function jumpToChatTurn(openView, sessionId, turn) {
      if (openView === undefined) return false;
      try {
        openView("chat", "");
      } catch {
        /* 切不过去就按当前 DOM 找 */
      }
      let row = await waitForChatTurn(turn.turn, 1200);
      if (row === null && clientCtx !== null && typeof clientCtx.get === "function") {
        const sessions = clientCtx.get("sessions");
        const binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
        const session = binding && binding.session;
        if (session && typeof session.loadThrough === "function" && typeof turn.startSeq === "number") {
          try {
            await session.loadThrough(turn.startSeq);
          } catch {
            /* 分页失败就按已加载的找 */
          }
          row = await waitForChatTurn(turn.turn, 1500);
        }
      }
      if (row === null) return false;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    }

    /* ---------------- 数字与格式 ---------------- */
    const h = React.createElement;
    const fmt = (value) => {
      if (value === null || value === undefined) return "—";
      if (value >= 1000000) return (value / 1000000).toFixed(value >= 10000000 ? 0 : 1) + "M";
      if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1) + "k";
      return String(value);
    };
    const pct = (value) => (value === null || value === undefined ? "—" : (value * 100).toFixed(value >= 0.9995 ? 0 : 1) + "%");
    const money = (value) => {
      if (value === null || value === undefined) return "—";
      if (value === 0) return "0";
      if (value >= 1) return value.toFixed(2);
      if (value >= 0.01) return value.toFixed(3);
      return value.toFixed(4);
    };
    const ms = (value) => {
      if (value === null || value === undefined) return "—";
      if (value < 1000) return Math.round(value) + "ms";
      if (value < 60000) return (value / 1000).toFixed(1) + "s";
      return Math.floor(value / 60000) + "m" + Math.round((value % 60000) / 1000) + "s";
    };

    /* ---------------- 数据 ---------------- */
    // version 是轨迹投影的节点数:会话在长,它就变。变了就重取一次(带 700ms 静默期),
    // 手点「刷新」则跳过后端 2 秒缓存并立刻取。
    function useDigest(sessionId, version) {
      const [state, setState] = React.useState({ status: sessionId ? "loading" : "idle", data: null, error: null, at: 0 });
      const [nonce, setNonce] = React.useState(0);
      const fetchedNonce = React.useRef(-1);
      React.useEffect(() => {
        if (!sessionId) {
          setState({ status: "idle", data: null, error: null, at: 0 });
          return void 0;
        }
        let alive = true;
        const manual = fetchedNonce.current !== nonce;
        fetchedNonce.current = nonce;
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = setTimeout(() => {
          const url = "/analysis-view/digest?session=" + encodeURIComponent(sessionId) + (manual ? "&fresh=1" : "");
          fetch(url, ctl ? { signal: ctl.signal, cache: "no-store" } : { cache: "no-store" })
            .then((r) => {
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.json();
            })
            .then((json) => {
              if (!alive) return;
              if (json && json.error) throw new Error(String(json.error));
              setState({ status: "ready", data: json, error: null, at: Date.now() });
            })
            .catch((error) => {
              if (!alive) return;
              if (error && (error.name === "AbortError" || ctl === null)) return;
              const message = String((error && error.message) || error);
              setState((prev) => ({ status: prev.data ? "stale" : "error", data: prev.data, error: message, at: prev.at }));
            });
        }, manual ? 0 : 700);
        return () => {
          alive = false;
          clearTimeout(timer);
          if (ctl) ctl.abort();
        };
      }, [sessionId, version, nonce]);
      const refresh = React.useCallback(() => setNonce((value) => value + 1), []);
      return { ...state, refresh };
    }

    /** 轨迹投影里的 seq → callId,让证据 chip 能跳到轨迹视图。 */
    function buildCallIndex(snap) {
      const index = new Map();
      const nodes = Array.isArray(snap && snap.eventNodes) ? snap.eventNodes : [];
      for (const node of nodes) {
        if (!node) continue;
        if (node.kind === "tool-result" && node.callId) index.set(node.seq, node.callId);
        if (node.kind === "assistant" && Array.isArray(node.blocks)) {
          for (const block of node.blocks) if (block && block.kind === "tool-call" && block.callId) index.set(node.seq, block.callId);
        }
      }
      return { index, version: nodes.length };
    }

    /* ---------------- 小组件 ---------------- */
    function Kpi(props) {
      return h("div", { className: "av-kpi" }, [
        h("div", { key: "n", className: "av-kpi-num" + (props.tone ? " " + props.tone : "") }, props.value),
        h("div", { key: "l", className: "av-kpi-label", title: props.title || props.label }, props.label),
      ]);
    }

    function Skeleton() {
      return h("div", { "aria-busy": "true", "aria-label": cmUi("正在读取会话", "Loading session") }, [
        h("div", { key: "k", className: "av-kpis" }, [0, 1, 2, 3].map((i) => h("div", { key: i, className: "av-skel", style: { height: 58 } }))),
        h("div", { key: "s", className: "av-section" }, [
          h("div", { key: "a", className: "av-skel line", style: { width: "28%" } }),
          h("div", { key: "b", className: "av-skel", style: { height: 28 } }),
        ]),
        h("div", { key: "c", className: "av-section" }, [
          h("div", { className: "av-skel line", style: { width: "36%" } }),
          h("div", { className: "av-skel line", style: { width: "82%" } }),
          h("div", { className: "av-skel line", style: { width: "64%", marginBottom: 0 } }),
        ]),
      ]);
    }

    function Notice(props) {
      return h("div", { className: "av-notice" }, [
        h("span", { key: "t" }, props.text),
        props.action ? h("button", { key: "b", className: "av-btn", onClick: props.action.onClick }, props.action.label) : null,
      ]);
    }

    function turnTone(turn) {
      if (turn.errors >= 3 || turn.endReason === "error") return "bad";
      if (turn.errors > 0) return "warn";
      return "ok";
    }

    // 24 轮以内按比例铺满,每格至少 14px;再多就换成等宽格 + 横向拖动,右边是最新。
    const STRIP_MAX = 24;

    function WorkPath(props) {
      const turns = props.turns || [];
      const index = props.index;
      const many = turns.length > STRIP_MAX;
      const rail = React.useRef(null);
      const drag = React.useRef(null);
      const [atEnd, setAtEnd] = React.useState(true);
      const scrollToEnd = React.useCallback(() => {
        const el = rail.current;
        if (el !== null) el.scrollLeft = el.scrollWidth;
      }, []);
      React.useEffect(() => {
        if (many) scrollToEnd();
      }, [many, turns.length, scrollToEnd]);
      if (turns.length === 0) {
        return h("div", { className: "av-section" }, [
          h("div", { key: "h", className: "av-section-head" }, h("h3", { className: "av-section-title" }, cmUi("轮次", "Turns"))),
          h("div", { key: "e", className: "av-empty" }, cmUi("这段会话还没有开始任何 turn", "This session has not started any turns")),
        ]);
      }
      const weight = (turn) => {
        const value = turn.durationMs !== null ? turn.durationMs : turn.requests > 0 ? turn.requests * 1000 : turn.toolCalls > 0 ? turn.toolCalls * 1000 : 1;
        return Math.max(1, value);
      };
      const segments = turns.map((turn) => {
        const tone = turnTone(turn);
        // 优先用 host 给的 callId(失败那条→这轮第一条),都没有才退到投影索引。
        const known = turn.firstErrorCallId !== undefined && turn.firstErrorCallId !== null
          ? turn.firstErrorCallId
          : turn.firstCallId !== undefined && turn.firstCallId !== null
            ? turn.firstCallId
            : turn.firstErrorSeq !== null ? index.get(turn.firstErrorSeq) : undefined;
        const callable = known !== undefined;
        const clickable = callable && props.openView !== undefined;
        const title = cmUi("第 ", "Turn ") + turn.turn + cmUi(" 轮 · ", " · ") + turn.toolCalls + cmUi(" 次调用", " calls") + (turn.errors > 0 ? " · " + turn.errors + cmUi(" 次失败", " failed") : "") +
          (turn.durationMs !== null ? " · " + ms(turn.durationMs) : "") + (clickable ? cmUi(" · 点击跳到轨迹", " · click to jump to trace") : "");
        return h("button", {
          key: turn.turn,
          className: "av-seg " + tone + (clickable ? " clickable" : ""),
          style: many ? undefined : { flexGrow: String(weight(turn)), flexBasis: "0" },
          title,
          "aria-label": title,
          tabIndex: clickable ? 0 : -1,
          onClick: clickable ? () => props.openView("trajectory", known) : undefined,
        }, turns.length <= 20 ? h("span", { className: "av-seg-label" }, String(turn.turn)) : null);
      });
      const startDrag = (event) => {
        const el = rail.current;
        if (!many || el === null) return;
        drag.current = { x: event.clientX, left: el.scrollLeft };
      };
      const moveDrag = (event) => {
        const state = drag.current;
        const el = rail.current;
        if (state === null || el === null) return;
        el.scrollLeft = state.left - (event.clientX - state.x);
      };
      const endDrag = () => {
        drag.current = null;
      };
      const onScroll = () => {
        const el = rail.current;
        if (el === null) return;
        setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
      };
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, cmUi("轮次", "Turns")),
          h("span", { key: "n", className: "av-hint" }, many
            ? turns.length + cmUi(" 轮 · 右边最新,可拖动;每格 14px 起,点一下就能选中", " turns · newest on the right, drag to scroll; cells are at least 14px, click to select")
            : turns.length + cmUi(" 个 turn · 宽度按时长,颜色按失败", " turns · width reflects duration, color reflects failures")),
          many && !atEnd ? h("span", { key: "sp", className: "av-spacer" }) : null,
          many && !atEnd ? h("button", { key: "end", className: "av-btn", onClick: scrollToEnd }, cmUi("回到最新", "Back to latest")) : null,
        ]),
        h("div", {
          key: "s",
          ref: rail,
          className: "av-strip" + (many ? " scroll" : ""),
          onScroll: many ? onScroll : undefined,
          onPointerDown: many ? startDrag : undefined,
          onPointerMove: many ? moveDrag : undefined,
          onPointerUp: many ? endDrag : undefined,
          onPointerLeave: many ? endDrag : undefined,
        }, segments),
        h("div", { key: "l", className: "av-legend" }, [
          h("span", { key: "ok", className: "av-legend-item" }, [h("span", { key: "s", className: "av-swatch", style: { background: "var(--dsw-alias-state-success-primary)", opacity: 0.5 } }), cmUi("正常", "Normal")]),
          h("span", { key: "warn", className: "av-legend-item" }, [h("span", { key: "s", className: "av-swatch", style: { background: "var(--dsw-alias-state-warn-primary)" } }), cmUi("有失败", "Has failures")]),
          h("span", { key: "bad", className: "av-legend-item" }, [h("span", { key: "s", className: "av-swatch", style: { background: "var(--dsw-alias-state-error-primary)" } }), cmUi("多次失败 / 异常收尾", "Multiple failures / abnormal ending")]),
          h("span", { key: "hint", className: "av-legend-item" }, clickableHint(turns, index)),
        ]),
      ]);
    }

    function clickableHint(turns, index) {
      const any = turns.some((turn) => (turn.firstErrorCallId !== undefined && turn.firstErrorCallId !== null) ||
        (turn.firstCallId !== undefined && turn.firstCallId !== null) ||
        (turn.firstErrorSeq !== null && index.get(turn.firstErrorSeq) !== undefined));
      return any ? cmUi("点一轮跳到轨迹里对应的调用", "Select a turn to jump to its call in the trace") : cmUi("这一轮没有可定位的调用", "No call can be located for this turn");
    }

    const COST_ROWS_MAX = 120;
    const COST_RATE_WARN = 0.9;

    function Cost(props) {
      const cost = props.cost;
      const pricing = cost && cost.pricing !== undefined && cost.pricing !== null && cost.pricing.priced > 0 ? cost.pricing : null;
      const list = React.useRef(null);
      const turns = React.useMemo(() => ((cost && Array.isArray(cost.byTurn)) ? cost.byTurn : []).filter((turn) => turn.turn !== null), [cost]);
      // cost.byTurn 只有 token 数字,没有 seq;按轮号从 turnStats 里补 startSeq,跳转才知道要加载到哪。
      const startSeqByTurn = React.useMemo(() => {
        const map = new Map();
        for (const stat of props.turnStats || []) if (typeof stat.startSeq === "number") map.set(stat.turn, stat.startSeq);
        return map;
      }, [props.turnStats]);
      const jumpTurn = (turn) => jumpToChatTurn(props.openView, props.sessionId, {
        turn: turn.turn,
        startSeq: startSeqByTurn.get(turn.turn),
      });
      React.useEffect(() => {
        const el = list.current;
        if (el !== null) el.scrollTop = el.scrollHeight;
      }, [turns.length]);
      if (!cost || !cost.requestCount) {
        return h("div", { className: "av-section" }, [
          h("div", { key: "h", className: "av-section-head" }, h("h3", { className: "av-section-title" }, cmUi("花费", "Cost"))),
          h("div", { key: "e", className: "av-empty" }, cmUi("这段会话没有可用的 token 数据", "No token data available for this session")),
        ]);
      }
      const shown = turns.slice(-COST_ROWS_MAX);
      const maxInput = shown.reduce((acc, turn) => Math.max(acc, (turn.input || 0) + (turn.cacheRead || 0)), 0);
      const maxOutput = shown.reduce((acc, turn) => Math.max(acc, turn.output || 0), 0);
      const width = (value, max) => (max === 0 ? 0 : Math.max(0, (value / max) * 100));
      const cacheSampleNote = (sample, total) => sample
        ? sample.records + "/" + total + cmUi(" 条结算同时上报缓存读取与未缓存输入", " usage records reported both cached reads and uncached input")
        : null;
      const sampleNote = cacheSampleNote(cost.cacheEfficiencySample, cost.requestCount);
      const rows = shown.map((turn) => {
        const miss = turn.input || 0;
        const hit = turn.cacheRead || 0;
        const out = turn.output || 0;
        const rate = turn.cacheEfficiency;
        const paired = cacheSampleNote(turn.cacheEfficiencySample, turn.requests);
        const title = cmUi("第 ", "Turn ") + turn.turn + cmUi(" 轮 · 未命中 ", " · cache miss ") + fmt(turn.input) + cmUi(" · 命中 ", " · cache hit ") + fmt(turn.cacheRead) + cmUi(" · 输出 ", " · output ") + fmt(turn.output) + cmUi(" · 命中率 ", " · hit rate ") + pct(rate) + (paired ? " · " + paired : "");
        return h("div", {
          key: String(turn.turn),
          className: "av-cost-row",
          title: title + cmUi(" · 点击跳到对话这一轮", " · click to jump to this turn in conversation"),
          role: "button",
          tabIndex: 0,
          onClick: () => jumpTurn(turn),
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") jumpTurn(turn);
          },
        }, [
          h("span", { key: "t", className: "av-cost-turn" }, "T" + turn.turn),
          h("div", { key: "i", className: "av-track" }, [
            h("div", { key: "h", className: "av-fill hit", style: { width: width(hit, maxInput) + "%" } }),
            h("div", { key: "m", className: "av-fill miss", style: { width: width(miss, maxInput) + "%" } }),
          ]),
          h("div", { key: "o", className: "av-track" }, [
            h("div", { key: "o", className: "av-fill out", style: { width: width(out, maxOutput) + "%" } }),
          ]),
          h("span", { key: "r", className: "av-rate" + (rate !== null && rate < COST_RATE_WARN ? " warn" : "") }, pct(rate)),
        ]);
      });
      const worst = [...turns]
        .filter((turn) => (turn.input || 0) > 0)
        .sort((a, b) => (b.input || 0) - (a.input || 0))
        .slice(0, 2);
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, cmUi("花费", "Cost")),
          h("span", { key: "n", className: "av-hint" }, cost.requestCount + cmUi(" 次请求 · ", " requests · ") + turns.length + cmUi(" 轮", " turns") + (cost.unknownRequests > 0 ? " · " + cost.unknownRequests + cmUi(" 次未上报", " unreported") : "")),
        ]),
        h("div", { key: "sum", className: "av-cost-head" }, [
          h("div", { key: "in", className: "av-cost-cell" }, [
            h("div", { className: "av-cost-num av-bad" }, fmt(cost.input)),
            h("div", { className: "av-cost-label av-bad" }, [cmUi("未命中", "Cache miss"), pricing === null ? null : h("span", { key: "m", className: "av-cost-money" }, " ¥" + money(pricing.cost.miss))]),
          ]),
          h("div", { key: "cr", className: "av-cost-cell" }, [
            h("div", { className: "av-cost-num" }, fmt(cost.cacheRead)),
            h("div", { className: "av-cost-label" }, [cmUi("命中", "Cache hit"), pricing === null ? null : h("span", { key: "m", className: "av-cost-money" }, " ¥" + money(pricing.cost.hit))]),
          ]),
          h("div", { key: "out", className: "av-cost-cell" }, [
            h("div", { className: "av-cost-num" }, fmt(cost.output)),
            h("div", { className: "av-cost-label" }, [cmUi("输出", "Output"), pricing === null ? null : h("span", { key: "m", className: "av-cost-money" }, " ¥" + money(pricing.cost.output))]),
          ]),
          h("div", { key: "eff", className: "av-cost-cell" }, [h("div", { className: "av-cost-num" }, pct(cost.cacheEfficiency)), h("div", { className: "av-cost-label" }, cmUi("命中率", "Hit rate"))]),
          pricing === null ? null : h("div", { key: "total", className: "av-cost-cell" }, [
            h("div", { className: "av-cost-num" }, "≈ ¥" + money(pricing.total)),
            h("div", { className: "av-cost-label" }, cmUi("合计", "Total")),
          ]),
        ]),
        sampleNote ? h("div", { key: "note", className: "av-hint", style: { marginBottom: 8 } }, sampleNote) : null,
        rows.length > 0 ? h("div", { key: "rows", className: "av-cost-rows", ref: list }, rows) : null,
        worst.length > 0 && turns.length > 1
          ? h("div", { key: "worst", className: "av-hint", style: { marginTop: 6 } },
            cmUi("未命中最多:", "Most cache misses: ") + worst.map((turn) => "T" + turn.turn + " " + fmt(turn.input)).join(" · "))
          : null,
        h("div", { key: "l", className: "av-legend" }, [
          h("span", { key: "h", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--dsw-alias-state-success-primary)", opacity: 0.55 } }), cmUi("命中", "Cache hit")]),
          h("span", { key: "m", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--dsw-alias-state-error-primary)", opacity: 0.8 } }), cmUi("未命中", "Cache miss")]),
          h("span", { key: "o", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--av-accent)", opacity: 0.75 } }), cmUi("输出", "Output")]),
          turns.length > COST_ROWS_MAX ? h("span", { key: "more", className: "av-legend-item" }, cmUi("只画最近 ", "Showing only the latest ") + COST_ROWS_MAX + cmUi(" 轮", " turns")) : null,
        ]),
      ]);
    }

    // 类别由 host 按工具自己的声明判定(digest 里每个工具带 category),客户端只负责画。
    const categoryLabels = () => ({ file: cmUi("文件", "Files"), run: cmUi("执行", "Execution"), web: cmUi("网络", "Web"), context: cmUi("上下文", "Context"), coop: cmUi("协作", "Collaboration"), plugin: cmUi("插件", "Plugins"), other: cmUi("其他", "Other") });
    // 类别色只用非红:红留给错误。取静态色板里的蓝、绿、橙、灰。
    const CATEGORY_COLORS = {
      file: "var(--av-accent)",
      run: "var(--dsw-static-amber-400)",
      web: "var(--dsw-static-deepseek-450)",
      context: "var(--dsw-static-blue-300)",
      coop: "var(--dsw-static-green-500)",
      plugin: "var(--dsw-static-neutral-400)",
      other: "var(--dsw-static-neutral-300)",
    };
    const categoryOf = (tool) => (tool.category !== undefined && Object.hasOwn(CATEGORY_COLORS, tool.category) ? tool.category : "other");

    function Tools(props) {
      const tools = (props.tools || []).filter((tool) => tool.calls > 0);
      const [pickedCategory, setPickedCategory] = React.useState(null);
      const [pickedTool, setPickedTool] = React.useState(null);
      if (tools.length === 0) return null;
      const buckets = new Map();
      let totalCalls = 0;
      let totalErrors = 0;
      let totalMs = 0;
      for (const tool of tools) {
        const id = categoryOf(tool);
        if (!buckets.has(id)) buckets.set(id, { id, label: categoryLabels()[id], color: CATEGORY_COLORS[id], calls: 0, errors: 0, ms: 0, tools: [] });
        const bucket = buckets.get(id);
        bucket.calls += tool.calls;
        bucket.errors += tool.errors;
        bucket.ms += tool.totalMs || 0;
        bucket.tools.push(tool);
        totalCalls += tool.calls;
        totalErrors += tool.errors;
        totalMs += tool.totalMs || 0;
      }
      const slices = [...buckets.values()].sort((a, b) => b.calls - a.calls);
      const ring = (items, total, valueOf, radius, stroke, gap, colorOf) => {
        const circumference = 2 * Math.PI * radius;
        let consumed = 0;
        return items.map((item) => {
          const value = Math.max(0, valueOf(item) || 0);
          const raw = total === 0 ? 0 : (value / total) * circumference;
          const length = Math.max(0, raw - gap);
          const arc = h("circle", {
            key: item.id || item.name,
            cx: 50,
            cy: 50,
            r: radius,
            fill: "none",
            stroke: colorOf(item),
            strokeWidth: stroke,
            strokeDasharray: length + " " + (circumference - length),
            strokeDashoffset: String(-consumed),
            transform: "rotate(-90 50 50)",
          });
          consumed += raw;
          return arc;
        });
      };
      // 三张图默认都在:类别 → 该类工具 → 一个工具的分布。没选就给默认(最大类别、它的第一名工具)。
      const defaultCategory = slices.length > 0 ? slices[0] : null;
      const category = pickedCategory === null ? defaultCategory : buckets.get(pickedCategory) || defaultCategory;
      const categoryTools = category === null ? [] : category.tools.slice().sort((a, b) => b.calls - a.calls);
      const defaultTool = categoryTools.length > 0 ? categoryTools[0] : null;
      const tool = category === null || pickedTool === null ? defaultTool : categoryTools.find((item) => item.name === pickedTool) || defaultTool;
      const shade = (color, index) => "color-mix(in srgb, " + color + " " + Math.max(30, 100 - index * 13) + "%, var(--dsw-alias-bg-layer-2))";
      const toolSlices = category === null ? [] : categoryTools.map((item, index) => ({ ...item, color: shade(category.color, index) }));
      const toolTurns = tool === null ? [] : (tool.byTurn || []).map((item) => ({ id: "t" + item.turn, label: "T" + item.turn, turn: item.turn, calls: item.calls }));
      const turnSlices = toolTurns.map((item, index) => ({ ...item, color: shade(category.color, index) }));
      const activeCategory = pickedCategory === null ? null : pickedCategory;
      const legend = slices.map((slice) => h("button", {
        key: slice.id,
        className: "av-leg",
        "aria-pressed": activeCategory === slice.id,
        onClick: () => {
          setPickedCategory((current) => (current === slice.id ? null : slice.id));
          setPickedTool(null);
        },
      }, [
        h("span", { key: "s", className: "av-swatch", style: { background: slice.color } }),
        h("span", { key: "n", className: "av-leg-name" }, slice.label),
        h("span", { key: "c", className: "av-leg-num" }, slice.calls + cmUi(" 次 · ", " calls · ") + Math.round((slice.calls / totalCalls) * 100) + "%"),
        slice.errors > 0 ? h("span", { key: "e", className: "av-leg-err" }, "×" + slice.errors) : null,
      ]));
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, cmUi("工具", "Tools")),
          h("span", { key: "n", className: "av-hint" }, tools.length + cmUi(" 种 · ", " types · ") + totalCalls + cmUi(" 次 · ", " calls · ") + ms(totalMs) + (totalErrors > 0 ? " · " + totalErrors + cmUi(" 失败", " failed") : "")),
        ]),
        h("div", { key: "flow", className: "av-tool-flow" }, [
          h("div", { key: "category", className: "av-flow-card" }, [
            h("div", { key: "h", className: "av-flow-head" }, [
              h("span", { key: "t", className: "av-flow-title" }, cmUi("按类别", "By category")),
              h("span", { key: "m", className: "av-flow-meta" }, slices.length + cmUi(" 类", " categories")),
            ]),
            h("div", { key: "b", className: "av-flow-body" }, [
              h("div", { key: "d", className: "av-donut av-donut-sm" }, [
                h("svg", { key: "s", viewBox: "0 0 100 100", width: "112", height: "112", role: "img", "aria-label": cmUi("各类别调用占比", "Call share by category") }, ring(slices, totalCalls, (slice) => slice.calls, 40, 13, 1, (slice) => slice.color)),
                h("div", { key: "c", className: "av-donut-center" }, [
                  h("span", { key: "n", className: "av-donut-num" }, String(totalCalls)),
                  h("span", { key: "l" }, cmUi("次调用", "calls")),
                ]),
              ]),
              h("div", { key: "l", className: "av-legend-col" }, legend),
            ]),
          ]),
          category === null ? null : h("div", { key: "tools", className: "av-flow-card" }, [
            h("div", { key: "h", className: "av-flow-head" }, [
              h("span", { key: "t", className: "av-flow-title" }, category.label + cmUi("的工具", " tools")),
              h("span", { key: "m", className: "av-flow-meta" }, category.calls + cmUi(" 次 · ", " calls · ") + ms(category.ms) + (category.errors > 0 ? " · " + category.errors + cmUi(" 失败", " failed") : "")),
            ]),
            h("div", { key: "b", className: "av-flow-body" }, [
              h("div", { key: "d", className: "av-donut av-donut-sm" }, [
                h("svg", { key: "s", viewBox: "0 0 100 100", width: "112", height: "112", role: "img", "aria-label": category.label + cmUi("内各工具占比", " tool share within category") }, ring(toolSlices, category.calls, (item) => item.calls, 40, 13, 2, (item) => item.color)),
                h("div", { key: "c", className: "av-donut-center" }, [
                  h("span", { key: "n", className: "av-donut-num" }, String(categoryTools.length)),
                  h("span", { key: "l" }, cmUi("种", "types")),
                ]),
              ]),
              h("div", { key: "l", className: "av-legend-col" }, toolSlices.map((item) => h("button", {
                key: item.name,
                className: "av-leg",
                "aria-pressed": tool !== null && tool.name === item.name,
                onClick: () => setPickedTool((current) => (current === item.name ? null : item.name)),
                title: item.name + cmUi(" · 平均 ", " · average ") + ms(item.avgMs) + cmUi(" · 最慢 ", " · slowest ") + ms(item.maxMs),
              }, [
                h("span", { key: "s", className: "av-swatch", style: { background: item.color } }),
                h("span", { key: "n", className: "av-leg-name" }, item.name),
                h("span", { key: "c", className: "av-leg-num" }, item.calls + cmUi(" 次", " calls")),
                item.errors > 0 ? h("span", { key: "e", className: "av-leg-err" }, "×" + item.errors) : null,
              ]))),
            ]),
          ]),
          tool === null ? null : h("div", { key: "tool", className: "av-flow-card" }, [
            h("div", { key: "h", className: "av-flow-head" }, [
              h("span", { key: "t", className: "av-flow-title" }, tool.name + cmUi(" 用在哪些轮", " turns using this tool")),
              h("span", { key: "m", className: "av-flow-meta" }, tool.calls + cmUi(" 次", " calls")),
            ]),
            h("div", { key: "b", className: "av-flow-body" }, [
              h("div", { key: "d", className: "av-donut av-donut-sm" }, [
                h("svg", { key: "s", viewBox: "0 0 100 100", width: "112", height: "112", role: "img", "aria-label": tool.name + cmUi(" 在各轮的调用占比", " share of calls by turn") }, ring(turnSlices, tool.calls, (item) => item.calls, 40, 13, 1.5, (item) => item.color)),
                h("div", { key: "c", className: "av-donut-center" }, [
                  h("span", { key: "n", className: "av-donut-num" }, String(tool.calls)),
                  h("span", { key: "l" }, cmUi("次", "calls")),
                ]),
              ]),
              h("div", { key: "l", className: "av-flow-side" }, [
                h("div", { key: "legend", className: "av-legend-col" }, turnSlices.map((item) => h("div", { key: item.id, className: "av-leg av-leg-static", title: cmUi("第 ", "Turn ") + item.turn + cmUi(" 轮 · ", " · ") + item.calls + cmUi(" 次", " calls") }, [
                  h("span", { key: "s", className: "av-swatch", style: { background: item.color } }),
                  h("span", { key: "n", className: "av-leg-name" }, item.label),
                  h("span", { key: "c", className: "av-leg-num" }, item.calls + cmUi(" 次", " calls")),
                ]))),
                h("div", { key: "stats", className: "av-stat-line" }, [
                  h("span", { key: "e", className: tool.errors > 0 ? "av-bad" : "" }, cmUi("失败 ", "Failed ") + (tool.errors > 0 ? tool.errors : "—")),
                  h("span", { key: "a" }, cmUi("平均 ", "Average ") + ms(tool.avgMs)),
                  h("span", { key: "x" }, cmUi("最慢 ", "Slowest ") + ms(tool.maxMs)),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]);
    }

    function Reasons(props) {
      const rows = [
        ["Cause", props.cause],
        [cmUi("Runtime 知道", "Runtime knew"), props.runtimeKnew],
        [cmUi("Model 收到", "Model received"), props.modelKnew],
        [cmUi("Harness 反应", "Harness response"), props.harness],
        [cmUi("影响", "Impact"), props.impact],
      ];
      return h("div", { className: "av-why" }, rows.map(([key, value], position) => h("div", { key: String(position) }, [
        h("span", { key: "k", className: "av-why-key" }, key),
        h("span", { key: "v" }, value),
      ])));
    }

    function Incidents(props) {
      const incidents = props.incidents || [];
      const index = props.index;
      if (incidents.length === 0) {
        return h("div", { className: "av-section" }, [
          h("div", { key: "h", className: "av-section-head" }, [
            h("h3", { key: "t", className: "av-section-title" }, "Incident"),
            h("span", { key: "n", className: "av-hint" }, cmUi("检查过:同参重复调用、调用失败、空转 turn", "Checked: repeated calls with identical arguments, failed calls, idle turns")),
          ]),
          h("div", { key: "e", className: "av-empty" }, cmUi("没有发现可归因的 incident", "No attributable incidents found")),
        ]);
      }
      const shown = incidents.slice(0, 20);
      const cards = shown.map((incident, position) => {
        const tone = incident.severity >= 5 ? "high" : incident.severity >= 3 ? "mid" : "";
        return h("div", { key: incident.type + "-" + position, className: "av-incident" }, [
          h("span", { key: "bar", className: "av-bar" + (tone ? " " + tone : "") }),
          h("div", { key: "h", className: "av-incident-head" }, [
            h("span", { key: "t", className: "av-incident-title" }, incident.title),
            h("span", { key: "b", className: "av-badge" }, cmUi("严重度 ", "Severity ") + incident.severity),
          ]),
          h("div", { key: "d", className: "av-detail" }, incident.detail),
          h(Reasons, { key: "why", cause: incident.cause, runtimeKnew: incident.runtimeKnew, modelKnew: incident.modelKnew, harness: incident.harness, impact: incident.impact }),
          incident.seqs && incident.seqs.length > 0 ? h("div", { key: "s", className: "av-chips" }, [].concat(
            incident.seqs.slice(0, 10).map((entry) => {
              const seq = typeof entry === "number" ? entry : entry.seq;
              const callId = typeof entry === "number" ? index.get(entry) : entry.callId;
              const jump = callId !== undefined && props.openView !== undefined;
              return h("button", {
                key: String(seq),
                className: "av-chip",
                disabled: !jump,
                title: jump ? cmUi("在轨迹里打开 seq ", "Open in trace at seq ") + seq : "seq " + seq + cmUi("(轨迹里没有对应调用)", " (no matching call in trace)"),
                onClick: jump ? () => props.openView("trajectory", callId) : undefined,
                style: jump ? undefined : { cursor: "default" },
              }, String(seq));
            }),
            incident.seqs.length > 10 ? [h("span", { key: "more", className: "av-hint" }, cmUi("还有 ", " plus ") + (incident.seqs.length - 10) + cmUi(" 条", " records"))] : [],
          )) : null,
        ]);
      });
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "Incident"),
          h("span", { key: "n", className: "av-hint" }, incidents.length + cmUi(" 条 · 按严重度排序 · seq 可点", " records · sorted by severity · click seq to open")),
        ]),
        h("div", { key: "c", className: "av-incident-list" }, cards),
        incidents.length > shown.length ? h("div", { key: "more", className: "av-hint", style: { marginTop: 6 } }, cmUi("还有 ", " plus ") + (incidents.length - shown.length) + cmUi(" 条", " records")) : null,
      ]);
    }

    function Interpret(props) {
      const [state, setState] = React.useState({ status: "idle", text: null, error: null, truncated: false });
      const sessionId = props.sessionId;
      const run = () => {
        if (!sessionId) return;
        setState({ status: "loading", text: null, error: null, truncated: false });
        fetch("/analysis-view/interpret?session=" + encodeURIComponent(sessionId), { cache: "no-store" })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.error) setState({ status: "error", text: null, error: String(json.error), truncated: false });
            else setState({ status: "ready", text: String((json && json.text) || ""), error: null, truncated: Boolean(json && json.truncated) });
          })
          .catch((error) => setState({ status: "error", text: null, error: String((error && error.message) || error), truncated: false }));
      };
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, cmUi("开放解读", "Open interpretation")),
          h("span", { key: "n", className: "av-hint" }, cmUi("按需生成,会调用一次模型", "Generated on demand with one model call")),
          h("span", { key: "sp", className: "av-spacer" }),
          h("button", { key: "b", className: "av-btn primary", onClick: run, disabled: state.status === "loading" || !sessionId }, state.status === "loading" ? cmUi("生成中", "Generating") : state.text !== null ? cmUi("重新生成", "Regenerate") : cmUi("生成解读", "Generate interpretation")),
        ]),
        state.status === "idle" ? h("div", { key: "i", className: "av-hint" }, cmUi("基于上面的确定性 incident 与证据片段生成,每条陈述引用 (session, seq@logId)", "Generated from the deterministic incidents and evidence above; each claim cites (session, seq@logId)")) : null,
        state.status === "loading" ? h("div", { key: "l" }, [h("div", { className: "av-skel line", style: { width: "92%" } }), h("div", { className: "av-skel line", style: { width: "70%", marginBottom: 0 } })]) : null,
        state.status === "error" ? h(Notice, { key: "e", text: cmUi("解读失败:", "Interpretation failed: ") + state.error, action: { label: cmUi("重试", "Retry"), onClick: run } }) : null,
        state.status === "ready" ? h("div", { key: "r", className: "av-interp" }, state.text) : null,
        state.status === "ready" && state.truncated ? h("div", { key: "t", className: "av-hint" }, cmUi("输出触到 token 上限,已截断", "Output reached the token limit and was truncated")) : null,
      ]);
    }


    /* ---------------- 面板 ---------------- */
    // 官方统计与上下文构成只存在于视图侧。页面由 /analysis-view/trace 现场生成,
    // 把这类值作为补丁交进 iframe;主干立即启动,详情后到时更新对应图层。
    //
    // contextTimeline 在浏览器里只有精简头,requests/events 是空的;插件自己的完整明细由
    // 它自己的只读路由给出(它自己的面板也是这么取的那份)。拿不到就当没有,不猜。
    const traceDetails = new Map();
    function loadTraceDetail(sessionId, revision) {
      const cached = traceDetails.get(sessionId);
      if (cached && Date.now() - cached.at < 120000 && cached.revision === revision && (revision !== undefined || !cached.settled)) return cached.promise;
      const entry = { revision, settled: false, at: Date.now() };
      const controller = new AbortController();
      entry.controller = controller;
      const timer = setTimeout(() => controller.abort(), 10000);
      entry.promise = fetch("/api/dsh-context/detail", {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const value = body?.ok && body.value;
          return value && typeof value === "object" ? { rev: value.rev, head: value.head, current: value.current,
            provider: value.provider, model: value.model, reasoningEffort: value.reasoningEffort, requests: value.requests } : null;
        })
        .catch(() => null)
        .then(value => {
          entry.settled = true;
          if (value === null || (revision !== undefined && value.rev !== revision)) {
            if (traceDetails.get(sessionId) === entry) traceDetails.delete(sessionId);
          }
          return value;
        }).finally(() => clearTimeout(timer));
      traceDetails.delete(sessionId);
      traceDetails.set(sessionId, entry);
      while (traceDetails.size > 2) traceDetails.delete(traceDetails.keys().next().value);
      return entry.promise;
    }

    function officialTracePatch(sessionId, detail, timeline, pressure, breakdown) {
      const patch = {}, context = {};
      // 口径先走官方:构成与路由取官方投影的当前值(contextTimeline 的精简头),
      // 官方没有的按轮历史才退回插件自己的明细。
      const head = detail && detail.head && typeof detail.head === "object" ? detail.head : null;
      const current = timeline?.current ?? detail?.current ?? head?.current;
      if (current && Object.values(current).some(value => typeof value === "number" && value > 0)) context.current = current;
      const route = (timeline && (timeline.provider || timeline.model) ? timeline : null)
        || (detail && (detail.provider || detail.model) ? detail : null) || head;
      if (route && (route.provider || route.model)) context.route = { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort };
      const requests = Array.isArray(detail?.requests) && detail.requests.length ? detail.requests
        : Array.isArray(timeline?.requests) && timeline.requests.length ? timeline.requests : null;
      if (requests) context.requests = requests;
      if (Object.keys(context).length) patch.context = context;
      let snapshot;
      try {
        const target = clientCtx && clientCtx.uiConversation && clientCtx.uiConversation.binding(sessionId).target("stats");
        snapshot = target && (typeof target.getSnapshot === "function" ? target.getSnapshot() : typeof target.snapshot === "function" ? target.snapshot() : target);
      } catch (error) {
        snapshot = undefined;
      }
      if (snapshot || pressure || breakdown) {
        patch.officialStats = { context: { pressure, breakdown, source: "@deepseek-ai/dsh-token-meter" } };
        if (snapshot) {
          patch.officialStats.snapshot = snapshot;
          // 页面按「轮 → 步」查每步的工具耗时;之前只传 snapshot,页面拿不到 turns,
          // 于是每一步都显示"未记录"。这里把 snapshot 摊平成同构的 turns。
          const list = Array.isArray(snapshot) ? snapshot
            : Array.isArray(snapshot.turns) ? snapshot.turns
              : Array.isArray(snapshot.nodes) ? snapshot.nodes : null;
          if (list) {
            const byTurn = new Map();
            for (const item of list) {
              const turn = Number(item && item.turn), step = Number(item && item.step);
              if (!Number.isFinite(turn)) continue;
              if (!byTurn.has(turn)) byTurn.set(turn, { turn, steps: [] });
              if (Number.isFinite(step)) byTurn.get(turn).steps.push({ ...item, step });
            }
            if (byTurn.size) patch.officialStats.turns = [...byTurn.values()].sort((a, b) => a.turn - b.turn);
          }
        }
      }
      return Object.keys(patch).length ? patch : null;
    }

    // 独立的一页:执行路径图,数据由 /analysis-view/trace 现场生成。
    // Removing or reparenting an iframe destroys its browsing context. Keep one
    // connected layer; the view's placeholder supplies its bounds while visible.
    const traceFrame = { element: null, layer: null, session: null, ready: false, version: null, assets: null, active: false, expiry: null, postedDetail: null };
    function receiveDiagnosisDraft(event, frame, sessionId, ctx, openView) {
      const message = event.data;
      if (event.origin !== window.location.origin || event.source !== frame?.contentWindow ||
          message?.type !== "analysis-diagnosis-draft" || message.sessionId !== sessionId ||
          !sessionId || typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 65536) return;
      let applied = false;
      try {
        const binding = ctx?.sessions?.binding(sessionId);
        if (binding && typeof openView === "function") {
          applied = ctx.conversation.input.requestDraftInitialization(binding, { prompt: message.prompt, whenDraftExists: "append" }) === "applied";
        }
      } catch {}
      event.source.postMessage({ type: "analysis-diagnosis-ack", sessionId, applied }, event.origin);
      if (applied) openView("chat", "");
    }
    function useDiagnosisDraft(frame, sessionId, openView, enabled = true) {
      React.useEffect(() => {
        if (!frame || !sessionId || !enabled) return;
        const onMessage = event => receiveDiagnosisDraft(event, frame, sessionId, clientCtx, openView);
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
      }, [frame, sessionId, openView, enabled]);
    }
    function PathView(props) {
      useLocaleRefresh();
      React.useEffect(() => ensureStyle(), []);
      const sessionId = props && props.sessionId;
      const useProjection = props && props.useProjection;
      const timeline = useProjection ? useProjection("contextTimeline") : undefined;
      const pressure = useProjection ? useProjection("contextPressure") : undefined;
      const breakdown = useProjection ? useProjection("contextBreakdown") : undefined;
      const [detailRecord, setDetailRecord] = React.useState(undefined);
      const detail = detailRecord?.session === sessionId ? detailRecord.value : undefined;
      const detailRevision = timeline?.detailRev;
      React.useEffect(() => {
        setDetailRecord(undefined);
        if (!sessionId) return undefined;
        let live = true;
        const load = () => { if (document.visibilityState !== "hidden") loadTraceDetail(sessionId, detailRevision).then((value) => { if (live) setDetailRecord({ session: sessionId, value }); }); };
        const cancel = () => {
          const entry = traceDetails.get(sessionId);
          if (entry && !entry.settled) { entry.controller.abort(); traceDetails.delete(sessionId); }
        };
        const visibility = () => { if (document.visibilityState === "hidden") cancel(); else load(); };
        load(); document.addEventListener("visibilitychange", visibility);
        return () => { live = false; cancel(); document.removeEventListener("visibilitychange", visibility); };
      }, [sessionId, detailRevision]);
      const patch = React.useMemo(
        () => (sessionId ? officialTracePatch(sessionId, detail, timeline, pressure, breakdown) : null),
        [sessionId, detail, timeline, pressure, breakdown],
      );
      const shell = React.useRef(null);
      const [frame, setFrame] = React.useState(null);
      useDiagnosisDraft(frame, sessionId, props.openView);
      // 挂载时复用上一次的 iframe;只有换会话才重新加载。
      React.useLayoutEffect(() => {
        const host = shell.current;
        if (!host || !sessionId) return undefined;
        clearTimeout(traceFrame.expiry);
        let layer = traceFrame.layer;
        if (!layer) {
          layer = document.createElement("div");
          layer.className = "av-root av-trace";
          layer.style.cssText = "position:fixed;z-index:1;margin:0;padding:0;min-height:0;overflow:hidden;display:none";
          layer.hidden = true;
          document.body.append(layer);
          traceFrame.layer = layer;
        }
        let element = traceFrame.element;
        const reused = element && traceFrame.session === sessionId;
        if (!element || traceFrame.session !== sessionId) {
          if (element) element.remove();
          element = document.createElement("iframe");
          element.className = "av-trace-frame";
          element.title = cmUi("执行路径", "Action path");
          element.src = "/analysis-view/trace?staged=1&session=" + encodeURIComponent(sessionId);
          traceFrame.element = element;
          traceFrame.session = sessionId;
          traceFrame.ready = false;
          traceFrame.version = null;
          traceFrame.assets = null; traceFrame.postedDetail = null;
          layer.append(element);
        }
        setFrame(element);
        traceFrame.active = document.visibilityState !== "hidden";
        const visible = () => {
          element.contentWindow?.postMessage({ type: "analysis-trace-visibility", sessionId, visible: traceFrame.active }, location.origin);
        };
        const fit = () => {
          const box = host.getBoundingClientRect();
          layer.hidden = !traceFrame.active || box.width <= 0 || box.height <= 0;
          Object.assign(layer.style, { display: layer.hidden ? "none" : "flex", left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px" });
        };
        fit();
        visible();
        const visibility = () => { traceFrame.active = document.visibilityState !== "hidden"; visible(); fit(); };
        document.addEventListener("visibilitychange", visibility);
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
        if (observer) { observer.observe(host); if (host.parentElement) observer.observe(host.parentElement); }
        window.addEventListener("resize", fit);
        window.addEventListener("scroll", fit, true);
        let live = true;
        // Revalidate the retained page without transferring or parsing its HTML.
        if (reused && traceFrame.ready) fetch("/analysis-view/trace-version?staged=1&session=" + encodeURIComponent(sessionId), { cache: "no-store" })
          .then(response => response.ok ? response.json() : undefined).then(value => {
            if (live && value && value.version !== traceFrame.version) {
              if (value.assets && traceFrame.assets && value.assets !== traceFrame.assets) {
                traceFrame.ready = false; traceFrame.version = null; traceFrame.postedDetail = null;
                element.src = "/analysis-view/trace?staged=1&session=" + encodeURIComponent(sessionId);
              } else element.contentWindow?.postMessage({ type: "analysis-trace-refresh", sessionId }, location.origin);
            }
          }).catch(() => {});
        return () => {
          live = false;
          if (observer) observer.disconnect();
          window.removeEventListener("resize", fit);
          window.removeEventListener("scroll", fit, true);
          document.removeEventListener("visibilitychange", visibility);
          traceFrame.active = false; visible();
          setFrame(null);
          layer.hidden = true;
          layer.style.display = "none";
          traceFrame.expiry = setTimeout(() => {
            if (traceFrame.active || traceFrame.element !== element) return;
            layer.remove(); traceFrame.element = traceFrame.layer = null;
            traceFrame.session = traceFrame.version = traceFrame.assets = traceFrame.postedDetail = null;
            traceFrame.ready = false; traceDetails.clear();
          }, 120000);
        };
      }, [sessionId]);
      React.useEffect(() => {
        if (!frame) return undefined;
        const post = () => {
          if (!frame.contentWindow || !traceFrame.active) return;
          const next = { ...(patch || {}), ...(patch?.context ? { context: { ...patch.context } } : {}),
            traceStatus: { context: detail === undefined ? "loading" : detail === null ? "unavailable" : "ready" } };
          if (next.context?.requests && traceFrame.postedDetail === detail) delete next.context.requests;
          else if (next.context?.requests) traceFrame.postedDetail = detail;
          frame.contentWindow.postMessage({ type: "analysis-trace-data", sessionId, payload: next }, location.origin);
          frame.contentWindow.postMessage({ type: "analysis-trace-visibility", sessionId, visible: true }, location.origin);
        };
        const onLoad = () => {
          const version = frame.contentWindow?.__geistPayload?.traceVersion;
          traceFrame.ready = version !== undefined && version !== null;
          traceFrame.version = version ?? traceFrame.version;
          post();
        };
        const onMessage = (event) => {
          if (event.origin !== location.origin || event.source !== frame.contentWindow || !event.data || event.data.type !== "analysis-trace-ready") return;
          traceFrame.ready = event.data.version !== undefined && event.data.version !== null;
          traceFrame.version = event.data.version ?? null;
          traceFrame.assets = event.data.assets ?? traceFrame.assets;
          // A ready announcement comes from a document; that document has not received
          // this detail yet, so the requests are not deduplicated against the previous one.
          traceFrame.postedDetail = null;
          if (!traceFrame.active) frame.contentWindow?.postMessage({ type: "analysis-trace-visibility", sessionId, visible: false }, location.origin);
          post();
        };
        window.addEventListener("message", onMessage);
        frame.addEventListener("load", onLoad);
        if (traceFrame.ready || frame.contentWindow?.__geistPayload) onLoad();
        return () => {
          window.removeEventListener("message", onMessage);
          frame.removeEventListener("load", onLoad);
        };
      }, [frame, patch, detail, sessionId]);
      // 页面里的"跳到第 N 轮对话":切到对话并滚到那一轮,复用分析面板的定位逻辑。
      React.useEffect(() => {
        if (!sessionId) return undefined;
        const onJump = (event) => {
          if (event.origin !== location.origin || !event.data || event.data.type !== "analysis-trace-jump") return;
          const turn = Number(event.data.turn);
          if (!Number.isInteger(turn) || turn < 1) return;
          try {
            if (props.openView) props.openView("chat", "");
          } catch (error) {
            /* 切不过去就按当前 DOM 找 */
          }
          waitForChatTurn(turn, 2500).then((row) => {
            if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        };
        window.addEventListener("message", onJump);
        return () => window.removeEventListener("message", onJump);
      }, [sessionId]);
      if (!sessionId) return h("div", { className: "av-root" }, [h(Notice, { key: "n", text: cmUi("还没有选中会话", "No session selected") })]);
      return h("div", { className: "av-root av-trace", ref: shell });
    }

    function AnalysisPanel(props) {
      React.useEffect(() => ensureStyle(), []);
      const sessionId = props && props.sessionId;
      const openView = props && props.openView;
      const useTrajectory = props && props.useTrajectory;
      const snapshot = useTrajectory ? useTrajectory((state) => state) : null;
      const { index, version } = React.useMemo(() => buildCallIndex(snapshot), [snapshot]);
      const digest = useDigest(sessionId, version);
      useLocaleRefresh();
      const data = digest.data;
      const incidents = data && Array.isArray(data.incidents) ? data.incidents : [];
      const status = digest.status;

      // 读不到 host 时降级:只列轨迹投影里的工具报错,并写明计数来源。
      const localErrors = React.useMemo(() => {
        const nodes = Array.isArray(snapshot && snapshot.eventNodes) ? snapshot.eventNodes : [];
        const seqs = [];
        for (const node of nodes) if (node && node.kind === "tool-result" && (node.error || node.isError)) seqs.push(node.seq);
        return seqs;
      }, [snapshot]);
      const degraded = status === "error" && !data && localErrors.length > 0
        ? [{
          type: "error",
          severity: localErrors.length,
          title: cmUi("调用失败", "Call failed"),
          detail: localErrors.length + cmUi(" 个工具调用返回错误(host 分析不可用,计数来自轨迹投影)", " tool calls returned errors (host analysis unavailable; count from trace projection)"),
          cause: cmUi("工具调用返回了错误结果", "The tool call returned an error result"),
          runtimeKnew: cmUi("错误码/失败状态已在事件中", "Error code / failure status is in the event"),
          modelKnew: cmUi("收到 tool result(可能已含错误)", "Received tool result (may include an error)"),
          harness: cmUi("未检测到针对性处理(需 host 判定)", "No targeted handling detected (requires host determination)"),
          impact: cmUi("该部分目标未达成", "This part of the goal was not achieved"),
          seqs: localErrors,
        }]
        : [];
      const head = h("div", { key: "h", className: "av-head" }, [
        h("span", { key: "d", className: "av-live " + (status === "ready" ? "" : status === "stale" ? "stale" : "dead"), title: status === "ready" ? cmUi("已读取", "Loaded") : status === "stale" ? cmUi("刷新失败,显示上一次结果", "Refresh failed; showing previous results") : cmUi("未连接", "Disconnected") }),
        h("h2", { key: "t", className: "av-title" }, cmUi("分析", "Analysis")),
        data && data.log ? h("span", { key: "m", className: "av-meta" }, [
          data.log.id + " · " + fmt(data.log.events) + cmUi(" 事件 · seq ", " events · seq ") + data.log.minSeq + "–" + data.log.maxSeq,
        ]) : null,
        h("span", { key: "sp", className: "av-spacer" }),
        h("button", { key: "r", className: "av-btn", onClick: digest.refresh, disabled: !sessionId || status === "loading" }, cmUi("刷新", "Refresh")),
      ]);

      if (!sessionId) return h("div", { className: "av-root" }, [head, h(Notice, { key: "n", text: cmUi("还没有选中会话", "No session selected") })]);

      if (status === "loading" || (status === "idle" && !data)) return h("div", { className: "av-root" }, [head, h(Skeleton, { key: "s" })]);

      if (status === "error" && !data) {
        return h("div", { className: "av-root" }, [
          head,
          h(Notice, { key: "e", text: cmUi("读取会话失败:", "Failed to read session: ") + digest.error, action: { label: cmUi("重试", "Retry"), onClick: digest.refresh } }),
          degraded.length > 0 ? h(Incidents, { key: "inc", incidents: degraded, index, openView }) : null,
        ]);
      }

      const cost = data && data.cost;
      const turns = data && Array.isArray(data.turnStats) ? data.turnStats : [];
      const tools = data && Array.isArray(data.toolStats) ? data.toolStats : [];

      return h("div", { className: "av-root" }, [
        head,
        status === "stale" ? h(Notice, { key: "st", text: cmUi("刷新失败,先显示上一次的结果:", "Refresh failed; showing previous results: ") + digest.error, action: { label: cmUi("重试", "Retry"), onClick: digest.refresh } }) : null,
        h("div", { key: "k", className: "av-kpis" }, [
          h(Kpi, { key: "turns", label: cmUi("轮次", "Turns"), value: String(data ? data.turns : "—") }),
          h(Kpi, { key: "calls", label: cmUi("工具调用", "Tool calls"), value: String(data ? data.toolCalls : "—") }),
          h(Kpi, { key: "errors", label: cmUi("失败", "Failed"), value: String(data ? data.errors : "—"), tone: data && data.errors > 0 ? "bad" : "" }),
          h(Kpi, { key: "cache", label: cmUi("缓存命中", "Cache hit"), value: pct(cost && cost.cacheEfficiency) }),
          h(Kpi, { key: "events", label: cmUi("事件", "Events"), value: fmt(data && data.eventCount) }),
        ]),
        h(WorkPath, { key: "w", turns, index, openView }),
        h(Cost, { key: "c", cost, turnStats: turns, sessionId, openView }),
        h(Tools, { key: "tools", tools }),
        h(Incidents, { key: "inc", incidents, index, openView }),
        h(Interpret, { key: "i", sessionId }),
        h("div", { key: "f", className: "av-foot" }, [
          h("span", { key: "v" }, cmUi("日志 ", "Log ") + (data && data.log ? data.log.id : "—")),
          h("span", { key: "l" }, cmUi("读于 ", "Read at ") + (digest.at ? new Date(digest.at).toLocaleTimeString() : "—")),
          h("span", { key: "n" }, cmUi("轨迹 ", "Trace ") + version + cmUi(" 节点", " nodes")),
        ]),
      ]);
    }

    const toolErrorLabels = {
      FS_NOT_OBSERVED: ["修改前未读取文件", "File not read before editing"],
      FS_STALE_VERSION: ["文件版本已变化", "File version changed"],
      FS_EDIT_NOT_FOUND: ["未找到待替换文本", "Edit target text not found"],
      FS_NOT_FOUND: ["文件未找到", "File not found"],
      FS_NOT_TEXT: ["目标文件不是文本", "Non-text file"],
      SESSION_QUERY_PERSISTENCE_FAILED: ["历史存储不可用", "Session history storage unavailable"],
      TOOL_TIMEOUT: ["工具调用超时", "Tool call timed out"],
      CODE_RUN_FAILED: ["Code Mode 执行失败", "Code Mode execution failed"],
      SEARCH_FAILED: ["搜索失败", "Search failed"],
      WEB_UNSUPPORTED_CONTENT_TYPE: ["网页内容类型不支持", "Unsupported web content type"],
      WEB_PROVIDER_ERROR: ["网页服务报错", "Web provider error"],
      WEB_REDIRECT_BLOCKED: ["网页重定向受阻", "Web redirect blocked"],
      ABORTED: ["执行中止", "Execution aborted"],
      ABORTED_BEFORE_DISPATCH: ["调度前取消", "Cancelled before dispatch"],
      TOOL_OUTCOME_UNKNOWN: ["宿主无法确认执行结果", "Outcome unknown to host"],
      TOOL_ERROR: ["无细分错误码", "Unspecified tool error"],
    };

    function toolErrorLabel(code) {
      return Object.hasOwn(toolErrorLabels, code) ? cmUi(...toolErrorLabels[code]) : code;
    }

    function EvalToolTiming({ timing, recordLink }) {
      if (!timing?.byTool?.length) return null;
      const minP95Samples = 20;
      const coverage = value => cmUi("有起止记录 ", "Paired samples ") + value.pairedCalls + "/" + value.calls;
      return h("details", { className: "av-eval-group" },
        h("summary", null, cmUi("调用到结果的耗时", "Call-to-result timing"),
          h("span", null, coverage(timing) + " (" + pct(timing.coverage) + ")")),
        h("p", { className: "av-hint" }, cmUi(
          "记录的耗时可能包含调度和等待。并发调用的耗时分别计入累计值。P95 至少需要 " + minP95Samples + " 个成对样本。",
          "Recorded durations may include scheduling and waiting. Overlapping calls each contribute to the total. P95 requires at least " + minP95Samples + " paired samples.")),
        h("ul", { className: "av-eval-list" }, timing.byTool.map(tool => h("li", { key: tool.name },
          h("div", { className: "av-eval-item" },
            h("strong", null, tool.name || cmUi("工具名缺失", "Unnamed tool")),
            h("span", { className: "av-hint" }, coverage(tool))),
          tool.pairedCalls ? h("div", { className: "av-eval-counts" },
            h("span", null, cmUi("累计 ", "Total ") + ms(tool.cumulativeMs)),
            h("span", null, "P50 " + ms(tool.p50Ms)),
            tool.pairedCalls >= minP95Samples ? h("span", null, "P95 " + ms(tool.p95Ms)) : null) : null,
          tool.rows.length ? h("details", { className: "av-eval-proof" },
            h("summary", null, cmUi("最慢的有记录调用", "Slowest recorded calls")),
            tool.rows.map(row => h("div", { key: row.record.seq, className: "av-eval-records" },
              h("span", { className: "av-hint" }, "T" + row.turn + " · " + ms(row.durationMs)),
              recordLink(cmUi("调用", "Call"), row.record, row),
              h("span", { className: "av-hint" }, cmUi("结果 #", "Result #") + row.resultSeq)))) : null))));
    }

    const evalNumber = value => Number.isFinite(value) ? value.toLocaleString(cmUi("zh-CN", "en-US")) : "—";
    const evalRatio = (count, total) => total ? evalNumber(count) + "/" + evalNumber(total) : "—";
    const evalSample = (value, samples, total) => value + " · " + evalRatio(samples, total);
    const evalEvidenceLabels = {
      "user/message": ["用户消息", "User message"], "assistant/message": ["模型回复", "Assistant reply"],
      "deliverables/presented": ["交付登记", "Delivery record"], "workspace/changes": ["工作区观测", "Workspace observation"],
      "turn/end": ["轮次结束", "Turn end"], goal: ["目标", "Goal"], "goal/change": ["目标变更", "Goal change"],
      "todo/write": ["待办更新", "Todo update"], "compaction/end": ["压缩结束", "Compaction end"],
      "compaction/prune": ["工具结果裁短", "Result prune"], "subagent/catalog": ["子会话", "Child session"],
      "session-log-deepseek/delivery-accepted": ["投递回执", "Delivery receipt"],
    };

    function evalEvidenceLinks(rows, recordLink) {
      if (!rows?.length) return null;
      return h("div", { className: "av-eval-records" }, rows.map(row => {
        const label = evalEvidenceLabels[row.type];
        return recordLink(label ? cmUi(...label) : cmUi("记录", "Record"), row, row);
      }));
    }

    function EvalMetricGroup({ title, summary, values, children }) {
      return h("details", { className: "av-eval-group" },
        h("summary", null, title, summary ? h("span", null, summary) : null),
        h("dl", { className: "av-eval-metrics" }, values.map(([label, value]) =>
          h("div", { key: label }, h("dt", null, label), h("dd", null, value)))),
        children);
    }

    const evalTurnReasons = {
      completed: ["正常结束", "Completed turn"], aborted: ["中止", "Aborted"],
      interrupted: ["打断", "Interrupted"], error: ["报错结束", "Ended with error"],
      open: ["未记录结束", "Open"], unknown: ["结束原因缺失", "Missing end reason"],
    };

    function EvalRuntimeMetrics({ metrics, recordLink }) {
      const { timing, usage, files, task, context } = metrics;
      const item = (zh, en, value) => [cmUi(zh, en), evalNumber(value)];
      const span = row => evalSample(ms(row.ms), row.measured, row.total);
      const official = timing.official;
      const officialLabels = {
        wall: ["官方墙钟", "Official wall time"], ttft: ["首字延迟", "Time to first token"],
        model: ["模型时间", "Model time"], decode: ["解码时间", "Decode time"],
        tool: ["官方工具累计", "Official tool total"], toolWall: ["官方工具区间", "Official tool wall time"],
        retries: ["官方重试", "Official retries"], toolErrors: ["官方工具报错", "Official tool errors"],
      };
      const usageLabels = {
        input: ["未缓存输入", "Uncached input"], cacheRead: ["缓存读取", "Cache reads"],
        cacheWrite: ["缓存写入", "Cache writes"], output: ["输出", "Output"],
        reasoning: ["推理", "Reasoning"], total: ["总量", "Total"],
      };
      const composition = context.requestComposition;
      return h("section", { className: "av-section" },
        h("h3", { className: "av-section-title" }, cmUi("范围指标", "Scope metrics")),
        h(EvalMetricGroup, { title: cmUi("执行时长", "Execution timing"), summary: span(timing.turns), values: [
          [cmUi("轮次起止", "Observed turn spans"), span(timing.turns)],
          [cmUi("步骤起止", "Observed step spans"), span(timing.steps)],
          [cmUi("步内工具累计", "Tool time summed within steps"), evalSample(ms(timing.toolSteps.cumulativeMs), timing.toolSteps.measured, timing.toolSteps.total)],
          [cmUi("步内工具并集", "Tool interval union within steps"), evalSample(ms(timing.toolSteps.coveredMs), timing.toolSteps.measured, timing.toolSteps.total)],
          [cmUi("步内调用起止配对", "Paired tool calls in recorded steps"), evalRatio(timing.toolSteps.pairedCalls, timing.toolSteps.calls)],
          ...Object.entries(official?.fields ?? {}).map(([key, field]) => [
            cmUi(...officialLabels[key]), evalSample(["retries", "toolErrors"].includes(key) ? evalNumber(field.value) : ms(field.value),
              field.samples, official.steps),
          ]),
          ...(official ? [] : [item("官方步骤统计", "Official step statistics", null)]),
        ] }, h("p", { className: "av-hint" }, cmUi(
          "步内区间裁剪到已记录的步骤边界。并集只算一次重叠时间。官方项来自宿主统计重放。",
          "Tool intervals are clipped to observed step boundaries. The union counts overlap once. Official fields use host replay."))),
        h(EvalMetricGroup, { title: cmUi("用量与缓存", "Usage and cache"), summary: evalNumber(usage.requests) + cmUi(" 条结算", " settlements"), values: [
          ...Object.entries(usageLabels).map(([key, labels]) => [
            cmUi(...labels), evalSample(evalNumber(usage[key]), usage.coverage[key], usage.requests),
          ]),
          [cmUi("缓存读取占比", "Cache-read share"), evalSample(pct(usage.cacheEfficiency), usage.cacheEfficiencySample.records, usage.requests)],
          [cmUi("缓存成对分母", "Paired cache denominator"), evalNumber(usage.cacheEfficiencySample.cacheRead) + " + " + evalNumber(usage.cacheEfficiencySample.input)],
        ] }, h("p", { className: "av-hint" }, cmUi("用量单位为 token。每项附有记录数，缓存占比使用同时上报的两项。", "Usage is in tokens. Each total includes its reporting coverage. The cache share uses paired fields."))),
        h(EvalMetricGroup, { title: cmUi("文件与信息", "Files and information"), summary: evalNumber(files.files) + cmUi(" 个文件", " files"), values: [
          item("涉及文件", "Distinct files", files.files), item("有文件关联的调用", "Calls with file evidence", files.calls),
          item("读取关联", "Read associations", files.access.read), item("搜索命中关联", "Search-match associations", files.access.match),
          item("写入关联", "Write associations", files.access.write), item("非报错写入返回", "Non-error write returns", files.returnedWriteCalls),
          [cmUi("首次写入前有读取", "Read before first write"), evalRatio(files.readBeforeFirstWrite, files.pairedWriteFiles)],
          [cmUi("末次写入后有读回", "Read after last write"), evalRatio(files.readAfterLastWrite, files.pairedWriteFiles)],
        ] }, h("p", { className: "av-hint" }, cmUi(
          "前读与读回只比较范围内有起止且非报错的读取和写入，按涉及文件计数。",
          "Read order uses paired, non-error reads and writes within the selected scope, counted by file.")),
          files.rows.length ? h("ul", { className: "av-eval-list" }, files.rows.map(row =>
          h("li", { key: row.path }, h("code", null, row.path),
            h("div", { className: "av-eval-records" }, evalNumber(row.calls) + cmUi(" 次调用", " calls"),
              recordLink(cmUi("最近记录", "Latest record"), row, row))))) : null),
        h(EvalMetricGroup, { title: cmUi("任务与成果", "Tasks and deliverables"), summary: evalNumber(task.deliveries) + cmUi(" 条交付登记", " delivery records"), values: [
          item("用户消息", "User messages", task.prompts), item("目标变更", "Goal changes", task.goalChanges),
          item("目标工具记录", "Goal tool records", task.goalToolRecords),
          item("待办更新", "Todo updates", task.todoUpdates),
          item("工作区变更观测", "Workspace change observations", task.workspaceObservations),
          item("交付登记", "Delivery records", task.deliveries), item("登记文件次数", "Listed file occurrences", task.deliveredFiles),
          ...Object.entries(task.turnReasons).map(([reason, value]) => [
            Object.hasOwn(evalTurnReasons, reason) ? cmUi(...evalTurnReasons[reason]) : reason, evalNumber(value),
          ]),
          ...Object.entries(task.goalPhases).map(([phase, value]) => [
            cmUi("目标状态 · ", "Goal phase · ") + phase, evalNumber(value),
          ]),
        ] }, h("p", { className: "av-hint" }, cmUi("结束原因和交付登记来自宿主，验收需核对产物与检查结果。", "Turn endings and delivery records come from the host. Acceptance requires checking the deliverable and verification results.")),
        evalEvidenceLinks(task.evidence, recordLink)),
        h(EvalMetricGroup, { title: cmUi("上下文、Skill 与协作", "Context, skills and collaboration"),
          summary: evalNumber(context.receipts) + cmUi(" 条投递回执", " delivery receipts"), values: [
            item("请求头记录", "Request header records", context.headers), item("请求上下文更新", "Request context updates", context.contextUpdates),
            item("投递回执", "Delivery receipts", context.receipts),
            item("最近回执覆盖到序号", "Latest receipt through seq", context.deliveredThroughSeq),
            item("压缩开始", "Compaction starts", context.compactionsStarted), item("压缩结束", "Compaction endings", context.compactionsEnded),
            [cmUi("压缩上报 token", "Reported compaction tokens"), evalSample(evalNumber(context.compactionUsage.total),
              context.compactionUsage.measured, context.compactionUsage.summaries)],
            item("工具结果裁短", "Tool result prunes", context.toolResultPrunes),
            item("Skill 目录", "Skill catalogs", context.skillCatalogs), item("Skill 引用", "Skill references", context.skillReferences),
            item("Skill 正文加载", "Skill body loads", context.skillLoads),
            item("切点仍保留的加载结果", "Load results retained at cut", context.retainedSkillLoads),
            item("子会话目录", "Catalogued child sessions", context.childSessions),
            item("协作消息", "Handoff messages", context.handoffMessages), item("子任务结束消息", "Child settled messages", context.settledMessages),
            [cmUi("完整样本 / 分类记录", "Complete samples / composition records"), composition ? evalRatio(composition.measured, composition.requests) : "—"],
            item("请求构成估算峰值", "Peak estimated request composition", composition?.peakTokens),
            item("完整请求样本首末差", "First-to-last complete composition change", composition?.netTokens),
            ...(context.pressure ? [
              item("切点上报占用", "Reported context pressure", context.pressure.reportedTokens),
              item("切点预计占用", "Projected context pressure", context.pressure.projectedTokens),
              item("上下文窗口", "Context window", context.pressure.contextWindow),
            ] : []),
          ] }, h("p", { className: "av-hint" }, cmUi("请求构成来自 dsh-context 的分类估算。投递回执和宿主上报用量另计。", "Request composition uses dsh-context category estimates. Delivery receipts and reported usage are counted separately.")),
          evalEvidenceLinks(context.evidence, recordLink)));
    }

    function EvalToolChecks({ execution, metrics, recordLink }) {
      if (!metrics) return null;
      const { repeats, parameters } = metrics, recovery = execution.recovery;
      const item = (zh, en, value) => [cmUi(zh, en), evalNumber(value)];
      return h(EvalMetricGroup, { title: cmUi("同参重试与参数检查", "Retry candidates and parameter checks"), values: [
        item("受阻段", "Blocked episodes", recovery?.episodes),
        item("全部有同参返回", "All failures have a same-input return", recovery?.allSameInputReturned),
        item("部分有同参返回", "Some failures have a same-input return", recovery?.partiallyMatched),
        item("未见同参返回", "No same-input return observed", recovery?.noSameInputReturn),
        item("同轮同参候选组", "Same-turn same-input groups", repeats.groups), item("候选组内调用", "Calls in candidate groups", repeats.calls),
        [cmUi("直接调用可校验", "Direct calls checkable"), parameters ? evalRatio(parameters.schema.checkable, parameters.scope.directCalls) : "—"],
        item("定义匹配", "Schema conforming", parameters?.schema.conforming),
        item("定义未匹配", "Schema nonconforming", parameters?.schema.nonconforming),
        item("定义待核验", "Schema status unknown", parameters?.schema.unknown),
        item("参数 JSON 有效", "Valid JSON arguments", parameters?.json.valid),
        item("参数 JSON 无效", "Invalid JSON arguments", parameters?.json.invalid),
        item("空参数", "Empty arguments", parameters?.json.empty),
        item("参数缺失", "Missing arguments", parameters?.json.unknown),
      ] }, h("p", { className: "av-hint" }, cmUi(
        "直接调用使用已记录的请求头和宿主校验器核对。是否有推进还要看每次调用取得的反馈和状态变化。",
        "Direct calls are checked against recorded headers with the host validator. Assess progress using the feedback and state changes from each attempt.")),
      repeats.rows.length ? h("div", { className: "av-eval-records" }, repeats.rows.map(row =>
        recordLink(row.tool + " ×" + row.calls, row, row))) : null,
      parameters?.evidence.length ? h("div", { className: "av-eval-records" }, parameters.evidence.map(row =>
        recordLink(cmUi("参数检查", "Parameter check") + " · " + row.tool, row, row))) : null);
    }

    function EvalDashboardPanel(props) {
      React.useEffect(() => ensureStyle(), []);
      const { sessionId, openView } = props;
      const [detailsSession, setDetailsSession] = React.useState(null);
      const [frame, setFrame] = React.useState(null);
      const details = Boolean(sessionId && sessionId === detailsSession);
      useDiagnosisDraft(frame, sessionId, openView, !details);
      React.useEffect(() => {
        if (!frame || details) return;
        const onMessage = event => {
          if (event.origin === window.location.origin && event.source === frame.contentWindow &&
              event.data?.type === "analysis-eval-details" && event.data.sessionId === sessionId) setDetailsSession(sessionId);
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
      }, [frame, sessionId, details]);
      if (!sessionId) return h(Notice, { text: cmUi("还没有选中会话", "No session selected") });
      return details ? h(EvalPanel, { ...props, backToCharts: () => setDetailsSession(null) }) :
        h("div", { className: "av-root av-trace" }, h("iframe", { key: sessionId, ref: setFrame, className: "av-trace-frame",
          title: cmUi("运行评估", "Session evaluation"), src: "/analysis-view/eval?format=page&session=" + encodeURIComponent(sessionId) }));
    }

    function EvalPanel(props) {
      React.useEffect(() => ensureStyle(), []);
      useLocaleRefresh();
      const { sessionId, openView } = props;
      const [loaded, setLoaded] = React.useState(null);
      const [refresh, setRefresh] = React.useState(0);
      const [selection, select] = React.useState(null);
      const [expanded, setExpanded] = React.useState(false);
      const current = loaded?.sessionId === sessionId && loaded.refresh === refresh ? loaded : null;

      React.useEffect(() => {
        if (!sessionId) return;
        const controller = new AbortController();
        async function load() {
          try {
            const response = await fetch("/analysis-view/eval?session=" + encodeURIComponent(sessionId),
              { cache: "no-store", signal: controller.signal });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || "HTTP " + response.status);
            if (!controller.signal.aborted) setLoaded({ sessionId, refresh, data });
          } catch (error) {
            if (!controller.signal.aborted) setLoaded({ sessionId, refresh, error: String(error.message || error) });
          }
        }
        load();
        return () => controller.abort();
      }, [sessionId, refresh]);

      const data = current?.data;
      const turn = selection?.sessionId === sessionId ? data?.turns?.find(item => item.turn === selection.turn) : null;
      const execution = turn?.execution ?? data?.execution;
      const metrics = turn ? turn.metrics : data?.metrics;
      const reload = () => setRefresh(value => value + 1);
      const recordLink = (label, record, row) => h("button", { key: record.seq, className: "av-chip", type: "button",
        disabled: typeof openView !== "function" || !record.callId && !Number.isSafeInteger(row.turn),
        onClick: () => record.callId ? openView("trajectory", record.callId) : jumpToChatTurn(openView, sessionId, row),
        title: record.callId ? cmUi("打开原始记录", "Open original record") : cmUi("打开所在轮次", "Open containing turn") }, label + " #" + record.seq);

      return h("div", { className: "av-root" }, [
        h("div", { key: "head", className: "av-head" }, [
          h("h2", { key: "title", className: "av-title" }, cmUi("评估", "Eval")),
          Number.isSafeInteger(data?.cut) ? h("span", { key: "cut", className: "av-meta" }, "seq " + data.cut) : null,
          h("span", { key: "space", className: "av-spacer" }),
          props.backToCharts ? h("button", { key: "charts", type: "button", className: "av-btn", onClick: props.backToCharts },
            cmUi("返回图表", "Back to charts")) : null,
          h("button", { key: "refresh", type: "button", className: "av-btn", disabled: !sessionId || !current,
            onClick: reload }, cmUi("刷新", "Refresh")),
        ]),
        !sessionId ? h(Notice, { key: "session", text: cmUi("还没有选中会话", "No session selected") }) : null,
        sessionId && !current ? h(Notice, { key: "load", text: cmUi("正在读取轨迹统计", "Loading trajectory metrics") }) : null,
        current?.error ? h(Notice, { key: "error", text: current.error, action: { label: cmUi("重试", "Retry"), onClick: reload } }) : null,
        data?.turns?.length ? h("select", { key: "turn", className: "av-eval-turn", value: turn?.turn ?? "",
          "aria-label": cmUi("选择统计范围", "Select a metric scope"),
          onChange: event => select(event.target.value === "" ? null : { sessionId, turn: Number(event.target.value) }) }, [
          h("option", { key: "all", value: "" }, cmUi("整段会话", "Whole session")),
          ...data.turns.map(option => h("option", { key: option.turn, value: option.turn }, "T" + option.turn + (option.label ? " · " + option.label : ""))),
        ]) : null,
        metrics ? h(EvalRuntimeMetrics, { key: "metrics", metrics, recordLink }) : null,
        execution ? h("section", { key: "execution", className: "av-section" }, [
          h("h3", { key: "h", className: "av-section-title" }, cmUi("工具执行", "Tool execution")),
          h("div", { key: "counts", className: "av-eval-counts" },
            h("span", null, cmUi("调用 ", "Calls ") + execution.calls),
            h("span", null, cmUi("非报错返回 ", "Non-error returns ") + execution.returned),
            h("span", null, cmUi("有报错记录 ", "Recorded errors ") + execution.errors),
            h("span", null, cmUi("无结果记录 ", "No recorded result ") + execution.unknown)),
          execution.errorsByCondition.length ? h("div", { key: "groups" }, execution.errorsByCondition.map(group =>
            h("details", { key: group.code, className: "av-eval-group" },
              h("summary", null, toolErrorLabel(group.code),
                h("span", null, group.calls + cmUi(" 次 · 同参恢复 ", " calls · Same-input recovery ") + group.matched)),
              h("p", { className: "av-hint" }, h("code", null, group.code), " · ",
                group.tools.map(tool => tool.name + " ×" + tool.count).join(" · ")),
              h("ul", { className: "av-eval-list" }, group.rows.map(row =>
                h("li", { key: row.failure.seq },
                  h("div", { className: "av-eval-item" }, h("strong", null, "T" + row.turn + " · " + row.tool)),
                  h("div", { className: "av-eval-records" },
                    recordLink(cmUi("报错", "Error"), row.failure, row),
                    row.retry ? recordLink(cmUi("同参返回", "Same-input return"), row.retry, row)
                      : h("span", { className: "av-hint" }, cmUi("未见同参返回", "No same-input return recorded")))))),
              group.calls > group.rows.length ? h("p", { className: "av-hint" },
                cmUi("仅列最近 " + group.rows.length + " 次", "Showing the " + group.rows.length + " most recent calls")) : null)))
            : h("p", { key: "empty", className: "av-hint" }, execution.errors
              ? cmUi("报错分类暂不可用", "Error breakdown unavailable")
              : cmUi("这个范围内未记录工具报错", "No tool errors were recorded in this scope")),
          h(EvalToolTiming, { key: "timing", timing: execution.timing, recordLink }),
          h(EvalToolChecks, { key: "checks", execution, metrics, recordLink }),
          h("details", { key: "basis", className: "av-eval-proof" }, [
            h("summary", { key: "s" }, cmUi("统计口径", "How this is counted")),
            h("p", { key: "rates", className: "av-eval-counts" },
              h("span", null, cmUi("结果覆盖率 ", "Result coverage ") + pct(execution.outcomeCoverage),
                execution.calls ? " (" + execution.known + "/" + execution.calls + ")" : ""),
              h("span", null, cmUi("已知结果中报错占比 ", "Error share among known results ") + pct(execution.errorRate),
                execution.known ? " (" + execution.errors + "/" + execution.known + ")" : "")),
            h("p", { key: "text", className: "av-hint" }, cmUi(
              "按轨迹树记录的调用计数。报错按已有分类分组。每条报错只在同轮、同工具、完整参数相同的后续调用有非报错返回时计一次同参恢复。",
              "Counts calls recorded in Trajectory Tree. Errors use the existing categories. Each error counts as recovered when a later call in the same turn uses the same tool and full arguments and records a non-error return.")),
          ]),
        ]) : null,
        sessionId ? h("details", { key: "ops", className: "av-eval-proof", onToggle: event => setExpanded(event.currentTarget.open) }, [
          h("summary", { key: "s" }, cmUi("运行证据", "Runtime evidence")),
          expanded ? h(AnalysisPanel, { ...props, key: "digest" }) : null,
        ]) : null,
      ]);
    }

    /* ---------------- 注册 ---------------- */
    function AnalysisSnapshotBuilder() {
      this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: { nodes: 0, upserts: 0 } };
    }
    AnalysisSnapshotBuilder.prototype.replace = function () { return this.snap; };
    AnalysisSnapshotBuilder.prototype.apply = function () { return this.snap; };
    AnalysisSnapshotBuilder.prototype.snapshot = function () { return this.snap; };

    return {
      inject: ["slots", "uiConversation", "commandUi", "sessions", "conversation"],
      apply(ctx) {
        clientCtx = ctx;
        ctx.commandUi.register({
          name: "trajectory",
          label: () => cmUi("轨迹树", "Trajectory Tree"),
          description: () => cmUi("打开当前会话的路径与上下文视图", "Open the current session's action path and context view"),
          available: (session) => typeof session.sessionId === "string" && session.sessionId.length > 0,
          ui: {
            kind: "action",
            run(session) {
              const url = new URL("/analysis-view/trace", window.location.href);
              url.searchParams.set("session", session.sessionId);
              url.searchParams.set("staged", "1");
              window.open(url.href, "_blank", "noopener,noreferrer");
            },
          },
        });
        if (typeof ctx.effect === "function") ctx.effect(() => () => {
          clearTimeout(traceFrame.expiry);
          for (const entry of traceDetails.values()) if (!entry.settled) entry.controller.abort();
          traceFrame.layer?.remove();
          Object.assign(traceFrame, { element: null, layer: null, session: null, ready: false, version: null });
          traceDetails.clear();
        }, "analysis-view: retained trace frame");
        ctx.uiConversation.views.register({ target: "analysis", create: () => new AnalysisSnapshotBuilder(), isActive: () => true });
        const slots = ctx.slots;
        if (!slots) return;
        ctx.uiConversation.views.register({ target: "path", create: () => new AnalysisSnapshotBuilder(), isActive: () => true });
        slots.inject("conversation.view", () => slots.register({
          name: "conversation.view",
          id: "path",
          order: 30,
          label: () => cmUi("轨迹树", "Trajectory Tree"),
          children: {},
          inject: (sessionId) => ({ sessionId }),
        }, PathView));
        slots.inject("conversation.view", () => slots.register({
          name: "conversation.view",
          id: "analysis",
          order: 40,
          label: () => cmUi("评估", "Eval"),
          children: {},
          inject: (sessionId) => {
            const target = ctx.uiConversation.binding(sessionId).target("trajectory");
            return { hooks: { trajectory: { getSnapshot: () => target.getSnapshot(), subscribe: (listener) => target.subscribe(listener) } }, sessionId };
          },
        }, EvalDashboardPanel));
      },
    };
  },
});
