# Claude Code host

Build with `node scripts/package-trajectory.mjs --host claude`, then load using `claude --plugin-dir ./dist/trajectory-tree-claude`. Commands are `/trajectory-tree:trajectory-view`, `/trajectory-tree:trajectory-eval`, `/trajectory-tree:trace-analysis`, and `/trajectory-tree:context-profile`.

The SessionStart hook provides the current `session_id` and `transcript_path` to Claude at startup, resume, clear, compaction, or fork. Use the exact path with `--host claude --file <transcript>` in the Trajectory Tree CLI. Parallel sessions do not share a current-session file. The hook does not read the transcript or send it anywhere.

The reader opens only the explicit local file. It includes visible user and assistant text, tool calls/results, and recorded message usage. It does not reconstruct branches, subagent transcripts, complete model requests, or context composition. An incomplete final JSONL line is excluded. Use results as partial evidence.

Use `/trajectory-tree:trajectory-eval` to open Eval for the bound transcript. To open a specific transcript from a terminal, run `node scripts/trajectory-view.mjs --host claude --file "<transcript_path>" --eval --serve` and open the returned local URL. The view uses the transcript revision captured at generation. Tool outcomes, same-input returns, file calls and recorded usage are observations. Execution duration, full request composition and task completion require other evidence.

Pass `--code` to the view or Eval command to open code execution directly. Use `--overview` for the bound transcript's project directory, or choose explicit files. The generated views include the shared diagnosis signals and use the same source cut for the copied evidence draft.

For diagnosis, select a scope in Eval and review the copied `/trajectory-tree:trace-analysis` draft in Claude Code. Use its transcript path and log identity when querying a record sequence. If the transcript changed, verify a reference against its native line or tool ID, or regenerate Eval for the new revision.

The installed plugin must include the hook script and generated skills; see the repository packaging workflow. Claude Code needs Node.js on PATH to run the hook and CLI. No Claude model call is needed for reading a transcript.

See the [Claude Code hooks reference](https://code.claude.com/docs/en/hooks), [plugin manifest reference](https://code.claude.com/docs/en/plugins-reference) and [skills reference](https://code.claude.com/docs/en/skills) for the host contracts.
