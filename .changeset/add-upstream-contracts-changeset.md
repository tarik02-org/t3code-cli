---
"t3code-cli": patch
---

- Move `@t3tools/contracts` from `dependencies` to `devDependencies` now that contracts are consumed via the upstream workspace package.
- Add and wire the `upstream-t3code` workspace submodule, enabling shared contracts from upstream t3code.
- Refresh lockfile resolution for workspace contracts consumption (`pnpm-lock.yaml`) and align tooling files (`pnpm-workspace.yaml`, workflows, ignores).
- Update CLI, application, domain, orchestration, and RPC implementation to match upstream contracts/schema behavior.
- Add websocket group RPC transport support.
