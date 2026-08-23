# SciFork

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a Git-native biomedical Research Graph that works alongside DeepSeek
Harness (DSH). DSH remains the conversation surface; SciFork opens a same-origin
standalone Companion that can float beside DSH or use the operating system's
side-by-side layout.

## Current status

This repository is a design-stage, minimal installable DSH bundle scaffold. The
implementation remains intentionally empty until the compatibility spike pins
the exact DSH preview contracts.

The lean MVP design has these boundaries:

- One package and one first-party bundle contain Core, Host, DSH Bridge,
  Companion assets, one `SciFork Research` Skill, and one lightweight PubMed
  retrieval Skill.
- The Companion uses `/scifork/*` on the existing DSH Web origin, is
  loopback-only, and opens no extra port.
- The page has one responsive layout; there are no Compact/Workspace modes.
- Clicking `Simulate` automatically submits to the corresponding DSH Chat.
  An idle Chat starts immediately; a running Chat queues the request.
- A lightweight PubMed Skill supports full PubMed queries, paged metadata
  batches of up to 300 records, and PMID/DOI lookup. It does not implement
  automatic MeSH expansion, PubTator, full text, caching, or RAG.
- The model may use another retrieval or PDF Skill instead, then load
  `SciFork Research` to format the current results as a `Research Import Draft`.
  SciFork validates the Draft; research-team data remains a Result.
- Git uses the current branch, managed-path checkpoints, and one-step
  Back/Forward. Branches and remotes remain the user's or DSH's responsibility.
- `DSH-better-sidebar v0.15.2` is a fixed implementation reference, never a
  dependency, peer dependency, profile entry, or runtime provider.

Read the [product design](docs/scifork-product-design.md), [software
architecture](docs/scifork-software-architecture.md), and [domain
language](CONTEXT.md) before implementation.

## Bundle contract

- Package: `dsh-scifork`
- Bundle manifest: `package.json#dsh.bundle`
- Configuration layer: `cordis.patch.yml`
- Plugin entry point: `index.js`

For a local compatibility check:

```sh
dsh plugin --profile web add .
dsh --profile web --dump-config
```

The dumped configuration should contain exactly one `scifork` loader entry.

## Release requirements

- Pin and smoke-test the exact DSH WebServer, additive overlay, scoped
  `SessionInput.setDraft + submit`, Skills, filesystem, and subprocess
  contracts.
- Distribute one prebuilt, auditable `.tgz` from GitHub Releases.
- Verify a fresh DSH Web profile can install, open, run Simulate, and uninstall
  SciFork without any third-party plugin.
- Document loopback security, Git sharing, sensitive-data handling,
  compatibility, and upgrade behavior.

## License

No license has been selected yet. The package is marked `UNLICENSED` until the
project owner makes that choice explicitly. Any future copied code must preserve
the corresponding upstream license notice.
