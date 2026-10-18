# SciFork

[![Release workflow](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml) [![DSH Plugin](https://img.shields.io/badge/DeepSeek_Harness-plugin-0f766e.svg)](https://github.com/topics/dsh-plugin) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![SciFork — Git-native biomedical Research Graph. Literature-grounded, local-first, and auditable.](docs/assets/scifork-banner.png)

[English](README.md) | [简体中文](README.zh-CN.md)

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a local, Git-native biomedical **Research Graph** plugin for
[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).
Retrieval plugins like `dsh-pubmed` find papers; SciFork turns what they find
into auditable research knowledge: every assertion is bound to a PMID/DOI and
a precise locator, machine review is separated from human review, claims can
only become Findings through an explicit evidence gate, and every change is a
local Git checkpoint over plain Markdown/JSON files. SciFork performs no
retrieval itself and is bound to no retrieval plugin — it consumes whatever
source you give it (an installed retrieval plugin, harness web search, or
pasted source text), and renders the whole project as a Research Graph tab in
the DSH right sidebar.

> **Early release:** SciFork `0.0.3` is pinned to the public interfaces in DSH
> `0.2.1-rc.2`. A desktop auto-update leaves the runtime unverified; the
> Companion then shows an Unverified DSH version banner until re-pinned.

## What you can do

- **Deep research** — ask for it in chat and SciFork runs a bounded
  multi-level research program: each level retrieves, saves machine-reviewed
  Evidence, keeps every qualifying branch, and automatically continues
  through exactly one new Hypothesis until your scope is covered.
- **One-click expansion** — select any entity and press **Research & Expand**
  for a single grounded step (at most five direct low-confidence branches).
- **Evidence you can audit** — every assertion carries its PMID/DOI, locator,
  and review rationale; machine-reviewed and human-reviewed are counted
  separately, and only human-reviewed Evidence (or a validated Result) can
  support a Finding.
- **A graph you can read** — organize Questions, Hypotheses, Predictions,
  Results, and Findings in the sidebar's **Main** and **Evidence** views.
- **Plain files + Git** — the project is ordinary Markdown/JSON; every change
  attempts a local Git checkpoint. No database, no cloud sync.

## Install

**From the Plugins panel (recommended):** open **Plugins** in the sidebar,
select **Add plugin**, enter `zhang-bin-98/sci-fork`, install (approve build
scripts if asked), then **Enable now**.

**From a chat:** ask the model — “install the DSH plugin `zhang-bin-98/sci-fork`”.

Both paths build the bundle locally from the Git source. To remove, use
**Remove** on the plugin's page.

## First use

Use a directory that is either outside another Git repository or is itself a
Git repository root. In DSH Chat, initialize the current directory once:

```text
/research init
```

SciFork creates the project files, initializes a local Git repository when the
directory does not already have one, and records a baseline checkpoint. Then
open **Research Graph** from the DSH right-sidebar guide or the sidebar footer
action.

A typical research flow is:

1. Describe the open biomedical question in DSH Chat. SciFork records it as a
   Research Question rather than treating it as an established claim.
2. Ask DSH to retrieve relevant literature, then import supported assertions
   into the project. Retrieval is external: complete an installed retrieval
   plugin such as `dsh-pubmed`, fall back to the harness web search, or paste
   source text; records without a qualifying PMID/DOI and real source text are
   skipped.
3. Open **Research Graph** to inspect the question, evidence, hypotheses,
   results, findings, and their relationships.
4. Select an entity and click **Research & Expand** when you want one bounded
   follow-up step. Multi-level exploration (deep research) starts only when
   you explicitly ask for a Progressive Research Run in the current DSH Chat.
5. Review machine-reviewed Evidence before accepting it as human-reviewed.
   Only human-reviewed Evidence or validated Results can support a Finding.
6. Check the project whenever needed:

```text
/research validate
```

The Research Graph tab is for navigation and inspection. Continue asking for
research, corrections, or graph changes in DSH Chat.

## Data and safety

SciFork is designed for local use on the DSH loopback server. Literature,
PDFs, model output, and project Markdown are treated as untrusted data, and the
Companion does not automatically load remote content. Retrieval output may
remain in the current DSH Chat even though SciFork does not store complete
abstracts or PDFs in the Research Project.

Before committing or sharing a Research Project, check it for PHI, PII, or
controlled-access data. See [SECURITY.md](SECURITY.md) for the complete data and
network boundaries.

## DSH ecosystem and distribution

SciFork follows the public DSH bundle contract: the package exports `name` and
`apply(ctx)`, declares its `cordis.patch.yml` through `package.json#dsh.bundle`,
and can be installed with the DSH plugin command. DSH recommends adding the
official [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) to public
plugin repositories for ecosystem discovery.

The independent community directory [DSH Plugin Hub](https://dsh-plugin.org)
scans that topic and may list matching repositories. It is not operated by or
endorsed by DeepSeek AI. The released `v0.0.1` tag remains tarball-only;
`v0.0.2` and later support both a GitHub source build and the checksum-backed
GitHub Release tarball. SciFork is not published to npm.

## License

SciFork is available under the [MIT License](LICENSE). Research Project data may
have separate ownership and sharing terms.
