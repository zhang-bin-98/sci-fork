# SciFork

[English](README.md) | [简体中文](README.zh-CN.md)

[![Release workflow](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a local, Git-native biomedical Research Graph plugin for
[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). DSH
Chat remains the conversation surface. SciFork adds a same-origin Graph
Companion beside it and turns an ordinary Research Project into a rebuildable,
auditable graph.

## What SciFork does

Research work often mixes publication claims, team observations, and ideas that
still need testing. SciFork keeps those things distinct while making their
relationships easy to inspect:

- **Research Project as the source of truth.** Markdown and JSON files in a
  local Git repository hold the project. The graph, summaries, and model
  context are projections that can be rebuilt.
- **A focused graph companion.** Open the responsive Companion from DSH's
  `Research Graph` action. It runs on the existing DSH Web origin, with no
  second server, database, login, or cloud sync.
- **Evidence with review boundaries.** An Evidence Assertion stores a PMID or
  normalized DOI, a precise locator, and a bounded citation snapshot.
  `machine_reviewed` evidence can guide exploration; only human-reviewed
  evidence or a validated Result can support a Finding.
- **Literature-grounded expansion.** A real `Research & Expand` click performs
  one retrieval-first, connected step with zero to five low-confidence direct
  branches. Focus does not move and the action never recurses in the
  background.
- **Two small Skills.** `pubmed-search` retrieves PubMed records and bounded
  abstracts. `scifork-research` formats retrieved material into an import draft
  and guides guarded graph changes through SciFork's typed tools. Retrieval
  happens before formatting. PubMed supports its full query syntax, paged
  metadata (up to 300 records per page), and PMID/DOI lookup with an optional
  bounded abstract.
- **Local Git checkpoints.** Successful mutations attempt a minimal commit of
  SciFork-managed paths on the current branch. Branches, remotes, history
  recovery, and sharing remain under the user's control.

## Model at a glance

```text
Research Question
       | addresses (framing link)
       v
Hypothesis ---- supports / contradicts ----> Finding
       ^                                      ^
       | predicts                             | supported by
Prediction                             reviewed Evidence
                                                ^
                                                | PMID / DOI + locator
                                      Publication Reference
```

An open inquiry is a **Research Question**, not an unqualified hypothesis.
Research-team observations are **Results**, separate from their
interpretation. A **Framing Link** says that a claim addresses a question; it is
not a scientific edge. Publication identity stays directly on Evidence; SciFork
does not create a Publication or Source node. Machine-reviewed Evidence is
provisional and cannot satisfy a Finding or literature-edge threshold. See
[CONTEXT.md](CONTEXT.md) for the complete domain language.

## Current status

The repository contains the implemented M0 compatibility baseline and M1 Core,
M2 Companion, and M3 Research milestones. The current package is `dsh-scifork`
`0.0.1`, pinned to the public DSH `0.1.1-rc.2` contracts. Treat this as an
early, compatibility-pinned release: the DSH preview APIs and the research
workflow may evolve together.

The DSH bundle surface is intentionally small: `index.js` is the plugin entry,
`package.json#dsh.bundle.patch` points to `cordis.patch.yml`, and the browser
bundle is exposed as `exports["./client"]`. The package contains one
first-party bundle; it does not depend on another DSH plugin.

## Install

### Requirements

- DSH `0.1.1-rc.2` with the Web profile
- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.23.0` (Corepack is recommended)
- A loopback DSH Web server (`127.0.0.1`)

Use the Web profile rather than a base-only profile: SciFork needs DSH's Web,
filesystem, sandbox policy, tools, storage, session, and subprocess services.

### From a GitHub Release

Each release contains one prebuilt tarball and a sibling SHA-256 file. Download
both assets from [Releases](https://github.com/zhang-bin-98/sci-fork/releases),
then verify the tarball before installing it.

On Linux:

```sh
sha256sum -c dsh-scifork-0.0.1.tgz.sha256
```

On macOS:

```sh
shasum -a 256 -c dsh-scifork-0.0.1.tgz.sha256
```

On Windows PowerShell:

```powershell
$asset = 'dsh-scifork-0.0.1.tgz'
$checksum = $asset + '.sha256'
$expected = (Get-Content $checksum).Split()[0].ToLowerInvariant()
$actual = (Get-FileHash $asset -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'SHA-256 verification failed' }
```

Install the verified archive into the DSH Web profile and start DSH from the
directory that contains your Research Project:

```sh
dsh plugin --profile web add ./dsh-scifork-0.0.1.tgz
dsh --profile web
```

Run `/research init` in DSH to create a project, then choose **Research Graph**
in the sidebar. `/research validate` reports the current project diagnostics
and revision. To remove the plugin later:

```sh
dsh plugin --profile web remove dsh-scifork
```

The `dsh plugin` command forwards its remaining arguments to pnpm in the
selected profile. Restart or refresh DSH after installing or removing a bundle.

### From a checkout

Use this path when developing SciFork or reviewing a change:

```sh
corepack pnpm install
corepack pnpm check
dsh plugin --profile web add .
dsh --profile web --dump-config
```

`pnpm check` runs strict TypeScript checks, the Vitest suite, and the production
build. The final command should show exactly one `scifork` bundle entry. Build
the package before installing a checkout; the release tarball always contains
the generated `dist/` assets.

## Typical workflow

1. Open a Research Project and run `/research init` once.
2. State an open inquiry. The `scifork-research` Skill records it as a
   Research Question and keeps its scope assumptions explicit.
3. Use `pubmed-search` (or another retrieval/PDF Skill) to obtain real source
   material, then load `scifork-research` to format and validate an import
   draft.
4. Review the graph in the Companion. Evidence is hidden by default; use
   **Show evidence** when you need the citation layer.
5. Select a question or claim and click **Research & Expand** for one bounded
   literature-first step. A running Chat queues the request; an idle Chat
   starts it. Ask for a Progressive Research Run explicitly in DSH Chat when a
   multi-level exploration is appropriate.
6. Review machine-reviewed Evidence before accepting it as human-reviewed.
   Only then can it contribute to a Finding's support threshold.
7. Run `/research validate` before sharing a project or creating a checkpoint.

## Safety and data boundaries

SciFork is designed for local research data:

- The Web server must remain loopback-only, and the Companion is same-origin
  with DSH. Page Keys are session- and project-bound, kept in memory and
  window-scoped storage, and never used as paths or query values.
- Publications, PDFs, abstracts, Drafts, Results, and Markdown are untrusted
  data. Markdown HTML, scripts, and automatic remote resources are disabled.
- SciFork retains only the minimal publication identity, citation snapshot,
  derived assertion, review rationale, and bounded edge provenance. It does not
  cache complete metadata, abstracts, PDFs, full text, or raw provider responses.
- Retrieval output may remain in the current DSH Chat; SciFork does not expose a
  contract for deleting that Chat history.
- Check whether a project contains PHI, PII, or controlled-access data before
  committing or sharing its Git repository. SciFork never uploads research data
  automatically.

Read [SECURITY.md](SECURITY.md) before using real research data.

## Scope and non-goals

The current release intentionally does not provide a second chat UI, automatic
background research, recursive button actions, a remote backend, a database,
cloud sync, full-text ingestion, automatic MeSH expansion, PubTator, caching,
RAG, or SciFork-owned Git history recovery. It also does not depend on
`dsh-better-sidebar` or any other third-party DSH plugin.

## Development and release

The repository is one pnpm package and one first-party DSH bundle. Useful
commands are:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm verify:pack
corepack pnpm check
```

The only GitHub Actions workflow currently present is
[release.yml](.github/workflows/release.yml). It is triggered by a pushed tag
matching the broad `v*` pattern; it is **not** a pull-request or ordinary branch
CI workflow. The workflow then requires the exact `v<package.json version>`
tag on the default branch, selected license metadata and a packaged license file,
and a clean, passing package check before publishing one tarball and its
checksum to a new GitHub Release. It never creates tags, pushes branches,
publishes to npm, or runs the separate DSH smoke exercise.

Before enabling releases on GitHub, configure an active `v*` tag ruleset and
restrict tag creation, update, deletion, and bypass to release maintainers.
See [GitHub Release Automation](docs/specs/github-release-automation.md) for
the full contract and failure behavior.

GitHub Releases is the current distribution channel. This repository does not
publish to npm or automatically register a DSH plugin-market listing; any
marketplace submission, if available for your DSH deployment, is a separate
maintainer-managed step.

To make a release, a maintainer updates `package.json#version`, commits and
merges that change into the default branch, then creates and pushes the exact
matching tag:

```sh
git tag v0.0.1
git push origin v0.0.1
```

The tag push starts the workflow. The workflow does not change the version,
create tags, or push branches on your behalf.

## Documentation

- [Product design](docs/scifork-product-design.md)
- [Software architecture](docs/scifork-software-architecture.md)
- [Domain language](CONTEXT.md)
- [M0 compatibility spike](docs/specs/m0-compatibility-spike.md)
- [Progressive research expansion](docs/specs/progressive-research-expansion.md)
- [Research Questions and machine-reviewed Evidence](docs/specs/research-questions-machine-review.md)
- [Security policy](SECURITY.md)

## Contributing

Read [AGENTS.md](AGENTS.md) for the repository's specification-driven and
test-driven development rules. For a non-trivial change, update the relevant
specification first, derive focused tests, run `corepack pnpm check`, and keep
the change on a work branch. Please do not include research data, credentials,
Page Keys, prompts, or local paths in issues or pull requests.

## License

SciFork is available under the [MIT License](LICENSE). Third-party dependencies
and any copied material remain subject to their own licenses and notices.
