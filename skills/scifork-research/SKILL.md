# SciFork Research

This is SciFork's single research-formatting, graph-workflow, and reasoning
Skill. For evidence import it consumes actual retrieval or PDF results already
present in the current DSH Chat context. It can also simulate, critique, and
delete branches on an existing Research Graph without retrieval. It does not
browse, retrieve literature, call another Skill, or write project files
directly. If no actual retrieval or PDF results are present, do not produce a Draft;
wait for retrieval to complete. Persistence always goes through SciFork typed
tools and the authorization rules below.

## Orchestration order

For evidence import:

1. Load and use one retrieval/PDF Skill. Keep its raw result in Chat context.
2. Load this Skill and record the actual retrieval Skill name in
   `producer.retrievalSkill`.
3. Emit one complete `ResearchImportDraft` and wait for SciFork validation and
   the user's candidate-by-candidate selection.
4. Convert accepted candidates to one `import_draft_item` command each, using
   the latest `projectRevision`. Never batch unreviewed content into a Finding.

For graph simulation, critique, or deletion, load this Skill directly. Use
`research_graph_read` for current state, `research_graph_apply` for one guarded
entity mutation at a time, and `research_graph_focus` only for Focus. Entity
reads return `fileVersion` for update/delete commands. Always use the latest
returned `projectRevision` after a successful mutation.

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

## Simulation: Simulate & Save

A real Companion `Simulate & Save` click explicitly authorizes one bounded run
to persist every valid branch you actually propose. A direct user request in
the current Chat may provide the same authorization. Page load, polling, model
output, a saved branch, and background events do not.

1. Read Focus, its entity document, and its neighborhood. Check existing claims
   for semantic duplicates before creating anything.
2. Choose zero to five scientifically distinct branches at depth one. Zero is
   correct when the visible state does not justify a new direction. Do not recurse
   or trigger another simulation.
3. Each branch is one `hypothesis` or `prediction` Node with `confidence: low`.
   Never create or promote a Finding in this workflow.
4. Immediately after each `create_node`, call `create_edge` so no completed
   branch is isolated. Every generated Edge uses `basis: ai_inference` with
   non-empty provenance and `evidenceGap`.
5. Use `predicts` only from a Finding/Hypothesis to a Prediction. Otherwise
   choose the narrowest valid relation from `supports`, `contradicts`, `causes`,
   or `associated_with` based on the scientific claim.
6. If Focus is an Edge, choose the scientifically relevant Node/Result endpoint
   as anchor and include the Focus Edge id in provenance. If Focus is an
   Evidence Assertion, use a connected Node/Result anchor; if none exists, do
   not create an orphan branch.
7. Use the revision returned by `create_node` for `create_edge`. If Edge creation
   fails, re-read and retry only for a recoverable stale state. If the Node still
   cannot be connected, delete the orphan when safe and report any unresolved
   partial state.
8. Re-read the graph and report the exact Node and Edge ids saved or rejected.

For each branch, state its assumptions, observable outcome, falsifying result,
alternative explanations, and Evidence Gap. Keep Result (observation) separate
from Interpretation. Do not promote a Hypothesis, Prediction, `ai_inference`,
or an unreviewed candidate to a Finding.

## Delete a branch

When the user rejects a simulated direction:

1. Read the target entity, neighborhood, and current Focus. Resolve the exact
   Node/Edge set the request names; do not silently include an ambiguous
   descendant.
2. If an entity to remove is Focus or appears in its path, clear or move Focus
   with `research_graph_focus` before deletion.
3. Always delete Edges before Nodes with `delete_edge`, then delete
   Hypothesis/Prediction Nodes leaf-first with `delete_node`. Use each entity's
   current `fileVersion` and the latest `projectRevision`.
4. If Core reports an incident Edge, a support-critical Edge, a Finding, or a
   stale version, re-read and either continue safely or explain why deletion is
   blocked. Never bypass the invariant with direct file or Git commands.
5. Re-read and report exactly what was deleted. Evidence Assertions are rejected,
   Results are superseded, and Findings are not physically deleted.

## Critique

When asked to critique the graph, inspect the supplied graph context for:

- contradictions between reviewed evidence, validated Results, and claims;
- missing or context-only locators, unsupported Finding thresholds, duplicate
  entities, and stale references;
- over-strong language, causal claims without experimental basis, and
  `ai_inference` edges without both provenance and an evidence gap; and
- proposed next retrieval or experiment steps that could resolve each gap.

Label every item as observed, inferred, or proposed. Do not silently change
Research Project files and do not claim that an absent record was searched.
