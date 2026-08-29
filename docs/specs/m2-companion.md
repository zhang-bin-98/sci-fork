# SciFork M2 Companion

> Status: Implemented; disposable pinned-profile smoke remains approval-gated
> Date: 2026-08-30
> Parent design: [product design v0.11](../scifork-product-design.md) sections 3, 6.3, and 11; [software architecture v0.12](../scifork-software-architecture.md) sections 8, 9, 12, 15.3, and 16
> Compatibility baseline: DeepSeek Harness `0.1.1-rc.2`

## Problem

M1 provides the rebuildable projection, project locator, Focus sidecar, and
current-branch Git behavior, but `/scifork/` is not yet a usable Companion.
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
4. Render the current Focus path, its one-hop neighborhood, and safe read-only
   Details in one responsive React layout.
5. Poll only while the page is visible and detect project, branch, HEAD, Focus,
   and validation changes through fresh Host reads.
6. Submit a bounded simulation prompt to the exact originating Session through
   a scoped BroadcastChannel and the public `setDraft + submit` transaction.

## Non-goals

- No embedded DSH panel, second layout mode, graph search, saved coordinates,
  Back/Forward stack, editing, import UI, WebSocket, SSE, CORS, new port, login,
  database, or remote synchronization.
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
`shell.overlay`, `ctx.sessions.scope(id)`, and
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

The Host adds `sessions` to its hard injections. These structural faces stay in
`src/host/contracts.ts`; SciFork does not add a runtime dependency on a DSH
package.

## Behavioral Contract

### Page Key and Open

The click handler synchronously opens `about:blank`, captures the current
Session scope, then POSTs `{ sessionId }` to `/scifork/api/launch`. The Host:

1. enforces the loopback socket and exact HTTP Origin/Host boundary;
2. resolves the live Session through `ctx.sessions.get(sessionId)`;
3. derives the project only from `session.header.cwd` and loads it through the
   existing Project Locator;
4. creates 32 cryptographically random bytes encoded as unpadded base64url; and
5. stores an in-memory binding `{ sessionId, sessionCwd, projectRoot,
   projectId? }` and returns `/scifork/#key=<page-key>`.

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

An exact request for the bare `/scifork` path returns HTTP `308` with
`Location: /scifork/`; the slash form is the canonical Companion entry.

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

With a Focus, the client renders the Focus, the current path, and one-hop
neighbors. A stored edge Focus renders its endpoints and the one-hop relations
of those endpoints. Without a Focus, the body-free projection is an overview;
an empty project has an explicit empty state. The layout is rebuilt
deterministically and is never persisted.

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

### Details Safety

Details uses `react-markdown` with `remark-gfm` and no raw-HTML plugin. Script,
iframe, object, style, and raw HTML nodes are not executed. Image syntax renders
as non-fetching alt text. HTTP(S) links require a real click and open with
`noopener noreferrer`; non-HTTP schemes and relative paths render inert. Thus
M2 performs no automatic remote request and no uncontained attachment read.

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

### Simulate

`buildSimulationPrompt` runs only from the `Simulate` click path and uses the
latest snapshot. It includes the Focus id and summary, visible support and
contradiction summaries, stored Evidence Gaps, and a clear simulation/critique
task. It preserves Result versus Interpretation and instructs the model not to
promote hypotheses, predictions, or `ai_inference` to Findings. The encoded
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
  rendering peer required by the approved standalone React tree.
- One package, one bundle, one tarball, one DSH Web origin, and one responsive
  layout remain unchanged.
- No log line records Page Keys, prompts, entity bodies, local roots, or
  abstracts.

## Acceptance Criteria

- [x] A fresh live Session/project click opens `/scifork/`, stores and clears the
      fragment key, and cannot use the key after Session disposal or Host unload.
- [x] Missing, malformed, wrong-project, and replaced-project keys fail closed
      without exposing paths or keys.
- [x] Static, launch, snapshot, entity, and Focus routes enforce method, origin,
      loopback, JSON type, body size, strict body, and allowlist boundaries.
- [x] Snapshot and Details stay consistent with M1 parsing, projection,
      diagnostics, Focus, branch, and HEAD behavior.
- [x] The same React tree works at narrow and wide viewports; graph, path,
      selected Details, loading, empty, read-only, and invalid-key states fit
      without overlap.
- [x] Hidden pages issue no polling requests and refresh immediately when shown.
- [x] Details executes no raw HTML/script and performs no automatic remote or
      uncontained resource load.
- [x] A real Simulate click submits once to the originating Session; idle and
      busy acknowledgements are Started and Queued, wrong channels/sessions do
      not submit, and duplicates do not resubmit.
- [x] Ack failure retains the bounded prompt and offers working Retry and Copy.
- [x] `pnpm check`, `node --check index.js`, `git diff --check`, and
      `pnpm pack --dry-run` pass with Companion assets in the tarball.
- [x] Desktop and narrow viewport browser checks cover nonblank rendering,
      stable graph sizing, responsive Details, and no incoherent overlap.

## Test Plan

- Host unit/integration: Page Key entropy/shape and lifecycle; Session/project
  binding; strict request admission; unchanged snapshot with fresh Focus;
  entity type/body boundary; Focus path truncation/cap; static allowlist and
  security headers; malformed/read-only projects; no path/key leakage.
- Bridge unit: synchronous blank window, current Session captured at click,
  launch failure notification, key-derived channel, idle/busy submit, exact
  ordering, wrong shape/session, duplicate nonce, prompt limit, and disposal.
- Companion unit: fragment consumption/storage clearing, API error mapping,
  local graph selection/layout determinism, visible-only polling, safe link and
  image rendering, prompt content/byte cap, ack timeout/retry nonce behavior.
- Browser: built static assets served locally with fixture API responses at
  desktop and narrow viewports; inspect screenshots, layout bounds, graph
  pixels, Details rendering, and interaction states.
- DSH smoke (separate explicit approval): disposable pinned `0.1.1-rc.2`
  profile, one package install, `/research init`, Open action, snapshot/entity/
  Focus, idle and busy Simulate, reload, unload, and project readability.
