# t3cli command reference

```
t3cli
├── project list|add|delete
├── model list
├── list|start|send|show|transcript|wait
├── terminal list|create|attach|read|stream|wait|write|destroy
└── thread approve|respond|archive|interrupt|unarchive|update|delete|callback
```

Auth commands: [setup.md](setup.md)

## Global flags

`--help` · `--version` · `--environment <name>` · `--completions bash|zsh|fish|sh` · `--log-level all|trace|debug|info|warn|warning|error|fatal|none`

## Environment variables

| Variable               | Maps to                  | Priority |
| ---------------------- | ------------------------ | -------- |
| `T3CLI_ENV`            | `--environment`          | 1        |
| `T3CODE_PROJECT_ROOT`  | `--project`              | 1        |
| `T3CODE_PROJECT_ID`    | `--project`              | 2        |
| `T3CODE_WORKTREE_PATH` | `--worktree`             | 1        |
| `T3CODE_THREAD_ID`     | `--thread`               | 1        |
| `T3CODE_URL`           | server URL override      | —        |
| `T3CODE_TOKEN`         | auth token override      | —        |
| `T3CLI_AGENT`          | Non-human default format | —        |

Also treated as agent env (no live TTY): `CI`, `CODEX_CI`, `CODEX_THREAD_ID`.

## project

```sh
t3cli project list [--format json]
t3cli project add [--path .] [--title <title>] [--format json]
t3cli project delete [--project <ref>] [--force] [--yes] [--format json]
```

`--path` defaults to current directory.

## model

```sh
t3cli model list [--all] [--provider <name>] [--format json]
```

## thread workflow

```sh
t3cli list [--project <ref>] [--archived | --all] [--format json]

t3cli start [message]
  [--project <ref>] [--stdin] [--title <title>] [--worktree <path>]
  [--provider <name>] [--model <id>]
  [--option key=value] [--reasoning-effort <v>] [--effort <v>] [--fast-mode] [--thinking]
  [--wait] [--format auto|human|json|ndjson]

t3cli send [--thread <id>] [--force|-f] [message] [--stdin]
  [--option ...] [--reasoning-effort] [--effort] [--fast-mode] [--thinking]
  [--wait] [--format auto|human|json|ndjson]

t3cli show [--thread <id>] [--format auto|human|json]
t3cli transcript [--thread <id>] [--limit N] [--full] [--format json]
t3cli wait [--thread <id>] [--format auto|human|ndjson]
```

## terminal

Thread scope uses `--thread` or `T3CODE_THREAD_ID`. Terminal ids remain positional arguments.

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

`--from-sequence` is inclusive: after the initial snapshot, only events with `sequence >= n` are emitted. `terminal write` treats payloads as raw bytes (latin1). `terminal destroy` requires `--yes` in non-interactive mode.

## advanced thread commands

```sh
t3cli thread approve --request <id> --decision accept|decline|cancel [--thread <id>] [--format json]
t3cli thread respond --request <id> [--answers <json>] [--stdin] [--thread <id>] [--format json]
t3cli thread archive [--thread <id>] [--force|-f] [--format json]
t3cli thread interrupt [--thread <id>] [--force|-f] [--format json]
t3cli thread unarchive [--thread <id>] [--format json]
t3cli thread update [--thread <id>] [--force|-f]
  [--title <title>]
  [--provider <name>] [--model <id>]
  [--option key=value] [--reasoning-effort <v>] [--effort <v>] [--fast-mode] [--thinking]
  [--branch <name>] [--clear-branch]
  [--worktree <path>] [--clear-worktree]
  [--format json]
t3cli thread delete [--thread <id>] [--force|-f] [--yes] [--format json]
t3cli thread callback --from <thread-id> --prompt <message> [--thread <id>] [--background]
```

### start responses

| Mode                         | stdout                                       |
| ---------------------------- | -------------------------------------------- |
| `--format json`, no `--wait` | `{ dispatch, project, threadId, thread? }`   |
| `--format json`, `--wait`    | `{ dispatch, threadId, thread }` after pause |
| `--format ndjson`, `--wait`  | Stream of events (see below)                 |

`send` follows the same output rules when `--wait` is set.

## Output formats

| Commands        | `--format`                    | Agent default                   |
| --------------- | ----------------------------- | ------------------------------- |
| Most            | `auto` \| `human` \| `json`   | `json`                          |
| `start`, `send` | + `ndjson`                    | `json` / `ndjson` with `--wait` |
| `wait`          | `auto` \| `human` \| `ndjson` | `ndjson`                        |

`auto` → `human` on interactive TTY, else structured default. Set `--format` explicitly in scripts.

## NDJSON stream

One JSON object per line:

```json
{ "type": "dispatch", "sequence": 42 }
{ "type": "thread", "thread": {}, "messageCount": 3 }
{ "type": "message", "message": { "role": "assistant", "text": "..." } }
{ "type": "status", "status": "running", "threadId": "..." }
{ "type": "done", "thread": {}, "latestAssistantMessage": {} }
```

## Examples

```sh
export T3CLI_AGENT=1 T3CODE_PROJECT_ROOT="$PWD"

# Start and capture thread id
START=$(t3cli start "$TASK" --format json --wait)
THREAD_ID=$(echo "$START" | jq -r .threadId)

t3cli send "add tests" --thread "$THREAD_ID" --format json --wait

# Remote server — explicit project
export T3CODE_PROJECT_ID=proj_abc
t3cli list --format json

# Stdin prompt
printf '%s' "$PROMPT" | t3cli start --stdin --format ndjson --wait
```
