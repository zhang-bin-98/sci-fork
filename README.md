# SciFork

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a Git-native biomedical Research Graph that works alongside DeepSeek
Harness (DSH). DSH remains the conversation surface; SciFork opens its graph as
a same-origin standalone browser Companion that can float beside DSH or use the
operating system's side-by-side window layout.

## Current status

This repository is still a design-stage, minimal installable DSH bundle
scaffold. The entry point intentionally registers no capabilities until the
compatibility spike pins and verifies the DSH preview contracts.

The current target design has these boundaries:

- One first-party bundle serves the Host, a tiny DSH Bridge, and the standalone
  Graph Companion; it does not require third-party DSH plugins.
- The Companion uses the existing DSH Web origin under `/scifork/*`; v0.1 is
  loopback-only and opens no extra port.
- The DSH Bridge only adds an Open action and composer-draft handoff. It does
  not replace the sidebar, conversation, or details areas.
- `DSH-better-sidebar v0.15.2` is a fixed reference for lifecycle, session/cwd
  scoping, visibility pause, and draft handoff patterns—not a runtime
  dependency.
- The research repository remains the source of truth. Source, Evidence
  Assertion, Result, Finding, Hypothesis, and Prediction have separate roles.

Read the [product design](docs/scifork-product-design.md), [software
architecture](docs/scifork-software-architecture.md), and [domain
language](CONTEXT.md) before implementation.

## Bundle contract

- Package: `dsh-scifork`
- Bundle manifest: `package.json#dsh.bundle`
- Configuration layer: `cordis.patch.yml`
- Plugin entry point: `index.js`

For a local compatibility check:

```sh
dsh plugin --profile web add .
dsh --profile web --dump-config
```

The dumped configuration should contain exactly one `scifork` loader entry.

## Release requirements

- Pin the exact tested DSH preview version and record the verified WebServer,
  additive overlay, and composer-draft contracts.
- Distribute one prebuilt, auditable `.tgz` from GitHub Releases.
- Verify a fresh DSH Web profile can install, open, and uninstall SciFork
  without `dsh-better-sidebar` or any other third-party plugin.
- Document the loopback-only security boundary, Git sharing responsibility,
  sensitive-data handling, compatibility range, and upgrade procedure.
- Keep the plugin in its own repository and add the `dsh-plugin` GitHub topic
  when the remote repository is created.

## License

No license has been selected yet. The package is marked `UNLICENSED` until the
project owner makes that choice explicitly. Any future copied code must also
preserve the corresponding upstream license notice.
