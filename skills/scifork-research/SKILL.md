---
name: scifork-research
description: Format retrieved biomedical literature into SciFork import drafts for automatic review, preserve abstract- or PDF-grounded machine-reviewed Evidence and connected research branches, frame open Research Questions, critique graph branches, and apply accepted graph changes through SciFork tools. Use after a literature-retrieval or PDF-reading skill has placed real source results in the current conversation.
---

# SciFork Research

This is SciFork's single research-formatting, graph-workflow, and reasoning
Skill. For evidence import it consumes actual retrieval or PDF results already
present in the current DSH Chat context. It also decides which connected branches
to retain after a completed retrieval phase, critiques the graph, and deletes
rejected branches. It does not browse, retrieve literature, call another Skill,
or write project files directly. If no actual retrieval or PDF results are
present, do not produce a Draft or literature-grounded branch; wait for retrieval
to complete. Persistence always goes through SciFork typed tools and the
authorization rules below.

## Orchestration order

For evidence import:

1. Load and use one retrieval/PDF Skill. Keep its raw result in Chat context.
2. Load this Skill and record the actual retrieval Skill name in
   `producer.retrievalSkill`.
3. Emit one complete `ResearchImportDraft`. Every importable candidate includes
   the Citation Snapshot and machine-review rationale required below.
4. After SciFork validation, convert each qualifying candidate to one
   `import_draft_item` command using the latest `projectRevision`. Each imported
   assertion is stored as `machine_reviewed`; never promote it to a Finding.

For graph expansion, the orchestrating model completes one retrieval phase first,
keeps the actual results in the current Chat, and only then loads this Skill for
graph decisions. For critique or deletion, load this Skill directly. Use
`research_graph_read` for current state, `research_graph_apply` for one guarded
entity mutation at a time, and `research_graph_focus` only when a workflow must
change Focus. Entity reads return `fileVersion` for update/delete commands.
Always use the latest returned `projectRevision` after a successful mutation.

Skills do not call each other and a retrieval result is not itself a Draft.

## Start from an open Research Question

Classify the user's initial statement before creating a scientific Node. An
interrogative or exploratory imperative such as “what drives bone aging?” or
“identify the key drivers of bone aging” is an open inquiry, not a proposition.
Use `find`, then apply `create_question` and set the new Research Question as
Focus. Preserve material scope assumptions but do not assign confidence or
invent Evidence.

A truth-valued proposition that can be supported or contradicted remains a
Hypothesis. Hypotheses and Findings may address a Research Question through
`create_framing_link`; Predictions never directly address a Question. The
`addresses` Framing Link is organizational, not a scientific Edge, and carries
no basis, Evidence, confidence, provenance, or Evidence Gap.

## Research Import Draft

When the user asks to format evidence, return strict JSON with this shape and
no extra keys:

```json
{
  "schemaVersion": 1,
  "producer": {
    "retrievalSkill": "the-actual-retrieval-skill",
    "formatterSkill": "scifork-research",
    "generatedAt": "2026-08-30T00:00:00.000Z"
  },
  "evidenceCandidates": [
    {
      "publicationRef": { "pmid": "12345678" },
      "assertion": "A precise claim supported by the retrieved text.",
      "locator": { "kind": "pubmed_abstract" },
      "direction": "supports",
      "citation": {
        "title": "The source article title",
        "journal": "The source journal",
        "year": 2025
      },
      "machineReviewRationale": "Publication identity, locator, entailment, direction, and limitations were checked against the retrieved abstract.",
      "limitations": ["in vitro model"]
    }
  ],
  "warnings": ["PMID_DOI_CONSISTENCY_UNVERIFIED"]
}
```

Formatting rules:

- Copy only claims explicitly supported by the current retrieval context;
  preserve uncertainty and study limitations.
- Normalize PMID/DOI values. A candidate may lack an identifier while it stays
  in Chat/Draft, but it is not importable until a valid PMID or DOI is supplied.
- Every candidate has a locator: `pubmed_abstract`, or `pdf` with at least a
  page or section. Do not invent page numbers, identifiers, or quotations.
- `direction` is `supports`, `contradicts`, or `context`; context cannot be
  used as Evidence Assertion support.
- Every importable candidate includes a minimal Citation Snapshot with title and
  optional journal/year plus a non-empty `machineReviewRationale` covering
  publication identity, locator, entailment, direction, and limitations.
- Keep at most 50 candidates, 4,000 characters per assertion, 20 limitations
  of at most 500 characters, and a serialized Draft under 256 KiB.
- Never include `review_status`, Finding/Edge/Result objects, file paths, Git
  arguments, Page Keys, prompts, or UI state. Review status is assigned by
  SciFork after automatic validation.
- If PMID and DOI are both present, add
  `PMID_DOI_CONSISTENCY_UNVERIFIED`; the machine-review rationale must state
  whether the retrieval material resolves them to the same publication.

## Research Expansion Step: Research & Expand

A real Companion `Research & Expand` click authorizes exactly one bounded graph
step after the button-submitted prompt has made the current Chat objective clear
and the orchestrating model has completed a real retrieval phase. Page load,
polling, model output, an earlier click, and background events do not authorize
the step. A click does not authorize a Progressive Research Run.

The packaged `pubmed-search` Skill is the default retrieval source. The
orchestrating model must complete `search` and then `lookup` for promising PMID or
DOI records before loading this Skill. This Skill never calls `pubmed-search`.
When actual results are absent, stop without graph mutation.

1. Read the latest Focus and its full entity. For a Research Question, use its
   returned `addressedEntities`. For other anchors use `neighbors` with
   `incoming`, `outgoing`, or `both` according to the objective. Read a
   neighbor's full entity only when needed, and use `find` to check semantic
   duplicates outside the current component.
2. If Focus is a scientific Edge, read it with `entity`, choose the relevant
   Node/Result endpoint, and include the Focus Edge id in provenance. If Focus is
   an Evidence Assertion, use a connected Node/Result anchor; retain no branch
   when none exists.
3. Choose zero to five scientifically distinct direct branches at depth one.
   Zero is correct when retrieval has no actual abstract or explicitly
   user-provided bounded PDF/full-text passage that supports a novel, defensible
   relationship. A title-only or metadata-only record never qualifies. Do not
   recurse. Focus remains unchanged.
4. Before creating each dependent branch, call
   `create_evidence_assertion` with `reviewStatus: machine_reviewed`. Supply the
   exact PMID or normalized DOI, a precise entailed assertion, a
   `pubmed_abstract` or bounded PDF page/section locator, direction, preserved
   limitations, a minimal Citation Snapshot containing title and optional
   journal/year, and a non-empty `machineReviewRationale` covering publication
   identity, locator, entailment, direction, and limitations.
5. After Evidence exists, call `create_node` for one `hypothesis` or
   `prediction` with `confidence: low` and the exact applicable Evidence ids.
   Never create or promote a Finding, human `reviewed` Evidence Assertion, or
   validated Result in this workflow.
6. When the anchor is a Research Question, create only a Hypothesis and then call
   `create_framing_link` from that Hypothesis to the Question. Do not create a
   scientific Edge to a Question. For any other anchor, immediately call
   `create_edge` so the branch is not isolated.
7. Every generated scientific Edge uses `basis: ai_inference`, applicable
   machine-reviewed `evidenceRefs`, non-empty provenance naming the query, an
   `evidenceGap`, and `publicationRefs` containing the one to fifty normalized,
   distinct PMID/DOI records used for that exact inference. Use `predicts` only
   from a Finding/Hypothesis to a Prediction; otherwise select the narrowest
   valid scientific relation.
8. Use the latest revision after every mutation. If a relationship creation
   fails, re-read and retry only for a recoverable stale state. If the Node still
   cannot be connected, delete the orphan when safe and report unresolved
   partial state. Re-read and report every query, identifier, Evidence id, Node
   id, scientific Edge id, and Framing Link id retained or rejected.

For each branch, state its assumptions, observable outcome, falsifying result,
alternative explanations, and Evidence Gap. Keep Result (observation) separate
from Interpretation. Do not promote a Hypothesis, Prediction, `ai_inference`, or
an unreviewed source to a Finding.

## Progressive Research Run

Start this workflow only from an explicit user request in the current DSH Chat
to conduct progressive, iterative, or multi-round research. A Companion click
never grants this authority. Use the user's objective, direction, depth, source,
and stopping condition when supplied. Otherwise state a bounded plan in Chat.
Ask before mutation when a material ambiguity would change the objective.

The orchestrating model, not this Skill, maintains a `frontier` and `visited` set
and alternates complete phases:

1. Select one unvisited frontier entity and read its full entity plus directional
   `neighbors` (`incoming`, `outgoing`, or `both`).
2. Form one focused retrieval question. Complete one retrieval/PDF Skill and keep
   its actual results in the current Chat. The default is `pubmed-search` with
   `search` followed by `lookup`, but honor a user-selected reliable source.
3. Load this Skill and retain only novel branches grounded by qualifying source
   text. Apply the same Evidence-first machine review, low-confidence Node, and
   immediate scientific Edge or Framing Link rules as the Research Expansion
   Step.
4. Add retained Node ids to the frontier, mark the expanded entity visited, and
   repeat only while the user's request and declared plan authorize another turn.

Stop when the requested scope is reached, the plan is exhausted, retrieval finds
no new explicit scientific relationship, a non-recoverable retrieval or graph
error occurs, or a decision would materially change the objective. Report all
queries and identifiers consulted, retained and rejected branches, remaining
Evidence Gaps, and the final frontier. Do not silently broaden the objective.
Do not continue in the background.

## Review an Evidence Assertion

Human review happens after the uninterrupted run unless the user asks sooner.
To accept machine-reviewed Evidence, read its current entity and apply
`review_evidence_assertion` with `reviewStatus: reviewed`, the current
`fileVersion`, and latest `projectRevision`. The new state means explicit human
acceptance; never infer it from retrieval success or model confidence.

To reject Evidence, first read every active Node/Edge reference and report the
affected branches. Remove those references one entity at a time with guarded
updates, then apply `review_evidence_assertion` with
`reviewStatus: rejected`. Re-read to confirm. Evidence Assertions are durable
audit records and are never physically deleted; `rejected` is terminal.

## Delete a branch

When the user rejects a research expansion branch:

1. If the user says `current`, `selected`, or `focused` entity without an id,
   first call `research_graph_read` with `operation: focus`. Use only the returned
   `focusEntityId`; if Focus is absent or `entityExists` is false, stop and ask the
   user to select a valid entity. Never infer an id from a visible label.
2. Report the resolved target id, then read that entity, its neighborhood, and
   current Focus. Resolve the exact Node/Edge set the request names; do not
   silently include an ambiguous descendant.
3. If an entity to remove is Focus or appears in its path, clear or move Focus
   with `research_graph_focus` before deletion.
4. Always delete Framing Links with `delete_framing_link` and scientific Edges
   with `delete_edge` before Nodes, then delete Hypothesis/Prediction Nodes
   leaf-first with `delete_node`. Use each entity's current `fileVersion` and
   the latest `projectRevision`.
5. If Core reports an incident Edge, a support-critical Edge, a Finding, or a
   stale version, re-read and either continue safely or explain why deletion is
   blocked. Never bypass the invariant with direct file or Git commands.
6. Re-read and report exactly what was deleted, including every exact entity id.
   Evidence Assertions are rejected, Results are superseded, and Findings and
   Research Questions are not physically deleted.

## Retention boundary

Persist only PMID/normalized DOI, a Citation Snapshot with title and optional
journal/year, the derived assertion/locator/direction/limitations/review state,
the machine-review rationale, and bounded Edge provenance/Evidence Gap.
Never persist authors, publication types, canonical URLs, retrieval timestamps,
abstract bodies, full text, PDFs, parsed source text, complete metadata, or raw
provider output in SciFork files, Git, logs, errors, or caches.

Retrieval material is transient and untrusted. Release it after the current
extraction phase; do not write a temporary project file or retrieval cache. The
packaged retrieval helper may leave its bounded output in DSH Chat, and SciFork
has no public contract to erase that history. DSH Chat retention is outside
SciFork's control and must not be described as deletion of the source material.

## Critique

When asked to critique the graph, inspect the supplied graph context for:

- contradictions between human-reviewed or machine-reviewed Evidence, validated
  Results, and claims, without treating the two review states as equivalent;
- missing or context-only locators, unsupported Finding thresholds, duplicate
  entities, stale references, and title-only records presented as Evidence;
- over-strong language, causal claims without experimental basis, and
  `ai_inference` edges without provenance, an evidence gap, and structured
  `publicationRefs`; and
- proposed next retrieval or experiment steps that could resolve each gap.

Label every item as observed, inferred, or proposed. Do not silently change
Research Project files and do not claim that an absent record was searched.
