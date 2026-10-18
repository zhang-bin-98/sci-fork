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

### Requirements

- DSH `0.2.1-rc.2` — DeepSeek Harness desktop `0.2.1-rc.2`, or the same-version Web profile
- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.23.0` (Git source builds require Corepack and its pnpm shim)
- Git with `user.name` and `user.email` configured
- DSH listening on local loopback only (`127.0.0.1`) — the desktop app does
  this by default; the Web profile is started from your project directory

### Install into the DeepSeek Harness desktop app (recommended)

The desktop app is the primary surface. Quit it completely (including the
tray icon) before changing its plugin profile — the app owns
`~/.dsh/profiles/desktop` and must not be modified while running.

The `dsh` CLI is not on `PATH` by default. Either register it from the
desktop app's menu (the post-install CLI registration action), or call the
bundled CLI directly:

```sh
"C:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add .\dsh-scifork-0.0.3.tgz
```

Source installation uses the same command with the Git URL:

```sh
"...\dsh.cmd" plugin --profile desktop add git+https://github.com/zhang-bin-98/sci-fork.git
```

Reopen the app. SciFork appears in the right-sidebar guide and the sidebar
footer action. A desktop nightly auto-update moves the runtime to an
unverified version; the Companion then shows an Unverified DSH version
banner until SciFork is re-pinned.

### Install into the DSH Web profile

The Web profile serves the same client bundle at loopback. Start it from the
directory you want to use as the Research Project:

```sh
dsh --profile web
```

### Install from GitHub source

Enable the Corepack pnpm shim before installing:

```sh
corepack enable pnpm
```

If `corepack` is missing (including Node.js 25+ installations), install it
first with `npm install --global corepack`, then enable the shim. This makes
nested `pnpm install` calls select the version pinned by SciFork.

An `ERR_PNPM_BAD_PM_VERSION` error can mean that a different global pnpm is
handling Git preparation even when the outer command uses Corepack. Run
`corepack enable pnpm` and retry from a terminal using that shim. In a SciFork
checkout, `corepack pnpm exec pnpm --version` must print `11.23.0`;
`corepack pnpm verify:source` checks this and performs an isolated source install.

Source installation is supported starting with `v0.0.2`. DSH Plugin Hub
uses this route when SciFork has no npm package. The install builds `dist/`
locally from the Git source:

```sh
dsh plugin --profile web add git+https://github.com/zhang-bin-98/sci-fork.git
```

If pnpm blocks the Git dependency's `prepare` script, use the exact
`allowBuilds` key and profile `pnpm-workspace.yaml` path printed by DSH, then
run the same command again. Do not guess or broaden the allowed key.

After installation, restart DSH if it is already running.

### Install from GitHub Releases

Use the prebuilt archive when you want to verify the published checksum or
avoid running the source build locally.

1. Download `dsh-scifork-0.0.3.tgz` and
   `dsh-scifork-0.0.3.tgz.sha256` from the
   [GitHub Releases page](https://github.com/zhang-bin-98/sci-fork/releases).
2. Put both files in the same directory and verify the archive.

Linux:

```sh
sha256sum -c dsh-scifork-0.0.3.tgz.sha256
```

macOS:

```sh
shasum -a 256 -c dsh-scifork-0.0.3.tgz.sha256
```

Windows PowerShell:

```powershell
$archive = 'dsh-scifork-0.0.3.tgz'
$expected = (Get-Content "$archive.sha256").Split()[0].ToLowerInvariant()
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'SHA-256 verification failed' }
```

3. Install the verified archive into the DSH Web profile.

```sh
dsh plugin --profile web add ./dsh-scifork-0.0.3.tgz
```

4. Start DSH from the directory you want to use as the Research Project.

```sh
dsh --profile web
```

If DSH was already running, restart it after installation. To uninstall the
plugin later, run the same command with `remove`:

```sh
dsh plugin --profile web remove dsh-scifork
```

(For the desktop app, quit it first and use `--profile desktop remove`.)

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
