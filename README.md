# SciFork

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a Git-native biomedical Research Graph that works alongside DeepSeek
Harness (DSH). DSH remains the conversation surface; SciFork opens a same-origin
standalone Companion that can float beside DSH or use the operating system's
side-by-side layout.

## Current status

The M0 compatibility spike pinned the exact DeepSeek Harness `0.1.1-rc.2`
preview contracts ([spike spec](docs/specs/m0-compatibility-spike.md)) and
introduced the pnpm, strict TypeScript, Vitest, esbuild, and build-time Tailwind CSS toolchain.

M1 (Core + Git) is implemented ([M1 spec](docs/specs/m1-core-git.md)): the
pure-TypeScript Core (strict schemas, front-matter parser, cross-entity
validation with the Finding support threshold, rebuildable projection, typed
single-entity commands, and Research Import Draft validation), plus the Host
Project Locator, the three model tools (`research_graph_read`,
`research_graph_apply`, `research_graph_focus`), the `/research init | open |
validate` commands, Focus storage, and current-branch managed-file checkpoints.
Every create, update, and delete plan validates its complete candidate project
before Host writes or checkpoints a file, so cross-entity invariant failures
remain read-only.
Git history recovery remains the responsibility of DSH Chat or the user.

M2 Companion is implemented ([M2 spec](docs/specs/m2-companion.md)): the
same-origin standalone React graph, Session/project-bound Page Keys, strict
snapshot/entity/Focus APIs, safe Details rendering, visible-only polling, and
the originating-Session `setDraft + submit` Bridge transaction. The Companion
keeps the complete non-Evidence projection visible by default; `Show evidence`
reveals the Evidence layer, while Focus only recenters and highlights the graph.
Its single-row header, typed color-dot cards, responsive Details drawer, and
in-card hover expansion use one Tailwind-owned visual system plus only minimal
document-base normalization and bounded React Flow/Markdown-specific CSS. The
specified refinement uses default `sm/md/xl` breakpoints, a warm-white/green
Research action, and a compact two-row Details header: exact type/publication-review/Focus
metadata first, then a borderless full-ID text control for click/keyboard copy.
Hypothesis/Prediction cards retain their exact scientific type and distinguish
unique publications, machine-reviewed Evidence, and human-reviewed Evidence.
The renewed automated, build, and package gates pass for the default-breakpoint
and quiet-ID refinement; its browser breakpoint matrix remains pending. The
approved disposable pinned DSH release-tarball exercise remains passed.
M3 Research is implemented ([M3 spec](docs/specs/m3-research.md)): the
dependency-free PubMed helper supports full Entrez query pages up to 300 metadata
records and PMID/DOI lookup with an optional bounded PubMed abstract, and both
packaged Skills contain the Draft,
research-expansion, progressive-research, and critique protocols. The approved
disposable DSH `0.1.1-rc.2`
v0.0.1 release-tarball exercise verified directory `resourceBase` discovery,
ordered Skill loading, real PubMed search and DOI lookup, Draft formatting and
machine-reviewed import, typed mutation/checkpoint, Focus, idle and queued
prompt submission, Page Key invalidation on restart, and uninstall with the
Git Research Project preserved.

The implemented [literature-grounded research expansion](docs/specs/progressive-research-expansion.md)
refines the earlier [bounded branch workflow](docs/specs/simulation-branches.md).
The approved [Research Question and machine-reviewed Evidence
specification](docs/specs/research-questions-machine-review.md) further adds
open Research Questions, non-scientific `addresses` Framing Links, automatic
Evidence-first review, post-run human audit, and a strict retrieval-retention
boundary.
The Companion now exposes a one-hop `Research & Expand` action that asks the model
to complete PubMed search and abstract lookup before retaining zero to five
connected, low-confidence branches. Each retained branch first persists a
`machine_reviewed` Evidence Assertion grounded in real abstract or bounded
user-provided PDF/full-text material; title-only metadata cannot qualify.
`research_graph_read` provides compact directional
neighbor reads, Focus remains unchanged, and multi-round Progressive Research
Runs require an explicit user request in DSH Chat. Guarded Edge-first branch
deletion now includes Framing Links, while Evidence is rejected rather than
physically deleted.
The pinned disposable DSH `0.1.1-rc.2` exercise verified a real one-click step and
a two-level Chat-authorized run, including per-level PubMed retrieval,
`frontier`/`visited` updates, connected persistence, explicit stopping, and an
unchanged Focus. It also exposed and verified a lossless-JSON fix for clearing
and reading an empty Focus.

All M0 gates remain recorded as passing: clean-package assembly, real DSH
HTTP/Git/Skill catalog, install/uninstall, runtime HMR unload/reload, sequential
Skill loading, and scoped Research Expansion submission.

Build and verify before installing from a checkout:

```sh
corepack pnpm install
corepack pnpm check   # typecheck + vitest + build
```

The currently implemented v0.0.1 baseline has these boundaries:

- One package and one first-party bundle contain Core, Host, DSH Bridge,
  Companion assets, one `SciFork Research` Skill, and one lightweight PubMed
  retrieval Skill.
- The Companion uses `/scifork/*` on the existing DSH Web origin, is
  loopback-only, and opens no extra port.
- The page has one responsive layout; there are no Compact/Workspace modes.
- Clicking `Research & Expand` automatically submits to the corresponding DSH Chat.
  An idle Chat starts immediately; a running Chat queues the request.
- An open-ended initial inquiry is a Research Question, not a Hypothesis.
  Hypotheses/Findings connect to it through a non-scientific `addresses`
  Framing Link.
- The click authorizes one literature-first, non-recursive step to retain zero to
  five direct branches. Every retained branch is preceded by machine-reviewed
  Evidence and contains a low-confidence Hypothesis/Prediction connected by a
  scientific Edge or, for a Question answer, a Framing Link; Focus does not
  change.
- A lightweight PubMed Skill supports full PubMed queries, paged metadata
  batches of up to 300 records, and PMID/DOI lookup with an optional abstract.
  It does not implement
  automatic MeSH expansion, PubTator, full text, caching, or RAG.
- Only the PubMed Skill exposes its package-owned directory through DSH's
  directory `resourceBase`; the model resolves `helper.mjs` relative to that
  directory without searching the installation or writing project intermediates.
- The model may use another retrieval or PDF Skill instead, then load
  `SciFork Research` to format the current results as a `Research Import Draft`.
  Every import and authorized expansion uses the same automatic checks and stores
  only qualifying minimal `machine_reviewed` Evidence. Only explicit human
  acceptance becomes `reviewed`, and only human-reviewed
  Evidence or validated Results can satisfy a Finding. Research-team data
  remains a Result. An explicitly
  requested Progressive Research Run may alternate completed retrieval and graph
  phases while maintaining a transient frontier and visited set.
- SciFork persists only PMID/DOI, a minimal Citation Snapshot, derived Evidence
  fields, review rationale, and bounded Edge provenance/gaps. It never stores or
  caches complete metadata, authors, publication types, retrieval URLs/times,
  abstracts, full text, PDFs, parsed source text, or raw provider responses.
  DSH Chat may retain bounded Skill output; SciFork cannot delete that history.
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
# Use an existing DSH Web profile; a base-only profile lacks the Web services
# required by SciFork.
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
- Verify an isolated DSH Web profile containing the pinned first-party base and
  Web app layers can install, open, run retrieval/import, execute one
  `Research & Expand` step, complete one Chat-authorized Progressive Research
  Run, restart, and uninstall SciFork without any third-party plugin.
- See [SECURITY.md](SECURITY.md) for loopback security, Git sharing,
  sensitive-data handling, compatibility, and upgrade behavior.

## License

No license has been selected yet. The package is marked `UNLICENSED` until the
project owner makes that choice explicitly. Any future copied code must preserve
the corresponding upstream license notice.
