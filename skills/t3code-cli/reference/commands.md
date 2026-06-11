# t3cli command reference

```
t3cli
├── project list|add
├── model list
└── thread list|start|send|messages|wait|archive
```

Auth commands: [setup.md](setup.md)

## Global flags

`--help` · `--version` · `--completions bash|zsh|fish|sh` · `--log-level all|trace|debug|info|warn|warning|error|fatal|none`

## Environment variables

| Variable               | Maps to                  | Priority |
| ---------------------- | ------------------------ | -------- |
| `T3CODE_PROJECT_ROOT`  | `--project`              | 1        |
| `T3CODE_PROJECT_ID`    | `--project`              | 2        |
| `T3CODE_WORKTREE_PATH` | `--worktree`             | 1        |
| `T3CODE_THREAD_ID`     | `--thread`               | 1        |
| `T3CLI_AGENT`          | Non-human default format | —        |

Also treated as agent env (no live TTY): `CI`, `CODEX_CI`, `CODEX_THREAD_ID`.

## project

```sh
t3cli project list [--format json]
t3cli project add [--path .] [--title <title>] [--format json]
```

`--path` defaults to current directory.

## model

```sh
t3cli model list [--all] [--provider <name>] [--format json]
```

## thread

```sh
t3cli thread list [--project <ref>] [--format json]

t3cli thread start [message]
  [--project <ref>] [--stdin] [--title <title>] [--worktree <path>]
  [--provider <name>] [--model <id>]
  [--option key=value] [--reasoning-effort <v>] [--effort <v>] [--fast-mode] [--thinking]
  [--wait] [--format auto|human|json|ndjson]

t3cli thread send [--thread <id>] [message] [--stdin]
  [--option ...] [--reasoning-effort] [--effort] [--fast-mode] [--thinking]
  [--wait] [--format auto|human|json|ndjson]

t3cli thread messages [--thread <id>] [--limit N] [--full] [--format json]
t3cli thread wait [--thread <id>] [--format auto|human|ndjson]
t3cli thread archive [--thread <id>] [--force|-f] [--format json]
```

### thread start responses

| Mode                         | stdout                                       |
| ---------------------------- | -------------------------------------------- |
| `--format json`, no `--wait` | `{ dispatch, project, threadId, thread? }`   |
| `--format json`, `--wait`    | `{ dispatch, threadId, thread }` after pause |
| `--format ndjson`, `--wait`  | Stream of events (see below)                 |

`thread send` follows the same output rules when `--wait` is set.

## Output formats

| Commands                      | `--format`                    | Agent default                   |
| ----------------------------- | ----------------------------- | ------------------------------- |
| Most                          | `auto` \| `human` \| `json`   | `json`                          |
| `thread start`, `thread send` | + `ndjson`                    | `json` / `ndjson` with `--wait` |
| `thread wait`                 | `auto` \| `human` \| `ndjson` | `ndjson`                        |

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

## Errors

| Tag                  | Cause                                                          |
| -------------------- | -------------------------------------------------------------- |
| `ProjectLookupError` | Unresolved `--project` / env / cwd                             |
| `MissingThreadError` | Missing `--thread` / `T3CODE_THREAD_ID`                        |
| `SelfArchiveError`   | Archiving thread matching `T3CODE_THREAD_ID` without `--force` |
| `MessageInputError`  | No message arg and empty stdin                                 |
| `InvalidLimitError`  | Invalid `--limit`                                              |

Non-zero exit; message on stderr.

## Examples

```sh
export T3CLI_AGENT=1 T3CODE_PROJECT_ROOT="$PWD"

# Start and capture thread id
START=$(t3cli thread start "$TASK" --format json --wait)
THREAD_ID=$(echo "$START" | jq -r .threadId)

t3cli thread send "add tests" --thread "$THREAD_ID" --format json --wait

# Remote server — explicit project
export T3CODE_PROJECT_ID=proj_abc
t3cli thread list --format json

# Stdin prompt
printf '%s' "$PROMPT" | t3cli thread start --stdin --format ndjson --wait
```
