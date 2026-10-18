# SciFork Security

SciFork is a local companion for DeepSeek Harness (DSH). It is not a hosted service and does not add a port, database, login system, cloud sync, or remote Git operation.

## Network boundary

The DSH server must listen on `127.0.0.1` (both desktop and Web). Companion `/scifork/api/*` endpoints are same-origin, require a loopback socket peer, a loopback `Host` header, exact JSON `Content-Type`, and bounded request bodies; browser requests must supply an `Origin` that matches `Host` (the desktop `dsh-app://` renderer omits `Origin` on loopback fetches, while any mismatched `Origin` is rejected). Host serves no static asset routes; the Companion mounts as a right-sidebar tab under DSH's application CSP without loading remote resources, frames, or objects.

A Page Key is a 256-bit random capability bound to one live DSH Session and Research Project. It is minted in the `/scifork/api/launch` JSON response body, held only in client plugin memory (and passed to the tab body via props), and never placed in a URL, query string, fragment, `sessionStorage`, log, or repository, nor accepted as a path, project id, or Git argument. Keys are revoked when the tab body unmounts (closing, hiding, or switching sessions with `keepMounted: false`), when the Session closes, when the project changes, on bundle unload, or on Host restart.

SciFork makes no external network requests. Literature retrieval runs in DSH Chat through user-installed external retrieval plugins, the harness web search fallback, or user-pasted source text.

## Research data and Git

Publications, PDFs, Drafts, Results, and Markdown are untrusted data. They are never treated as instructions, scripts, or HTML to execute. Research Project files are read, created, and updated only through DSH's filesystem boundary and are contained under the Session-derived project root. The pinned DSH filesystem contract has no delete operation, so a Core-validated typed delete removes one Core-derived managed path with fixed arguments: `git rm -- <path>`. SciFork checkpoints only its managed paths on the current branch; it does not recover or rewrite history, manage branches, use remotes, or run destructive history, branch, or remote operations.

Review whether a project contains PHI, PII, or controlled-access data before committing. Git sharing, remote hosting, and repository permissions are the user's responsibility. SciFork never uploads research data automatically and does not choose a license for Research Project data. The SciFork software in this repository is distributed under the MIT License; project data may have separate ownership and sharing terms.

## Skills and model output

SciFork packages a single `scifork-research` Skill without a `resourceBase`. Retrieval runs externally in Chat context before `scifork-research` is loaded. For ordinary import, `scifork-research` formats a candidate `ResearchImportDraft`; Core validates the whole Draft, and qualifying items are persisted as minimal `machine_reviewed` Evidence Assertions. The same automatic checks apply to an authorized Research Expansion or Progressive Research Run. Persistence requires an actual abstract or explicitly user-provided bounded PDF/full-text passage, PMID/DOI, locator, Citation Snapshot, and machine-review rationale. Title-only metadata cannot qualify, and machine review never satisfies a Finding or literature-Edge threshold; only explicit human acceptance can produce `reviewed` Evidence. Skills do not call each other or write project files directly. A Draft cannot declare reviewed evidence or directly create a Finding, Edge, or Result.

SciFork persists no complete retrieval record. Project files, Git checkpoints, logs, errors, and caches may contain only PMID/normalized DOI, a minimal Citation Snapshot, derived Evidence fields, machine-review rationale, and bounded Edge provenance/Evidence Gap. They must not contain authors, publication types, canonical URLs, retrieval times, abstract/full-text bodies, PDFs, parsed source text, complete metadata, or raw provider responses. External retrieval plugins or web search leave their output in DSH Chat, and SciFork has no public contract to delete DSH Chat history.

Do not put Page Keys, prompts, Draft bodies, abstracts, sensitive research data, or local absolute paths in SciFork logs, errors, Drafts, Research Projects, issue reports, or public repositories.

## Compatibility and upgrades

The bundle is pinned to the public DSH `0.2.1-rc.2` contracts (desktop `0.2.1-rc.2`, nightly channel, and same-version Web; see `docs/specs/dsh-desktop-right-sidebar.md`). When a desktop auto-update moves the runtime off the pinned version, the Companion displays an `Unverified DSH version` warning banner until re-pinned. Install a released prebuilt tarball only after checking its file list and the sibling `.sha256` file. From a directory containing both downloads, run `sha256sum -c dsh-scifork-<version>.tgz.sha256`. On Windows PowerShell, compare the first field in that file with `(Get-FileHash dsh-scifork-<version>.tgz -Algorithm SHA256).Hash`. Before upgrading, keep a Git checkpoint and verify the Research Project with `/research validate`. Uninstalling the bundle leaves ordinary project files and DSH Sessions readable; history recovery remains a DSH/user operation.

Report suspected vulnerabilities privately to the project owner rather than publishing Page Keys, research content, or local paths in a public issue.
