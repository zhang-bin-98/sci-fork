# SciFork contextual Evidence view and question intake

> Status: implemented on 2026-09-04
> Parent design: product design v0.20 and software architecture v0.21

## Problem

The preceding Companion interaction mixed Evidence visibility into the complete
graph through hidden, focused-node, and all modes.
Users need a stable Main graph for scientific context and a separate Evidence
view scoped to one explicitly selected anchor, without unrelated graph entities
or Evidence cards.

The Research Question and Framing Link model already exists, but the intended
initial-question workflow must be explicit: an open user inquiry becomes a
Research Question first, and only after real retrieval material is available
may the workflow persist low-confidence Hypotheses with machine-reviewed
Evidence.

## Goals

1. Make the responsive graph direction deterministic: `TB` below the default
   `md` breakpoint and `LR` at or above it.
2. Replace Evidence visibility modes with transient, mutually exclusive Main
   and locked-anchor Evidence views.
3. Specify and test the existing two-stage initial-question workflow without
   adding a DSH input-event or Bridge contract.

## Non-goals

- Do not persist graph view, Evidence anchor, layout direction, or drawer state.
- Do not change the Research Question domain model into a Node.
- Do not create a Hypothesis before retrieval produces qualifying source text
  and machine-reviewed Evidence.
- Do not add a DSH message listener, private client API, new backend, or new
  Skill; the existing `scifork-research` workflow remains the orchestrator.
- Do not add graph Evidence projection for Evidence referenced only by a
  scientific Edge; that remains a Details concern in this increment.

## Behavioral contract

### Responsive direction

The Companion uses the existing default Tailwind breakpoint:

- `<768px`: Dagre `TB`, with top/bottom React Flow handles.
- `>=768px`: Dagre `LR`, with left/right React Flow handles.

The direction is derived from the browser viewport, matching the current
product and architecture contract. A rebuilt client bundle must produce the
same result at the exact breakpoint boundaries.

### Evidence view

The page derives two mutually exclusive views from the complete snapshot. View
state is local UI state and defaults to `main`.

- `main`: retain every non-Evidence entity and every relationship whose two
  endpoints remain visible. It contains no Evidence entity or `evidence_ref`.
- `evidence`: retain exactly one locked non-Evidence anchor, every existing
  Evidence entity connected directly to that anchor by `evidence_ref`, and only
  those direct projection relationships.

The Evidence control is enabled only when the Host-confirmed Focus is a valid
anchor with at least one direct `evidence_ref` whose source Evidence entity
exists, and no Focus selection is pending. Current schemas produce these direct
references only for Finding, Hypothesis, and Prediction Nodes; this view does
not extend schemas for Question, Result, or stored scientific Edge Evidence.

Entering Evidence locks the current Focus id as the anchor. Later clicks on its
Evidence update Focus and Details but do not change view membership. Returning
to Main restores the anchor through the serialized Focus queue and keeps the
Evidence view visible, with new graph selection disabled, until that exact
request is Host-confirmed. A failed restore leaves the Evidence view open and
uses the existing error feedback. If the anchor has disappeared from the latest
projection, the page returns to Main without sending an invalid Focus request.
If the anchor remains but loses all Evidence, Evidence view retains the anchor
alone until the user returns to Main.

Evidence referenced only by a stored scientific Edge remains a Details concern
and is not added to the Evidence graph.

### Initial question workflow

After a user message is submitted, the existing `scifork-research` Skill
classifies the statement before creating a scientific Node:

1. An interrogative or exploratory imperative is normalized to a standalone
   Research Question. The model uses `find`, applies `create_question`, and
   sets that Question as Focus. An existing matching Question may be focused
   instead of duplicated.
2. A truth-valued proposition remains a Hypothesis candidate and is not
   rewritten as a Question.
3. The model completes the retrieval Skill phase and keeps real abstract or
   explicitly user-provided bounded PDF text in the current Chat.
4. Only qualifying retrieval material may produce machine-reviewed Evidence.
   Each retained Question branch creates Evidence first, then a low-confidence
   Hypothesis with the exact Evidence references, followed by a `frames`
   Framing Link from the Question to that Hypothesis. No scientific Edge targets a Question.
5. If retrieval yields no qualifying material, the Question may remain the
   only new graph entity and the workflow reports that no Hypothesis was
   persisted.

The Bridge continues to expose only the pinned public DSH contracts. It does
not intercept ordinary user messages; automatic intake means model-orchestrated
tool use after message submission, not a new pre-submit host event.

## Constraints and interfaces

- Core schemas, typed commands, and file paths remain unchanged.
- `SnapshotGraph` remains a complete body-free projection; Main/Evidence
  derivation occurs in `src/companion/graph.ts` and Companion local state only.
- The existing Focus API remains the source of the confirmed focused entity.
- Main and Evidence use the same deterministic Dagre layout; no mixed-graph
  Evidence barrier or special rank remains.
- `scifork-research` remains the only SciFork research Skill and must preserve
  the Evidence-first machine-review boundary.
- Existing DSH compatibility remains `0.1.1-rc.2`.

## Acceptance criteria

- [x] The built Companion renders `TB` below `md` and `LR` at/above `md`, with
      direction-aware handles and deterministic layout tests.
- [x] Main is the default and contains all non-Evidence entities and only
      relationships with visible endpoints.
- [x] Evidence can be entered only from an eligible Host-confirmed Focus and
      contains exactly its locked anchor, existing direct Evidence, and matching
      `evidence_ref` relationships.
- [x] Evidence Focus changes do not replace the anchor; returning to Main
      restores the anchor after exact Host confirmation and stays in Evidence on
      failure.
- [x] The old three-state implementation paths and mixed Evidence rank logic are
      absent; tests retain only explicit negative assertions against regression.
- [x] The initial-question Skill contract creates/focuses a Research Question
      before retrieval, then persists only evidence-backed low-confidence
      Hypotheses with Framing Links.
- [x] No Bridge or private DSH input event is introduced.
- [x] `pnpm check`, `node --check index.js`, `git diff --check`, and
      `pnpm pack --dry-run` pass.
- [x] Browser checks cover `320`, `639`, `640`, `767`, `768`, `1279`, `1280`,
      and `1440` pixel viewports, including nonblank graph pixels and no
      incoherent overlap.

## Test plan

- Companion graph unit tests for Main membership, locked-anchor Evidence
  membership, invalid/dangling anchors, and deterministic `TB`/`LR` coordinates.
- Companion UI and Focus-queue tests for the two-state control, entry gating,
  stable anchor, exact restore completion, rapid clicks, and restore failure.
- Skill-content tests for the ordered Question -> retrieval -> Evidence ->
  Hypothesis/Framing Link workflow and the no-source-text stop condition.
- Built-client browser checks at the documented breakpoint boundaries and a
  fixture containing multiple Nodes with disjoint Evidence references.
- Run the repository's final typecheck, test, build, packaging, and diff checks.

## Verification record

2026-09-04: source tests and built-client browser verification completed. The
Main view excluded Evidence and `evidence_ref`; Evidence view retained only the
Hypothesis anchor and its two direct Evidence items, and Evidence Focus changes
did not change membership. Finding, Hypothesis, and Prediction each entered
their own Evidence view; a Result without direct Evidence remained ineligible.
The `320/639/640/767/768/1279/1280/1440` viewport matrix showed no horizontal
overflow, non-overlapping panes/nodes, and nonblank Main/Evidence graphs. At
return, both view controls and the graph were busy/disabled until the exact anchor
Focus was confirmed. Key screenshots were captured at 320px Main, 768px Evidence,
and 1280px Main.
