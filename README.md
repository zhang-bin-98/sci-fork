# SciFork

[![Release workflow](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml) [![DSH Plugin](https://img.shields.io/badge/DeepSeek_Harness-plugin-0f766e.svg)](https://github.com/topics/dsh-plugin) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![SciFork — Git-native biomedical Research Graph. Literature-grounded, local-first, and auditable.](docs/assets/scifork-banner.png)

[English](README.md) | [简体中文](README.zh-CN.md)

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a local, Git-native biomedical Research Graph plugin for
[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). DSH
Chat remains the only conversation surface; SciFork renders a Research Graph
tab in the DSH right sidebar (desktop and same-version Web) for organizing
research questions, hypotheses, evidence, results, and findings.

Your Research Project remains a collection of ordinary Markdown and JSON files
in a local Git repository. The graph is a rebuildable view of those files, not
a separate database, and SciFork does not upload the project or add cloud sync.

> **Early release:** SciFork `0.0.3` is pinned to the public interfaces in DSH
> `0.2.1-rc.2` (DeepSeek Harness desktop `0.2.1-rc.2`, nightly channel, or the
> same-version Web profile). A desktop auto-update leaves the runtime unverified;
> the Companion then shows an Unverified DSH version banner until re-pinned.

## What you can do

- Turn an open research question into a connected, inspectable Research Graph.
- Bring in literature evidence identified by PMID or DOI, including material
  from an installed retrieval plugin (for example `dsh-pubmed`), the harness
  web search fallback, or user-pasted source text.
- Keep research-team Results separate from interpretations and untested
  Hypotheses.
- Inspect the whole project in **Main** view or focus on an entity's direct
  assertions in **Evidence** view.
- Click **Research & Expand** to run one literature-grounded expansion from the
  current Focus. Each click is limited to one step and at most five direct,
  low-confidence branches.
- After a successful research change, attempt a local Git checkpoint containing
  only files that SciFork manages.

## Install

SciFork ships as a DSH plugin bundle (`dsh-scifork`). Install it from inside
DeepSeek Harness — no command line required.

Requirements: DSH `0.2.1-rc.2` (desktop or same-version Web) listening on
loopback only, and Git with `user.name` and `user.email` configured.

### Install from the Plugins panel (desktop and Web, recommended)

1. Open **Plugins** in the sidebar and select **Add plugin**.
2. Enter the Git repository address:

   ```text
   zhang-bin-98/sci-fork
   ```

3. Select **Install**. When a registry prompt appears, the mainland China
   mirror is offered automatically when GitHub is unreachable; if pnpm asks
   about build scripts, use the **Allow these scripts and retry** button the
   dialog offers. The install builds the bundle locally from the Git source.
4. Select **Enable now** when the install finishes. If the Research Graph
   entry does not appear right away, restart the app once.

If your setup enables the plugin-management agent tool, you can instead ask
the model in a chat to install `zhang-bin-98/sci-fork` for you.

### Install a verified release archive (optional)

1. Download `dsh-scifork-0.0.3.tgz` and its `.sha256` from the
   [GitHub Releases page](https://github.com/zhang-bin-98/sci-fork/releases)
   and verify the checksum (`sha256sum -c` on Linux, `shasum -a 256 -c` on
   macOS, or `Get-FileHash` on Windows).
2. In **Add plugin**, enter the archive's absolute local path.

### CLI (advanced)

The `dsh plugin` command installs into a named profile and is useful for
automation. Quit the desktop app completely before touching its profile; the
Web profile can be updated while running (restart DSH afterwards).

```sh
dsh plugin --profile desktop add git+https://github.com/zhang-bin-98/sci-fork.git
dsh plugin --profile web add ./dsh-scifork-0.0.3.tgz
```

Building the Git source locally requires Corepack's pnpm shim
(`corepack enable pnpm`; `corepack pnpm verify:source` in a checkout verifies
the isolated source install). To uninstall, use **Remove** on the plugin's
page, or `dsh plugin --profile <name> remove dsh-scifork`.

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
   follow-up step. Multi-level exploration starts only when you explicitly ask
   for a Progressive Research Run in the current DSH Chat.
5. Review machine-reviewed Evidence before accepting it as human-reviewed.
   Only human-reviewed Evidence or validated Results can support a Finding.
6. Check the project whenever needed:

```text
/research validate
```

The Graph Companion is for navigation and inspection. Continue asking for
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
