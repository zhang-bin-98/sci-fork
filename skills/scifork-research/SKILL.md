---
name: scifork-research
description: Format retrieved biomedical literature into reviewable SciFork import drafts, preserve retrieval-supported AI-inference branches with structured publication references, critique graph branches, and apply accepted graph changes through SciFork tools. Use after a literature-retrieval or PDF-reading skill has placed real source results in the current conversation.
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
3. Emit one complete `ResearchImportDraft` and wait for SciFork validation and
   the user's candidate-by-candidate selection.
4. Convert accepted candidates to one `import_draft_item` command each, using
   the latest `projectRevision`. Never batch unreviewed content into a Finding.

For graph expansion, the orchestrating model completes one retrieval phase first,
keeps the actual results in the current Chat, and only then loads this Skill for
graph decisions. For critique or deletion, load this Skill directly. Use
`research_graph_read` for current state, `research_graph_apply` for one guarded
entity mutation at a time, and `research_graph_focus` only when a workflow must
change Focus. Entity reads return `fileVersion` for update/delete commands.
Always use the latest returned `projectRevision` after a successful mutation.

Skills do not call each other and a retrieval result is not itself a Draft.

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
- Keep at most 50 candidates, 4,000 characters per assertion, 20 limitations
  of at most 500 characters, and a serialized Draft under 256 KiB.
- Never include `review_status`, Finding/Edge/Result objects, file paths, Git
  arguments, Page Keys, prompts, or UI state. The Draft is candidate-only.
- If PMID and DOI are both present, add
  `PMID_DOI_CONSISTENCY_UNVERIFIED`; user review decides whether they identify
  the same publication.

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

1. Read the latest Focus and its full entity. Use `neighbors` with `incoming`,
   `outgoing`, or `both` according to the objective; read a neighbor's full entity
   only when needed. Use `find` to check semantic duplicates outside the current
   component.
2. If Focus is an Edge, read it with `entity`, choose the scientifically relevant
   Node/Result endpoint, and use that endpoint as the anchor. Include the Focus
   Edge id in provenance. If Focus is an Evidence Assertion, use a connected
   Node/Result anchor; if none exists, retain no branch.
3. Choose zero to five scientifically distinct direct branches at depth one.
   Zero is correct when retrieval reveals no novel, defensible, explicit
   scientific relationship. Do not recurse. Focus remains unchanged.
4. Each branch is one `hypothesis` or `prediction` Node with `confidence: low`.
   Never create or promote a Finding, reviewed Evidence Assertion, or validated
   Result in this workflow.
5. Immediately after each `create_node`, call `create_edge` so no completed
   branch is isolated. Every generated Edge uses `basis: ai_inference` with
   non-empty provenance naming the query, an `evidenceGap` that states why the
   relation remains unverified, and `publicationRefs` containing the one to
   fifty normalized, distinct PMID/DOI records that support that exact inference.
   Copy these identifiers from completed retrieval results; never recover them
   by parsing prose provenance. These structured references do not create or
   review an Evidence Assertion and do not satisfy a Finding threshold.
6. Use `predicts` only from a Finding/Hypothesis to a Prediction. Otherwise choose
   the narrowest valid relation from `supports`, `contradicts`, `causes`, or
   `associated_with` based on the scientific claim.
7. Use the revision returned by `create_node` for `create_edge`. If Edge creation
   fails, re-read and retry only for a recoverable stale state. If the Node still
   cannot be connected, delete the orphan when safe and report any unresolved
   partial state.
8. Re-read the graph and report the retrieval query, consulted identifiers, and
   exact Node and Edge ids retained or rejected.

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
3. Load this Skill and retain only novel branches with an explicit scientific
   relationship. Apply the same low-confidence Node + immediate Edge rules and
   scientific boundaries as the Research Expansion Step.
4. Add retained Node ids to the frontier, mark the expanded entity visited, and
   repeat only while the user's request and declared plan authorize another turn.

Stop when the requested scope is reached, the plan is exhausted, retrieval finds
no new explicit scientific relationship, a non-recoverable retrieval or graph
error occurs, or a decision would materially change the objective. Report all
queries and identifiers consulted, retained and rejected branches, remaining
Evidence Gaps, and the final frontier. Do not silently broaden the objective.
Do not continue in the background.

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
4. Always delete Edges before Nodes with `delete_edge`, then delete
   Hypothesis/Prediction Nodes leaf-first with `delete_node`. Use each entity's
   current `fileVersion` and the latest `projectRevision`.
5. If Core reports an incident Edge, a support-critical Edge, a Finding, or a
   stale version, re-read and either continue safely or explain why deletion is
   blocked. Never bypass the invariant with direct file or Git commands.
6. Re-read and report exactly what was deleted, including every exact entity id.
   Evidence Assertions are rejected,
   Results are superseded, and Findings are not physically deleted.

## Critique

When asked to critique the graph, inspect the supplied graph context for:

- contradictions between reviewed evidence, validated Results, and claims;
- missing or context-only locators, unsupported Finding thresholds, duplicate
  entities, and stale references;
- over-strong language, causal claims without experimental basis, and
  `ai_inference` edges without provenance, an evidence gap, and structured
  `publicationRefs`; and
- proposed next retrieval or experiment steps that could resolve each gap.

Label every item as observed, inferred, or proposed. Do not silently change
Research Project files and do not claim that an absent record was searched.
