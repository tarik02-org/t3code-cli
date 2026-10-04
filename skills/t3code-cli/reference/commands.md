# t3cli command reference

```
t3cli
├── action list|run|add|update|delete
├── auth pair|local|status
├── env list|use|remove
├── project list|add|delete
├── model list
├── list|search|start|send|show|transcript|wait
├── terminal list|create|attach|read|stream|wait|write|destroy
└── thread approve|respond|archive|interrupt|queue|settle|unsettle|snooze|unsnooze|pin|unpin|unarchive|update|delete|callback
```

Auth and environment commands: [setup.md](setup.md)

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

## auth

```sh
t3cli auth pair --url <url> [--name <name>] [--replace] [--local] [--format json]
t3cli auth local [--name <name>] [--replace] [--format json]
t3cli auth status [--format json]
```

## env

```sh
t3cli env list [--format json]
t3cli env use <name> [--format json]
t3cli env remove [--name <name>] [--yes] [--format json]
```

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

## action

Project-defined toolbar actions are called `action` in the CLI and map to project scripts in the server contract. Project scope for `list`, `add`, `update`, and `delete` uses `--project`, `T3CODE_PROJECT_ROOT`, `T3CODE_PROJECT_ID`, or cwd with local auth. `run` uses `--thread` or `T3CODE_THREAD_ID` and infers the project from the thread.

```sh
t3cli action list [--project <ref>] [--format auto|human|json]
t3cli action run --thread <id> (--id <id> | --name <name>)
  [--terminal <id>] [--attach] [--format auto|human|json]
t3cli action add [--project <ref>] --name <name> --command <command>
  [--id <id>] [--icon play|test|lint|configure|build|debug]
  [--setup] [--preview-url <url>] [--auto-open-preview]
  [--format auto|human|json]
t3cli action update [--project <ref>] (--id <id> | --name <name>)
  [--set-name <name>] [--command <command>]
  [--icon play|test|lint|configure|build|debug]
  [--setup | --no-setup]
  [--preview-url <url> | --clear-preview-url]
  [--auto-open-preview | --no-auto-open-preview | --clear-auto-open-preview]
  [--format auto|human|json]
t3cli action delete [--project <ref>] (--id <id> | --name <name>)
  [--yes] [--format auto|human|json]
```

Selectors require exactly one of `--id` or `--name`. `--name` matching trims the query, compares case-insensitively, and fails if zero or multiple actions match. `add` generates an id from `--name` when omitted. Default `add` values are `--icon play` and non-setup.

Mutations send the next full scripts array as a `project.update` and print the updated project. `--setup` enforces one setup action per project by clearing setup from the others. Preview fields are editable, but `action run` does not open previews. `action run` opens a new terminal by default, can target `--terminal <id>`, and can attach with `--attach`.

## thread workflow

```sh
t3cli list [--project <ref>] [--archived | --all] [--format json]
t3cli search <query> [--limit <1-50>] [--format auto|human|json]

t3cli ask [message]
  [--project <ref>] [--thread <id>] [--force|-f] [--stdin]
  [--title <title>] [--worktree <path>] [--provider <name>] [--model <id>]
  [--option key=value] [--reasoning-effort <v>] [--effort <v>] [--fast-mode] [--thinking]
  [--archive never|always|on-success|on-failure] [--as-user]
  [--timeout <duration>]
  [--format auto|human|json|ndjson]

t3cli start [message]
  [--project <ref>] [--stdin] [--title <title>] [--worktree <path>]
  [--provider <name>] [--model <id>]
  [--option key=value] [--reasoning-effort <v>] [--effort <v>] [--fast-mode] [--thinking]
  [--wait] [--format auto|human|json|ndjson]

t3cli send [--thread <id>] [--force|-f] [message] [--stdin]
  [--option ...] [--reasoning-effort] [--effort] [--fast-mode] [--thinking]
  [--mode auto|queue|steer|restart] [--as-user] [--wait] [--format auto|human|json|ndjson]

t3cli show [--thread <id>] [--format auto|human|json]
t3cli transcript [--thread <id>] [--limit N]
  [--before-cursor <cursor>] [--all]
  [--full] [--format auto|human|json]
t3cli wait [--thread <id>] [--format auto|human|ndjson]
```

`send --mode` decides what happens when the thread already has a run in flight: `queue` runs the
message after it, `steer` adds it to the active run, `restart` interrupts the active run and starts
over with it, and `auto` (default) lets the server pick from the provider's capabilities. An idle
thread starts a new run in every mode.

Messages from `send`, `ask --thread`, and `thread callback` are sent as agent messages that name
the calling thread (`T3CODE_THREAD_ID`, or `--from` for `callback`) when that thread exists in the
target environment. `--as-user` sends them as plain user messages instead. The first message of a
new thread (`start`, `ask` without `--thread`) is always recorded as the user's.

`ask` always waits for the run it starts. Without `--thread`, it creates a thread and defaults to
`--archive on-success`. With an explicit `--thread`, it defaults to `--archive never`. An explicit
archive policy applies to either target. Archive failures produce a warning and remain visible in
structured output without changing a successful exit status.

Existing busy or archived threads and threads with pending approval or user-input requests are
rejected.

`--timeout` accepts positive durations such as `30s`, `5m`, and `1h`; omitting it waits without a
limit. A timeout or local interruption stops a run started by `ask` when ownership can be
confirmed, then applies the failure archive policy.

`--title`, `--worktree`, `--provider`, and `--model` apply only when creating a thread and are
rejected with `--thread`. Model option flags apply to both modes. `ask` never reads
`T3CODE_THREAD_ID`; selecting an existing thread requires `--thread`.

`transcript` loads the most recent window of the thread timeline; the server sizes each page. JSON
output includes `beforeCursor` and `hasMoreHistory`; pass the cursor to `--before-cursor` to load
the next older page. `--all` loads the full thread and cannot be combined with `--before-cursor`.
`--full` adds the raw timeline rows (tool calls, reasoning, plans) to JSON output. `--limit` only
caps messages rendered in human output.

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
t3cli thread queue list [--thread <id>] [--format auto|human|json]
t3cli thread queue cancel [--thread <id>] [--force|-f] <run-id> [--format json]
t3cli thread queue edit [--thread <id>] [--force|-f] <run-id> [message] [--stdin] [--format json]
t3cli thread queue move [--thread <id>] [--force|-f] <run-id> (--before <run-id> | --last) [--format json]
t3cli thread queue steer [--thread <id>] [--force|-f] <run-id> [--format json]
t3cli thread queue resume [--thread <id>] [--force|-f] [--format json]
t3cli thread settle [--thread <id>] [--format auto|human|json]
t3cli thread unsettle [--thread <id>] [--format auto|human|json]
t3cli thread snooze [--thread <id>]
  (--until <ISO-8601> | --preset hour|evening|tomorrow|next-week)
  [--format auto|human|json]
t3cli thread unsnooze [--thread <id>] [--format auto|human|json]
t3cli thread pin [--thread <id>] [--format auto|human|json]
t3cli thread unpin [--thread <id>] [--format auto|human|json]
t3cli thread unarchive [--thread <id>] [--format json]
t3cli thread update [--thread <id>] [--force|-f]
  [--title <title>]
  [--provider <name>] [--model <id>]
  [--option key=value] [--reasoning-effort <v>] [--effort <v>] [--fast-mode] [--thinking]
  [--branch <name>] [--clear-branch]
  [--worktree <path>] [--clear-worktree]
  [--format json]
t3cli thread delete [--thread <id>] [--force|-f] [--yes] [--format json]
t3cli thread callback --from <thread-id> --prompt <message> [--thread <id>] [--background] [--as-user]
```

`thread queue` manages messages sent with `send --mode queue` (or queued by the server) while a run
is active. `list` shows them in start order with their run ids; `steer` delivers one to the running
run now; `resume` starts a queue the server held after restarting.

`thread snooze` requires exactly one wake-time option. Presets use the local time zone and the same schedule as T3 Code clients. The `evening` preset is unavailable once fewer than one hour remains before 18:00; use `tomorrow` or `--until` then.

### start responses

| Mode                         | stdout                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `--format json`, no `--wait` | `{ threadId, project, thread, status, latestAssistantMessage }`              |
| `--format json`, `--wait`    | `{ threadId, thread, status, latestAssistantMessage }` once the thread idles |
| `--format ndjson`            | `started`, then thread events (see below); `--wait` streams until `done`     |

`send` returns `{ dispatch, threadId, messageId, thread, status, latestAssistantMessage }` and starts
its NDJSON stream with `dispatch`. `thread` is the thread record without its timeline; read the
timeline with `transcript`.

## Output formats

| Commands        | `--format`                    | Agent default                   |
| --------------- | ----------------------------- | ------------------------------- |
| Most            | `auto` \| `human` \| `json`   | `json`                          |
| `ask`           | + `ndjson`                    | `json`                          |
| `start`, `send` | + `ndjson`                    | `json` / `ndjson` with `--wait` |
| `wait`          | `auto` \| `human` \| `ndjson` | `ndjson`                        |

`auto` → `human` on interactive TTY, else structured default. Set `--format` explicitly in scripts.

## NDJSON stream

One JSON object per line:

```json
{ "type": "started", "threadId": "..." }
{ "type": "thread", "thread": {}, "status": "running", "messageCount": 3 }
{ "type": "message", "message": { "role": "assistant", "text": "...", "runId": "..." } }
{ "type": "status", "status": "running", "threadId": "..." }
{ "type": "done", "thread": {}, "status": "completed", "latestAssistantMessage": {} }
```

The first line names what was sent: `started` (`start`), `dispatch` with the command `sequence`
(`send`), or `dispatched` with `threadId` and `messageId` (`ask`). `status` lines appear only when
the status changes. Statuses are `idle` or a run status: `preparing`, `queued`, `starting`,
`running`, `waiting` (on an approval or user input), `completed`, `interrupted`, `failed`,
`cancelled`, `rolled_back`.

Successful `ask --format ndjson` streams the same thread events and ends with a `result` object.
`ask --format json` returns one object with `answer`, `threadId`, `runId`, `created`, and
`archive`. Human output writes progress to stderr and only the final answer to stdout.

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
