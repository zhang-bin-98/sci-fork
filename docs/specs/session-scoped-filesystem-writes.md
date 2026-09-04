# Session-scoped filesystem writes

> Status: Implemented
> Parent design: [software architecture v0.21](../scifork-software-architecture.md)
> Related contract: [M1 Core + Git](m1-core-git.md)

## Problem

SciFork resolves Research Project paths from the current DSH Session, but its
Host mutations call `ctx.fs.writeText` without the per-call sandbox policy. The
sandbox backend therefore falls back to the DSH process workspace instead of
the Session cwd. A valid project in another workspace is rejected with
`FS_SANDBOX_DENIED`, which SciFork currently collapses into the misleading
`INVALID_ENTITY` error.

Deletion and initialization also perform Git or directory mutations outside
`ctx.fs`, so the Host must enforce the same Session policy before any mutation
instead of relying only on the filesystem backend at the final write.

## Goals/Non-goals

Goals:

- Resolve the public DSH sandbox policy from the exact Session that invoked a
  typed mutation or `/research init`.
- Carry that complete policy into every `ctx.fs.writeText` call.
- Reject `read-only` and out-of-workspace mutations before file, directory, or
  Git state changes.
- Report filesystem policy and permission denials as `WRITE_DENIED`, without
  exposing an absolute path.

Non-goals:

- No new permission prompt, escalation mechanism, sandbox mode, or policy
  override in SciFork.
- No model-provided path, workspace root, Session id, or permission mode.
- No change to read-only graph operations, Focus storage, Core schemas,
  scientific invariants, or Git checkpoint recovery.

## Behavioral contract

`research_graph_apply` and `/research init` receive the live public DSH Session
from their existing execution contexts. The Host calls
`sandboxPolicy.resolve({ session })` once at the mutation boundary.

- Missing Session or cwd returns `SESSION_UNAVAILABLE` before mutation.
- `read-only` returns `WRITE_DENIED` before Git initialization/preflight,
  managed-directory creation, file write/deletion, or checkpointing.
- `workspace-write` requires the resolved Research Project root to be equal to
  or contained by the resolved policy workspace root. A project found above the
  Session cwd is readable but mutations return `WRITE_DENIED`.
- `danger-full-access` does not add a workspace-root restriction; SciFork's own
  managed-path containment remains mandatory.
- Create/update passes the exact resolved policy as the fifth
  `ctx.fs.writeText` argument. Delete remains argv-only Git, after the common
  policy preflight.
- DSH `FS_SANDBOX_DENIED` and `FS_PERMISSION_DENIED` failures map to
  `WRITE_DENIED`; stale observation codes remain `STALE_TARGET`; other unsafe
  write failures remain `INVALID_ENTITY`.

The error text is stable and path-free. It may tell the user to enable a DSH
file policy that permits workspace writes, but SciFork never changes the mode.

## Constraints and interfaces

- Host hard-injects the pinned public `sandboxPolicy` service in addition to
  the existing DSH services.
- `contracts.ts` structurally pins `SandboxPolicyPort`,
  `SandboxExecutionPolicy`, and the optional fifth `FsPort.writeText` argument.
- Mutation inputs carry the live Session object; cwd continues to come only
  from `session.header.cwd`.
- The policy root and project root are resolved through `ctx.fs`, and
  containment uses `ctx.fs.contains`; opaque target keys are never parsed.
- Core remains independent of DSH, Node filesystem APIs, and sandbox policy.
- No prompts, Draft bodies, research content, Page Keys, or absolute paths are
  logged or returned.

## Acceptance criteria

- A workspace-write Session can initialize a project outside the DSH process
  cwd and can create/update a managed entity.
- The exact Session and resolved policy reach the guarded manifest/entity
  write.
- A read-only Session changes no files, directories, Git repository, index, or
  history and returns `WRITE_DENIED`.
- A Session whose cwd is below an existing project may read it but cannot
  mutate files or Git state above its policy root.
- Filesystem sandbox/permission denial is no longer reported as
  `INVALID_ENTITY`.
- Existing stale-write, validation, checkpoint, and project-containment
  behavior remains unchanged.

## Test plan

- Add Host regression tests for policy forwarding on entity creation and
  initialization.
- Add tests proving read-only and ancestor-project mutations stop before Git or
  filesystem side effects.
- Add store-level tests for `FS_SANDBOX_DENIED` and `FS_PERMISSION_DENIED`
  mapping while retaining stale and generic failure behavior.
- Update Host wiring tests to require `sandboxPolicy` and the nine-service
  injection list.
- Run focused Host tests, `pnpm check`, `node --check index.js`,
  `git diff --check`, and package dry-run verification.
