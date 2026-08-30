# SciFork Research Model

SciFork describes an evolving biomedical research state. Its language separates literature evidence, research-team results, interpretations, and unverified scientific claims.

## Language

**Research Project**:
A bounded body of scientific work with one evolving research state and an auditable history.
_Avoid_: Workspace, database

**Research Graph**:
A projection of the current research state that connects claims, results, and their relationships.
_Avoid_: Knowledge database, paper graph

**Publication Reference**:
A PMID or normalized DOI that uniquely identifies the publication behind an Evidence Assertion; PMID is canonical when both are available.
_Avoid_: Source, publication node, citation record

**Evidence Assertion**:
A reviewable scientific assertion derived from an identified publication, with a precise locator, direction, limitations, and review state.
_Avoid_: Paper, source record, summary

**Result**:
A recorded observation or output produced by the research team, kept separate from its interpretation.
_Avoid_: Finding, conclusion, user-result node

**Finding**:
An interpreted scientific claim that meets the project's support threshold through reviewed Evidence Assertions or validated Results.
_Avoid_: Result, paper finding, established fact

**Hypothesis**:
A plausible scientific claim that does not yet meet the support threshold.
_Avoid_: Finding, speculation

**Prediction**:
A testable consequence derived from a Hypothesis or Finding.
_Avoid_: Hypothesis, forecast

**Simulation Branch**:
A bounded, unverified Hypothesis or Prediction retained from one user-started simulation and connected to the research state that grounded it.
_Avoid_: Simulation result, accepted finding, scenario record

**Evidence Candidate**:
A proposed Evidence Assertion awaiting human review and adoption into the Research Project.
_Avoid_: Evidence Assertion, search result

**Research Import Draft**:
A transient structured package of Evidence Candidates produced outside SciFork's persistence boundary.
_Avoid_: Imported evidence, Research Project, accepted evidence

**Focus**:
The claim, result, or relationship currently grounding the user's conversation and local graph view.
_Avoid_: Selection, active node

**Confidence Band**:
A qualitative assessment of support strength (`low`, `moderate`, or `high`), not a calibrated probability.
_Avoid_: Probability, confidence score

**Research Checkpoint**:
An auditable saved state created after a successful SciFork scientific operation.
_Avoid_: Save, snapshot file
