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
t3cli list [--project <ref>]                 # List threads
t3cli show [--thread <id>]                   # Show thread details
t3cli send [--thread <id>] [message]         # Send message to thread
t3cli transcript [--thread <id>] [--limit]   # View messages
t3cli wait [--thread <id>]                   # Wait for completion
```

### Advanced Thread Commands

```sh
t3cli thread archive [--thread <id>]        # Archive thread
t3cli thread approve --request <id>         # Approve request
t3cli thread respond --request <id>         # Respond to request
t3cli thread callback --from <id>           # Notify another thread on completion
```

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
