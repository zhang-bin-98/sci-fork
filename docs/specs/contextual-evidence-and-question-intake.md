# SciFork contextual Evidence view and question intake

> Status: implemented on 2026-09-02
> Parent design: product design v0.19 and software architecture v0.20

## Problem

The Companion currently lays out the graph responsively and hides or reveals
the entire Evidence layer with one global switch. Users need the graph to keep
the intended wide-screen left-to-right and narrow-screen top-to-bottom reading
direction, and need to inspect Evidence for one focused Node without flooding
the graph with unrelated Evidence cards.

The Research Question and Framing Link model already exists, but the intended
initial-question workflow must be explicit: an open user inquiry becomes a
Research Question first, and only after real retrieval material is available
may the workflow persist low-confidence Hypotheses with machine-reviewed
Evidence.

## Goals

1. Make the responsive graph direction deterministic: `TB` below the default
   `md` breakpoint and `LR` at or above it.
2. Add a transient Companion Evidence view with hidden, focused-Node, and all
   Evidence modes.
3. Specify and test the existing two-stage initial-question workflow without
   adding a DSH input-event or Bridge contract.

## Non-goals

- Do not persist Evidence visibility, layout direction, or drawer state.
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

The graph keeps all non-Evidence entities and scientific/framing edges in every
mode. Evidence visibility is local UI state and defaults to `hidden`.

- `hidden`: remove all Evidence entities and their `evidence_ref` edges.
- `focused-node`: when Focus identifies a Node, retain only that Node's
  referenced Evidence entities and their `evidence_ref` edges. If Focus is not
  a Node, this mode renders no Evidence entities.
- `all`: retain every Evidence entity and `evidence_ref` edge.

Changing Focus does not write project data. The focused-node view follows the
currently confirmed Focus; selecting a different Node changes the displayed
Evidence set after that Focus is confirmed. Evidence referenced by a stored
scientific Edge is not added to the graph in this increment.

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
- `SnapshotGraph` remains a complete body-free projection; filtering occurs in
  `src/companion/graph.ts` and Companion local state only.
- The existing Focus API remains the source of the confirmed focused entity.
- `scifork-research` remains the only SciFork research Skill and must preserve
  the Evidence-first machine-review boundary.
- Existing DSH compatibility remains `0.1.1-rc.2`.

## Acceptance criteria

- [x] The built Companion renders `TB` below `md` and `LR` at/above `md`, with
      direction-aware handles and deterministic layout tests.
- [x] Evidence is hidden by default, can be limited to the focused Node, and
      can be expanded to all Evidence without changing the snapshot or project.
- [x] Focused-node mode never leaves an Evidence entity or `evidence_ref` edge
      for a different Node.
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

- Companion graph unit tests for all Evidence modes, focused non-Node/unknown
  targets, edge retention, and deterministic `TB`/`LR` coordinates.
- Companion UI tests for the three-state control labels and disabled focused
  mode when Focus is not a Node.
- Skill-content tests for the ordered Question -> retrieval -> Evidence ->
  Hypothesis/Framing Link workflow and the no-source-text stop condition.
- Built-client browser checks at the documented breakpoint boundaries and a
  fixture containing multiple Nodes with disjoint Evidence references.
- Run the repository's final typecheck, test, build, packaging, and diff checks.

## Verification record

On 2026-09-02, the built Companion was served from a loopback fixture and
checked at `320`, `639`, `640`, `767`, `768`, `1279`, `1280`, and `1440` pixel
viewports. Connected Nodes used TB below `768px` and LR at/above `768px`; the
graph stayed within its pane after a Details resize. The Evidence control showed
only the Focus Node's Evidence in focused-node mode and both fixture Evidence
nodes in all mode. Document width remained equal to the viewport at each check,
and screenshots at narrow and wide sizes rendered nonblank cards without
overlap.
