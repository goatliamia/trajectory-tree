# Shared views, host capabilities and language

The four hosts use the same trajectory document, renderer and report components. Geometry, navigation, files, goal markers, context trends and report bindings use shared evidence. [Page assembly](../plugin/analysis-view/lib/trace/presentation.mjs) inserts the host adapter at one extension point. DSH supplies its [live data bridge](../plugin/analysis-view/lib/trace/dsh-bridge.js) and [conversation actions](../plugin/analysis-view/lib/trace/dsh-presentation.js). Portable hosts boot directly from a snapshot and add explanations for their own native records.

| Capability | DSH | Pi | Codex | Claude Code |
| --- | --- | --- | --- | --- |
| Execution unit | Native model step | Assistant cycle | Visible action | Assistant record |
| Tool intervals | Official recorded intervals | Validated start/end capture | Matching local rollout timestamps | Not reconstructed from transcript order |
| Native duration without intervals | Kept separately | Kept separately | Kept separately | Missing stays unknown |
| Context sources | Request composition estimates | Retained branch text estimates | Retained rollout text estimates | Visible transcript text estimates |
| Request usage | Official statistics | Recorded assistant usage | Optional local response telemetry | Message usage, deduplicated by message ID |
| Child execution history | Load on demand when available | No invented history | Delegation metadata; child completion remains unknown | No invented history |
| Jump to host conversation | Supported in native frame | Disabled | Disabled | Disabled |
| Bring a diagnostic draft back | Append to the composer | Load with the copied Pi command or paste the text | Copy and paste | Copy and paste |

`lib/host-capabilities.mjs` describes these boundaries. Frame embedding alone does not authorize DSH-specific actions. Missing evidence is not zero. A cumulative duration does not supply an execution interval; interval coverage unions overlaps and excludes idle gaps. Unknown model timing is not classified as “other” time.

Portable pages retain the shared light/dark theme rules and responsive viewport layout. The old research-only fixed graph heights are not applied. English source names can wrap inside their existing grid cells.

## Automatic language selection

The trajectory tree, Eval and their diagnostic drafts choose a language automatically. Pass `?lang=en` or `?lang=zh-CN` in the URL, or set `--lang` when exporting a portable page. Selection order:

1. Explicit `?lang=en|zh-CN` or CLI `--lang en|zh-CN`.
2. A saved manual interface preference.
3. The same-origin host's current interface language, when embedded.
4. The first supported entry in the browser's language preferences.
5. English.

`?lang=auto` returns to automatic selection, bypassing a fixed export language and a saved manual preference. Chinese variants use Simplified Chinese and English variants use English.

DSH's locale service synchronizes `document.documentElement.lang`. Its panel observes that attribute and preference changes, and the two view frames follow the same-origin host language. Independent HTML files need no host API or model call. When the host or browser language changes in automatic mode, the view reloads in the new language.

This follows the explicit-preference and browser-fallback pattern used by [i18next](https://github.com/i18next/i18next-browser-languageDetector) and [next-intl](https://next-intl.dev/docs/routing/middleware). The implementation remains dependency-free for offline HTML.

```sh
node scripts/trajectory-view.mjs --host codex --serve --lang auto
node scripts/trajectory-view.mjs --host pi --file session.jsonl --eval --lang en
node scripts/trajectory-report.mjs render --markdown report.md --bundle bundle.json --output report.html --lang en
```

Interface language and report prose are separate. AI-authored reports follow the user's current request or explicit language instruction. Quoted messages, tool arguments/results, paths and identifiers remain verbatim. UI literals are translated before inserting evidence; the renderer does not translate the completed DOM or the source dataset. Stored annotations are presented from structured calls in the selected language while retaining native facts, operation metadata and diffs.

## Diagnostic changes and verification

The prior code-relations findings about goal-event imports, versioned caching and npm file coverage are covered by the existing native regression tests. The remaining eager turn-row work in portable inspection is now lazy and shared within each query. The analyzer's native comparison harness was rerun against the prior source: all 264 complete JSON responses matched; 126 scenarios used fewer filter predicates, with no callback-count regression. This is a synchronous work-count comparison, not a wall-clock performance claim.

Portable inspection now accepts `samples: false` for compact summary rows. It preserves statistics and frozen-cut read pointers, and cursor continuation retains the selection. Data-format output retains its original data contract.

```sh
node lib/i18n-test.mjs
node view/test.mjs
node view/assets/pi-host-test.mjs
node view/assets/codex-host-test.mjs
node analyzers/claude-host-test.mjs
node report/test.mjs
node plugin/analysis-view/self-test.mjs
node plugin/analysis-view/presentation-test.mjs
node --test plugin/analysis-view/goal-events-test.mjs plugin/analysis-view/stages-test.mjs plugin/analysis-view/resources-test.mjs
npm test --prefix plugin/portable-tools
npm test --prefix plugin/trajectory-tools
```

Rebuild shared assets and all three portable packages after changing presentation code. `dist/` is generated and ignored by Git. Updating the installed DSH plugin remains a separate installation step.

## DSH version

Checked against the installed runtime `0.2.2-alpha.2` and the published `0.2.2-rc.1` (2026-11-04, the first candidate of the 0.2.2 line). This is a static comparison of the release artifacts, not a run against a booted `0.2.2-rc.1`.

| Package | `0.2.2-alpha.2` → `0.2.2-rc.1` |
| --- | --- |
| `dsh-tools` | package.json only; `defineTool` and `ctx.tools.register` unchanged |
| `dsh-session` | package.json only |
| `dsh-session-projection` | adds the `onEventChanged` event feed; deprecates `cachedSnapshot`; `snapshot()` computes only the requested units; `restore()` keeps its signature and synchronous return |
| `dsh-session-projection-cache` | identical, including `cachedSnapshot(header, keys)` |
| `dsh-token-meter` | `summary: false` added to the `contextBreakdown` and `contextPressure` projections; the `estimate` entry point is unchanged |
| `dsh-client-ui-slots` | identical |
| `dsh-client-ui-conversation` | slot-contract comments only |
| `dsh-client-ui-commands` | drops the `builtinCommandName` and `resolveCommand` client exports; `register(contribution)` is unchanged |

The update also raises the minimum Node.js version to 24.9.

One behaviour to verify after upgrading: `contextBreakdown` and `contextPressure` are no longer part of a Session's summary key set. The panel reads them through `useProjection("contextBreakdown")` and `useProjection("contextPressure")`, so it should still receive them; a reader that took them from the summary instead would stop seeing them.
