# SciFork

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a Git-native biomedical Research Graph that works alongside DeepSeek
Harness (DSH). DSH remains the conversation surface; SciFork opens a same-origin
standalone Companion that can float beside DSH or use the operating system's
side-by-side layout.

## Current status

The M0 compatibility spike pinned the exact DeepSeek Harness `0.1.1-rc.2`
preview contracts ([spike spec](docs/specs/m0-compatibility-spike.md)) and
introduced the pnpm, strict TypeScript, Vitest, and esbuild toolchain.

M1 (Core + Git) is implemented ([M1 spec](docs/specs/m1-core-git.md)): the
pure-TypeScript Core (strict schemas, front-matter parser, cross-entity
validation with the Finding support threshold, rebuildable projection, typed
single-entity commands, and Research Import Draft validation), plus the Host
Project Locator, the three model tools (`research_graph_read`,
`research_graph_apply`, `research_graph_focus`), the `/research init | open |
validate` commands, Focus storage, and current-branch managed-file checkpoints.
Git history recovery remains the responsibility of DSH Chat or the user.

M2 Companion is implemented ([M2 spec](docs/specs/m2-companion.md)): the
same-origin standalone React graph, Session/project-bound Page Keys, strict
snapshot/entity/Focus APIs, safe Details rendering, visible-only polling, and
the originating-Session `setDraft + submit` Bridge transaction. The current
automated gates and desktop/narrow local browser checks pass. The disposable
pinned-DSH-profile smoke remains a separate approval-gated verification.
M3 Research is implemented ([M3 spec](docs/specs/m3-research.md)): the
dependency-free PubMed helper supports full Entrez query pages up to 300 metadata
records and PMID/DOI lookup, and both packaged Skills contain the Draft,
simulation, and critique protocol. An approved disposable DSH `0.1.1-rc.2`
exercise verified the static entry and method guard, `/research init`, ordered
Skill loading, a typed graph mutation/checkpoint, and originating-Session
Simulate submission. PubMed retrieval and Draft import remain explicit
action-time test gates; release-tarball E2E remains a separate release gate.

All M0 gates remain recorded as passing: clean-package assembly, real DSH
HTTP/Git/Skill catalog, install/uninstall, runtime HMR unload/reload, sequential
Skill loading, and scoped Simulate submission.

Build and verify before installing from a checkout:

```sh
corepack pnpm install
corepack pnpm check   # typecheck + vitest + build
```

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
- Git uses the current branch for a minimal managed-path commit attempt.
  SciFork does not own undo/redo or history recovery; branches and remotes remain
  the user's or DSH's responsibility.
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
- Run `corepack pnpm pack --dry-run` and confirm the tarball contains
  `dist/host`, `dist/client.js`, Companion assets, the PubMed helper, and both
  Skill files.
- Verify a fresh DSH Web profile can install, open, run Simulate, and uninstall
  SciFork without any third-party plugin.
- See [SECURITY.md](SECURITY.md) for loopback security, Git sharing,
  sensitive-data handling, compatibility, and upgrade behavior.

## License

No license has been selected yet. The package is marked `UNLICENSED` until the
project owner makes that choice explicitly. Any future copied code must preserve
the corresponding upstream license notice.
