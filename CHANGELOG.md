# t3code-cli

## Unreleased

### Patch Changes

- use upstream t3code contracts package via workspace submodule wiring (`upstream-t3code`, `pnpm-workspace.yaml`);
- switch `@t3tools/contracts` from production dependency to dev dependency;
- refresh lockfile and workspace installation to resolve the upstream contracts package (`pnpm-lock.yaml`);
- update application, CLI, orchestration, and RPC implementation paths for the upstream contracts schema/runtime alignment;
- add websocket group RPC transport support;
- update CI workflow and repository ignore patterns for the new upstream submodule setup.

## 0.1.2

### Patch Changes

- 0e5f0e9: Create GitHub releases and tags when publishing packages.

## 0.1.1

### Patch Changes

- ab979c0: Rename npm package

## 0.1.0

### Minor Changes

- f37522b: Initial release.
