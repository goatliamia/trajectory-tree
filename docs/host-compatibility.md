# Shared views, host capabilities and language

The four hosts use the same trajectory document, renderer and report components. Geometry, navigation, files, goal markers, context trends and report bindings use shared evidence. [Page assembly](../plugin/analysis-view/lib/trace/presentation.mjs) inserts the host adapter at one extension point. DSH supplies its [live data bridge](../plugin/analysis-view/lib/trace/dsh-bridge.js) and [conversation actions](../plugin/analysis-view/lib/trace/dsh-presentation.js). Portable hosts boot directly from a snapshot and add explanations for their own native records.

| Capability | DSH | Pi | Codex | Claude Code |
| --- | --- | --- | --- | --- |
| Execution unit | Native model step | Assistant cycle | Visible action | Assistant record |
| Tool intervals | Official recorded intervals | Validated start/end capture | Matching local rollout timestamps | Not reconstructed from transcript order |
| Native duration without intervals | Kept separately | Kept separately | Kept separately | Missing stays unknown |
| Tool failure evidence | Native error codes and direct/PTC result text | Recorded tool result and typed details, when present | Aggregated output and the recorded command exit code | `tool_result` content and typed shell metadata for a single paired result |
| Context sources | Request composition estimates | Retained branch text estimates | Retained rollout text estimates | Visible transcript text estimates |
| Request usage | Official statistics | Recorded assistant usage | Optional local response telemetry | Message usage, deduplicated by message ID |
| Child execution history | Load on demand when available | No invented history | Delegation metadata; child completion remains unknown | No invented history |
| Jump to host conversation | Supported in native frame | Disabled | Disabled | Disabled |
| Bring a diagnostic draft back | Append to the composer | Load with the copied Pi command or paste the text | Copy and paste | Copy and paste |
| Project Eval overview | Native left sidebar and registered workspaces | Selected branch and recent sessions in its directory | Indexed project threads or explicit snapshots | Explicit transcripts or their directory |

`lib/host-capabilities.mjs` describes these boundaries. Frame embedding alone does not authorize DSH-specific actions. Missing evidence is not zero. A cumulative duration does not supply an execution interval; interval coverage unions overlaps and excludes idle gaps. Unknown model timing is not classified as “other” time.

Portable pages retain the shared light/dark theme rules and responsive viewport layout. The old research-only fixed graph heights are not applied. English source names can wrap inside their existing grid cells.

The portable overview compares reported input bands and recorded tool results. Codex offers occupancy bands when usage and window capacity belong to the same turn's recorded request. Pi and Claude history retain the input and tool comparisons without borrowing a current model capacity for historical requests.

Eval and overview count attribution among recorded tool errors in the selected scope. Both use the same rule set and separate recognized feedback, tentative explanations, unclassified output and empty text. Coverage depends on the tasks and the evidence each host records. Optional PowerShell parsing can add a location or a tentative explanation to the evidence details.

DSH's PowerShell renderer reports non-zero process exits in the returned text without necessarily setting a tool error. The findings projector separately preserves those command markers, original tool status and command evidence. Command feedback does not change the tool-error denominator or the native same-argument error/return pairs. The preset Demo can enrich at most 12 observations per session with the configured CR PowerShell parser, retaining its version, source hash and coverage state; historical scripts are never executed by this enrichment. Its diagnostic drafts include exact source/cut queries and PowerShell, disposition and context-supply methods. All four investigation directions are selectable independently of the program's suggested directions.

Codex analysis replaces inline Base64 images in App Server responses, saved snapshots and local rollouts with a compact reference. It keeps the surrounding record, image type, encoded size and a digest. Native request usage still comes from the host's telemetry.

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

Interface language and report prose are separate. AI-authored reports follow the user's current request or explicit language instruction. Quoted text, paths and identifiers retain their source wording. UI literals are translated before inserting evidence. Stored annotations are presented from structured calls in the selected language while retaining native facts, operation metadata and diffs.

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

### 0.2.2-rc.3 (2026-11-14)

The local npm CLI is now `0.2.2-rc.3`. Its version, a native PTY child, the 34 source-derived consumer goals and the existing Skill/tool lifetime fixtures pass. The published upgrade index adds no rc.2-specific migration section. The linked view bundle is `0.11.0`, and the evidence/Skill bundle is `0.6.8`; an already-running host must reload these modules or restart before it uses them.

The preset Eval workspace is served at the existing native `/analysis-view/overview` entry. It reads the launcher-owned profile and registered workspaces, progressively projects native session observations, and ships its UI and collector dependencies inside the package. It does not read the optional Stats page or depend on the standalone Demo server. Current configuration remains a static, explicitly timed snapshot; dynamic request assembly is not inferred from registered source text.

Restart reuse is versioned by the projector graph, host installation and persistence revision. Model identities are restored from each saved catalog. Live sequence numbers alone never authorize cross-process reuse. Configuration may first show a last-known snapshot marked as being checked; management previews always await a fresh read. [Review and validation](release-review.md)

Pi `1.5.2` and Claude Code stable `2.1.311` were installed through their official paths, and Trajectory Tree `0.2.4` was registered locally. Portable adapters now actually produce tool measures and recorded error locations before display truncation. Pi's native `powershell` tool and CC's capitalized tool names retain their identity. The new preset Eval homepage is DSH-only; existing portable views remain shared.

### 0.2.2-rc.2 (2026-11-13)

The local npm CLI is upgraded from `0.2.2-rc.1` to `0.2.2-rc.2`. The installed CLI version, shared `HarnessError` identity and a native PTY child were checked. Both installed Trajectory Tree bundles resolve to this workspace; existing DSH processes need a restart to load the updated host and plugin modules.

The CR upgrade replay was run against the current consumer, using the exact published rc.1/rc.2 artifacts and their integrity receipts. All 31 cases and 12 assertions pass after adaptation. The four native approval/context identities no longer collapse into one unknown label; existing confirmed labels, normal/PTC failure status, future unknowns and mixed-SDK missing identity remain bounded by their evidence.

| Surface | Adaptation or verification |
| --- | --- |
| Tool failures | Preserve rejection, cancellation, unavailable approval channels, missing runtime context, unknown tools, availability-check failures, invalid outputs and unsupported schemas. Explicit approval decisions do not imply a repair or recovery recommendation. Recorded host error counts remain intact. |
| Attachments | Recognize the 17 published attachment/image error codes without treating arbitrary future codes as known. This follows the attachment-error migration guide. |
| Named subagents | Keep the catalog name separately from the task label, direct-parent ownership and same-cut child catalog facts. Use each observation's `inheritedEventCount` to exclude inherited entries; a recorded end-seed boundary is only a fallback when the floor is unavailable. This preserves nested relationship evidence; it does not recursively load every descendant. |
| Child settlement | Preserve `stopReason` and use the latest settlement. Aborted, refused, failed and token-limited runs are not completed; missing or future reasons remain unknown. |
| Session batches | Native single/array `append` and the consumer's event projection pass. The plugin observes `session/event` and does not replace `Session.append`; the published runtime still notifies per event. |
| Runtime context | Read `source.kind/form/sections`; reminder framing and an explicit empty snapshot retain their identity. Existing stored logs are not rewritten. |
| Current configuration | The read-only demo builder works with rc.2 and discovers `dsh-doc`, which replaces the four former Creator skills. Agent Experience content is now `dsh-doc/references/tool-design.md`. |
| Other surfaces | No removed `getAnchorRect` or `Session.append` replacement is used. Account, Forge, CUA provider and terminal-backend migrations do not apply to these two bundles' imports and configuration. |

`node scripts/check-dsh-rc2-surfaces.mjs --assert` checks 34 additional source-derived goals using the installed native constructors and the actual consumers. CR's goal comparison also passes for these responses. Query, native view, staged delivery, bounded actor reads/cache and context-evidence regressions passed. Private receipts and before/after CR reports are under `.dsh/dsh-rc2-review/`; this is not a claim of complete live-host UI or unrelated third-party plugin compatibility.

### Earlier rc.1 review

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

### Optional DSH data sources

The tree, conversation search and core Eval metrics use recorded session events. The built-in token meter supplies context occupancy and the current three-category estimate.

The tree and Eval derive elapsed and tool timing from recorded intervals and model timing from native step starts and assistant streams. Eval and the evidence tools can also replay the official Stats definitions shipped with DSH for supplementary step statistics. The experimental Inspector bundle can stay disabled.

Trajectory Tree rebuilds its seven-category request history from the durable DSH surface and the built-in token-meter estimator. The pre-response surface is the estimate anchor and the latest recorded request header supplies tool definitions. The tree, Eval and evidence queries use the same sampler. Provider-reported input is a separate field.
