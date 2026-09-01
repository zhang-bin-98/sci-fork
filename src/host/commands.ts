import {
  initProject,
  loadProjectState,
  type ResearchMutationDeps,
} from './apply-command.js'
import type { CommandInvocation, CommandResult, CommandsPort } from './contracts.js'

/**
 * Human slash commands (architecture §7.3): `/research init`, `/research
 * open`, `/research validate`. The project root always comes from the
 * invoking session's cwd; results never include local absolute paths.
 */

export interface ResearchCommandsDeps extends ResearchMutationDeps {
  commands: CommandsPort
  mkdirs?(root: string): void
}

const USAGE = 'usage: /research init | open | validate'

async function handle(deps: ResearchCommandsDeps, invocation: CommandInvocation): Promise<CommandResult> {
  const subcommand = invocation.rawInput.trim()
  const session = invocation.agent?.session
  const sessionCwd = session?.header.cwd

  if (subcommand === 'init') {
    const result = await initProject(deps, { session, signal: invocation.signal })
    if (!result.ok) {
      return { kind: 'error', text: `${result.code}: ${result.message}` }
    }
    return {
      kind: 'success',
      text:
        `SciFork research project "${result.name}" initialized (project_id ${result.projectId}).\n` +
        `Baseline checkpoint ${result.checkpointId.slice(0, 12)} created on the current branch.`,
    }
  }

  if (subcommand === 'open') {
    return {
      kind: 'success',
      text: 'Use the Open Research Graph action in DSH to launch the Companion.',
    }
  }

  if (subcommand === 'validate') {
    const context = await loadProjectState(deps, sessionCwd, invocation.signal)
    if (!('root' in context)) {
      return { kind: 'error', text: `${context.code}: ${context.message}` }
    }
    const { project, branch, head } = context
    const diagnostics = project.diagnostics
    const lines: string[] = []
    if (diagnostics.length === 0) {
      lines.push('Research project is valid.')
    } else {
      lines.push(`Research project has ${diagnostics.length} diagnostics (read-only):`)
      for (const diagnostic of diagnostics.slice(0, 10)) {
        lines.push(`- ${diagnostic.path || 'project'}: ${diagnostic.code}`)
      }
      if (diagnostics.length > 10) lines.push(`- … ${diagnostics.length - 10} more`)
    }
    lines.push(
      `questions: ${project.questions.size}, framing links: ${project.framingLinks.size}, ` +
        `nodes: ${project.nodes.size}, edges: ${project.edges.size}, ` +
        `evidence: ${project.evidenceAssertions.size}, results: ${project.results.size}`,
    )
    lines.push(`revision: ${project.projectRevision}`)
    if (branch !== undefined && head !== undefined) {
      lines.push(`branch: ${branch}, head: ${head.slice(0, 12)}`)
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  return { kind: 'error', text: USAGE }
}

export function registerResearchCommands(deps: ResearchCommandsDeps): () => void {
  return deps.commands.register({
    name: 'research',
    description: 'Manage the SciFork Research Graph: init, open, or validate the current project.',
    input: { hint: 'init | open | validate' },
    handler: (invocation) => handle(deps, invocation),
  })
}
