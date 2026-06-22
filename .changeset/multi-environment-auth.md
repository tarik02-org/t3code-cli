---
"t3code-cli": minor
---

Add multi-environment auth with encrypted credential storage.

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
