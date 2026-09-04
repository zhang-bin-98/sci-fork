# SciFork

[English](README.md) | [简体中文](README.zh-CN.md)

[![Release workflow](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a local, Git-native biomedical Research Graph plugin for
[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). DSH
Chat remains the only conversation surface; SciFork opens a same-origin Graph
Companion for organizing research questions, hypotheses, evidence, results, and
findings.

Your Research Project remains a collection of ordinary Markdown and JSON files
in a local Git repository. The graph is a rebuildable view of those files, not
a separate database, and SciFork does not upload the project or add cloud sync.

> **Early release:** SciFork `0.0.1` is pinned to the public interfaces in DSH
> `0.1.1-rc.2`.

## What you can do

- Turn an open research question into a connected, inspectable Research Graph.
- Bring in literature evidence identified by PMID or DOI, including material
  retrieved from PubMed with the bundled Skill.
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

### Requirements

- DSH `0.1.1-rc.2` with the Web profile
- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.23.0` (Corepack is recommended)
- Git with `user.name` and `user.email` configured
- DSH Web configured for local loopback access (`127.0.0.1`)

### Install from GitHub Releases

1. Download `dsh-scifork-0.0.1.tgz` and
   `dsh-scifork-0.0.1.tgz.sha256` from the
   [GitHub Releases page](https://github.com/zhang-bin-98/sci-fork/releases).
2. Put both files in the same directory and verify the archive.

Linux:

```sh
sha256sum -c dsh-scifork-0.0.1.tgz.sha256
```

macOS:

```sh
shasum -a 256 -c dsh-scifork-0.0.1.tgz.sha256
```

Windows PowerShell:

```powershell
$archive = 'dsh-scifork-0.0.1.tgz'
$expected = (Get-Content "$archive.sha256").Split()[0].ToLowerInvariant()
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'SHA-256 verification failed' }
```

3. Install the verified archive into the DSH Web profile.

```sh
dsh plugin --profile web add ./dsh-scifork-0.0.1.tgz
```

4. Start DSH from the directory you want to use as the Research Project.

```sh
dsh --profile web
```

If DSH was already running, restart it after installation. To uninstall the
plugin later, run:

```sh
dsh plugin --profile web remove dsh-scifork
```

## First use

Use a directory that is either outside another Git repository or is itself a
Git repository root. In DSH Chat, initialize the current directory once:

```text
/research init
```

SciFork creates the project files, initializes a local Git repository when the
directory does not already have one, and records a baseline checkpoint. Then
click **Research Graph** in the DSH sidebar to open the companion.

A typical research flow is:

1. Describe the open biomedical question in DSH Chat. SciFork records it as a
   Research Question rather than treating it as an established claim.
2. Ask DSH to retrieve relevant literature, then import supported assertions
   into the project. The bundled PubMed Skill can search by PubMed query and
   look up a PMID or DOI.
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

SciFork is designed for local use on the DSH loopback Web server. Literature,
PDFs, model output, and project Markdown are treated as untrusted data, and the
Companion does not automatically load remote content. Retrieval output may
remain in the current DSH Chat even though SciFork does not store complete
abstracts or PDFs in the Research Project.

Before committing or sharing a Research Project, check it for PHI, PII, or
controlled-access data. See [SECURITY.md](SECURITY.md) for the complete data and
network boundaries.

## License

SciFork is available under the [MIT License](LICENSE). Research Project data may
have separate ownership and sharing terms.
