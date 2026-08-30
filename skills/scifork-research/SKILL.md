# SciFork Research

This is SciFork's single research-formatting and reasoning Skill. It consumes
retrieval or PDF results already present in the current DSH Chat context. It
does not browse, call another Skill, or write a Research Project. Persistence
always goes through SciFork typed tools after explicit user confirmation.

## Orchestration order

1. Load and use one retrieval/PDF Skill. Keep its raw result in Chat context.
2. Load this Skill and record the actual retrieval Skill name in
   `producer.retrievalSkill`.
3. For import, emit one complete `ResearchImportDraft` and wait for SciFork
   validation and the user's candidate-by-candidate selection.
4. Convert accepted candidates to one `import_draft_item` command each, using
   the latest `projectRevision`. Never batch unreviewed content into a Finding.

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

## Simulation

For a Focus simulation, produce a clearly labeled proposal containing:

- the Focus id and the visible claim/result summary;
- a Hypothesis or Prediction, explicitly marked unverified;
- a plausible mechanism path and the assumptions behind it;
- a next experiment with observable outcome and falsifying result; and
- a critique listing evidence gaps, contradictions, alternative explanations,
  and which statements would require reviewed Evidence Assertions or validated
  Results.

Keep Result (observation) separate from Interpretation. Do not promote a
Hypothesis, Prediction, `ai_inference`, or an unreviewed candidate to a
Finding. Simulation is reasoning, not persistence; use typed commands only
after the user asks to save a specific entity and Core validation succeeds.

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
