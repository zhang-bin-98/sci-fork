# PubMed Search (M0 stub)

PubMed Search runs full Entrez queries, paged metadata batches up to 300
records, and PMID/DOI lookup through the bundled helper script. The helper
lands with M3; this M0 stub exists so the skill is discoverable and loadable
before `scifork-research`.

- Search results stay in the Chat context.
- Never fabricate records on network failure or invalid responses.
- Never call other Skills; never write SciFork files.
