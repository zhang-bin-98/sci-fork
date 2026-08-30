# SciFork M3: Research Skills and PubMed helper

> Status: Implementation slice complete; pinned DSH E2E remains approval-gated
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

The packaged helper is a Node ESM CLI:

```text
node skills/pubmed-search/helper.mjs < request.json
```

It also accepts one JSON request argument for hosts that cannot pipe stdin. It
writes exactly one JSON value to stdout and diagnostics to stderr. The request
is one of:

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

`pubmed-search` is retrieval-only. The model loads it first, keeps its output in
the current Chat context, and then loads `scifork-research` when formatting or
reasoning is needed. Skills never call each other.

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
- No prompt, abstract, Draft body, Page Key, or local absolute path is logged.
- Core, Host, Companion, and the pinned DSH contracts remain unchanged.

## Acceptance criteria

- [x] Helper validates requests, performs paged search, and exposes stable JSON
      errors for invalid input, network failure, timeout, and invalid responses.
- [x] Search metadata is limited to the documented fields and uses POST for
      metadata batches over 200 IDs.
- [x] PMID and DOI lookup normalize identifiers, return canonical URLs, and
      report not-found without fabricated data.
- [x] Both packaged Skills contain complete retrieval/Draft/simulation/critique
      instructions and preserve the Core import boundary.
- [x] `SECURITY.md`, README status, and release tarball verification describe
      loopback, Git sharing, sensitive data, compatibility, and upgrade behavior.
- [x] `pnpm check`, `node --check index.js`, `git diff --check`, and
      `pnpm pack --dry-run` pass.

## Test plan

- Unit/integration tests run the CLI against a local HTTP fixture and cover
  request validation, default and maximum pagination, POST batching, PMID/DOI
  lookup, empty results, malformed responses, timeout/network errors, and
  output bounds.
- Static checks verify Skill boundary language and that the package dry-run
  contains the helper, both Skill files, `SECURITY.md`, this M3 spec, and built
  assets.
- An offline workflow test proves retrieval output formatted by
  `scifork-research` passes Core Draft validation and becomes one candidate-only
  typed import command; identifier-free PDF candidates remain non-importable.
- Disposable pinned DSH E2E remains approval-gated and is not run implicitly.
