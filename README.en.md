<h1 align="center"><img src="docs/media/trajectory-tree-cover.png" alt="Trajectory Tree · 轨迹树"></h1>

<p align="center"><strong>See how your agent gets the work done.</strong></p>
<p align="center">Trajectory tree · Eval · Diagnosis from a selection · Visual reports</p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/host-entrypoints.md">Host setup</a> ·
  <a href="LICENSE">MIT License</a>
</p>

<p align="center"><code>DSH</code> &nbsp; <code>Pi</code> &nbsp; <code>Codex</code> &nbsp; <code>Claude Code</code></p>

> Screenshots use reproducible public synthetic examples, with no private conversations. Model A / B illustrate comparisons. [Media and reproduction](docs/media/README.md)

## Trajectory tree

Unfold the session into branches of tools and actions. Open any turn to inspect arguments, results, file changes, subagent relations and context deltas, then follow the linked records to see how the task progressed.

![Execution path with turns, tool branches, file changes and context deltas](docs/media/trajectory-overview-en.jpg)

## Eval

Eval extracts metrics from everyday tasks using the same trace data and cut as the tree. No separate benchmark is required. Session Eval compares turn timing, output, tool latency and errors; the project overview adds progress, model behavior and signals across sessions.

Filter by project, date and model, then compare requests and execution by window occupancy, input size or tool. Select a band to inspect its samples. DSH shows loaded sessions immediately and fills in the remaining data while preserving filters and diagnosis selections.

![Project overview with task progress, goals, deliverables and model comparisons](docs/media/global-eval-en.jpg)

<details>
<summary>Window occupancy comparisons and session metrics</summary>

![Compare request and tool outcomes by model and window occupancy](docs/media/window-comparison-en.jpg)

![Session Eval with turn timing, output and execution duration](docs/media/eval-overview-en.jpg)

</details>

## Follow a failure signal to its execution

**Code execution** brings PowerShell, child-program and PTC code together with host outcomes and feedback. Filter by executor or signal to inspect script positions, evidence, parent/child calls and later returns. The program attributes recognizable signals; the agent investigates the task and environment behind them.

![Code execution analysis with signals, calls, original code and feedback](docs/media/code-execution-en.jpg)

| Case | Evidence to inspect |
| --- | --- |
| PowerShell syntax or argument error | Original script, parser location, outer exit code and specific feedback |
| Edit blocked by a read guard | Target file, later read, same-input edit return and verification |
| A failed PTC child call | Outer program, inner tool and their respective outcomes |
| More errors at high window occupancy | Samples and error distributions for the same model, tool and occupancy band |

## Diagnose a selection

In the DSH tree, hold to select an item or hold and drag to select a region. Context change bars are selectable too. In Eval, start from the chart details, including DSH tool sources and calls. Pick a question to get an editable draft with the session, selection and evidence queries. Review it before sending.

Overview and session Eval also offer **Diagnosis signals**. Program-generated groups suggest directions to investigate: implementation or environment, recovery, capabilities, and reusable methods. Directions can be combined; the agent follows the existing evidence workflow to reach a diagnosis. A same-input return records a later outcome without claiming task completion.

![Choose an investigation direction from recorded signals](docs/media/diagnosis-signals-en.jpg)

<details>
<summary>An action-path selection and editable diagnosis draft</summary>

![A selected step in the DSH action path opens an editable diagnosis draft](docs/media/diagnosis-draft-en.jpg)

</details>

## Deliver the investigation as a report

Reports combine conclusions, Eval metrics from the same cut and original evidence. Connect actions, feedback and verification with flowcharts; show composition with rings; compare distributions, trends and tables. Select chart elements to inspect records and measurement details. The resulting HTML works offline.

![Diagnostic report with reviewed conclusions and an evidence-bound flow](docs/media/diagnostic-report-en.jpg)

<details>
<summary>More examples: context retention and assembly</summary>

- [Context trends](docs/media/context-trend.jpg) show retained material and per-turn changes by source.
- [Context assembly](docs/media/context-assembly.gif) replays appends, retention and rewrites.
- [Report components and authoring](report/AUTHORING.md): evidence bindings, flows, composition, distributions and trends.

</details>

## Quick start

Run commands from the repository root. The plugin packages declare Node.js 18+, but DSH 0.2.2 and later require Node.js 24.9+ for the host itself; other hosts and standalone views require Node.js 20+.

| Host | Session Eval | Project overview | Code execution |
| --- | --- | --- | --- |
| DSH | Evaluation panel in the conversation | Eval overview in the left sidebar | Evaluation → Code execution |
| Pi | `/trajectory --eval` | `/trajectory --overview` | `/trajectory --code` |
| Codex | `$trajectory-eval` | `$trajectory-eval --overview` | `$trajectory-eval --code` |
| Claude Code | `/trajectory-tree:trajectory-eval` | `/trajectory-tree:trajectory-eval --overview` | `/trajectory-tree:trajectory-eval --code` |

The trajectory generation entry in Pi, Codex and Claude Code also accepts `--eval`, `--overview` or `--code`. DSH uses its persistent panels. [All host entry points](docs/host-entrypoints.md)

<details>
<summary><strong>DSH · Native plugins and analysis panel</strong></summary>

```sh
npm pack ./plugin/trajectory-tools
npm pack ./plugin/analysis-view
dsh plugin --profile web add ./dsh-trajectory-tools-0.6.7.tgz ./dsh-analysis-view-0.10.147.tgz
```

Restart `dsh web`, then open **Eval** or use `/trajectory` for the current session's path. Choose a diagnostic question and select **Fill conversation** to append the draft to the composer. The plugins target the DSH 0.2.2 line; see the [host compatibility notes](docs/host-compatibility.md#dsh-version).

Open **Eval overview** in the local DSH Web left sidebar to compare progress, model behavior, and tool errors across projects. The context section compares request and tool metrics by window occupancy.

Select a goal line in the overview to open that goal. Select an event marker to inspect that change and open the associated turn in the action path or conversation.
Trajectory Tree estimates seven categories of request context from DSH session records and shows changes by turn and step. Eval and the evidence tools share the samples. Reported input is shown separately.

Open **Trajectory Tree** in DSH's plugin manager to configure right-sidebar conversation search, default trace layers, and the Eval tool sort. Search starts enabled and covers the full session. Load older matches and select a result to jump to its turn. DSH on-demand interpretation calls the current model. Disable the default post-compaction check-in with `config.reconcile: false`.

[Analysis panel](plugin/analysis-view/README.md) · [Evidence tools](plugin/trajectory-tools/README.md)

</details>

<details>
<summary><strong>Pi · Selected branch and native command</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
pi -e ./plugin/portable-tools
```

Use `/trajectory` for the selected branch or `/trajectory --eval` for Eval. Copy the Pi draft command back into the terminal. If the editor already contains a draft, copy the prompt text and merge it yourself. Use `trace-analysis` for the session process and `context-profile` for current context and tool configuration.

[Pi setup](plugin/portable-tools/README.md#pi)

</details>

<details>
<summary><strong>Codex · Plugin, MCP and standalone views</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host codex
```

Install `dist/trajectory-tree-codex` from the local plugin directory. Use `$trajectory-view` for the tree, `$trajectory-eval` for Eval, or `$trace-analysis` and `$context-profile` for analysis. Copy an Eval draft back into the Codex composer.

Generate a view directly for the current session; local session reads require the official `codex app-server`:

```sh
node scripts/trajectory-view.mjs --host codex --serve
```

Use `trajectory_command_diagnose` to inspect a command failure at the same log cut. Optional syntax inspection supports Windows PowerShell 5.1 and PowerShell 7. [Command diagnostics setup](docs/host-entrypoints.md#命令诊断)

Open **Compare changes** from an action or file history to switch between changed files, read added and removed lines with the recorded line numbers, or see the raw patch.

[Plugin entry points](docs/host-entrypoints.md) · [Codex / MCP setup](plugin/portable-tools/README.md#codex)

</details>

<details>
<summary><strong>Claude Code · Native plugin and transcript</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host claude
claude --plugin-dir ./dist/trajectory-tree-claude
```

Use `/trajectory-tree:trajectory-view` or `/trajectory-tree:trajectory-eval` to open a view, then copy a diagnosis draft back into Claude Code. The plugin provides the current transcript path at session startup, resume and related lifecycle events.

[Claude Code setup](plugin/claude/README.md)

</details>

### Generate an offline view

```sh
node scripts/trajectory-view.mjs --host pi --file /absolute/session.jsonl --open
node scripts/trajectory-view.mjs --host claude --file /absolute/transcript.jsonl --eval --lang en --open
```

Generation does not call a model. The command returns a standalone HTML file and a local preview URL; fonts are embedded for offline viewing.

The trajectory tree, Eval and diagnostic drafts follow the host or browser language. Choose Auto / 中文 / English in the tree, or pass `--lang en` or `--lang zh-CN` for a standalone view. Quoted logs, paths and arguments keep their original text. See [host compatibility and language selection](docs/host-compatibility.md) for available evidence and supported capabilities.

## One set of evidence tools

| Tool | Purpose |
| --- | --- |
| `trajectory_inspect` | Inspect the process, latency, usage, repeated attempts, tools/files and context |
| `trajectory_search` | Locate sessions, literal records and statistical scopes |
| `trajectory_read` | Read originals, connected actions and feedback; continue through full arguments and results |
| `trajectory_graph` | Inspect record relations and session lineage |

Use `outcome` to filter calls by result. This query counts recorded errors by tool. Use `abnormal` to also include calls with an unconfirmed result.

```json
{"view":"io","groupBy":"tool","outcome":"error","sort":"count"}
```

Queries are read-only. Each host exposes its recorded evidence; missing content remains unknown.

| Host | Main data sources |
| --- | --- |
| DSH | Native events, official statistics, context composition, files, Skills and subagents |
| Pi | Selected branch, current SDK configuration and captured execution timing |
| Codex | Official session APIs and matching local thread records |
| Claude Code | An explicitly selected transcript, native tool arguments/results and recorded message usage |

## Documentation

- [Feature index](docs/INDEX.md) · [Code map](docs/code-map.md) · [Design archive](docs/archive/README.md)
- [Host setup and commands](docs/host-entrypoints.md)
- [Tool configuration, queries and continued reads](plugin/portable-tools/README.md)
- [Analysis methods](skill/trace-analysis/SKILL.md) · [Context and configuration profile](skill/context-profile/SKILL.md)
- [HTML report components](report/AUTHORING.md)

<details>
<summary>Development and checks</summary>

```sh
node scripts/sync-host-skills.mjs --check
node scripts/sync-view-assets.mjs --check
npm test --prefix plugin/trajectory-tools
npm test --prefix plugin/portable-tools
node plugin/analysis-view/presentation-test.mjs
node plugin/analysis-view/perf-test.mjs
```

`plugin/` provides host integrations, `analyzers/` reads native records, and `view/` plus `report/` provide visualizations. Recreate the public showcase pages with `node scripts/build-readme-media.mjs --serve 3099`.

</details>

## License

[MIT](LICENSE) © 2026 goatliamia

Trajectory Tree and Eval bundle Geist Sans and Geist Mono by Vercel in collaboration with basement.studio. The fonts are licensed under the SIL Open Font License 1.1. [Geist website](https://vercel.com/font) · [Bundled font license](plugin/analysis-view/lib/trace/fonts/LICENSE.txt)
