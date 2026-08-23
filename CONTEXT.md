# SciFork Research Model

SciFork describes an evolving biomedical research state. Its language separates source material, auditable evidence, observations, interpretations, and unverified scientific claims.

## Language

**Research Project**:
A bounded body of scientific work with one evolving research state and an auditable history.
_Avoid_: Workspace, database

**Research Graph**:
A projection of the current research state that connects claims, results, and their relationships.
_Avoid_: Knowledge database, paper graph

**Source**:
A publication, dataset, attachment, or other identifiable material from which evidence can be located.
_Avoid_: Evidence, Finding

**Evidence Assertion**:
A reviewable scientific assertion tied to a Source and a precise locator, with its direction, model, limitations, and review state.
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

**Evidence Candidate**:
A proposed Evidence Assertion awaiting human review and adoption into the Research Project.
_Avoid_: Evidence Assertion, search result

**Focus**:
The claim, result, or relationship currently grounding the user's conversation and local graph view.
_Avoid_: Selection, active node

**Confidence Band**:
A qualitative assessment of support strength (`low`, `moderate`, or `high`), not a calibrated probability.
_Avoid_: Probability, confidence score

**Research Checkpoint**:
An auditable saved state created after a successful scientific operation or restoration.
_Avoid_: Save, snapshot file
