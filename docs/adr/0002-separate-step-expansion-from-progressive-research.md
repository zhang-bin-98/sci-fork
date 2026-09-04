---
status: accepted
---

# Separate one-step graph expansion from progressive research

The Companion action performs exactly one literature-grounded Research Expansion
Step from the current Focus and never recurses. A Progressive Research Run is a
separate `scifork-research` workflow authorized by an explicit user request in
DSH Chat, where the model chooses successive retrieval and graph-reading steps.
This keeps the button predictable, leaves research strategy in the conversation,
and avoids adding a scheduler, workflow engine, or hidden background crawler.
