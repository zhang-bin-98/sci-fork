---
status: accepted
---

# Let the LLM orchestrate bounded simulation branches with primitive tools

SciFork treats a real `Simulate & Save` click as authorization to persist every
valid branch from one bounded run, rather than introducing a Simulation Draft,
batch transaction, or graph editor. The LLM and `scifork-research` Skill choose
and sequence primitive single-entity commands; Core still enforces low-level
shape, evidence, relation, stale-write, and deletion invariants. This favors a
convenient breadth of exploration and adaptable LLM workflows while accepting
multiple checkpoints and recoverable partial progress instead of adding a second
workflow engine.
