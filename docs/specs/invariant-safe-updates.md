# Invariant-safe typed updates

> Status: implemented
> Parent design: [software architecture v0.20](../scifork-software-architecture.md)
> Related contract: [M1 Core + Git](m1-core-git.md)

## Problem

Typed update commands validate the target entity before rendering it, while
some scientific invariants depend on other entities. A valid-looking update can
therefore remove the only validated Result support for a Finding or invalidate
the endpoints of an existing `predicts` Edge. Discovering that only after the
file is written leaves the project read-only with an invalid file.

## Goals

- Reject every typed create, update, and delete plan that would make the complete
  Research Project fail Core validation.
- Keep the existing Host re-read and post-write validation as a second boundary
  for concurrent filesystem changes.
- Return the same structured command failure before any file mutation or Git
  operation.

## Non-goals

- No multi-entity transaction or automatic repair of an invalid existing
  project.
- No change to the scientific invariants themselves, entity schemas, or Git
  checkpoint policy.

## Behavioral contract

After a command-specific plan renders one file or deletion, Core applies that
candidate change to the in-memory managed-file map and runs the complete
`parseAndValidateProject` pass. A non-empty diagnostic makes the plan fail with
an `INVALID_ENTITY` command issue. The Host must not write or remove the target
when the plan fails.

Command planners own command syntax, target/version guards, state transitions,
deletion policy, and rendering. Cross-entity scientific invariants have one
implementation in `validator.ts`; planners do not duplicate those rules.

## Constraints and interfaces

- The check remains in pure `src/core/commands.ts` and uses the injected
  `HashFn`; it does not access Node, DSH, Git, or browser APIs.
- The candidate map changes exactly one Core-derived managed path.
- The Host still re-reads and validates after its guarded filesystem mutation to
  detect races or external changes.

## Acceptance criteria

- Superseding the only validated Result supporting a Finding is rejected before
  writing.
- Changing a supporting Edge away from `supports` is rejected when it would
  remove the Finding's last support.
- Changing a `predicts` source from Finding/Hypothesis to Prediction is rejected
  while the existing Edge remains.
- Valid single-entity creates, updates, and deletes continue to plan and pass
  the existing test suite.

## Test plan

- Add Core regression tests for the three invalid update scenarios above.
- Add a Host regression test proving a rejected cross-entity update neither
  changes the target file nor creates a Git checkpoint.
- Keep the existing command, Host mutation, typecheck, build, and package checks
  green.
- Verify the working tree with `git diff --check`.
