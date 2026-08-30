# SciFork bounded simulation branches

> Status: implemented for v0.0.1; forward expansion and Companion-action semantics are superseded by [literature-grounded research expansion](progressive-research-expansion.md), while typed deletion remains authoritative here
> Parent design: [product design v0.12](../scifork-product-design.md) sections 3, 4, 6, and 7; [software architecture v0.13](../scifork-software-architecture.md) sections 5, 6, 7, 9-12, and 15
> Extends: [M1 Core + Git](m1-core-git.md), [M2 Companion](m2-companion.md), and [M3 Research](m3-research.md)

## Problem

The v0.0.1 simulation flow submits one free-form proposal and requires another
round trip before any claim is persisted. This encourages a single linear
direction, makes automation cumbersome, and can leave manually created
simulation nodes disconnected from the Focus. SciFork also lacks typed deletion
commands, so a user cannot safely remove an unsuitable generated direction
through the same LLM/tool boundary.

## Goals

1. Treat one real `Simulate & Save` click as authorization for the originating
   DSH Chat to retain every valid, non-duplicate branch it proposes in that
   bounded run.
2. Persist each branch as an unverified, low-confidence Hypothesis or Prediction
   plus one scientific Edge to a valid graph anchor.
3. Keep orchestration in the LLM and `scifork-research` Skill while exposing only
   primitive read, create, update, delete, and Focus capabilities.
4. Add the precise `predicts` relation and safe typed deletion of Edges and
   unverified claim nodes.
5. Preserve Core validation, stale-write protection, local Git auditability, and
   the separate Evidence/Result/Finding boundaries.

## Non-goals

- No batch command, multi-entity transaction, Simulation Draft entity, scheduler,
  queue database, recursive background exploration, or extra DSH Session.
- No Companion graph editing, delete button, multi-select review, or second
  conversation surface.
- No automatic Finding, reviewed Evidence Assertion, validated Result, or
  literature claim.
- No physical deletion command for Finding, Evidence Assertion, or Result.
- No automatic cleanup that silently chooses a scientific branch on behalf of
  the LLM when the graph shape is ambiguous.

## Behavioral contract

### User-triggered simulation

The Companion button is labeled `Simulate & Save`. Its real click builds the
existing bounded prompt and explicitly states that the click authorizes this one
run to save every valid branch the model actually proposes. Page load, polling,
model output, an earlier saved branch, and background events cannot trigger a
run. Retry remains another real click with the exact retained prompt and a new
nonce.

The prompt directs the originating DSH Chat to use `scifork-research`. The model
must read the latest Focus and neighborhood before reasoning. It may retain zero
to five scientifically distinct branches at depth one. Zero is valid when no new
direction is defensible from the available context. The run ends after reporting
the exact persisted or failed entity ids; saved branches never trigger another
simulation automatically.

### Simulation Branch

A Simulation Branch is a workflow term, not a schema entity. Each retained
branch consists of:

```text
one Node(kind: hypothesis | prediction, confidence: low)
+ one Edge connecting a valid Node/Result anchor to that Node
```

The model checks the current graph for a semantically duplicate claim before
creation. When the Focus is an Edge it chooses an appropriate endpoint as the
anchor and records the Focus Edge id in provenance. When the Focus is an Evidence
Assertion it uses a connected Node/Result anchor; if none exists it does not
create an orphan branch.

`predicts` has one legal shape:

```text
Finding | Hypothesis --predicts--> Prediction
```

For another scientifically justified shape, the model chooses the narrowest of
`supports`, `contradicts`, `causes`, or `associated_with`. Every generated Edge
uses `basis: ai_inference` with non-empty provenance, Evidence Gap, and one to
fifty structured `publication_refs` identifying the retrieved records that
support that inference. Those references do not create or review an Evidence
Assertion. A simulation cannot create or promote a Finding.

The model creates one Node and immediately creates its Edge using the returned
project revision. If Edge creation fails, it re-reads and retries only when the
error is recoverable. If it cannot connect the Node, it deletes that orphan
before continuing when safe; any unresolved partial state is reported exactly.
Each successful Node, Edge, or deletion remains one ResearchCommand and one Git
checkpoint.

### Primitive deletion

`research_graph_apply` gains:

```ts
type DeleteEdge = {
  kind: 'delete_edge'
  id: EdgeId
  expectedFileVersion: Sha256
}

type DeleteNode = {
  kind: 'delete_node'
  id: NodeId
  expectedFileVersion: Sha256
}
```

`delete_edge` rejects a stale/missing target and any deletion that would leave a
Finding below its support threshold. `delete_node` rejects a stale/missing
target, every Finding, and every Hypothesis/Prediction that still has an incoming
or outgoing persisted Edge. Evidence references stored on the node do not block
its deletion because they are not reverse references from the Evidence
Assertion.

The `scifork-research` delete-branch workflow reads the target, its neighborhood,
and Focus. It clears or moves the current Focus when it names an entity being
removed, deletes explicitly selected Edges first, then deletes
Hypothesis/Prediction nodes leaf-first. It re-reads after stale errors and reports
what was actually deleted. Evidence uses `rejected`; Result uses `superseded`;
Finding has no physical deletion command.

### Read and Host boundary

`research_graph_read { operation: "entity" }` returns the entity document plus
its SHA-256 `fileVersion`. Update and delete workflows must use that value; the
model does not calculate managed-file hashes or paths itself.

All read-tool results remain lossless JSON during recovery. Optional manifest,
branch, or HEAD fields are omitted when unavailable; they are never returned as
JavaScript `undefined`, which the pinned DSH tool boundary rejects.

Core plans exactly one create, update, or deletion path derived from the entity
id. The pinned DSH filesystem service has guarded create/replace but no deletion.
After Core and project-revision validation, Host therefore performs a deletion
only through the fixed Git executable using:

```text
git rm -- <Core-derived managed relative path>
```

The model cannot supply a path, executable, or argv. Host re-reads the complete
managed snapshot, requires it to equal the initial snapshot minus that one file,
revalidates all invariants, and then creates the normal one-path checkpoint.
Because `git rm` already staged the exact deletion and removed the path from the
index, the deletion checkpoint goes directly to `git commit --only <path>`; it
must not run the create/update `git add` step on the now-missing path. This keeps
unrelated staged work untouched. A failed deletion does not claim success; a
checkpoint failure leaves the deletion visible for DSH or the user to inspect,
matching existing mutation recovery semantics.

## Constraints and interfaces

- `Relation` adds `predicts`; persisted invalid endpoint kinds make the project
  read-only, and create/update commands reject the same invalid shape.
- The three public model tool names remain unchanged. Only the read result and
  `research_graph_apply` discriminated command union are extended.
- Simulation remains within the 12 KiB Companion prompt and 16 KiB Bridge
  message bounds and uses the pinned `setDraft + submit` transaction.
- The Companion remains read-only, same-origin, loopback-only, and uses no new
  dependency or service.
- Research Import Draft selection and Evidence review are unchanged. Default
  save applies only to a user-click-authorized Simulation Branch run.

## Acceptance criteria

- [x] The visible action says `Simulate & Save`, and its bounded prompt records
      authorization, zero-to-five branches, depth one, deduplication, low
      confidence, Node+Edge persistence, and no automatic Finding/recursion.
- [x] `scifork-research` describes simulation-save and delete-branch workflows,
      lets the LLM choose branch count/type/relation, and retains deterministic
      scientific and failure guardrails.
- [x] `predicts` parses, projects, and renders; invalid endpoints fail both
      project validation and create/update planning.
- [x] Entity reads return `fileVersion` without exposing local paths.
- [x] `delete_edge` and `delete_node` require current project/file revisions,
      delete one Core-derived path, and produce one checkpoint.
- [x] A connected Node, a Finding, or a support-critical Edge cannot be deleted;
      a detached Hypothesis/Prediction and a non-critical Edge can be deleted.
- [x] Evidence/Result state transitions and the Finding support threshold remain
      unchanged.
- [x] No test, log, prompt, error, or tool argument exposes a Page Key, local
      absolute path, arbitrary Git argv, abstract, or research body beyond the
      existing bounded interfaces.
- [x] Focused tests, `pnpm check`, `node --check index.js`, `git diff --check`, and
      `pnpm pack --dry-run` pass.

## Disposable DSH exercise

The approved pinned-profile exercise used one real `Simulate & Save` click on a
Prediction Focus. The originating Chat loaded the updated Skill, retained three
distinct depth-one branches, and created three low-confidence Nodes plus three
`ai_inference` Edges with provenance and Evidence Gaps. It correctly avoided
`predicts` because a Prediction cannot be its source. Companion and Git both
showed five Nodes, four Edges, six independent create checkpoints, and a clean
worktree.

Deleting one rejected branch Edge-first exposed two recovery defects. First,
the generic checkpoint tried `git add` after `git rm` had already removed the
path from the index, so the file deletion remained staged and the tool correctly
reported `CHECKPOINT_FAILED`. The repaired deletion checkpoint now commits that
exact existing staging directly; a real-Git regression covers the Edge path and
the repaired Host completed the Node deletion with its own checkpoint. Second,
read-tool recovery results included absent Git fields as `undefined`, which the
pinned DSH lossless-JSON boundary rejected. Read results now omit unavailable
optional fields, with regression coverage for dirty Git and invalid manifests.

The staged Edge deletion was recovered with the same exact-path `commit --only`
operation before the repaired Host resumed. Final state was clean and contained
four Nodes, three Edges, one candidate Evidence Assertion, zero Results, and the
original Focus. The selected Edge and Prediction no longer existed; the other
two generated branches were unchanged.

## Test plan

- Core schema/validator tests cover legal and illegal `predicts` edges.
- Core command tests cover parsing, file-version protection, incident-edge
  rejection, Finding rejection, support-critical Edge rejection, and successful
  single-file delete plans.
- Host tests prove entity reads return `fileVersion`, Git deletion uses one exact
  Core-derived path, after-snapshot validation removes only that file, and the
  normal checkpoint records the deletion.
- Tool-schema tests expose both delete commands and the five relation values.
- Companion prompt tests require save authorization, the five-branch/depth-one
  bounds, Node+Edge, low confidence, no Finding, and preservation under UTF-8
  truncation.
- Skill tests require deduplication, immediate Edge creation, orphan cleanup,
  Edge-first/leaf-first deletion, Focus handling, and unchanged Evidence review
  language.
