# GitHub Source Installation

> Status: approved for implementation; npm publication remains out of scope.

## Problem

The DSH Plugin Hub installs a catalog entry from its GitHub repository when no
npm package is available. SciFork's repository intentionally excludes `dist/`,
while `index.js` imports `dist/host/index.js`. The existing `prepack` hook makes
the GitHub Release tarball complete, but the project does not yet define or
verify the build lifecycle required for a Git-hosted dependency.

## Goals and non-goals

Goals:

- Support installation from the public GitHub repository with
  `dsh plugin --profile web add git+https://github.com/zhang-bin-98/sci-fork.git`.
- Build every required `dist/` surface from tracked source during Git dependency
  installation.
- Keep `dist/` untracked and keep the prebuilt GitHub Release tarball as the
  auditable, checksum-backed installation option.
- Verify the source-install contract from an isolated local Git repository
  before a release can be published.

Non-goals:

- Publishing SciFork to npm or another package registry.
- Committing generated `dist/` files.
- Changing the pinned DSH compatibility baseline or plugin interfaces.
- Changing DSH Plugin Hub behavior or automatically submitting a catalog entry.
- Running the pinned DSH profile smoke test implicitly.

## Behavioral contract

The root package declares a `prepare` lifecycle script that runs the existing
build. When pnpm installs SciFork as a Git dependency, it installs the build-time
dependency graph, runs `prepare`, and packs the generated `dist/` files into the
installed package. A build failure fails the dependency installation instead of
leaving a loadable-looking package without its runtime entry or browser assets.

The existing `prepack` hook remains the release-tarball build boundary. Source
installation and release packaging use the same `build` script and therefore
produce the same Host, Client, Companion, and Skill surfaces from one source
tree. The repository continues to ignore `dist/`.

pnpm may require a Git dependency's build script to be explicitly allowed. DSH
reports the exact `allowBuilds` key and profile workspace file when this occurs;
after that key is approved, rerunning the same command completes the install.
The community Plugin Hub may automate that retry, but SciFork does not weaken or
bypass the package manager's build-script policy.

The source-install verifier copies only tracked and non-ignored worktree files
into a temporary local Git repository, installs that repository into an isolated
consumer with dependency builds enabled, and requires the installed package to:

1. contain `dist/host/index.js`, `dist/client.js`, and all Companion assets;
2. contain both packaged Skills;
3. preserve the `dsh.bundle` manifest contract; and
4. import successfully through the public package entry point.

The released `v0.0.1` tag predates this contract and remains tarball-only. The
source command is supported only by a later release whose tagged source includes
the `prepare` hook and source-install verification.

## Constraints and interfaces

- The root `package.json` remains the single package, dependency, lifecycle, and
  DSH bundle metadata source.
- `prepare` and `prepack` call the existing `build` script; no second build path
  or checked-in generated representation is introduced.
- The source build uses the Node range and pnpm version declared in
  `package.json` through Corepack.
- Verification uses a local Git URL and a temporary consumer. It does not call
  DSH, publish a package, push a branch, or access Research Project data.
- The GitHub Release continues to contain exactly one `.tgz` and its checksum.

## Acceptance criteria

- A clean Git dependency installation generates and installs every runtime
  artifact required by the DSH bundle.
- Importing the installed package entry succeeds without relying on the source
  checkout's `node_modules` or `dist/` directories.
- Removing or breaking `prepare` causes the source-install verifier to fail.
- `dist/` remains ignored and absent from Git tracking.
- Existing package and release verification remains green.
- README files describe GitHub source installation, the package-manager build
  approval failure path, and the checksum-backed Release tarball alternative.
- No npm publication or DSH compatibility change is introduced.

## Test plan

- Run the source-install verifier before adding `prepare` and observe failure
  because the installed Git dependency lacks built runtime artifacts.
- Add `prepare`, rerun the verifier, and require the installed entry import and
  artifact checks to pass.
- Assert the release workflow invokes the source-install verifier before
  packaging.
- Run `pnpm check`, `node --check index.js`, `pnpm verify:source`,
  `pnpm verify:pack`, and `git diff --check`.
