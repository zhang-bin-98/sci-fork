import type { SubprocessPort } from './contracts.js'

/** Fixed executable name resolved through the provider's scrubbed PATH. */
export const GIT_EXECUTABLE = 'git'

/** Termination grace for Git probes (SIGTERM → SIGKILL escalation window). */
export const GIT_GRACE_MS = 5000

/** Cap for collected stdout/stderr on Git probes. */
const GIT_OUTPUT_LIMIT = 64 * 1024

/**
 * Build one argv-only Git spec. Git is always invoked as a program with
 * explicit arguments; no shell string, no `-c`, no option injection from
 * research content.
 */
export function buildGitArgv(
  gitExecutable: string,
  args: readonly string[],
  cwd: string,
): { argv: readonly string[]; cwd: string } {
  if (!gitExecutable) throw new Error('scifork: git executable must not be empty')
  if (!cwd) throw new Error('scifork: git cwd must not be empty')
  for (const arg of args) {
    if (arg.includes('\0')) throw new Error('scifork: git argument contains NUL byte')
  }
  return { argv: [gitExecutable, ...args], cwd }
}

/**
 * Parse `git rev-parse --show-toplevel` output: exactly one absolute path.
 * Anything else (empty, multiple lines) is not a usable answer.
 */
export function parseRevParseToplevel(output: string): string | undefined {
  const trimmed = output.trim()
  if (!trimmed || trimmed.includes('\n')) return undefined
  return trimmed
}

/**
 * Run `git rev-parse --show-toplevel` in `cwd` through the DSH subprocess
 * service. Returns the repository top-level directory, or undefined when the
 * directory is not a repository or the output is ambiguous.
 */
export async function gitShowToplevel(
  subprocess: SubprocessPort,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const executable = await subprocess.resolveExecutable(GIT_EXECUTABLE, undefined, signal)
  const spec = {
    ...buildGitArgv(executable, ['rev-parse', '--show-toplevel'], cwd),
    stdio: {
      stdin: 'ignore' as const,
      stdout: { maxBytes: GIT_OUTPUT_LIMIT },
      stderr: { maxBytes: GIT_OUTPUT_LIMIT },
    },
    graceMs: GIT_GRACE_MS,
    ...(signal !== undefined ? { signal } : {}),
  }
  const handle = subprocess.spawn(spec)
  const outcome = await handle.done
  if (outcome.exitCode !== 0) return undefined
  const text = handle.collected.stdout?.readFrom(0).text ?? ''
  return parseRevParseToplevel(text)
}
