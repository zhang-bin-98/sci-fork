# SciFork M3: Research Skills and PubMed helper

> Status: v0.0.1 implemented; release E2E passed on 2026-08-30
> Parent design: [product design v0.11](../scifork-product-design.md) sections 7-9; [software architecture v0.12](../scifork-software-architecture.md) sections 10 and 16
> Compatibility baseline: DeepSeek Harness `0.1.1-rc.2`

## Problem

M1 and M2 provide a validated Research Project and a usable Companion, but the
packaged Skills are still M0 stubs. M3 must make literature retrieval and
evidence formatting useful without allowing a retrieval provider or model output
to bypass the Research Import Draft and user-review boundaries.

## Goals

1. Provide a deterministic PubMed helper for paged metadata search and PMID/DOI
   lookup using NCBI's JSON E-utilities.
2. Publish complete `pubmed-search` and `scifork-research` Skill instructions
   covering retrieval, Draft formatting, simulation, and critique.
3. Keep retrieval results in Chat context and require the formatter Skill to
   produce the existing Core-validated `ResearchImportDraft`.
4. Document loopback security, sensitive-data handling, compatibility, and the
   release tarball gate.

## Non-goals

- No new DSH tool, server, database, cache, provider framework, or remote sync.
- No automatic MeSH expansion, PubTator, full-text download, RAG, or article
  knowledge graph.
- The helper never writes a Research Project, calls another Skill, or creates a
  reviewed Evidence Assertion, Finding, Edge, or Result.
- No automatic network request from the Companion or on page/model load.

## Behavioral contract

### Helper invocation

The Host registers only `pubmed-search` with the pinned DSH directory resource
base:

```ts
resourceBase: {
  kind: 'directory',
  path: '<package>/skills/pubmed-search',
}
```

The Skill instructions explicitly reference the relative resource `helper.mjs`.
The DSH Skill loader exposes the base directory and instructs the model to
resolve that relative path before executing the packaged Node ESM CLI. The model
must not search user or DSH directories, guess an installation path, copy the
helper into the Research Project, or create an intermediate request file.
Requests use stdin by default:

```text
<compact JSON request> | node <resolved-resource-base>/helper.mjs
```

The helper also accepts one JSON request argument for hosts that cannot pipe
stdin. It writes exactly one compact JSON value to stdout and diagnostics to
stderr. Raw upstream JSON/XML is not returned or saved. The request is one of:

```ts
type PubMedRequest =
  | { operation: 'search'; query: string; retstart?: number; retmax?: number }
  | { operation: 'lookup'; identifier: { pmid?: string; doi?: string } }
```

`search` preserves PubMed query syntax, defaults `retstart` to `0` and `retmax`
to `20`, and accepts at most 300 records per page. It returns total `count`,
the requested page, `records`, and `nextRetstart` only when another page is
available. Each record contains only `pmid`, optional `doi`, `title`, optional
`journal`, optional four-digit `year`, simplified `authors`, and
`publicationTypes`.

`lookup` requires exactly one valid PMID or DOI. DOI lookup resolves the DOI to
the first PubMed PMID returned by Entrez, then returns the same deterministic
record shape plus a canonical PubMed URL and retrieval timestamp. An abstract
may be included only when supplied by the upstream response; it is never
fabricated.

The helper sends a descriptive User-Agent and optional `NCBI_EMAIL` and
`NCBI_API_KEY` environment values. Without an API key it spaces requests at
approximately three per second; with a key it spaces them at approximately ten
per second. Requests have a bounded timeout and a small bounded retry policy.
Invalid input, timeout, network failure, non-JSON or structurally invalid NCBI
responses, missing identifiers, and not-found lookups return a stable
`{ ok: false, error: { code, message } }` object and never synthetic records.

### Skill orchestration

Catalog descriptions are part of the routing contract because they are visible
before Skill bodies are loaded:

- `pubmed-search` describes concise PubMed search/PMID-or-DOI lookup, says to
  load and complete it before `scifork-research`, and says not to load both while
  retrieval is unfinished.
- `scifork-research` says it formats only real retrieval or PDF results already
  present in the current Chat context and does not perform retrieval.

`pubmed-search` is retrieval-only. The model loads and executes it first, keeps
its output in the current Chat context, and only then loads `scifork-research`
when formatting or reasoning is needed. Skills never call each other. If
`scifork-research` is loaded before real retrieval output exists, it waits for
that context and does not fabricate a Draft.

`scifork-research` may produce only a candidate `ResearchImportDraft`, a
simulation proposal, or a critique. A Draft must use `formatterSkill:
"scifork-research"`, preserve the actual retrieval Skill name, include a
locator for every candidate, and never claim `review_status: reviewed` or
directly create a Finding, Edge, or Result. SciFork Core validates the complete
Draft before the user selects candidates for one-at-a-time typed persistence.

## Constraints and interfaces

- The helper uses only Node 22+ built-ins and `fetch`; no runtime dependency is
  added. Its NCBI base URL is overrideable only for tests through
  `SCIFORK_PUBMED_BASE_URL`.
- The helper output is bounded to 512 KiB and search page size to 300.
- No prompt, abstract, Draft body, Page Key, or local absolute path is written to
  SciFork logs, errors, Drafts, or the Research Project. The package-owned Skill
  directory is intentionally model-visible in the local DSH Skill load result
  through directory `resourceBase` and may be retained in that DSH Session.
- Core and Companion contracts remain unchanged. Host's structural
  `SkillRegistration` contract gains the pinned public `resourceBase` member;
  no new service or dependency is added.

## Acceptance criteria

- [x] Helper validates requests, performs paged search, and exposes stable JSON
      errors for invalid input, network failure, timeout, and invalid responses.
- [x] Search metadata is limited to the documented fields and uses POST for
      metadata batches over 200 IDs.
- [x] PMID and DOI lookup normalize identifiers, return canonical URLs, and
      report not-found without fabricated data.
- [x] Both packaged Skills contain complete retrieval/Draft/simulation/critique
      instructions and preserve the Core import boundary.
- [x] Only `pubmed-search` exposes its package-owned directory as
      `resourceBase`; `helper.mjs` resolves from it without filesystem search or
      Research Project intermediates.
- [x] Catalog descriptions enforce retrieval-before-formatting, and
      `scifork-research` refuses to synthesize a Draft without real retrieval
      context.
- [x] Initialization failures and SciFork diagnostics do not disclose the
      package absolute path.
- [x] `SECURITY.md`, README status, and release tarball verification describe
      loopback, Git sharing, sensitive data, compatibility, and upgrade behavior.
- [x] `pnpm check`, `node --check index.js`, `git diff --check`, and
      `pnpm pack --dry-run` pass.

### Disposable DSH smoke

The approved v0.0.1 release-tarball exercise passed against pinned DSH
`0.1.1-rc.2` in an isolated profile and disposable Git Research Project. The
profile contained only the first-party base/Web layers and SciFork; no
third-party DSH plugin was installed.

The model first loaded only `pubmed-search`, received its directory
`resourceBase`, resolved `helper.mjs` without filesystem search or a request
file, and sent compact JSON through stdin. A real PubMed title search returned
two bounded records, and DOI lookup for `10.1016/j.cell.2019.06.002` resolved
PMID `31251913`. Only after retrieval completed did the model load
`scifork-research` and format a Draft containing both identifiers, a
`pubmed_abstract` locator, title-metadata limitations, and an explicit
PMID/DOI-consistency warning. Selecting one candidate created exactly one
candidate Evidence Assertion through `import_draft_item` and a Git checkpoint.
Invalid IDs and an attempted unreviewed evidence reference were rejected by
Core without a write.

The exercise then created one explicitly unverified, low-confidence Hypothesis
without a reviewed evidence link, created no Finding or Edge, and set Focus.
The Companion displayed that Focus, cleared the Page Key fragment, and real
user clicks produced `Started` for an idle Session and `Queued` for a busy
Session; the queued request began automatically after the current response.
Restart invalidated the old Page Key while preserving the DSH Session and
project, and a new launch restored the same Focus.

Finally, uninstall removed the package, Companion route, and overlay after the
DSH page was refreshed. The already-rendered overlay remained visible until
that refresh, which is a pinned DSH client unload limitation rather than a
SciFork data or routing failure. The disposable project remained clean on its
current `main` branch with its initialization, import, and Hypothesis commits;
no temporary absolute path or request artifact was written into the project.

## Test plan

- Unit/integration tests run the CLI against a local HTTP fixture and cover
  request validation, default and maximum pagination, POST batching, PMID/DOI
  lookup, empty results, malformed responses, timeout/network errors, and
  output bounds.
- Static checks verify Skill boundary language and that the package dry-run
  contains the helper, both Skill files, `SECURITY.md`, this M3 spec, and built
  assets.
- Host tests verify the exact `pubmed-search` directory `resourceBase`, absence
  of a resource base on `scifork-research`, resource disposal, and path-free
  initialization diagnostics.
- An offline workflow test proves retrieval output formatted by
  `scifork-research` passes Core Draft validation and becomes one candidate-only
  typed import command; identifier-free PDF candidates remain non-importable.
- Disposable pinned DSH E2E is never run implicitly. The approved v0.0.1 release
  exercise covers Skill discovery/loading, real PubMed retrieval and lookup,
  ordered Draft formatting/import, typed mutation, Focus, Simulate, restart,
  and uninstall in an isolated profile and disposable Research Project.
