import type { Diagnostic, LoadedProject, ResearchProject } from './parser.js'
import { parseProject } from './parser.js'
import type { HashFn } from './revision.js'
import { entityFilePath } from './schema.js'

/**
 * Cross-entity domain invariants (architecture §5.2): reference resolution,
 * active evidence references, role/direction consistency, Framing Link
 * endpoints, and the Finding support threshold. Structural problems stay in the parser; this
 * module only rules about relationships between entities.
 */

function diag(path: string, code: string, message: string): Diagnostic {
  return { path, code, message }
}

function refPath(ownerId: string): string {
  return entityFilePath(ownerId) ?? ''
}

/**
 * Issues for one evidence reference list: resolution, active-review state, and
 * role/direction consistency. Shared by project validation and command
 * planning.
 */
export function evidenceRefIssues(
  project: ResearchProject,
  ownerPath: string,
  refs: readonly { id: string; role: 'supports' | 'contradicts' }[] | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const ref of refs ?? []) {
    const evidence = project.evidenceAssertions.get(ref.id)
    if (evidence === undefined) {
      diagnostics.push(diag(ownerPath, 'unknown_reference', `evidence ${ref.id} does not exist`))
      continue
    }
    if (evidence.review_status !== 'machine_reviewed' && evidence.review_status !== 'reviewed') {
      diagnostics.push(
        diag(ownerPath, 'evidence_not_reviewed', `evidence ${ref.id} is ${evidence.review_status}, not reviewed`),
      )
    }
    if (evidence.direction !== ref.role) {
      diagnostics.push(
        diag(
          ownerPath,
          'role_direction_mismatch',
          `evidence ${ref.id} direction ${evidence.direction} does not match role ${ref.role}`,
        ),
      )
    }
  }
  return diagnostics
}

/**
 * Whether a Finding meets the support threshold: at least one reviewed
 * supporting Evidence Assertion reference, or one supporting edge from a
 * validated Result (architecture §5.2 / product design §2.3).
 */
export function findingHasSupport(project: ResearchProject, nodeId: string, refs: readonly { id: string; role: 'supports' | 'contradicts' }[] | undefined): boolean {
  const hasSupportingEvidence = (refs ?? []).some((ref) => {
    if (ref.role !== 'supports') return false
    const evidence = project.evidenceAssertions.get(ref.id)
    return evidence !== undefined && evidence.review_status === 'reviewed' && evidence.direction === 'supports'
  })
  if (hasSupportingEvidence) return true
  return [...project.edges.values()].some(
    (edge) =>
      edge.to === nodeId &&
      edge.relation === 'supports' &&
      project.results.get(edge.from)?.status === 'validated',
  )
}

/** `predicts` is directional: a Finding/Hypothesis yields a Prediction. */
export function predictsEndpointsValid(project: ResearchProject, from: string, to: string): boolean {
  const source = project.nodes.get(from)
  const target = project.nodes.get(to)
  return (
    source !== undefined &&
    (source.kind === 'finding' || source.kind === 'hypothesis') &&
    target?.kind === 'prediction'
  )
}

/**
 * Validate every cross-entity invariant and return the diagnostics. The
 * caller decides how to surface them; a non-empty result means read-only.
 */
export function validateProject(project: ResearchProject): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  for (const node of project.nodes.values()) {
    const path = refPath(node.id)
    diagnostics.push(...evidenceRefIssues(project, path, node.evidence_refs))
    if (node.kind === 'finding' && !findingHasSupport(project, node.id, node.evidence_refs)) {
      diagnostics.push(
        diag(path, 'finding_lacks_support', `finding ${node.id} needs a reviewed supporting assertion or a validated result edge`),
      )
    }
  }

  for (const edge of project.edges.values()) {
    const path = refPath(edge.id)
    if (project.nodes.get(edge.from) === undefined && project.results.get(edge.from) === undefined) {
      diagnostics.push(diag(path, 'unknown_endpoint', `edge endpoint ${edge.from} does not exist`))
    }
    if (project.nodes.get(edge.to) === undefined && project.results.get(edge.to) === undefined) {
      diagnostics.push(diag(path, 'unknown_endpoint', `edge endpoint ${edge.to} does not exist`))
    }
    if (edge.relation === 'predicts' && !predictsEndpointsValid(project, edge.from, edge.to)) {
      diagnostics.push(
        diag(
          path,
          'invalid_predicts_endpoints',
          `predicts edge ${edge.id} must connect a Finding/Hypothesis to a Prediction`,
        ),
      )
    }
    diagnostics.push(...evidenceRefIssues(project, path, edge.evidence_refs))
    if (edge.basis === 'literature') {
      for (const ref of edge.evidence_refs ?? []) {
        const evidence = project.evidenceAssertions.get(ref.id)
        if (evidence !== undefined && evidence.review_status !== 'reviewed') {
          diagnostics.push(
            diag(
              path,
              'literature_evidence_not_human_reviewed',
              `literature edge ${edge.id} requires human-reviewed evidence; ${ref.id} is ${evidence.review_status}`,
            ),
          )
        }
      }
    }
  }

  for (const link of project.framingLinks.values()) {
    const path = refPath(link.id)
    const source = project.nodes.get(link.from)
    if (source === undefined) {
      diagnostics.push(diag(path, 'unknown_endpoint', `framing link source ${link.from} does not exist`))
    } else if (source.kind !== 'hypothesis' && source.kind !== 'finding') {
      diagnostics.push(
        diag(
          path,
          'invalid_framing_source',
          `framing link ${link.id} must start from a Hypothesis or Finding`,
        ),
      )
    }
    if (!project.questions.has(link.to)) {
      diagnostics.push(diag(path, 'unknown_endpoint', `framing link target ${link.to} does not exist`))
    }
  }

  return diagnostics
}

/**
 * Parse and validate in one step: returns the LoadedProject with the merged
 * structural and cross-entity diagnostics.
 */
export function parseAndValidateProject(files: ReadonlyMap<string, string>, hash: HashFn): LoadedProject {
  const project = parseProject(files, hash)
  const diagnostics = [...project.diagnostics, ...validateProject(project)]
  return { ...project, diagnostics }
}
