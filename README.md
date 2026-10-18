# SciFork

[![Release workflow](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml) [![DSH Plugin](https://img.shields.io/badge/DeepSeek_Harness-plugin-0f766e.svg)](https://github.com/topics/dsh-plugin) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![SciFork — Git-native biomedical Research Graph. Literature-grounded, local-first, and auditable.](docs/assets/scifork-banner.png)

[English](README.md) | [简体中文](README.zh-CN.md)

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a biomedical **Research Graph** plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). DSH Chat stays your single conversation surface, while SciFork provides a visual Research Graph in the right sidebar to turn literature findings and discussions into structured, auditable research knowledge.

> **Current release:** SciFork `0.0.5` targets DSH `0.2.1-rc.2` (desktop and same-version Web).

## What you can do

- **Deep research** — ask for deep research in DSH Chat and SciFork runs a bounded multi-level exploration: each level retrieves literature, records machine-reviewed Evidence, keeps every qualifying branch, and automatically continues through the most promising new Hypothesis until your scope is covered.
- **One-click expansion** — select any node in the graph and click **Research & Expand** for a single grounded step outward (up to five direct candidate branches).
- **Two-stage evidence gate** — every Evidence assertion is bound to a PMID or DOI, a source locator, and a review rationale. Machine-reviewed Evidence can guide exploration, while only human-reviewed Evidence (or a validated team Result) can support an established **Finding**.
- **Two views** — see the full research structure in **Main** view or focus on a single node's direct assertions in **Evidence** view, with a **Details** panel for full Markdown notes and grouped citations.
- **Plain files + local Git** — your project lives in ordinary local Markdown and JSON files, and every change creates a local Git checkpoint on your current branch. You can connect the repository to GitHub or any remote of your choice.

## Views and research model

- **Main view (default)** — displays the complete research structure: starting from open **Research Questions**, it connects candidate **Hypotheses**, testable **Predictions**, research-team **Results**, and established **Findings**, showing how claims support, contradict, cause, or predict one another.
- **Evidence view** — available whenever the selected node has direct literature support. It isolates that node and its linked **Evidence** assertions so you can inspect the underlying literature without visual clutter; switching back to **Main** restores your focus on that node.
- **Details panel** — shows the selected item's full Markdown body, publication and review counts, and citations grouped into human-reviewed, machine-reviewed, rejected, and retrieval references. Click the ID at the top of the panel to copy it when you want to reference a specific item in Chat.

## Install and literature retrieval

**From npm (recommended, prebuilt — no build-script approval):** open **Plugins** in the DSH sidebar, select **Add plugin**, enter `dsh-scifork`, install, and click **Enable now**. (Available from the release after 0.0.5; until then use the tarball path below.)

**From the Plugins panel with a tarball:** select **Add plugin**, paste the release tarball URL (copy the `dsh-scifork-<version>.tgz` link from the [Releases page](https://github.com/zhang-bin-98/sci-fork/releases)), install, and click **Enable now**. The archive is prebuilt — no build-script approval is ever asked.

**Tracking development (Git address):** entering `zhang-bin-98/sci-fork` installs from source and follows the default branch, but every install/update runs a local build that pnpm's supply-chain policy blocks first: when it fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`, add the exact `allowBuilds` key printed in the error to the profile's `pnpm-workspace.yaml` and select **Retry** (the key changes with each commit).

**From a chat:** ask the model — “install the DSH plugin `zhang-bin-98/sci-fork`”.

To uninstall, select **Remove** on the plugin's page; your local research project files remain intact and readable.

### Pairing with literature retrieval

SciFork is not tied to a single database and works with real literature material in DSH Chat in this order:

1. **Retrieval plugin (recommended)** — install [`dsh-pubmed`](https://github.com/aiyacharley/dsh-pubmed) (tested with `0.4.4`, optional) or another literature/PDF plugin so the model can search papers and read abstracts automatically.
2. **Web search** — when no retrieval plugin is installed or results are insufficient, SciFork falls back to DSH's built-in web search.
3. **Pasted source text** — you can also paste abstracts or bounded PDF passages directly into Chat along with a valid PMID or DOI.

Across all paths, only records with a valid PMID or DOI and real abstract or passage text are accepted; title-only records are skipped and citations are never fabricated.

## Quick start

Choose an empty directory or the root of a Git repository (not a subdirectory inside another Git repo, and make sure Git `user.name` and `user.email` are configured). Initialize the directory once in DSH Chat:

```text
/research init
```

Then open **Research Graph** from the right-sidebar guide card or the **Research Graph** button at the bottom of the left sidebar:

1. **Ask a research question** — describe an open biomedical question in DSH Chat; SciFork records it as your starting Research Question and focuses it in the graph.
2. **Retrieve and expand** — ask DSH to retrieve literature and import evidence; select a node and click **Research & Expand** for a single step, or ask in Chat for **deep research** to explore across multiple levels.
3. **Review and promote** — switch between **Main** and **Evidence** views to inspect claims and sources, then ask in Chat to accept verified machine-reviewed assertions as human-reviewed Evidence (or critique, edit, or delete weak branches) to advance a Hypothesis into a Finding.
4. **Check project health** — validate your project at any time in Chat:

```text
/research validate
```

The Research Graph tab is a read-only surface for browsing, focusing nodes, and triggering one-step expansion. Day-to-day questions, deep research, edits, branch deletion, and Git history recovery all happen in DSH Chat.

## Data and safety

SciFork runs locally and never uploads your research data or adds cloud sync. Project files store only PMIDs/DOIs, article titles, journals, years, and derived assertions with locators — full abstracts and PDFs are never written into your repository.

Before committing or sharing a project, check that it does not contain protected health information (PHI/PII) or controlled-access data. See [SECURITY.md](SECURITY.md) for details.

## License

SciFork is available under the [MIT License](LICENSE). Your research project data remains yours and may carry its own ownership and sharing terms.
