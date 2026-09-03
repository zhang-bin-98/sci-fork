# SciFork Research Model

SciFork describes an evolving biomedical research state. Its language separates literature evidence, research-team results, interpretations, and unverified scientific claims.

## Language

**Research Project**:
A bounded body of scientific work with one evolving research state and an auditable history.
_Avoid_: Workspace, database

**Research Graph**:
A projection of the current research state that connects claims, results, and their relationships.
_Avoid_: Knowledge database, paper graph

**Research Question**:
An open-ended, user-originated inquiry that frames retrieval and candidate explanations without asserting a scientific fact or carrying confidence.
_Avoid_: Hypothesis, research topic, prompt

**Framing Link**:
An organizational `frames` link from a Research Question to a Hypothesis or Finding in its scope; it is not a scientific relationship or evidence-bearing Edge.
_Avoid_: Evidence edge, supports, parent-child link

**Publication Reference**:
A PMID or normalized DOI that uniquely identifies the publication behind an Evidence Assertion; PMID is canonical when both are available.
An unreviewed Research Expansion Edge may also retain bounded Publication References as retrieval provenance; those references do not become Evidence Assertions or satisfy a Finding support threshold.
_Avoid_: Source, publication node, citation record

**Citation Snapshot**:
A bounded title, journal, and year retained with an Evidence Assertion so a person can identify its publication; the Publication Reference remains the publication identity.
_Avoid_: Publication entity, full metadata, article record

**Evidence Assertion**:
A reviewable scientific assertion derived from an identified publication, with a precise locator, direction, limitations, and review state.
_Avoid_: Paper, source record, summary

**Machine-reviewed Evidence Assertion**:
An Evidence Assertion that passed automated identity, locator, entailment, direction, and limitation checks against real retrieval material; it can guide provisional research but cannot satisfy a Finding support threshold.
_Avoid_: Reviewed Evidence, accepted fact, human-reviewed evidence

**Human-reviewed Evidence Assertion**:
An Evidence Assertion explicitly accepted by a person after review and stored with `reviewed` status; only this review state can provide literature support for a Finding.
_Avoid_: Machine-reviewed evidence, automatically accepted evidence

**Result**:
A recorded observation or output produced by the research team, kept separate from its interpretation.
_Avoid_: Finding, conclusion, user-result node

**Finding**:
An interpreted scientific claim that meets the project's support threshold through human-reviewed Evidence Assertions or validated Results.
_Avoid_: Result, paper finding, established fact

**Hypothesis**:
A plausible scientific claim that does not yet meet the support threshold.
_Avoid_: Finding, speculation

**Prediction**:
A testable consequence derived from a Hypothesis or Finding.
_Avoid_: Hypothesis, forecast

**Research Expansion Step**:
A single user-started, literature-grounded expansion from the current Focus that retains only connected, unverified claims with explicit scientific relationships.
_Avoid_: Simulation, recursive run, background research

**Progressive Research Run**:
A Chat-directed sequence of Research Expansion Steps that follows one stated research objective by automatically selecting exactly one newly retained Hypothesis after each step as the sole continuation; other retained claims remain terminal side branches for that run.
_Avoid_: Background crawler, button recursion, scheduled simulation

**Evidence Candidate**:
A transient proposed Evidence Assertion awaiting automatic validation. It is persisted only after machine-review requirements pass, and then enters the Research Project as `machine_reviewed` rather than `candidate`.
_Avoid_: Evidence Assertion, search result

**Research Import Draft**:
A transient structured package of Evidence Candidates produced outside SciFork's persistence boundary.
_Avoid_: Imported evidence, Research Project, accepted evidence

**Retrieval Material**:
Untrusted metadata, abstracts, full text, PDFs, or parsed text available only while a retrieval phase runs; SciFork retains no original article or complete retrieval response after the run.
_Avoid_: Evidence, project attachment, publication archive

**Focus**:
The Research Question, claim, result, Evidence Assertion, or relationship currently grounding the user's conversation and visual center within the Research Graph.
_Avoid_: Selection, active node, filtered subgraph

**Confidence Band**:
A qualitative assessment of support strength (`low`, `moderate`, or `high`), not a calibrated probability.
_Avoid_: Probability, confidence score

**Research Checkpoint**:
An auditable saved state created after a successful SciFork scientific operation.
_Avoid_: Save, snapshot file
