# t3code-cli

Non-interactive CLI for [t3code](https://t3code.dev) — manage projects, models, and agent threads from the terminal.

## Installation

```sh
npm install --global t3code-cli
```

This installs the `t3cli` command globally.

## Quick Start

```sh
# Authenticate
t3cli auth pair --url <pairing-url> [--local]

# Or use local auth
t3cli auth local

# Check status
t3cli auth status

# List projects
t3cli project list

# Start a thread
t3cli start "Implement a new feature" --wait
```

## Agent Skill

This repo includes an agent skill for operating `t3cli`: [`skills/t3code-cli/SKILL.md`](skills/t3code-cli/SKILL.md).

Install it with:

```sh
npx skills add tarik02-org/t3code-cli
```

## Nix

On NixOS or another system with Nix installed:

```sh
nix profile install github:tarik02-org/t3code-cli
```

Packages are built for `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`.

### Prebuilt packages

Trusted `master` builds publish the package to the public `tarik02-t3code-cli` Cachix cache. Pull
requests build without cache write credentials.

The flake offers the cache configuration when used directly. For NixOS or nix-darwin configurations
that consume it as an input, configure the cache explicitly:

```nix
nix.settings = {
  extra-substituters = [ "https://tarik02-t3code-cli.cachix.org" ];
  extra-trusted-public-keys = [
    "tarik02-t3code-cli.cachix.org-1:peiScdictfKPjHjL02GpaKqTcCS0tVZ79ixeMFdgqK0="
  ];
};
```

Cache entries may be evicted when storage fills. Nix builds from source when a matching prebuilt
package is unavailable.

## Authentication

`t3cli` stores multiple named auth environments in `~/.config/t3cli/config.json` (or `$XDG_CONFIG_HOME/t3cli/config.json`). Tokens are encrypted at rest with AES-256-GCM; the master key is stored in the OS keyring when available, otherwise in `~/.config/t3cli/key`.

```sh
t3cli auth pair --url <url> [--name <name>] [--replace] [--local]   # Pair with a remote server
t3cli auth local [--name <name>] [--replace]                        # Local t3code installation
t3cli auth status [--format json]                                   # Check current auth
t3cli env list [--format json]                                      # List stored environments
t3cli env use <name> [--format json]                                # Set default environment
t3cli env remove (--name <name> | --environment <name>) [--yes]  # Remove local credentials
t3cli --environment <name> ...                                      # Use a specific environment once
```

- Use `auth pair` with a pairing URL from a running t3code server
- Default environment names: hostname slug from the paired URL, or `local` for `auth local`
- `auth pair` / `auth local` set the default environment only when creating the first stored environment; use `env use` to switch afterward
- `--replace` overwrites an existing environment and makes it the default
- `env remove` removes local CLI credentials only; any remote token can remain valid until natural expiry
- Use `auth local` or `auth pair --local` to authenticate against a local t3code installation
- Local auth enables automatic project resolution from the current directory
- Set `T3CLI_ENV=<name>` to select an environment when `--environment` is omitted
- `T3CODE_URL` and `T3CODE_TOKEN` override the selected environment only when both are set

## Programmatic API

Pairing accepts T3 client presentation metadata. Automation clients should identify themselves as
bots and provide a label that users can recognize in T3 Code:

```ts
import * as Effect from "effect/Effect";
import { T3AuthPairing } from "t3code-cli/auth";
import { T3AuthPairingLayer } from "t3code-cli/runtime";

const pair = Effect.gen(function* () {
  const auth = yield* T3AuthPairing;
  return yield* auth.pair({
    pairingUrl,
    clientMetadata: {
      label: "aperture bridge",
      deviceType: "bot",
      os: "linux",
    },
  });
}).pipe(Effect.provide(T3AuthPairingLayer));
```

`T3Orchestration.watchShellSnapshots()` emits the initial shell snapshot and a reduced snapshot for
each later project or thread event. A new full snapshot resets the reducer after reconnects.

T3 Code's shared and client-runtime export maps are mirrored under `t3code-cli/shared/*` and
`t3code-cli/client-runtime/*`. For example, the viewport catalog and resolver are available through
the matching shared subpath:

```ts
import {
  PREVIEW_VIEWPORT_PRESETS,
  resolvePreviewViewport,
} from "t3code-cli/shared/previewViewport";
import { PreviewViewportSetting } from "t3code-cli/contracts";
```

## Upstream Maintenance

Synchronize dependency versions and patches with the current `upstream-t3code` revision:

```sh
pnpm sync-upstream
```

Pass `--target` to update the submodule first. It accepts `stable`, `nightly`, `main`, a version such
as `0.0.31` or `v0.0.31`, or a Git ref or commit:

```sh
pnpm sync-upstream --target stable
```

## Project Management

```sh
t3cli project list                        # List known projects
t3cli project add [--path <path>] [--title <title>]
t3cli project delete [--project <ref>] [--force] [--yes]
```

The `--path` defaults to the current directory.

## Models

```sh
t3cli model list [--all] [--provider <provider>]
```

Lists available provider models. Use `--all` to include hidden or unavailable entries.

## Thread Workflow

### Asking One Question

`ask` waits for one answer and prints only the assistant text by default:

```sh
t3cli ask "Which package owns this API?" --project /path/to/project
t3cli ask "Summarize the decision" --thread <id>
```

Without `--thread`, it creates a thread and archives it after a successful answer. With
`--thread`, it leaves the existing thread active unless `--archive` is set explicitly.
`--archive` accepts `never`, `always`, `on-success`, or `on-failure`.

Existing busy threads are rejected. `--timeout 5m` limits the response wait. Unlike other
thread-scoped commands, `ask` uses only an explicit `--thread` and ignores `T3CODE_THREAD_ID`.

### Starting Threads

```sh
t3cli start [message]
  [--project <ref>]
  [--stdin]
  [--title <title>]
  [--worktree <path>]
  [--provider <provider>]
  [--model <model>]
  [--option <key=value>]
  [--reasoning-effort <value>]
  [--effort <value>]
  [--fast-mode]
  [--thinking]
  [--wait]
```

### Common Thread Commands

```sh
t3cli list [--project <ref>] [--archived | --all]
t3cli search <query> [--limit <1-50>]          # Search conversation content
t3cli show [--thread <id>]                   # Show thread details
t3cli send [--thread <id>] [message] [--mode auto|queue|steer|restart] # Send message to thread
t3cli transcript [--thread <id>] [--before-cursor <cursor>] [--all] # View messages
t3cli wait [--thread <id>]                   # Wait for completion
```

`transcript` loads the most recent window of the thread timeline and includes pagination metadata
in JSON output. Pass the returned `beforeCursor` to `--before-cursor` for the next older page, or use
`--all` to load the complete transcript.

`send --mode` controls delivery while a run is active: `queue` runs after it, `steer` joins it,
`restart` interrupts and restarts it, and `auto` lets the server choose.

### Advanced Thread Commands

```sh
t3cli thread archive [--thread <id>]        # Archive thread
t3cli thread approve --request <id>         # Approve request
t3cli thread interrupt [--thread <id>]      # Interrupt running run
t3cli thread queue list [--thread <id>]     # Messages queued behind the running run
t3cli thread queue cancel|edit|move|steer <run-id>  # Manage a queued message
t3cli thread pin [--thread <id>]            # Pin thread
t3cli thread respond --request <id>         # Respond to request
t3cli thread settle [--thread <id>]         # Settle thread
t3cli thread snooze [--thread <id>] (--until <ISO-8601> | --preset hour|evening|tomorrow|next-week)
t3cli thread unpin [--thread <id>]          # Unpin thread
t3cli thread unsnooze [--thread <id>]       # Wake snoozed thread
t3cli thread unsettle [--thread <id>]       # Unsettle thread
t3cli thread update [--thread <id>]         # Update thread metadata
t3cli thread handoff (--worktree <path> --branch <name> | --clear-worktree) [--continue <prompt>]  # Stop the run, switch the worktree, continue there
t3cli thread unarchive [--thread <id>]      # Unarchive thread
t3cli thread delete [--thread <id>] [--yes] # Delete thread
t3cli thread callback --from <id>           # Notify another thread on completion
```

## Action Commands

Project-defined toolbar actions are exposed as `t3cli action`.

```sh
t3cli action list [--project <ref>] [--format auto|human|json]
t3cli action run --thread <id> (--id <id> | --name <name>) [--terminal <id>] [--attach] [--format auto|human|json]
t3cli action add [--project <ref>] --name <name> --command <command> [--id <id>] [--icon play|test|lint|configure|build|debug] [--setup] [--preview-url <url>] [--auto-open-preview] [--format auto|human|json]
t3cli action update [--project <ref>] (--id <id> | --name <name>) [--set-name <name>] [--command <command>] [--icon play|test|lint|configure|build|debug] [--setup | --no-setup] [--preview-url <url> | --clear-preview-url] [--auto-open-preview | --no-auto-open-preview | --clear-auto-open-preview] [--format auto|human|json]
t3cli action delete [--project <ref>] (--id <id> | --name <name>) [--yes] [--format auto|human|json]
```

`action list`, `add`, `update`, and `delete` use normal project resolution: `--project`, `T3CODE_PROJECT_ROOT`, `T3CODE_PROJECT_ID`, or cwd with local auth. `action run` infers the project from `--thread`.

Selectors require exactly one of `--id` or `--name`. Name matching is exact after trimming and case folding, and must match a single action. `action add` generates an id from `--name` when omitted. `--setup` marks the action to run on worktree creation and clears setup from other actions. Preview fields are stored on the action; `action run` only starts the terminal command and does not open previews.

## Terminal Commands

```sh
t3cli terminal list [--thread <id>] [--format auto|human|json]
t3cli terminal create [--thread <id>] [command] [--id <id>] [--attach] [--format auto|human|json]
t3cli terminal attach [--thread <id>] <terminal-id>
t3cli terminal read [--thread <id>] <terminal-id> [--history] [--format json|ndjson]
t3cli terminal read [--thread <id>] <terminal-id> --history --follow --format ndjson [--from-sequence <n>]
t3cli terminal stream [--thread <id>] <terminal-id> [--format ndjson] [--from-sequence <n>]
t3cli terminal wait [--thread <id>] <terminal-id> [--for exited|closed|ended] [--format auto|human|json]
t3cli terminal write [--thread <id>] <terminal-id> <data> [--format auto|human|json] [--quiet]
t3cli terminal write [--thread <id>] <terminal-id> --stdin [--format auto|human|json] [--quiet]
t3cli terminal write [--thread <id>] <terminal-id> --hex <hex> [--format auto|human|json] [--quiet]
t3cli terminal write [--thread <id>] <terminal-id> --base64 <base64> [--format auto|human|json] [--quiet]
t3cli terminal destroy [--thread <id>] <terminal-id> [--yes] [--format auto|human|json] [--quiet]
```

`terminal list` shows a one-shot snapshot of terminals for a thread. `terminal create` opens a server-owned terminal in the thread workspace, using the active thread worktree when present and the project workspace root otherwise. When `[command]` is provided, the CLI opens the terminal first and then writes `${command}\r`.

`terminal attach` replays terminal history and then streams live output while forwarding local input to the remote PTY. Use `Ctrl-]` to detach locally without destroying the remote terminal. `Ctrl-C` is forwarded to the remote terminal. Terminal resize events are forwarded to the server.

`terminal read` returns the current terminal snapshot. Add `--history` to include snapshot history. Add `--follow --format ndjson` to continue streaming structured events after the snapshot. `--from-sequence` is inclusive: events with sequence greater than or equal to `<n>` are emitted after the initial snapshot. `terminal stream` is the lower-level attach event stream for agents and always emits ndjson attach events.

`terminal wait` blocks until the terminal emits the requested lifecycle event. `exited` waits for the process to end, `closed` waits for the server-owned terminal session to be removed, and `ended` accepts either.

`terminal write` accepts exactly one payload source: raw argument text, `--stdin`, `--hex`, or `--base64`. Payloads are treated as raw bytes (latin1), not UTF-8 text. `terminal destroy` performs a destructive close with history deletion and requires `--yes` in non-interactive mode.

## Companion (prototype)

```sh
t3cli companion start [--port <port>] [--env <name>]... [--format auto|human|json]
t3cli companion status [--format auto|human|json]
t3cli companion stop
t3cli companion install [--port <port>] [--env <name>]... [--format auto|human|json]
t3cli companion uninstall [--format auto|human|json]
t3cli companion run [--port <port>] [--env <name>]... [--log-file <path>]
t3cli subscribe [--thread <subscriber>] [--caller-env <env>] (--to <thread> | --project <id>) [--source-env <env>] [--event <kind>]... [--wake] [--priority <kind>=urgent|normal|low]... [--follow]
t3cli inbox [--thread <subscriber>] [--caller-env <env>] [--wait] [--timeout <seconds>] [--event <kind>]... [--id <n>]... [--resolve [--disposition <text>] | --snooze <seconds>] [--all]
```

The companion is a background daemon that keeps one shell-stream connection per stored environment (all of them by default; names sharing a URL share one connection) and records thread events in an inbox, so agents subscribe to other threads instead of polling them. It stores subscriptions and the inbox in SQLite under `%LOCALAPPDATA%\t3cli` on Windows or `$XDG_STATE_HOME/t3cli` (default `~/.local/state/t3cli`) elsewhere, and logs to `companion.log` there. It reloads environments when `t3cli env` or `auth` changes the config. `companion install` starts it at login (a hidden Windows scheduled task, a systemd user unit, or a launchd agent) and starts it now; re-run it after upgrading node or t3cli, since the entry pins both paths. A second `run` exits when a companion already answers, `stop` clears a stale runtime file left by a crashed daemon, and a busy port is retried for 30 seconds.

Events: `idle` (no active or queued run and no pending request, quiet for 3 seconds), `failed`, `needs-input`, `settled`, and `env-down` / `env-up` when an environment with subscriptions stays unreachable for a minute and later returns. An `idle` whose run ended with background tasks still pending (a Claude `Monitor`, a background command, a subagent, a PR watch) is marked `pause`, names the tasks, and is delivered at low priority; when the tasks end without a new run, the same run gives a finished `idle`, which resolves the pause. `pr-checks` fires when a linked PR's checks finish on its head (pass, or fail with the failing jobs when T3 Code watches the PR), once per head. Idle, failed, and settled events carry the source's last assistant message (up to 10,000 characters, sent whole in digests) and its linked PRs (draft or ready, mergeability, checks), and `subscribe` returns the source's current state, adding an item at once if it already failed, needs input, or finished. A project subscription with `--follow` (MCP `follow: true`) takes no events itself; it subscribes the subscriber to each new thread it launches in that project, with the same events and settings.

Before a digest goes out, items are checked against the source's latest state: an idle or settled the source has moved past is resolved as superseded, and PR states are refreshed (mergeability is left out for merged or closed PRs). A settled whose PRs are all merged or closed and whose last message was already delivered resolves itself.

Every item stays open in the subscriber's inbox until resolved, with an optional disposition. Snoozing hides an item until at least the given time passes and its source is idle, then brings it back. Waking is one-shot: a `--wake` subscription wakes the subscriber for one event, then disarms; until it is armed again (MCP `arm`, or subscribing to the same source again, which updates that subscription instead of adding one) its events reach the inbox passively and ride along in the next digest something else starts. `failed` and `needs-input` always wake and do not spend the arm; `env-down` / `env-up` never wake on their own. `subscriptions_list` shows `armed`. With `--wake` the subscriber thread also gets a digest message per 5-second window, sent by priority: `urgent` (failed, needs-input) steers into its running turn at once and carries everything else pending; `normal` (idle, env-down) and `low` (settled, env-up, pauses, snoozed items back) are held by the companion until that turn ends (its own background work, such as delegates, does not count as a turn) and then sent together as one new turn. The companion never queues digests in T3 Code. For a local environment (stored with `local: true`, served from a T3 home on this machine) digests go through T3 Code's MCP `t3_thread_send`, so the subscriber thread shows them as from an agent; the companion mints its own `mcp-client` session into that home's auth database, like `t3cli auth local`. Digests to remote environments still show as the user's, since T3 Code restamps every websocket message as user-created. `--priority idle=low` and friends override the defaults per subscription.

Agents use the MCP endpoint at `http://127.0.0.1:47731/mcp` (`subscribe`, `unsubscribe`, `subscriptions_list`, `inbox_list`, `inbox_resolve`, `inbox_snooze`, `inbox_wait`, `open_work`, `thread_send`, `thread_start`; `open_work` lists subscribed threads with draft PRs whose checks pass), identifying themselves with `callerThreadId` (their `T3CODE_THREAD_ID`) and optionally `callerEnvironment`. The CLI commands talk to the daemon over Effect RPC at `/rpc`.

### Environment Variables

When flags are omitted, the CLI reads these environment variables (first match wins):

| Variable               | Used by                                       |
| ---------------------- | --------------------------------------------- |
| `T3CODE_PROJECT_ROOT`  | `--project`                                   |
| `T3CODE_PROJECT_ID`    | `--project` (after `T3CODE_PROJECT_ROOT`)     |
| `T3CODE_WORKTREE_PATH` | `--worktree`                                  |
| `T3CODE_THREAD_ID`     | `--thread`                                    |
| `T3CLI_ENV`            | `--environment`                               |
| `T3CODE_URL`           | server URL override (requires `T3CODE_TOKEN`) |
| `T3CODE_TOKEN`         | auth token override (requires `T3CODE_URL`)   |

### Project Resolution

- `--project` accepts a project id or path
- When omitted, the CLI resolves the project from the current directory (local auth only)
- Resolution checks: registered `workspaceRoot` → paths under it → known thread `worktreePath`
- Remote pairings require explicit `--project` or `T3CODE_PROJECT_*` env var

## Output Formats

Most commands support:

```sh
--format auto|human|json
```

Thread commands also support `ndjson` for streaming:

```sh
t3cli ask "task" --format ndjson
t3cli start "task" --format ndjson --wait
t3cli wait --format ndjson
```

## Global Flags

```sh
--help                    # Show help
--version                 # Show version
--environment <name>      # Auth environment for this command
--completions <shell>     # Generate shell completions (bash|zsh|fish|sh)
--log-level <level>        # Set log level
```

## Links

- [Agent Skill Documentation](skills/t3code-cli/SKILL.md)
- [Command Behavior](skills/t3code-cli/reference/behavior.md)
- [Output Formats](skills/t3code-cli/reference/output.md)
- [Setup Guide](skills/t3code-cli/reference/setup.md)
