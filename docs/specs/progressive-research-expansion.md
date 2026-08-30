# SciFork literature-grounded research expansion

> Status: implemented; automated verification and pinned DSH E2E passed on 2026-08-31
> Parent design: [product design v0.16](../scifork-product-design.md) sections 3, 4, 6-9, and 13-15; [software architecture v0.17](../scifork-software-architecture.md) sections 7, 9, 10, and 15-18
> Refines: [bounded simulation branches](simulation-branches.md) and [ADR-0001](../adr/0001-llm-orchestrated-simulation-branches.md)
> Decision: [ADR-0002](../adr/0002-separate-step-expansion-from-progressive-research.md)

## Problem

The implemented `Simulate & Save` action reasons from a prebuilt, depth-one Focus
neighborhood and may save plausible branches without first retrieving related
literature. That makes the action convenient but gives the model too little control
over context selection and makes a speculative simulation look more authoritative
than it is. It also conflates two different user intents: taking one deliberate
step from the visible Focus and asking Chat to conduct a progressive, multi-round
research investigation.

## Goals

1. Replace `Simulate & Save` with a predictable `Research & Expand` action that
   performs one literature-grounded, one-hop Research Expansion Step.
2. Let the model select fresh graph context through primitive directional-neighbor
   reads instead of embedding a fixed neighborhood body in the Companion prompt.
3. Retain zero to five non-duplicate, low-confidence Hypothesis or Prediction
   nodes only when each has an explicit typed scientific Edge to the current
   expansion anchor.
4. Add a separate Progressive Research Run workflow to `scifork-research`, invoked
   only by an explicit user request in the current DSH Chat.
5. Keep retrieval providers independent, graph persistence typed and auditable,
   and all Evidence/Result/Finding boundaries unchanged.

## Non-goals

- No recursive or multi-round behavior from a Companion click.
- No scheduler, background crawler, new Session, workflow engine, queue database,
  separate backend, or model-independent research controller.
- No graph-side plan editor, provider selector, branch picker, or additional Chat
  surface.
- No automatic Evidence Assertion, reviewed evidence, validated Result, Finding,
  full-text download, article node, vector store, RAG, or GraphRAG index.
- No requirement that the complete Research Graph be acyclic or tree-shaped.
- No new batch mutation or multi-entity transaction.

## Behavioral contract

### Research Expansion Step

The Companion action is labeled `Research & Expand`. A real click submits one
bounded prompt to the exact DSH Session that opened the Companion. The prompt
contains the current Focus id and summary, states the one-step research objective
and save authorization, and tells the model to use the research objective already
present in the current Chat. It does not serialize the Focus neighborhood or the
complete graph into the prompt.

If the current Chat does not contain a sufficiently clear research objective, the
model does not retrieve or mutate. It explains what is missing; that click's save
authorization ends, and the user may state the objective and click again.

For one valid step, the model:

1. Reads the latest Focus, its entity, and its incoming/outgoing neighbors.
2. Uses the packaged `pubmed-search` Skill for the button's default retrieval,
   starting broad enough to locate related work and using `lookup` for promising
   PMID/DOI records before making a scientific proposal.
3. Uses the retrieved material to identify zero to five scientifically distinct,
   non-duplicate direct branches from the current Focus anchor.
4. Saves each retained branch as one low-confidence Hypothesis or Prediction and
   immediately connects it with one typed Edge.
5. Re-reads and reports the exact saved, rejected, or failed Node and Edge ids.

When Focus is an Edge, the model reads its endpoints and chooses the scientifically
relevant Node/Result as the expansion anchor while recording the Focus Edge id in
provenance. When Focus is a projected Evidence endpoint, it uses a connected
Node/Result anchor; if none exists it retains no branch rather than creating an
orphan.

The step does not expand a newly created node, trigger itself, or move Focus. The
user may select a child node and click again to choose the next direction. Page
load, polling, model output, a saved node, and background events never start a
step. Idle and busy Session behavior remains the public DSH start/Queue behavior.

### Explicit connected relationships

Every retained node must be connected to a Node or Result already in the visited
research state by a scientific Edge whose direction and relation the model can
explain. `predicts` retains its legal Finding/Hypothesis-to-Prediction shape; other
relationships use the narrowest valid `supports`, `contradicts`, `causes`, or
`associated_with` relation.

Search results remain untrusted context rather than accepted evidence. A branch
grounded in retrieved but unreviewed literature therefore remains low confidence,
and its generated Edge uses `basis: ai_inference` with non-empty provenance, an
Evidence Gap, and one to fifty structured `publication_refs` identifying the
records that support that exact inference. These references are normalized and
deduplicated, but do not create or review an Evidence Assertion and cannot satisfy
a Finding support threshold.

The generated expansion may branch and later converge:

```text
A -> B -> C
\-> D -> C
```

No generated node may be isolated. A run keeps a visited set to avoid repeatedly
expanding the same entity, but SciFork does not impose a global DAG invariant on
the scientific graph.

### Progressive Research Run

A Progressive Research Run starts only when the user explicitly asks the current
DSH Chat to conduct progressive, iterative, or multi-round research. A Companion
click never grants this authority. The user's request defines the objective and
may define a direction, depth, source, or stopping condition. When those details
are absent, the model states a bounded plan in Chat and proceeds only while that
plan remains within the request; a material ambiguity requires clarification
before mutation.

The model maintains a research frontier and repeats the following logical step:

```text
read frontier entity and directional neighbors
-> choose a retrieval question
-> load and complete one retrieval Skill
-> inspect promising records
-> load scifork-research
-> retain only explicit connected Node + Edge branches
-> update visited set and frontier
```

The packaged PubMed Skill is the default, but a Chat-authorized run remains
provider-neutral and may use another user-selected database/PDF retrieval Skill or
reliable material already present in Chat. Skills never call one another: the DSH
model completes each retrieval phase, keeps its results in current Chat context,
then loads `scifork-research` for graph decisions and persistence. It may repeat
that sequence for the next frontier.

The model stops when it reaches the user's requested scope, finds no novel
defensible connected relationship, exhausts its declared plan, encounters a
non-recoverable retrieval or graph error, or needs a decision that would change
the objective. It reports the queries and identifiers consulted, branches retained
or rejected, remaining Evidence Gaps, and the frontier at termination. It does not
silently broaden the objective or continue as background work.

### Directional graph reads

The public tool names remain unchanged. `research_graph_read` adds:

```ts
type NeighborRead = {
  operation: 'neighbors'
  entityId: GraphEndpointId
  direction?: 'incoming' | 'outgoing' | 'both'
}
```

`GraphEndpointId` is a Node, Result, or projected Evidence endpoint; an Edge Focus
is first read with `entity`, after which the model chooses and reads the relevant
Node/Result endpoint. `direction` defaults to `both`. The result identifies the
requested entity and returns each matching incident Edge together with a compact
adjacent-entity card and whether that neighbor is incoming or outgoing. It does
not inline adjacent entity bodies; the model uses the existing `entity` operation
when full content is relevant. The existing `neighborhood` operation remains
compatible, and `find` remains available for duplicate checks outside the
traversed component.

The interface uses incoming/outgoing rather than parent/child because Research
Graph relations are directed scientific claims, not ownership or a tree hierarchy.

## Constraints and interfaces

- The Companion remains read-only, same-origin, loopback-only, and has one
  responsive layout.
- The Bridge remains a thin Page-Key-scoped `setDraft + submit` adapter and does
  not execute research logic.
- The one-step prompt remains within the existing 12 KiB Companion and 16 KiB
  Bridge bounds and contains no Page Key, local path, abstract, or complete graph.
- Core remains pure TypeScript and all mutations remain primitive single-entity
  commands with revision/file-version guards and one managed-path checkpoint.
- `create_edge`/`update_edge` accept bounded `publicationRefs` only for
  `ai_inference`; literature/experiment Edges reject the field. The Skill never
  relies on parsing identifiers back out of prose provenance.
- Research Project files remain the scientific source of truth; Chat retrieval
  notes and a Progressive Research Run frontier are transient.
- External and packaged retrieval Skills cannot write the Research Project.
- A direct Chat request authorizes only the stated Progressive Research Run. A
  changed objective, later run, retry after termination, or unrelated mutation
  needs fresh user authority.

## Acceptance criteria

- [x] Product and architecture documents distinguish Research Expansion Step from
      Progressive Research Run and no longer describe the button as simulation.
- [x] `CONTEXT.md` defines both terms without treating parent/child as a scientific
      relationship.
- [x] The Companion action reads `Research & Expand` and its real click submits one
      Focus-based, literature-first, one-hop prompt to the originating Session.
- [x] One click may save zero to five direct connected branches, never recurses,
      never changes Focus, and never creates an orphan or Finding.
- [x] The prompt delegates fresh context selection to graph tools instead of
      embedding the current neighborhood body.
- [x] `research_graph_read` supports directional neighbor reads with compact
      adjacent-entity cards while preserving existing read operations.
- [x] The packaged Skill describes a user-authorized progressive research frontier,
      provider-neutral retrieval phases, explicit stop conditions, and connected
      persistence without one Skill calling another.
- [x] Search results remain untrusted; automatic expansion cannot create reviewed
      Evidence Assertions, validated Results, or Findings.
- [x] Idle/queued submission, Retry/Copy, Page Key scope, typed deletion, and Git
      checkpoint behavior remain unchanged.
- [x] Focused tests, `pnpm check`, `node --check index.js`, `git diff --check`, and
      `pnpm pack --dry-run` pass before executable changes are committed.
- [x] A disposable pinned-DSH E2E verifies one button step and one explicit
      Chat-authorized progressive run before release.

### Verification record (2026-08-31)

- Automated Red/Green covered the prompt replacement, directional neighbors,
  packaged Skill catalog/content, and empty-Focus lossless JSON regression.
- Final post-fix `pnpm check` passed 31 test files and 318 tests.
- The pinned disposable DSH `0.1.1-rc.2` profile reset the graph Edge-first,
  preserved the candidate Evidence Assertion, and verified an empty Focus as
  lossless `{ "ok": true }`.
- One real `Research & Expand` click returned `Started`, completed PubMed search
  then PMID lookup, loaded `scifork-research`, read `neighbors` with direction
  `both`, and retained three direct Node+Edge branches while Focus stayed unchanged.
- One explicit two-level Progressive Research Run maintained `frontier` and
  `visited`, completed a fresh retrieval phase per level, retained one connected
  branch per level, and stopped at the declared depth. Final state: seven Nodes,
  six stored Edges, one candidate Evidence Assertion, zero Results, and unchanged
  Focus.

## Test plan

### Host/tool tests

- Register `neighbors` without changing the three public tool names.
- Verify incoming, outgoing, and default-both results, compact neighbor cards,
  missing entities, and graphs with branching, convergence, and unrelated nodes.
- Verify adjacent bodies and local absolute paths are not returned by `neighbors`.

### Companion/Bridge tests

- Observe Red for the old label and neighborhood-heavy simulation prompt.
- Verify the new label, Focus id/summary, literature-first objective, single-step
  authorization, zero-to-five direct branches, unchanged Focus, and no recursion.
- Preserve idle, queued, nonce, Retry/Copy, and wrong-channel coverage.

### Skill/static tests

- Verify the catalog and `scifork-research` instructions distinguish button-step
  authorization from explicit Chat-run authorization.
- Verify the progressive workflow alternates completed retrieval and graph phases,
  retains an explicit frontier/visited set, stops explicitly, and never treats a
  PMID/DOI as reviewed evidence.
- Run the packaged Skill registration and static workflow tests used by this DSH
  adapter; its Skill body and catalog metadata are registered separately.

### Pinned DSH E2E

1. State a clear research objective, Focus a connected claim, and click
   `Research & Expand` once.
2. Verify PubMed retrieval occurs before graph mutation and only direct connected
   branches are saved while Focus remains unchanged.
3. Ask the same Chat for a bounded progressive investigation across at least two
   levels and verify each retained node has an explicit Edge.
4. Verify no isolated node, automatic Evidence Assertion, Finding, recursive
   button submission, or cross-Session message is created.
