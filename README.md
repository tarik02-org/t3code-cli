# t3code-cli

Non-interactive CLI for a t3code server.

## install

```sh
npm install --global t3code-cli
```

This installs the `t3cli` command.

## agent skill

This repo includes an agent skill for operating `t3cli`: [`skills/t3code-cli/SKILL.md`](skills/t3code-cli/SKILL.md).

Install it with [skills](https://skills.sh/):

```sh
npx skills add tarik02/t3cli
```

## authenticate

```sh
t3cli auth pair --url <url> [--local]
t3cli auth local [--base-dir <path>] [--origin <url>] [--role owner|client] [--label <label>] [--subject <subject>]
t3cli auth status
```

Use `auth pair` with a pairing URL from a running t3code server, or `auth local` to authenticate against a local t3code installation. Local auth (`auth local` or `auth pair --local`) enables automatic project resolution from the current directory.

## project

```sh
t3cli project list
t3cli project add [--path <path>] [--title <title>]
```

`project list` shows known projects. `project add` registers a project path with the server. `--path` defaults to the current directory.

## model

```sh
t3cli model list [--all] [--provider <provider>]
```

Lists available provider models. Use `--all` to include hidden or unavailable entries when the server exposes them.

## thread

```sh
t3cli thread list [--project <ref>]
t3cli thread start [message] [--project <ref>] [--stdin] [--title <title>] [--worktree <path>] [--provider <provider>] [--model <model>] [--option <key=value>] [--reasoning-effort <value>] [--effort <value>] [--fast-mode] [--thinking] [--wait]
t3cli thread send [--thread <id>] [message] [--stdin] [--option <key=value>] [--reasoning-effort <value>] [--effort <value>] [--fast-mode] [--thinking] [--wait]
t3cli thread messages [--thread <id>] [--limit <count>] [--full]
t3cli thread wait [--thread <id>]
t3cli thread archive [--thread <id>]
```

`--project` accepts a project id or path. When omitted, the CLI resolves the project from the current directory only for local auth (`auth local` or `auth pair --local`). Resolution checks a registered `workspaceRoot`, paths under it, and known thread `worktreePath` values from the server snapshot. Remote pairings require an explicit `--project` or `T3CODE_PROJECT_*` env var. `thread start` infers the worktree from cwd unless `--worktree` or `T3CODE_WORKTREE_PATH` is set.

Thread-targeting commands accept `--thread` or fall back to `T3CODE_THREAD_ID`.

Use `--stdin` when the message should be read from standard input instead of an argument. Use `--wait` to stream until the thread pauses.

## environment fallbacks

When flags are omitted, the CLI reads these variables (first match wins within each group):

| Variable               | Used by                                   |
| ---------------------- | ----------------------------------------- |
| `T3CODE_PROJECT_ROOT`  | `--project`                               |
| `T3CODE_PROJECT_ID`    | `--project` (after `T3CODE_PROJECT_ROOT`) |
| `T3CODE_WORKTREE_PATH` | `--worktree`                              |
| `T3CODE_THREAD_ID`     | `--thread`                                |

## output

Most commands support:

```sh
--format auto|human|json
```

Thread start/send commands also support `--format ndjson`; `thread wait` supports `--format human|ndjson`.

Global flags:

```sh
--help
--version
--completions bash|zsh|fish|sh
--log-level all|trace|debug|info|warn|warning|error|fatal|none
```
