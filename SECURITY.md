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
files are read and written only through DSH's filesystem boundary and are
contained under the Session-derived project root. SciFork checkpoints only its
managed paths on the current branch; it does not recover history, change
branches, use remotes, or run destructive Git commands.

Review whether a project contains PHI, PII, or controlled-access data before
committing. Git sharing, remote hosting, and repository permissions are the
user's responsibility. SciFork never uploads research data automatically and
does not choose a project license.

## Skills and model output

Retrieval Skills stay in Chat context. `scifork-research` formats a candidate
`ResearchImportDraft`; Core validates the whole Draft, and the user selects
individual candidates before persistence. Skills do not call each other or
write project files. A Draft cannot declare reviewed evidence or directly
create a Finding, Edge, or Result. PMID/DOI and locator information must come
from the retrieval context.

The pinned DSH Skill contract renders a directory `resourceBase` as an absolute
base directory in the model-facing Skill load result. SciFork uses this only for
the package-owned `pubmed-search` directory so the model can resolve the
explicitly referenced `helper.mjs`; `scifork-research` has no resource base. The
path can remain in the private local DSH Session. The model must not search
around that directory, repeat the path in user-facing prose, copy the helper or
request files into the Research Project, or include the path in a Draft.

Do not put Page Keys, prompts, Draft bodies, abstracts, local absolute paths,
or sensitive research data in SciFork logs, errors, Drafts, Research Projects,
issue reports, or public repositories. The model-facing local DSH
`resourceBase` described above is the sole approved absolute-path exception.

## Compatibility and upgrades

The bundle is pinned to the public DSH `0.1.1-rc.2` contracts recorded in the
M0 compatibility spike. Install the released prebuilt tarball only after
checking its file list and checksum. Before upgrading, keep a Git checkpoint
and verify the Research Project with `/research validate`. Uninstalling the
bundle leaves ordinary project files and DSH Sessions readable; history
recovery remains a DSH/user operation.

Report suspected vulnerabilities privately to the project owner rather than
publishing Page Keys, research content, or local paths in a public issue.
