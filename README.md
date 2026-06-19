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
npx skills add tarik02/t3cli
```

## Authentication

```sh
t3cli auth pair --url <url> [--local]     # Pair with a remote server
t3cli auth local                          # Local t3code installation
t3cli auth status                         # Check current auth
```

- Use `auth pair` with a pairing URL from a running t3code server
- Use `auth local` to authenticate against a local t3code installation
- Local auth enables automatic project resolution from the current directory

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
t3cli show [--thread <id>]                   # Show thread details
t3cli send [--thread <id>] [message]         # Send message to thread
t3cli transcript [--thread <id>] [--limit]   # View messages
t3cli wait [--thread <id>]                   # Wait for completion
```

### Advanced Thread Commands

```sh
t3cli thread archive [--thread <id>]        # Archive thread
t3cli thread approve --request <id>         # Approve request
t3cli thread interrupt [--thread <id>]      # Interrupt running turn
t3cli thread respond --request <id>         # Respond to request
t3cli thread update [--thread <id>]         # Update thread metadata
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

### Environment Variables

When flags are omitted, the CLI reads these environment variables (first match wins):

| Variable               | Used by                                   |
| ---------------------- | ----------------------------------------- |
| `T3CODE_PROJECT_ROOT`  | `--project`                               |
| `T3CODE_PROJECT_ID`    | `--project` (after `T3CODE_PROJECT_ROOT`) |
| `T3CODE_WORKTREE_PATH` | `--worktree`                              |
| `T3CODE_THREAD_ID`     | `--thread`                                |

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
t3cli start "task" --format ndjson --wait
t3cli wait --format ndjson
```

## Global Flags

```sh
--help                    # Show help
--version                 # Show version
--completions <shell>     # Generate shell completions (bash|zsh|fish|sh)
--log-level <level>        # Set log level
```

## Links

- [Agent Skill Documentation](skills/t3code-cli/SKILL.md)
- [Command Reference](skills/t3code-cli/reference/commands.md)
- [Setup Guide](skills/t3code-cli/reference/setup.md)
