# SciFork Security

SciFork is a local companion for DeepSeek Harness (DSH). It is not a hosted
service and does not add a port, database, login system, cloud sync, or remote
Git operation.

## Network boundary

The DSH Web server must listen on `127.0.0.1`. Companion APIs are same-origin,
require a loopback peer and exact `Origin`/`Host` match, and use bounded JSON
requests. Static assets are allowlisted and served with a restrictive CSP. A
Page Key is random, bound to one live DSH Session and Research Project, kept in
memory and window-scoped storage, removed from the URL immediately, and never
accepted as a path, query, project id, or Git argument. Keys are revoked on
session disposal, project replacement, bundle unload, and Host restart.

The Companion makes no automatic external requests. The PubMed helper is an
explicit retrieval action initiated by the model through the packaged
`pubmed-search` Skill. NCBI requests use a bounded timeout, retry policy, rate
limit, and output size cap. Upstream failures are surfaced as structured
errors; no citation or abstract is synthesized.

## Research data and Git

Publications, PDFs, Drafts, Results, and Markdown are untrusted data. They are
never treated as instructions, scripts, or HTML to execute. Research Project
files are read, created, and updated only through DSH's filesystem boundary and
are contained under the Session-derived project root. The pinned DSH filesystem
contract has no delete operation, so a Core-validated typed delete removes one
Core-derived managed path with fixed arguments: `git rm -- <path>`. SciFork
checkpoints only its managed paths on the current branch; it does not recover or
rewrite history, manage branches, use remotes, or run destructive history,
branch, or remote operations.

Review whether a project contains PHI, PII, or controlled-access data before
committing. Git sharing, remote hosting, and repository permissions are the
user's responsibility. SciFork never uploads research data automatically and
does not choose a project license.

## Skills and model output

Retrieval Skills stay in Chat context. For ordinary import,
`scifork-research` formats a candidate `ResearchImportDraft`; Core validates
the whole Draft, and qualifying items are persisted as minimal
`machine_reviewed` Evidence Assertions. The same automatic checks apply to an
authorized Research Expansion or Progressive Research Run. Persistence requires
an actual abstract or explicitly user-provided bounded PDF/full-text passage,
PMID/DOI, locator, Citation Snapshot, and machine-review rationale. Title-only
metadata cannot qualify, and machine review never satisfies a Finding or
literature-Edge threshold; only explicit human acceptance can produce
`reviewed` Evidence. Skills do not call each other or write project files
directly. A Draft cannot declare reviewed evidence or directly create a Finding,
Edge, or Result.

SciFork persists no complete retrieval record. Project files, Git checkpoints,
logs, errors, and caches may contain only PMID/normalized DOI, a minimal Citation
Snapshot, derived Evidence fields, machine-review rationale, and bounded Edge
provenance/Evidence Gap. They must not contain authors, publication types,
canonical URLs, retrieval times, abstract/full-text bodies, PDFs, parsed source
text, complete metadata, or raw provider responses. The packaged helper emits a
bounded result without saving files; DSH Chat may retain that Skill output, and
SciFork has no public contract to delete DSH Chat history.

The pinned DSH Skill contract renders a directory `resourceBase` as an absolute
base directory in the model-facing Skill load result. SciFork uses this only for
the package-owned `pubmed-search` directory so the model can resolve the
explicitly referenced `helper.mjs`; `scifork-research` has no resource base. The
path can remain in the private local DSH Session. The model must not search
around that directory, repeat the path in user-facing prose, copy the helper or
request files into the Research Project, or include the path in a Draft.

Do not put Page Keys, prompts, or local absolute paths in SciFork logs, errors,
Drafts, Research Projects, issue reports, or public repositories. Keep Draft
bodies, abstracts, and sensitive research data out of logs, errors, issue
reports, and public repositories. The model-facing local DSH `resourceBase`
described above is the sole approved absolute-path exception.

## Compatibility and upgrades

The bundle is pinned to the public DSH `0.1.1-rc.2` contracts recorded in the
M0 compatibility spike. Install the released prebuilt tarball only after
checking its file list and the sibling `.sha256` file. From a directory
containing both downloads, run `sha256sum -c dsh-scifork-<version>.tgz.sha256`.
Before upgrading, keep a Git checkpoint and verify the Research Project with
`/research validate`. Uninstalling the bundle leaves ordinary project files and
DSH Sessions readable; history recovery remains a DSH/user operation.

Report suspected vulnerabilities privately to the project owner rather than
publishing Page Keys, research content, or local paths in a public issue.
