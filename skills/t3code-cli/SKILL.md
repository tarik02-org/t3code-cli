---
name: t3code-cli
description: >-
  Operate t3code via the t3cli CLI — projects, models, and agent threads with
  flag/env scope resolution and machine-readable output. Use when running t3cli,
  automating t3code, starting or monitoring threads, or pairing auth.
---

# t3code-cli

Non-interactive CLI (`t3cli`) for a t3code server.

## Agent defaults

```sh
export T3CLI_AGENT=1
export T3CODE_PROJECT_ROOT="$PWD"   # when not using local-auth cwd resolution
```

First-time setup: [reference/setup.md](reference/setup.md)

## Self-identity (check before spawning threads)

Before starting new threads, check your own identity to maintain consistency:

```sh
# Check current thread identity
t3cli show --format json
```

The output includes `modelSelection` with:

- `instanceId` — the provider (e.g., `cursor`, `codex`, `codex_work`)
- `model` — the model slug (e.g., `composer-2.5`, `gpt-5.5`, `claude-opus-4-8`)

**Preferred behavior**: When spawning additional threads, use the same provider (`instanceId`) and model family unless the user explicitly requests otherwise. This ensures consistent behavior and cost predictability.

Example workflow:

```sh
# Check self identity
SELF=$(t3cli show --format json)
PROVIDER=$(echo "$SELF" | jq -r '.modelSelection.instanceId')
MODEL=$(echo "$SELF" | jq -r '.modelSelection.model')

# Start a new thread with same provider/model
t3cli start "task description" --provider "$PROVIDER" --model "$MODEL" --wait
```

## Scope resolution

| Target      | Flag            | Env (first match wins)                                              |
| ----------- | --------------- | ------------------------------------------------------------------- |
| Environment | `--environment` | `T3CLI_ENV` → config default                                        |
| Project     | `--project`     | `T3CODE_PROJECT_ROOT` → `T3CODE_PROJECT_ID` → cwd (local auth only) |
| Worktree    | `--worktree`    | `T3CODE_WORKTREE_PATH` → inferred from cwd                          |
| Thread      | `--thread`      | `T3CODE_THREAD_ID`                                                  |

Project matching: id → `workspaceRoot` → ancestor under workspace → known thread `worktreePath`. Remote pairing without `--local` requires explicit `--project` or `T3CODE_PROJECT_*`.

## Workflows

**Check before using**

```sh
t3cli auth status [--format json]
t3cli model list
```

**Start and wait**

```sh
t3cli start "task" --format json --wait
t3cli start "task" --format ndjson --wait   # stream events
```

**Follow-up**

```sh
t3cli send "continue" --thread <id> --format json --wait
```

**Wait vs Callback — when to use which**

| Command    | Use when                                                                                        | Behavior                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `wait`     | Actively monitor a thread, send corrections, or continue work immediately when thread completes | Blocks until thread completes; real-time monitoring                                        |
| `callback` | Receive later notification when thread completes (handoff, async workflows)                     | Sends message to another thread when source completes; use `--background` for non-blocking |

**Callback (async handoff)**

```sh
# Foreground: block until source completes, then send message
t3cli thread callback \
  --from <source-thread-id> \
  --thread <target-thread-id> \
  --prompt "Review the completed analysis."

# Background: spawn detached watcher, exit immediately
t3cli thread callback \
  --from <source-thread-id> \
  --prompt "Task done" \
  --background
# Uses T3CODE_THREAD_ID env var as target if --thread not provided
```

Use cases: handoff long tasks, parallel work notifications, async workflows.

**Inspect**

```sh
t3cli list --format json
t3cli transcript --thread <id> --format json
printf '%s' "$PROMPT" | t3cli start --stdin --format json
```

**Lifecycle**

```sh
t3cli thread interrupt --thread <id> --format json   # stop running turn
t3cli thread archive --thread <id> --format json
t3cli thread unarchive --thread <id> --format json
```

**Terminal lifecycle**

- Create a t3code terminal only when the user needs the process visible in t3code.
- Keep commands entered into a user-visible terminal short and readable. Prefer existing project scripts or CLI subcommands.
- List terminals before creating one, then track every terminal id you create. Do not repurpose an existing terminal unless the user explicitly asks.
- Keep a terminal only while the user needs it. Destroy terminals you created when their process stops, they are superseded, or the user no longer needs them.
- Before finishing the task, destroy every unused terminal you created. Never implicitly destroy a terminal you did not create, even when it appears unused.

**Terminal commands**

```sh
export T3CODE_THREAD_ID="$THREAD_ID"

t3cli terminal list --format json
t3cli terminal create --attach --format json
t3cli terminal read <terminal-id> --history --follow --format ndjson --from-sequence 0
t3cli terminal stream <terminal-id> --from-sequence 0
t3cli terminal write <terminal-id> --hex 0a --format json
t3cli terminal wait <terminal-id> --for exited --format json
t3cli terminal destroy <terminal-id> --yes --format json
```

Use `--thread` or `T3CODE_THREAD_ID` for thread scope. `terminal write` payloads are raw bytes (`--hex`, `--base64`, `--stdin`). `terminal destroy` requires `--yes` in non-interactive mode.

## Output

Use `json` for one-shot results; `ndjson` with `--wait` for streaming (`dispatch`, `thread`, `message`, `status`, `done`). Details: [reference/commands.md](reference/commands.md#ndjson-stream).

## Reference

- First time setup and auth: [reference/setup.md](reference/setup.md)
- Command syntax, flags, errors, examples: [reference/commands.md](reference/commands.md)
