# t3code-cli

## 0.11.0

### Minor Changes

- 1eb8ed3: Add `thread delete` and `project delete` commands with interactive confirmation.
- 1310049: Add `thread interrupt` and `thread unarchive` commands.
- 07120ba: Expose service constructors, live layers, and Node adapters for library consumers.
- 70d0693: Require `--force` when an agent command targets its own thread for mutating thread actions.
- 5efff6d: Add `--archived` and `--all` flags to `thread list` for listing archived threads.
- 189b120: Add `t3cli thread update` to change thread title, model, branch, and worktree metadata.

## 0.10.0

### Minor Changes

- 33c587c: Move common thread workflow commands to the root CLI surface and rename `messages` to `transcript`.

### Patch Changes

- 7d67d83: Treat ready sessions with stale running turn snapshots as complete when an assistant response is present, fixing thread callbacks that were registered before source thread completion.

## 0.9.1

### Patch Changes

- ba0c671: Fix background thread callbacks exiting before delivery.

## 0.9.0

### Minor Changes

- 3652760: Add `thread show`, `thread approve`, and `thread respond` commands.

### Patch Changes

- 7942f5b: Restructure `vp pack` output into a single `shared.js` chunk plus thin named entry files (no hashed chunk filenames).
- 59225bc: Restructure README with improved navigation and add self-identity guidance to skill.
  - README now has clearer sections: Quick Start, Authentication, Project Management, Models, Thread Management
  - Skill updated with guidance to use `t3cli thread show` to check identity before spawning threads
  - Agents should prefer same provider and model family when starting new threads

- bbdbdf0: Add self-archive protection to `thread archive` with `--force` override.

## 0.8.0

### Minor Changes

- 1c4e911: add t3cli thread callback command

  new subcommand to watch a thread and send a message when it completes:
  - --from: source thread id to watch
  - --thread: target thread id (or T3CODE_THREAD_ID env var)
  - --prompt: message to send
  - --background: fork detached watcher process

  use cases: async handoffs, parallel work notifications

### Patch Changes

- 73652ca: Update `upstream-t3code` submodule to latest `main`.

## 0.7.0

### Minor Changes

- e38eeb8: fix project resolution precedence for nested worktrees and paths

## 0.6.0

### Minor Changes

- de470d8: Restructure the public API for library consumers such as `t3-goals`.
  - Add package.json subpath exports: `./layout`, `./orchestration`, `./rpc`, `./auth`, `./config`, `./connection`, `./runtime`, `./application`, `./contracts`, and `./t3tools`
  - Export the full bundled `@t3tools/contracts` surface as `t3code-cli/t3tools`
  - Add `resolveT3BaseDir`, `readT3LayoutFromNodeProcess`, and `T3Layout` under `t3code-cli/layout`
  - Export `T3OrchestrationLayer`, `T3Orchestration`, and related types under `t3code-cli/orchestration`
  - Export `RpcError` under `t3code-cli/rpc`
  - Slim the default export to the application surface plus `AppLayer` and `AuthAppLayer`

  **BREAKING:** The default export no longer includes `Environment`, `EnvironmentShape`, `NodeEnvironmentLive`, `SqlClientFactory`, auth/config/connection/runtime layer exports, or contract type re-exports. Use subpath imports where those surfaces remain public.

- c83b1f5: Restructure the CLI command surface for agent and human ergonomics.
  - Rename command groups: `projects` → `project`, `models` → `model`, `threads` → `thread`
  - Replace positional project/thread refs with `--project` and `--thread` flags
  - Make `--project` optional with cwd-based resolution (id, workspace root, or nested worktree path)
  - Infer worktree path from cwd when starting a thread inside a project subdirectory
  - Add `project add --path` (defaults to `.`) and `auth pair --url`
  - Add env fallbacks: `T3CODE_PROJECT_ROOT`, `T3CODE_PROJECT_ID`, `T3CODE_WORKTREE_PATH`, `T3CODE_THREAD_ID`
  - Export CLI flags and scope resolvers as library surfaces: `t3code-cli/cli` (flags) and `t3code-cli/scope`

  **BREAKING:** All previous CLI command names and positional arguments are removed. Update scripts and integrations to the new surface.

- e1555b9: Add a bundled agent skill for operating `t3cli` from agents.
  - Skill lives at `skills/t3code-cli/` with setup and command reference docs
  - Install with `npx skills add tarik02/t3cli`

## 0.5.1

### Patch Changes

- 7cbfcdf: Add a public T3 Code connection provider API that composes separate origin and auth values. The connection-native RPC path re-reads the provider on websocket open/reopen, while local origin resolution and local token issuance are separate services.

## 0.5.0

### Minor Changes

- 8d1d06e: Export local and pairing auth services, supporting environment/config/sqlite layers, and split token issuance from config writes for programmatic auth flows.

## 0.4.0

### Minor Changes

- f882df4: replace local auth's t3 cli dependency with direct t3code database session issuance, update pairing to exchange credentials through oauth token exchange, and align websocket auth with the current upstream ticket contract

## 0.3.0

### Minor Changes

- 37ec214: Stop publishing package types that resolve to source files and workspace-only contracts.

## 0.2.0

### Minor Changes

- 3c31a60: Support t3code servers mounted under custom base URLs.

## 0.1.3

### Patch Changes

- f61d6d1: - Move internal schema definitions to upstream t3code schema modules for shared contract alignment.

## 0.1.2

### Patch Changes

- 0e5f0e9: Create GitHub releases and tags when publishing packages.

## 0.1.1

### Patch Changes

- ab979c0: Rename npm package

## 0.1.0

### Minor Changes

- f37522b: Initial release.
