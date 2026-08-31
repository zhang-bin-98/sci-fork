import matter from 'gray-matter'
import yaml from 'js-yaml'
import type { HashFn } from './revision.js'
import { projectRevision } from './revision.js'
import {
  BODY_MAX,
  MANIFEST_FILE,
  normalizeDoi,
  parseEdgeFile,
  parseEvidenceData,
  parseFramingLinkFile,
  parseManifest,
  parseNodeData,
  parseQuestionData,
  parseResultData,
  isValidManagedFileName,
  type EdgeFile,
  type EvidenceData,
  type FramingLinkFile,
  type NodeData,
  type QuestionData,
  type ResearchManifest,
  type ResultData,
  utf8ByteLength,
} from './schema.js'

/**
 * Parse a Research Project from a relative-path → content file map into a
 * LoadedProject. Pure: file access and hashing are injected by the Host.
 * Untrusted input never throws; problems become diagnostics and the project
 * is read-only while any diagnostic exists.
 */

export interface Diagnostic {
  /** Managed relative path, or '' for project-level problems. */
  path: string
  code: string
  message: string
}

export type ResearchNode = NodeData & { body: string }
export type ResearchQuestion = QuestionData & { body: string }
export type EvidenceAssertion = EvidenceData & { body: string }
export type ResearchResult = ResultData & { body: string }
export type ResearchEdge = EdgeFile
export type FramingLink = FramingLinkFile

/**
 * Architecture §6 projection surface. `manifest` is undefined while the
 * manifest is missing or invalid; every such state carries a diagnostic, so
 * consumers must treat a project with non-empty diagnostics as read-only.
 */
export interface ResearchProject {
  manifest: ResearchManifest | undefined
  questions: ReadonlyMap<string, ResearchQuestion>
  framingLinks: ReadonlyMap<string, FramingLink>
  nodes: ReadonlyMap<string, ResearchNode>
  edges: ReadonlyMap<string, ResearchEdge>
  evidenceAssertions: ReadonlyMap<string, EvidenceAssertion>
  results: ReadonlyMap<string, ResearchResult>
  projectRevision: string
  diagnostics: readonly Diagnostic[]
}

/** Core-internal loaded state: the parsed project plus its managed files. */
export interface LoadedProject extends ResearchProject {
  /** Only managed files (research.json + the managed entity directories). */
  files: ReadonlyMap<string, string>
}

const MANAGED_DIRS = ['questions', 'question-links', 'nodes', 'edges', 'evidence', 'results'] as const

/**
 * Front matter uses the same js-yaml v4 (YAML 1.2) for parsing and rendering
 * so round-trips never reinterpret YAML 1.1 booleans; gray-matter only owns
 * the delimiter splitting.
 */
const YAML_ENGINE = {
  yaml: {
    parse: (input: string): object => yaml.load(input) as object,
    stringify: (data: object): string =>
      yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false }),
  },
} as const

function diag(path: string, code: string, message: string): Diagnostic {
  return { path, code, message }
}

function stemOf(fileName: string): string {
  if (fileName.endsWith('.md')) return fileName.slice(0, -3)
  if (fileName.endsWith('.json')) return fileName.slice(0, -5)
  return fileName
}

interface ParsedEntity {
  id: string
  entity: Record<string, unknown> & { id: string; body: string }
}

type LooseEntityParser = (
  data: unknown,
) => { ok: true; value: unknown } | { ok: false; issues: string[] }

function parseMarkdownEntity(
  path: string,
  content: string,
  parseData: LooseEntityParser,
  requiredBody: boolean,
): { diagnostics: Diagnostic[]; entity?: ParsedEntity } {
  const diagnostics: Diagnostic[] = []
  const fileName = path.slice(path.indexOf('/') + 1)
  const stem = stemOf(fileName)
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content, { engines: YAML_ENGINE })
  } catch {
    return { diagnostics: [diag(path, 'invalid_entity', 'front matter is not valid YAML')] }
  }
  if (parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return { diagnostics: [diag(path, 'invalid_entity', 'front matter must be a YAML object')] }
  }
  const data = parsed.data as Record<string, unknown>
  // Hand-authored identifiers: trim PMIDs and normalize DOI prefixes.
  const publicationRef = data['publication_ref'] as Record<string, unknown> | undefined
  if (publicationRef !== undefined && publicationRef !== null && typeof publicationRef === 'object' && !Array.isArray(publicationRef)) {
    if (typeof publicationRef['pmid'] === 'string') publicationRef['pmid'] = publicationRef['pmid'].trim()
    if (typeof publicationRef['doi'] === 'string') {
      const normalized = normalizeDoi(publicationRef['doi'])
      if (normalized !== undefined) publicationRef['doi'] = normalized
    }
  }
  const parsedData = parseData(data)
  if (!parsedData.ok) {
    for (const issue of parsedData.issues) {
      diagnostics.push(diag(path, 'invalid_entity', issue))
    }
    return { diagnostics }
  }
  const body = parsed.content
  const value = parsedData.value as { id: string }
  const id = value.id
  if (id !== stem) {
    diagnostics.push(diag(path, 'id_filename_mismatch', `entity id ${id} does not match file name`))
    return { diagnostics }
  }
  if (utf8ByteLength(body) > BODY_MAX) {
    diagnostics.push(diag(path, 'invalid_entity', `body exceeds ${BODY_MAX} bytes`))
    return { diagnostics }
  }
  if (requiredBody && body.trim().length === 0) {
    diagnostics.push(diag(path, 'invalid_entity', 'body must not be empty'))
    return { diagnostics }
  }
  return {
    diagnostics,
    entity: {
      id,
      entity: { ...(parsedData.value as Record<string, unknown>), id, body } as Record<string, unknown> & {
        id: string
        body: string
      },
    },
  }
}

function parseEdgeEntity(path: string, content: string): { diagnostics: Diagnostic[]; entity?: { id: string; entity: ResearchEdge } } {
  const diagnostics: Diagnostic[] = []
  const fileName = path.slice(path.indexOf('/') + 1)
  const stem = stemOf(fileName)
  const parsedEdge = parseEdgeFile(content)
  if (!parsedEdge.ok) {
    for (const issue of parsedEdge.issues) {
      diagnostics.push(diag(path, 'invalid_entity', issue))
    }
    return { diagnostics }
  }
  if (parsedEdge.value.id !== stem) {
    diagnostics.push(diag(path, 'id_filename_mismatch', `entity id ${parsedEdge.value.id} does not match file name`))
    return { diagnostics }
  }
  return { diagnostics, entity: { id: parsedEdge.value.id, entity: parsedEdge.value } }
}

function parseFramingLinkEntity(path: string, content: string): { diagnostics: Diagnostic[]; entity?: { id: string; entity: FramingLink } } {
  const diagnostics: Diagnostic[] = []
  const fileName = path.slice(path.indexOf('/') + 1)
  const stem = stemOf(fileName)
  const parsedLink = parseFramingLinkFile(content)
  if (!parsedLink.ok) {
    for (const issue of parsedLink.issues) {
      diagnostics.push(diag(path, 'invalid_entity', issue))
    }
    return { diagnostics }
  }
  if (parsedLink.value.id !== stem) {
    diagnostics.push(diag(path, 'id_filename_mismatch', `entity id ${parsedLink.value.id} does not match file name`))
    return { diagnostics }
  }
  return { diagnostics, entity: { id: parsedLink.value.id, entity: parsedLink.value } }
}

/**
 * Parse a complete Research Project. The returned LoadedProject always has a
 * projectRevision; diagnostics carry every structural problem found.
 */
export function parseProject(files: ReadonlyMap<string, string>, hash: HashFn): LoadedProject {
  const diagnostics: Diagnostic[] = []
  const managedFiles = new Map<string, string>()
  for (const [path, content] of files) {
    if (path === MANIFEST_FILE || MANAGED_DIRS.some((dir) => path.startsWith(`${dir}/`))) {
      managedFiles.set(path, content)
    }
  }

  let manifest: ResearchManifest | undefined
  const manifestRaw = files.get(MANIFEST_FILE)
  if (manifestRaw === undefined) {
    diagnostics.push(diag(MANIFEST_FILE, 'invalid_manifest', 'research.json is missing'))
  } else {
    let manifestJson: unknown
    try {
      manifestJson = JSON.parse(manifestRaw) as unknown
    } catch {
      manifestJson = undefined
    }
    if (manifestJson === undefined) {
      diagnostics.push(diag(MANIFEST_FILE, 'invalid_manifest', 'research.json is not valid JSON'))
    } else if (typeof manifestJson !== 'object' || manifestJson === null || Array.isArray(manifestJson)) {
      diagnostics.push(diag(MANIFEST_FILE, 'invalid_manifest', 'research.json must contain a JSON object'))
    } else {
      const version = (manifestJson as Record<string, unknown>)['schema_version']
      if (typeof version === 'number' && version !== 1) {
        diagnostics.push(diag(MANIFEST_FILE, 'unsupported_schema_version', `schema_version ${version} is not supported`))
      } else {
        const parsedManifest = parseManifest(manifestRaw)
        if (parsedManifest.ok) {
          manifest = parsedManifest.value
        } else {
          for (const issue of parsedManifest.issues) {
            diagnostics.push(diag(MANIFEST_FILE, 'invalid_manifest', issue))
          }
        }
      }
    }
  }

  const questions = new Map<string, ResearchQuestion>()
  const framingLinks = new Map<string, FramingLink>()
  const nodes = new Map<string, ResearchNode>()
  const edges = new Map<string, ResearchEdge>()
  const evidenceAssertions = new Map<string, EvidenceAssertion>()
  const results = new Map<string, ResearchResult>()

  const paths = [...managedFiles.keys()].filter((path) => path.includes('/')).sort()
  for (const path of paths) {
    const content = managedFiles.get(path)!
    const slash = path.indexOf('/')
    const dir = path.slice(0, slash)
    const fileName = path.slice(slash + 1)
    if (fileName.includes('/') || !isValidManagedFileName(fileName)) {
      diagnostics.push(diag(path, 'unknown_managed_file', `unmanaged file inside ${dir}/`))
      continue
    }
    if (dir === 'edges') {
      const { diagnostics: fileDiagnostics, entity } = parseEdgeEntity(path, content)
      diagnostics.push(...fileDiagnostics)
      if (entity !== undefined) edges.set(entity.id, entity.entity)
      continue
    }
    if (dir === 'question-links') {
      const { diagnostics: fileDiagnostics, entity } = parseFramingLinkEntity(path, content)
      diagnostics.push(...fileDiagnostics)
      if (entity !== undefined) framingLinks.set(entity.id, entity.entity)
      continue
    }
    const { diagnostics: fileDiagnostics, entity } = parseMarkdownEntity(
      path,
      content,
      dir === 'questions'
        ? parseQuestionData
        : dir === 'nodes'
          ? parseNodeData
          : dir === 'evidence'
            ? parseEvidenceData
            : parseResultData,
      dir === 'nodes' || dir === 'results',
    )
    diagnostics.push(...fileDiagnostics)
    if (entity === undefined) continue
    if (dir === 'questions') {
      questions.set(entity.id, entity.entity as ResearchQuestion)
    } else if (dir === 'nodes') {
      nodes.set(entity.id, entity.entity as ResearchNode)
    } else if (dir === 'evidence') {
      evidenceAssertions.set(entity.id, entity.entity as EvidenceAssertion)
    } else {
      results.set(entity.id, entity.entity as ResearchResult)
    }
  }

  return {
    manifest,
    questions,
    framingLinks,
    nodes,
    edges,
    evidenceAssertions,
    results,
    projectRevision: projectRevision(managedFiles, hash),
    diagnostics,
    files: managedFiles,
  }
}
