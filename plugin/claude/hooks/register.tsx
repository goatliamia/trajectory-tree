import type { EngineInterface, Register, RenderSurface } from 'claude-code'

let transcriptBinding: { id: string; path: string } | null = null

async function findGenerator($: EngineInterface): Promise<string | null> {
  const cwd = await $.session.cwd()
  const candidates = [
    `${$.plugin.root}/scripts/trajectory-view.mjs`,
    `${$.plugin.root}/../../scripts/trajectory-view.mjs`,
    `${cwd}/scripts/trajectory-view.mjs`,
  ]
  for (const path of candidates) {
    if (await $.fs.exists(path)) return path
  }
  return null
}

async function getHome($: EngineInterface): Promise<string | null> {
  try {
    const home = await $.env.get('HOME')
    if (home) return home
  } catch {
    // not set
  }
  try {
    const profile = await $.env.get('USERPROFILE')
    if (profile) return profile
  } catch {
    // not set
  }
  return null
}

async function deriveTranscriptPath($: EngineInterface): Promise<string | null> {
  const id = await $.session.id()
  if (!id) return null
  const home = await getHome($)
  if (!home) return null
  const projectsDir = `${home.replace(/[\\/]+$/, '')}/.claude/projects`
  let entries
  try {
    entries = await $.fs.list(projectsDir)
  } catch {
    return null
  }
  for (const entry of entries) {
    const candidate = `${projectsDir}/${entry.name}/${id}.jsonl`
    if (await $.fs.exists(candidate)) return candidate
  }
  return null
}

async function resolveTranscript($: EngineInterface): Promise<string | null> {
  const id = await $.session.id()
  if (transcriptBinding?.id === id && await $.fs.exists(transcriptBinding.path)) return transcriptBinding.path
  const derived = await deriveTranscriptPath($)
  if (derived) transcriptBinding = { id, path: derived }
  return derived
}

type ViewJson = { ok?: boolean; url?: string; error?: string }

function parseViewJson(stdout: string): ViewJson | null {
  const lines = stdout.trim().split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const value = JSON.parse(lines[i])
      if (value && typeof value === 'object') return value as ViewJson
    } catch {
      // not the JSON line
    }
  }
  return null
}

function failureDetail(result: { exitCode: number; stdout: string; stderr: string }): string {
  const text = result.stderr.trim() || result.stdout.trim()
  return text.slice(0, 300) || `exit code ${result.exitCode}`
}

let generating = false

async function openView(
  $: EngineInterface,
  kind: 'trace' | 'eval' | 'code',
  surface?: RenderSurface,
): Promise<void> {
  if (generating) {
    $.ui.toast('Trajectory Tree: still generating the previous view.')
    return
  }
  generating = true
  try {
    const transcript = await resolveTranscript($)
    if (!transcript) {
      $.ui.toast('Trajectory Tree: transcript path is not bound yet — clear or restart the session.')
      return
    }
    const script = await findGenerator($)
    if (!script) {
      $.ui.toast('Trajectory Tree: scripts/trajectory-view.mjs was not found beside the plugin.')
      return
    }
    const args = ['--host', 'claude', '--file', transcript, '--open']
    if (kind === 'eval') args.push('--eval')
    else if (kind === 'code') args.push('--code')
    $.ui.status('Trajectory Tree: generating view…')
    let result
    try {
      result = await $.process.run(['node', script, ...args], { timeoutMs: 120000 })
    } catch (error) {
      $.ui.toast(
        'Trajectory Tree: ' + (error instanceof Error ? error.message : 'view generation failed.'),
      )
      return
    } finally {
      $.ui.status(undefined)
    }
    const parsed = parseViewJson(result.stdout)
    if (parsed?.ok && parsed.url) {
      const copied = await $.ui.copy({ text: parsed.url, surface })
      $.ui.toast(
        copied.isCopied
          ? 'Trajectory Tree: view opened, link copied.'
          : 'Trajectory Tree: view opened, but the link could not be copied.',
      )
      return
    }
    $.ui.toast('Trajectory Tree: ' + (parsed?.error ?? failureDetail(result)))
  } catch (error) {
    $.ui.toast(
      'Trajectory Tree: ' + (error instanceof Error ? error.message : 'view generation failed.'),
    )
  } finally {
    generating = false
  }
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    if (e.transcript_path) transcriptBinding = { id: e.session_id || await $.session.id(), path: e.transcript_path }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const previous = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Button key="trace" onPress={press => void openView($, 'trace', press.surface)}>轨迹树</Button>
        <Button key="eval" onPress={press => void openView($, 'eval', press.surface)}>Eval</Button>
        <Button key="code" onPress={press => void openView($, 'code', press.surface)}>Code</Button>
        {previous}
      </Box>
    )
  })
}
