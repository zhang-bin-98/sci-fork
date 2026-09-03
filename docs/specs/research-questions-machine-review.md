# SciFork Research Questions and machine-reviewed evidence

> Status: implemented on 2026-08-31; interface cleanup updated on 2026-09-03
> Parent design: [product design v0.20](../scifork-product-design.md) and
> [software architecture v0.21](../scifork-software-architecture.md)
> Refines: [literature-grounded research expansion](progressive-research-expansion.md)

## Problem

SciFork currently treats every scientific Node as a Finding, Hypothesis, or
Prediction. A user's initial input may instead be an open-ended inquiry such as
“What are the key drivers of bone aging?” Turning that question into a
Hypothesis invents a truth-valued claim before retrieval and leaves an empty
Research Project without a semantically valid expansion anchor.

Research Expansion currently retains only publication identifiers on
`ai_inference` Edges. This supports uninterrupted multi-round research, but it
does not preserve the precise abstract-grounded assertions a user needs for
post-run audit. Requiring candidate-by-candidate review during either import or
expansion would interrupt the frontier, split evidence ingestion into two trust
paths, and recreate the cognitive burden that Progressive Research is intended
to remove.

The project also needs an explicit retention boundary: retrieval metadata,
abstracts, full text, PDFs, parsed text, and raw provider responses are useful
during a retrieval phase but must not become durable Research Project or
SciFork-cache content. DSH may retain Skill output in its Chat history because
SciFork has no public contract for deleting that history.

## Goals

1. Represent an open-ended user inquiry as a first-class Research Question, not
   as a Hypothesis, and allow it to be the initial Focus.
2. Connect Hypotheses and Findings to the Question they address without treating
   that organizational connection as a scientific Edge.
3. Automatically extract and persist machine-reviewed Evidence Assertions from
   real abstract or bounded PDF retrieval material so a Progressive Research Run
   can continue without per-item confirmation.
4. Keep `machine_reviewed` distinct from human `reviewed`; only human-reviewed
   Evidence Assertions or validated Results satisfy a Finding support threshold.
5. Hide Evidence nodes in the Companion by default while exposing their exact
   article identity, assertion, locator, direction, limitations, and review state
   in the related Node or Edge Details.
6. Retain only the minimum durable citation snapshot needed for post-run audit
   and discard complete retrieval material after each run.
7. Apply the same automatic machine-review requirements to ordinary Draft import
   and authorized Research Expansion.

## Non-goals

- No automatic Finding creation or promotion from machine-reviewed evidence.
- No claim that PubMed identity, an abstract, or model entailment checking makes
  a scientific assertion human-reviewed.
- No Publication/Source entity, article graph, local paper library, abstract
  archive, PDF store, full-text cache, vector index, RAG, or provider database.
- No deletion of DSH Chat history; SciFork does not own that surface or contract.
- No physical deletion of Evidence Assertions or Findings. A rejected Evidence
  Assertion remains an audit record and is hidden from the active view by
  default.
- No automatic recursive action from the Companion button and no background or
  scheduled Progressive Research Run.

## Behavioral contract

### Research Question

A Research Question is a standalone entity with a `question_<uuid>` id, required
question text, optional scope assumptions, and optional Markdown notes. It has no
confidence, evidence support threshold, or scientific direction. It can be
selected as Focus and is rendered as a neutral question card.

When a user supplies an open-ended inquiry, the model creates a Research Question
and sets it as Focus instead of forcing it into a Hypothesis. A proposition that
can be supported or contradicted remains a Hypothesis. Imperative wording such as
“identify the key drivers of bone aging” is normalized to an open Research
Question while preserving the user's intended scope.

The first expansion from a Question retrieves literature and creates zero to five
low-confidence Hypotheses. Each retained Hypothesis has at least one associated
machine-reviewed Evidence Assertion and one Framing Link. A Question is not a
scientific Edge endpoint, so the first expansion does not invent a scientific
relationship between the question and its candidate answers.

### Framing Link

A Framing Link is a standalone `qlink_<uuid>` entity with the single relation
`frames`. Its source is a Research Question and its target is a Hypothesis or
Finding. It carries no basis, evidence reference, confidence, provenance, or
Evidence Gap and never participates in Finding support or publication counts.

Predictions do not directly belong to a Question; they remain testable consequences
of a Finding or Hypothesis. A Framing Link is deleted before deleting its target
Hypothesis. Research Questions and Findings are not physically deleted by MVP
commands.

### Automatic evidence extraction and review

For every retained expansion branch, the model uses completed retrieval results
to extract one or more Evidence Assertions before creating the branch. A
machine-reviewed Evidence Assertion requires:

- a valid PMID or normalized DOI;
- an actual abstract, or an explicitly user-provided PDF/full-text passage;
- a precise assertion entailed by the retrieved passage rather than its title;
- `pubmed_abstract`, or a PDF page/section, as locator;
- `supports`, `contradicts`, or `context` direction;
- preserved uncertainty and study limitations;
- a bounded Citation Snapshot containing title and optional journal/year; and
- a non-empty machine-review rationale covering identity, locator, entailment,
  direction, and limitations.

Title-only or metadata-only records remain Publication References in retrieval
provenance and cannot become machine-reviewed Evidence Assertions. Missing or
ambiguous source text causes the branch to be omitted when no defensible
Evidence Assertion can be extracted.

The persisted review lifecycle for newly created Evidence is:

```text
machine_reviewed -> reviewed | rejected
reviewed ---------------------------------> rejected
rejected is terminal
```

`candidate` names a transient Evidence Candidate in a Research Import Draft and
is not a persisted Evidence review state. Creation and import persist qualifying
Evidence directly as `machine_reviewed`.

`reviewed` continues to mean explicit human acceptance. `machine_reviewed`
Evidence can ground low-confidence Hypotheses, Predictions, and `ai_inference`
Edges, but it does not satisfy the Finding threshold and is reported separately
from human-reviewed evidence.

The `Research & Expand` click authorizes machine-reviewed Evidence Assertions
only for the one bounded step it submits. An explicitly authorized Progressive
Research Run grants the same automatic extraction/review behavior for its stated
rounds. Ordinary evidence import uses the same identity, locator, entailment,
direction, limitation, Citation Snapshot, and rationale checks, then persists
qualifying Draft items directly as `machine_reviewed`.

### Post-run audit and rejection

The user can accept a machine-reviewed Evidence Assertion as human `reviewed` or
reject it. Before rejection, the model removes its active Node/Edge evidence
references and reports affected branches. When the user rejects an expansion
branch, the model deletes Framing Links and scientific Edges before deleting
leaf Hypothesis/Prediction Nodes. Rejected Evidence Assertions remain durable
audit records but are hidden from the default graph.

The MVP does not add an automatic dependency-taint state. The model re-reads the
affected neighborhood, reports downstream entities that depended on rejected
material, and asks only when deleting or revising them would exceed the user's
request.

### Companion evidence presentation

The Companion snapshot remains a complete rebuildable projection. Its local
Main view excludes Evidence. From an eligible Host-confirmed Focus, the user can
enter a locked Evidence view containing only that anchor, its existing direct
Evidence, and the corresponding projection relationships, without changing
project state.

Node and stored scientific Edge Details include a Literature section grouped by:

- human-reviewed Evidence;
- machine-reviewed Evidence;
- rejected Evidence, collapsed by default; and
- retrieval-only Publication References that have no Evidence Assertion.

Each Evidence row shows the Citation Snapshot, PMID/DOI, assertion, locator,
direction, limitations, machine-review rationale when present, and review state.
Question Details show scope assumptions, framed Hypotheses/Findings, aggregate
publication coverage, and review-state counts; those aggregates do not imply that
the Question itself is evidence-supported.

Node cards replace the ambiguous `N refs (M reviewed)` text with bounded counts
that distinguish publications, machine-reviewed Evidence, and human-reviewed
Evidence. Framing Links and Questions do not contribute to publication counts.

### Retention boundary

SciFork durably stores only:

- Publication Reference: PMID and/or normalized DOI;
- Citation Snapshot: title plus optional journal and year;
- derived assertion, locator, direction, limitations, and review state;
- machine-review rationale;
- the existing bounded Edge provenance and Evidence Gap; and
- ordinary Research Question, Framing Link, Node, Result, and Git history data.

SciFork never writes or caches complete search metadata, authors,
publication-type lists, canonical retrieval URLs, retrieval timestamps,
abstract/full-text bodies, PDFs, parsed source text, or raw provider responses.
Retrieval material remains untrusted current-run context and is released by
SciFork after extraction. The packaged helper continues to emit a bounded result
to DSH Chat and never writes a file; DSH Chat retention remains outside SciFork's
control and must be disclosed to the user.

## Constraints and interfaces

- Core remains pure TypeScript and all new files use strict schemas and
  single-entity typed commands.
- The project adds `questions/` and `question-links/` to the managed paths; Git
  checkpoint behavior remains current-branch, one-entity, and local-only.
- Question and Framing Link ids, paths, endpoints, and relationships are derived
  by Core and never supplied as filesystem paths.
- Existing `reviewed` Evidence retains its meaning and remains valid; the
  additive `machine_reviewed` state does not require rewriting existing files.
- Citation Snapshot and machine-review rationale are required when Evidence enters
  the project as `machine_reviewed`; later review transitions preserve them.
- Scientific `evidence_refs` may target `machine_reviewed` or `reviewed` Evidence
  for Hypothesis/Prediction and `ai_inference` workflows. A Finding's support
  threshold still considers only human `reviewed` supporting Evidence.
- `basis: literature` continues to require at least one human-reviewed Evidence
  Assertion; machine-reviewed Evidence remains on `ai_inference` Edges.
- Framing Links are not included in directional scientific-neighbor reads unless
  a Question is the requested Focus; Question reads return framed entities
  separately from scientific neighbors.
- Companion and API remain same-origin, loopback-only, Page-Key scoped, and free
  of automatic external requests. PubMed links require a real user click.
- The current DSH compatibility baseline remains `0.1.1-rc.2`; no private
  component, Chat deletion, or new DSH contract is introduced.

## Acceptance criteria

- [x] `CONTEXT.md`, product design, architecture, README, packaged Skills, and
      this specification use the same Question, Framing Link, machine-review,
      Finding-threshold, Main/Evidence-view, and retention terminology.
- [x] An open-ended inquiry can be persisted as a Research Question, selected as
      Focus, read through public tools, and used as the first expansion anchor.
- [x] Questions can frame Hypotheses/Findings through non-scientific Framing
      Links; invalid endpoints, duplicate ids, and dependent deletion are guarded.
- [x] Core parses, validates, projects, creates, updates, and checkpoints Question
      and Framing Link files without adding Node confidence or scientific basis.
- [x] A machine-reviewed Evidence Assertion requires real-source fields, a
      Citation Snapshot, and rationale; title-only records cannot qualify.
- [x] Machine-reviewed Evidence can support uninterrupted low-confidence branch
      creation but cannot satisfy a Finding or a `basis: literature` Edge.
- [x] Human acceptance and rejection use guarded review transitions; rejected
      material is removed from active references before status transition.
- [x] Research Expansion, Progressive Research, and ordinary Draft import apply
      the same machine-review requirements and persist qualifying Evidence as
      `machine_reviewed` while retaining exact ids.
- [x] Main excludes Evidence by default; an eligible confirmed Focus opens one
      locked-anchor Evidence view, and related Node/Edge Details identify
      publications and all review states.
- [x] UI counts distinguish unique publications, machine-reviewed Evidence, and
      human-reviewed Evidence; Framing Links are excluded.
- [x] No Research Project, Git checkpoint, SciFork log, error, or cache contains
      complete metadata, authors, publication types, retrieval URLs/times,
      abstracts, full text, PDFs, parsed source text, or raw provider responses.
- [x] Focused tests observe Red before implementation and cover new schemas,
      invariants, commands, projection, service payloads, UI filtering/details,
      prompts, Skills, retention, and deletion ordering.
- [x] `pnpm check`, `node --check index.js`, `git diff --check`, and package file
      verification pass before commit.

## Test plan

### Core

- Parse valid/invalid Research Question and Framing Link files, including id,
  endpoint, duplicate, body-size, and unknown-field failures.
- Validate machine-review lifecycle, required Citation Snapshot/rationale,
  Finding thresholds, literature Edge restrictions, role/direction consistency,
  and rejection while references remain active.
- Exercise create/update/delete commands for Questions and Framing Links plus
  create/review Evidence transitions and single-entity path planning.
- Verify projections distinguish Questions, Framing Links, scientific Edges, and
  Evidence relationships without treating `frames` as scientific.

### Host and Git

- Include both new managed directories in project initialization, reads,
  containment, project revision, exact-path Git staging, diagnostics, and package
  behavior.
- Extend tool schemas and entity/directional-neighbor operations for Questions and
  Framing Links without adding public tool names.
- Verify Question Focus and framed-entity reads while preserving directional
  scientific-neighbor behavior.

### Companion and Bridge

- Verify Question cards, Focus, Details, and first-step prompt semantics.
- Verify Main excludes Evidence by default, eligible entities enter a locked
  Evidence view, and Node/Edge Literature Details render minimum citation
  snapshots without remote fetches.
- Verify publication/machine/human counts and rejected grouping.
- Preserve one-click, nonce, idle/queued, Retry/Copy, responsive, and Page-Key
  behavior.

### Skills and retention

- Verify both expansion workflows require real abstract/PDF passages before
  machine review and reject title-only records.
- Verify machine Evidence is created before dependent Node/Edge/Framing Link
  mutations, and only human `reviewed` evidence can justify a Finding.
- Verify Skill instructions persist only the minimum citation snapshot and never
  request storage of abstracts, PDFs, full text, complete metadata, or raw
  provider responses.
- Verify documentation states that DSH Chat may retain Skill output outside
  SciFork's deletion control.

### Pinned DSH E2E

1. Initialize an empty project, state an open Research Question, create/focus it,
   and run one `Research & Expand` step.
2. Verify PubMed search/lookup precedes mutation, at least one real abstract-backed
   machine-reviewed Evidence Assertion precedes every retained Hypothesis, and
   each branch frames the Question's scope.
3. Run a bounded multi-level Progressive Research Run without per-item review and
   verify no Finding is created from machine-reviewed Evidence.
4. Accept one Evidence Assertion, reject another, delete one affected branch, and
   verify exact audit state and Git checkpoints.
5. Verify Main excludes Evidence, the locked-anchor Evidence view and Details
   identify source articles, and no project file contains abstract/full-text/PDF
   or complete provider output.
