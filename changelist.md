# Changelist

## PR diff summary (`origin/master..HEAD`)

### Highlights

- moved `@t3tools/contracts` from production dependencies to `devDependencies`;
- initialized the `upstream-t3code` workspace submodule for contracts reuse;
- switched lockfile generation to use the upstream contracts workspace and refreshed `pnpm-lock.yaml`;
- updated GitHub workflows and `.gitignore` for the new upstream/workspace setup;
- updated application, CLI formatting, orchestration, and RPC wiring to match the upstream contracts/workflow changes;
- added websocket grouped RPC transport support.

### Changed files

- `.github/workflows/check.yml`
- `.github/workflows/release.yml`
- `.gitignore`
- `.gitmodules`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src/application/model-selection.ts`
- `src/application/models.ts`
- `src/application/project-commands.ts`
- `src/application/service.ts`
- `src/application/shell-sequence.ts`
- `src/application/thread-commands.ts`
- `src/application/thread-wait.ts`
- `src/cli/model-format.ts`
- `src/cli/project-format.ts`
- `src/cli/thread-format.ts`
- `src/domain/command-schema.ts`
- `src/domain/helpers.ts`
- `src/domain/model-config.ts`
- `src/domain/schema.ts`
- `src/domain/thread-lifecycle.ts`
- `src/index.ts`
- `src/orchestration/layer.ts`
- `src/orchestration/service.ts`
- `src/protocol/schema.ts`
- `src/rpc/error.ts`
- `src/rpc/layer.ts`
- `src/rpc/service.ts`
- `src/rpc/ws-group.ts`
- `upstream-t3code`
