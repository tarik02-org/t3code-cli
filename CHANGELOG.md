# t3code-cli

## 0.14.0

### Minor Changes

- 0665a27: add public preview automation, pairing metadata, shell snapshot, and mirrored T3 package APIs

## 0.13.0

### Minor Changes

- 267ba43: Reuse upstream client-runtime authorization and RPC session creation for CLI connections.

### Patch Changes

- d70687f: Keep RPC connections compatible with server config fields the CLI does not use.

## 0.12.0

### Minor Changes

- 690e901: Add the root `t3cli action` command group for project-defined toolbar actions.
- 4e62957: Improve human-readable CLI output with table layouts and markdown-rendered transcripts.
- 82f218c: Use the upstream t3tools contracts workspace package directly instead of local import aliases.
- 58c598c: Add multi-environment auth with encrypted credential storage.

  ### Features
  - Store multiple named auth environments in `~/.config/t3cli/config.json` (or `$XDG_CONFIG_HOME/t3cli/config.json`).
  - Encrypt tokens at rest with AES-256-GCM; bind ciphertext to environment name, URL, and `local` flag via additional authenticated data.
  - Store the master key in the OS keyring when available (`@napi-rs/keyring`), otherwise in `~/.config/t3cli/key` with `0600` permissions.
  - Migrate legacy v1 flat config (plaintext `url`/`token`) to encrypted v2 on first read; rewrite `config.json` automatically.
  - Add global `--environment <name>` flag and `T3CLI_ENV` for per-command environment selection.
  - Add `T3CODE_URL` + `T3CODE_TOKEN` override when both are set.
  - Add `env list`, `env use`, and `env remove` commands for managing stored environments.
  - Add `--name` and `--replace` flags to `auth pair` and `auth local`.
  - Verify credential decryption before switching the default environment (`env use`).

  ### Breaking changes

  **CLI**

  - `auth list`, `auth use`, and `auth unpair` are removed. Use `env list`, `env use`, and `env remove` instead.
  - `auth unpair` is renamed to `env remove` (same behavior: removes local credentials only).

  **Library (`t3code-cli/config`)**

  - `T3ConfigLive`, `makeT3Config`, `UrlError`, and `StoredConfig` are removed from the public export surface.
  - Import config services via namespace exports instead: `Config`, `Credential`, `Keystore`, `Selection`, `Env`, `Paths`, `Url`, `EnvironmentName`.
  - `ResolvedConfig` remains exported but now includes optional `environment` and a `source` discriminator (`config` | `env`).

  **Library (`t3code-cli/connection`)**

  - `T3CodeNodeRpcLayer` is no longer exported from `t3code-cli/connection`. Import it from `t3code-cli/node`.

  **Library (`t3code-cli/runtime` and `t3code-cli/node`)**

  - `NodeEnvironmentLive` is removed. Environment/process snapshot access moved to `CliRuntime` under `t3code-cli/cli`.

  ### Upgrade notes
  - Existing single-environment v1 configs upgrade automatically on the first command that reads config.
  - After upgrade, tokens are encrypted; keep the OS keyring entry or `~/.config/t3cli/key` file backed up if you rely on stored credentials.
  - Scripts using `auth list`, `auth use`, or `auth unpair` must switch to the `env` subcommands.

### Patch Changes

- 244f5bc: Reject unexpected positional arguments on CLI commands instead of silently ignoring them.

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
