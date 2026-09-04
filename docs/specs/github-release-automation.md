# GitHub Release Automation

> Status: implemented; the package license identifier is `MIT`.

## Problem

SciFork's release contract requires one prebuilt, auditable DSH bundle tarball
on GitHub Releases, but the repository has no automated path from a version tag
to a verified release asset. Manual packaging can publish the wrong package
version, omit required files, or omit the checksum users are told to verify.

## Goals and non-goals

Goals:

- Build and verify the package from a version tag on GitHub-hosted runners.
- Verify that the tagged source can build and install as an isolated Git
  dependency before packaging the release assets.
- Require the tag to match `package.json#version` and originate from the default
  branch.
- Require a selected license identifier, a packaged license file, and no
  `workspace:*` dependency specifier before a public release.
- Publish exactly one prebuilt `.tgz` plus its SHA-256 checksum to a GitHub
  Release using least-privilege repository permissions.
- Generate release notes from GitHub history and mark SemVer prereleases as
  prereleases.

Non-goals:

- Selecting a license for Research Project data.
- Changing `package.json#version`, creating or pushing a tag, or pushing any
  branch.
- Publishing to npm or another package registry.
- Running the pinned DSH profile exercise implicitly.
- Overwriting an existing GitHub Release or release asset.

## Behavioral contract

The `.github/workflows/release.yml` workflow runs only for pushed tags matching
the broad `v*` filter. A repository-owned preflight then applies the strict
rules that GitHub's glob syntax cannot express:

1. The tag is exactly `v${package.json.version}` and the version is SemVer.
2. The tagged commit is an ancestor of the repository's default branch.
3. `package.json#license` is neither empty nor `UNLICENSED` (the current value
   is `MIT`).
4. A non-empty `LICENSE`, `LICENSE.md`, or `LICENSE.txt` exists at the package
   root.
5. No dependency field contains a `workspace:*` specifier.

After preflight, a read-only verification job enables the pnpm Corepack shim,
installs the locked dependency graph, runs `pnpm check`, checks `index.js`,
performs an isolated local-Git source installation, validates the dry-run
package manifest, creates one real tarball, inspects the real archive for the
required package surfaces and license, and generates a sibling `.sha256` file.
The shim is required because pnpm starts a nested `pnpm install` while preparing
a Git dependency. The job uploads only those two verified files as a short-lived
workflow artifact. A dependent publication job rechecks the remote tag against
the exact packaged commit, downloads and verifies the artifact checksum, and
creates the GitHub Release.
Stable versions create stable releases; versions with a SemVer prerelease
component create prereleases.

No asset is published until all local checks pass. Publication creates an
explicit draft, records its numeric release ID, uploads both assets to that ID,
and publishes that same ID only after both uploads succeed. It checks for a
unique same-tag Release immediately after draft creation and again before
publication. A later failure triggers best-effort deletion only when that exact
ID is still a draft, without deleting the tag. An already-existing release or
draft is an error and is never replaced automatically.

## Constraints and interfaces

- The root `package.json` remains the only version, package, build, and release
  metadata source.
- The workflow uses the package's pinned pnpm through Corepack and a Node version
  allowed by `package.json#engines`.
- The GitHub repository has an active `v*` tag ruleset that restricts creation,
  update, deletion, and bypass to release maintainers. This server-side rule is
  required because tag-push workflows are read from the tagged commit.
- The verification job grants only `contents: read`. The publication job grants
  `actions: read` and `contents: write`, runs no reusable Action, and exposes the
  ephemeral `GITHUB_TOKEN` only to its three GitHub API steps. Dependency
  installation, tests, builds, and pack hooks never receive a write token. No
  long-lived secret or personal access token is required.
- GitHub's runner-provided `gh` CLI creates the Release, avoiding a new release
  action dependency.
- Release assets contain package code and public documentation only. No Research
  Project, environment file, local path, prompt, Draft, or credential is read or
  uploaded.

## Acceptance criteria

- A matching version tag on the default branch reaches packaging after all
  repository checks pass.
- Mismatched tags, invalid versions, unresolved/missing licenses, workspace
  dependencies, tags outside the default branch, and tags moved after packaging
  fail before publication.
- The published `.tgz` passes the existing package-manifest gate and a check of
  its real archive contents, including both language README files and `LICENSE`.
- The tagged repository passes the Git source-install gate before the release
  tarball is created.
- The checksum file names the tarball and contains its SHA-256 digest.
- The GitHub Release contains one `.tgz` and its checksum and uses generated
  release notes.
- No npm publication, tag creation, remote push, or DSH smoke test is performed.

## Test plan

- Unit-test the repository-owned preflight against valid metadata and each
  release-blocking metadata condition.
- Parse the workflow YAML with the repository's YAML parser and assert its tag
  trigger, least-privilege permission, full-SHA action pins, token scope, and
  draft/upload/publish sequence.
- Run `pnpm check`, `node --check index.js`, `pnpm verify:source`,
  `pnpm verify:pack`, and `git diff --check` locally.
- Exercise the current repository preflight and confirm that the selected MIT
  metadata and non-empty `LICENSE` pass its license gate.
- The first real GitHub execution is a version-tag release after the commit is
  merged; the pinned DSH exercise remains a separate, explicitly approved
  release gate.
