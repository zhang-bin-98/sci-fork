# SciFork M2 Companion

> Status: Implemented; automated re-verification passed on 2026-08-31; renewed default-breakpoint browser check pending
> Date: 2026-08-31
> Parent design: [product design v0.18](../scifork-product-design.md) sections 3, 6.3, and 14; [software architecture v0.19](../scifork-software-architecture.md) sections 8, 9, 12, 15.3, and 16
> Compatibility baseline: DeepSeek Harness `0.1.1-rc.2`
> Action semantics: the historical `Simulate & Save` contract below is superseded
> by [literature-grounded research expansion](progressive-research-expansion.md).
> Historical baseline: parent-version references and the superseded wire section
> record M2 as implemented at that time; current behavior is defined by the
> linked refinements and the v0.19/v0.20 umbrella documents.

## Problem

M1 provides the rebuildable projection, project locator, Focus sidecar, and
current-branch Git behavior, but `/scifork` is not yet a usable Companion.
The M0 client still opens an unauthenticated placeholder and exposes a direct
spike Simulate button. M2 must add the standalone graph experience without
creating another backend, trusting browser-supplied paths, or sending a prompt
to a different DSH Session.

## Goals

1. Open one same-origin standalone Companion from the additive DSH action.
2. Bind every page to one live Session and Research Project with a 256-bit Page
   Key that never enters a query, repository, log, or Chat command result.
3. Expose bounded snapshot, entity, and Focus POST APIs over the existing DSH
   Web origin.
4. Render the complete Research Graph, graph-highlighted Focus path, and safe read-only,
   collapsible Details in one responsive React layout; Focus only recenters and
   highlights after Host acknowledgement.
5. Poll only while the page is visible and detect project, branch, HEAD, Focus,
   and validation changes through fresh Host reads.
6. Submit a bounded simulation prompt to the exact originating Session through
   a scoped BroadcastChannel and the public `setDraft + submit` transaction.

## Non-goals

- No embedded DSH panel, second persisted layout mode, graph search, saved
  coordinates, Back/Forward stack, direct graph editing/deletion, import UI,
  WebSocket, SSE, CORS, new port, login, database, or remote synchronization.
- No arbitrary project or attachment path supplied by the browser. M2 renders
  relative attachment references inert; a future contained attachment endpoint
  requires an explicit design decision.
- No automatic action on page load, polling, model output, or background events.
- No direct use of private DSH React components, DOM click simulation, or
  unexported send functions.
- No Page Key in `/research open` output. The command directs the user to the
  `Open Research Graph` action; exposing a keyed URL in command text would
  violate the Page Key data boundary.

## Pinned DSH Contracts

M0 contracts remain authoritative for `ctx.webServer.register`,
`sidebar.footer.action`, `ctx.sessions.scope(id)`, and
`ctx.conversation.input.for(scope).setDraft + submit`.

M2 additionally pins these public `0.1.1-rc.2` faces:

- `dsh-session/lib/types/index.d.ts`: Host `ctx.sessions.get(id)` returns the
  live Session or `undefined`; `Session.header.cwd` is the immutable validated
  absolute working directory.
- `dsh-session/lib/types/index.d.ts`: `ctx.on('session/disposed', session =>
  ...)` reports removal of a live Session and supplies `session.id`.
- `dsh-client-runtime/lib/types/client/sessions/service.d.ts`: the client
  Session list snapshot has `byId[id].running`, used only to label an accepted
  submit as `started` or `queued`.
- `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts`:
  `sidebar.footer.action` is a root-scoped list slot rendered before
  `sidebar.settings`; every entry receives `{ wide: boolean }`, with false
  representing the collapsed rail.

The Host adds `sessions` to its hard injections. These structural faces stay in
`src/host/contracts.ts`; SciFork does not add a runtime dependency on a DSH
package.

## Behavioral Contract

### Page Key and Open

SciFork registers exactly one `sidebar.footer.action` entry. In the wide
sidebar it is a full-width row with a package-owned Graph icon and `Research
Graph` label above Settings. In the collapsed rail it becomes a 36 px icon-only
button with `Open Research Graph` as its tooltip and accessible name. It uses no
private DSH component, class, DOM query, or layout mutation. The slot owner
controls placement relative to any other footer actions.

The click handler synchronously opens `about:blank`, captures the current
Session scope, then POSTs `{ sessionId }` to `/scifork/api/launch`. The Host:

1. enforces the loopback socket and exact HTTP Origin/Host boundary;
2. resolves the live Session through `ctx.sessions.get(sessionId)`;
3. derives the project only from `session.header.cwd` and loads it through the
   existing Project Locator;
4. creates 32 cryptographically random bytes encoded as unpadded base64url; and
5. stores an in-memory binding `{ sessionId, sessionCwd, projectRoot,
   projectId? }` and returns `/scifork#key=<page-key>`.

The Bridge creates the key-derived channel before navigating the blank window.
If popup creation or launch fails, it retains no channel, closes the blank page
when possible, and notifies the originating composer. It never opens a fallback
Session.

Bindings have no persistent or configurable TTL. They remain valid only while
the exact Session is live and the same project remains at the bound root. They
are revoked on `session/disposed`, bundle unload, Host restart, project-root
change, or valid manifest project-id replacement.

The Companion accepts a key from the `#key=` fragment, validates it, writes it
to window-scoped `sessionStorage`, and immediately removes the complete fragment
with `history.replaceState`. Reload may reuse that window's stored key. An
invalid or revoked key clears the stored value and shows only `Reopen from DSH`.

The Page Key is sent in `X-SciFork-Page-Key`. It is never accepted in a URL,
query, request body, project path, or Session id field. The BroadcastChannel
name is the fixed versioned prefix plus the random key; unpredictability comes
from the 256-bit key.

### Routes and Request Boundary

The registered paths are:

```text
prefix /scifork                 allowlisted static Companion assets
POST   /scifork/api/launch      create Page Key
POST   /scifork/api/snapshot    read bounded projection summaries
POST   /scifork/api/entity      read one managed entity document
POST   /scifork/api/focus       update Focus sidecar
```

The bare `/scifork` path is the canonical Companion entry and serves the SPA
shell directly. A request for the legacy directory-style `/scifork/` path
returns HTTP `308` with `Location: /scifork`. Static assets remain absolute
allowlisted paths below `/scifork/`, so entry-path resolution does not depend on
directory URL semantics.

The M0 `/scifork/api/spike` route is removed; M1 real Git tests supersede its
runtime probe. Exact API routes remain registered separately from the static
prefix.

Every JSON request requires an exact `application/json` media type, a body no
larger than 64 KiB, a numeric loopback peer, and an `Origin` exactly equal to
the current HTTP Host. Bodies are strict objects:

```ts
type LaunchRequest = { sessionId: string }
type SnapshotRequest = { sinceProjectRevision?: string }
type EntityRequest = { entityId: string }
type FocusRequest = { entityId: string }
```

The three keyed endpoints first resolve the in-memory binding, confirm the
Session is still live with the same cwd, reload through the Project Locator,
and confirm the bound root and, when available, project id. They never accept
cwd, root, path, Git arguments, Markdown, prompt text, or another session id.

API failures use the existing bounded error shape and add
`PAGE_KEY_INVALID`. A missing or invalid key is HTTP 401. A stale binding is
revoked before returning 401. Responses and errors never include a Page Key,
local absolute path, or research body except the requested entity body.

### Snapshot

Snapshot returns project identity metadata, revision, read-only state, bounded
relative-path diagnostics, current Focus, and the full body-free projection.
Entity labels are deterministic summaries of at most 240 characters. Edge
views may include a bounded Evidence Gap from their managed edge file.

When `sinceProjectRevision` equals the current project revision, the response
may omit graph entities and edges but still returns current Focus, diagnostics,
and read-only state so a Focus-only change is observable. The browser retains
the last graph until a changed revision arrives.

The client always renders the complete body-free projection returned by the
snapshot. Without a Focus, the initial viewport fits that complete graph. With
a Focus, the entity or stored Edge remains part of the same complete graph and
is highlighted; a Focus change preserves the current zoom and moves the entity
center or Edge midpoint to the viewport center. An empty project has an explicit
empty state. The layout is rebuilt deterministically and is never persisted.

### Entity and Focus

Entity returns one structured node, Evidence Assertion, Result, or stored edge.
Only node/evidence/result responses contain their managed Markdown body. Stored
edge Details are structured JSON fields and never synthesize Markdown from an
untrusted path.

Focus validates the entity against the freshly loaded project. On a click, its
path is derived from the previous sidecar state:

- selecting an id already in `[...pathIds, focusEntityId]` truncates the path
  before that id;
- selecting a new id appends the previous Focus to the path;
- the oldest entries are dropped when necessary to keep at most 32 path ids.

Focus remains sidecar-only and creates no file or Git change. This visible path
is not an undo/redo stack and provides no history restoration.

React Flow's transient selection is not a second source of truth. A click shows
pending feedback until `setFocus` succeeds, then the returned Focus becomes the
only solid selection highlight and Details target. While one request is in
flight, later clicks are retained and processed serially so the last clicked
entity becomes the final Focus instead of being silently dropped.

Focus does not define graph membership. Path changes, entity clicks, polling,
and restored Focus state never remove unrelated entities or Edges from the
Companion. The bounded one-hop selection remains an internal simulation-prompt
context only.

### Details Safety

Details uses `react-markdown` with `remark-gfm` and no raw-HTML plugin. Script,
iframe, object, style, and raw HTML nodes are not executed. Image syntax renders
as non-fetching alt text. HTTP(S) links require a real click and open with
`noopener noreferrer`; non-HTTP schemes and relative paths render inert. Thus
M2 performs no automatic remote request and no uncontained attachment read.

Details is open by default and may be collapsed for the lifetime of the current
page. Its state is not persisted. Companion uses only Tailwind's default viewport
breakpoints: `sm=40rem`, `md=48rem`, and `xl=80rem`, with no arbitrary viewport
media threshold. Below `xl`, Details is a bottom drawer with a horizontal closed
handle; at `xl` and above it is a right-side drawer with a vertical closed handle.
The Graph uses TB layout below `md` and LR layout at `md` and above. The single-row
app header remains outside scrolling content and no separate Focus breadcrumb is
rendered. The compact two-line Details header remains visible and only its body
scrolls, so long entity content never increases the page height. Below `sm`,
failed Research Expansion recovery controls move from the app header into a
compact strip directly below it, preserving both actions without wrapping or
clipping the header.

The fixed Details header has exactly two information rows. Its first row exposes
the precise selected entity type, applicable `N ref/refs (M reviewed)`, Focus
state, and the direction-correct drawer control. Its second row is a borderless
native button whose complete monospace id text is the click/Enter/Space copy
target; there is no separate copy icon. Transient `Copied` or `Copy failed`
feedback remains in the same row without layout shift and is announced through a
polite live region. The visible redundant `Details` heading is removed while a
visually-hidden `<h2>` preserves the accessible structure; the collapsed handle
still says `Details`. Finding, Hypothesis,
Prediction, `EVIDENCE`, and Result use a colored dot plus text in both cards and
Details. A graph card expands its own body on pointer hover or keyboard focus to
expose its complete wrapped label; it uses no detached tooltip and does not
trigger graph relayout. Extremely long labels use bounded internal scrolling.

The header keeps status and actions on one line at all supported widths; branch
appears from `sm`, project name from `md`, and HEAD/long labels may be hidden or
ellipsized before metadata wraps. Drawer chevrons use left/right semantics beside
the graph and up/down semantics below it. `Research & Expand` uses a warm-white
action surface with accent-green text instead of a filled green CTA.

The original M2 projection summaries exposed `referenceCount` and
`reviewedEvidenceCount`.
The Host deduplicates total references from the Node and incident stored Edges by
canonical PMID, otherwise normalized DOI. Reviewed count only includes publications
behind reviewed Evidence Assertions. Cards and Details format this as
`1 ref (M reviewed)` for a singular total and `N refs (M reviewed)` otherwise.

Tailwind theme tokens and utilities own the general Companion visual system:
app shell, header, controls, banners, cards, Details, typography, spacing,
borders, radii, shadows, interaction states, and responsive composition.
Semantic class names may remain as stable hooks, but handwritten CSS is limited
to base rules required with Preflight disabled, React Flow external selectors and
edge states, bounded card expansion, and Markdown pseudo-elements that utilities
cannot safely express. There is no parallel handwritten component theme.
Responsive variants use only the default `sm`, `md`, and `xl` breakpoints.

Static routing serves only `index.html`, `app.js`, and `styles.css` from a fixed
build manifest. It rejects encoded or decoded traversal and API-shaped paths.
Responses set `nosniff`, `no-referrer`, frame denial, and a CSP with self-only
scripts/connects, no object/frame/base/form targets, and no remote images.
Inline style attributes are allowed only because React Flow positions graph
nodes with them; inline scripts remain forbidden.

### Visible-only Polling

The Companion performs one snapshot read on mount when visible, repeats every
5 seconds while `document.visibilityState === 'visible'`, cancels the timer
while hidden, and refreshes immediately when visibility returns. It has at most
one snapshot request in flight and disposes timers/listeners on unmount.

### Historical: Simulate & Save (superseded)

This subsection records the M2 wire baseline only. The visible action and prompt
behavior are replaced by `Research & Expand`; only the documented v1 wire
literals remain for an already-open first-party Companion during bundle reload.

`buildSimulationPrompt` runs only from the `Simulate & Save` click path and uses the
latest snapshot. It includes the Focus id and summary, bounded-neighborhood support and
contradiction summaries, stored Evidence Gaps, and a clear simulation/critique
task. It preserves Result versus Interpretation and instructs the model not to
promote hypotheses, predictions, or `ai_inference` to Findings. The v0.0.1
[bounded simulation extension](simulation-branches.md) also makes that real
click the explicit authorization to save every valid branch from a single-layer,
zero-to-five branch run, with a low-confidence Node and an Edge for each. The encoded
prompt is at most 12 KiB; the Bridge rejects messages above 16 KiB.

The page sends `{ type: 'simulate', nonce, prompt }` on the key-derived channel.
Each retry is another real click and uses a new 128-bit nonce while retaining
the exact prompt. The Bridge accepts only its own channel, the exact message
shape, bounded fields, a live originating Session, and a nonce not previously
accepted on that channel. It calls `setDraft(prompt)` then `submit()` exactly
once. The pre-submit Session list `running` bit determines the acknowledgement:
`started` when idle, `queued` when busy.

The page displays `Started` or `Queued` only after
`{ type: 'ack', nonce, status }`. No acknowledgement within 2 seconds, an error
reply, or an unavailable channel preserves the prompt and exposes `Retry` and
`Copy`. Duplicate nonce messages are dropped without another submit. Bridge
channels and nonce state close on bundle unload.

## Constraints and Interfaces

- Core remains browser/Node/DSH independent and is not changed for M2.
- Host can import Node APIs only for crypto and allowlisted package assets.
- Browser code imports no `node:` modules.
- Approved architecture dependencies are `@xyflow/react`,
  `@dagrejs/dagre`, `react-markdown`, and `remark-gfm`; React DOM is the
  rendering peer required by the approved standalone React tree. Tailwind CSS and
  its CLI are build-time development dependencies; no Tailwind runtime or component
  library is shipped. Preflight remains disabled to avoid changing React Flow and
  safe Markdown defaults.
- One package, one bundle, one tarball, one DSH Web origin, and one responsive
  layout remain unchanged.
- No log line records Page Keys, prompts, entity bodies, local roots, or
  abstracts.

## Acceptance Criteria

- [x] A fresh live Session/project click opens `/scifork`, stores and clears the
      fragment key, and cannot use the key after Session disposal or Host unload.
- [x] The Open action uses `sidebar.footer.action`, renders above Settings in
      the pinned DSH composition, and follows wide/rail state with label/icon
      and icon-only variants without private DOM or class hooks.
- [x] Missing, malformed, wrong-project, and replaced-project keys fail closed
      without exposing paths or keys.
- [x] Static, launch, snapshot, entity, and Focus routes enforce method, origin,
      loopback, JSON type, body size, strict body, and allowlist boundaries.
- [x] Snapshot and Details stay consistent with M1 parsing, projection,
      diagnostics, Focus, branch, and HEAD behavior.
- [x] The Companion always renders the complete projection; changing a Node,
      Result, Evidence Assertion, or stored Edge Focus preserves graph membership and
      current zoom while centering the focused entity or Edge midpoint.
- [x] The same React tree works at narrow and wide viewports; graph, path,
      selected Details, loading, empty, read-only, and invalid-key states fit
      without overlap.
- [x] Only Host-confirmed Focus receives the solid graph highlight; rapid clicks
      are not dropped and settle on the last clicked entity.
- [x] Every selected entity type exposes a full id whose borderless text control
      supports click/Enter/Space copy with transient visible and live feedback, plus precise type with
      text plus a color dot; graph cards expand themselves on pointer hover and
      keyboard focus without a detached tooltip or graph relayout.
- [x] Node cards and Details show deduplicated `1 ref`/`N refs (M reviewed)` derived from
      structured Publication References and reviewed Evidence Assertions.
- [x] Open Details uses exactly two fixed information rows: type/count/Focus/drawer
      first, then the quiet full-id copy control; the visible `Details` heading is absent,
      its accessible heading remains, and body H1 typography does not compete.
- [x] The top bar remains one line with branch from `sm`, project name from `md`,
      a warm-white/accent-green Research action, and no standalone Focus breadcrumb.
- [x] Tailwind utilities own every general layout, color, typography, spacing,
      border, radius, shadow, control-state, and responsive rule; handwritten CSS
      is limited to the documented React Flow, bounded-expansion, base, and
      Markdown exceptions, and responsive behavior uses only default `sm/md/xl` variants.
- [x] Details defaults open, collapses with direction-correct responsive chevrons,
      stays below Graph at `<xl`, moves beside it at `xl+`, and keeps long content in an internal scroll region while the
      app header and two-line Details header remain visible.
- [x] Hidden pages issue no polling requests and refresh immediately when shown.
- [x] Details executes no raw HTML/script and performs no automatic remote or
      uncontained resource load.
- [x] A real Simulate click submits once to the originating Session; idle and
      busy acknowledgements are Started and Queued, wrong channels/sessions do
      not submit, and duplicates do not resubmit.
- [x] Ack failure retains the bounded prompt and offers working Retry and Copy.
- [x] `pnpm check`, `node --check index.js`, `git diff --check`, and
      `pnpm pack --dry-run` pass with Companion assets in the tarball.
- [ ] Desktop and default-breakpoint browser checks cover nonblank rendering,
      stable graph sizing, responsive Details, and no incoherent overlap.

## Test Plan

- Host unit/integration: Page Key entropy/shape and lifecycle; Session/project
  binding; strict request admission; unchanged snapshot with fresh Focus;
  entity type/body boundary; Focus path truncation/cap; static allowlist and
  security headers; malformed/read-only projects; no path/key leakage.
- Bridge unit: footer slot registration, wide/rail button rendering and Graph
  icon accessibility; synchronous blank window, current Session captured at click,
  launch failure notification, key-derived channel, idle/busy submit, exact
  ordering, wrong shape/session, duplicate nonce, prompt limit, and disposal.
- Companion unit: fragment consumption/storage clearing, API error mapping,
  global graph membership, bounded prompt-neighborhood selection, Focus center
  resolution, serialized latest-click selection, layout determinism, visible-only
  polling, safe link and image rendering, Details two-row id-text copy/type/reference/drawer semantics,
  prompt content/byte cap, ack timeout/retry nonce behavior.
- Browser: built static assets served locally with fixture API responses at
  320, 639/640, 767/768, 1279/1280, and desktop widths; inspect the fixed single-row header,
  graph pixels, card expansion, Focus/pending states, two-row Details header,
  inverted Research action, borderless ID copy feedback, Graph TB/LR boundary,
  restrained body heading scale, drawer and internal scroll.
- DSH smoke (separate explicit approval): disposable pinned `0.1.1-rc.2`
  profile, one package install, `/research init`, Open action, snapshot/entity/
  Focus, idle and busy Simulate, reload, unload, and project readability.
