# SciFork

> Fork hypotheses. Connect evidence. Advance research.

SciFork is a Git-native research graph for evidence-grounded scientific
simulation inside DeepSeek Harness.

## Status

This repository currently contains the minimal installable DeepSeek Harness
bundle scaffold. The entry point intentionally registers no capabilities until
the compatibility spike pins and verifies the preview APIs used by SciFork.

The product and architecture documents are maintained on the `design` branch.

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

## Community publishing checklist

- Keep the plugin in its own repository; the upstream project currently does
  not accept external pull requests.
- Add the GitHub repository topic `dsh-plugin` when the remote repository is
  created.
- Pin the exact tested DeepSeek Harness preview version before implementing
  integrations or claiming compatibility.
- Distribute prebuilt, auditable artifacts for end users once the TypeScript
  implementation introduces a build step.

## License

No license has been selected yet. The package is marked `UNLICENSED` until the
project owner makes that choice explicitly.
