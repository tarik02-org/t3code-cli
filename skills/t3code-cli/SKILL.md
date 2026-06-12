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
t3cli thread show --format json
```

The output includes `modelSelection` with:
- `instanceId` — the provider (e.g., `openai`, `anthropic`)
- `model` — the model identifier (e.g., `gpt-4o`, `claude-sonnet-4-20250514`)

**Preferred behavior**: When spawning additional threads, use the same provider (`instanceId`) and model family unless the user explicitly requests otherwise. This ensures consistent behavior and cost predictability.

Example workflow:

```sh
# Check self identity
SELF=$(t3cli thread show --format json)
PROVIDER=$(echo "$SELF" | jq -r '.modelSelection.instanceId')
MODEL=$(echo "$SELF" | jq -r '.modelSelection.model')

# Start a new thread with same provider/model
t3cli thread start "task description" --provider "$PROVIDER" --model "$MODEL" --wait
```

## Scope resolution

| Target   | Flag         | Env (first match wins)                                              |
| -------- | ------------ | ------------------------------------------------------------------- |
| Project  | `--project`  | `T3CODE_PROJECT_ROOT` → `T3CODE_PROJECT_ID` → cwd (local auth only) |
| Worktree | `--worktree` | `T3CODE_WORKTREE_PATH` → inferred from cwd                          |
| Thread   | `--thread`   | `T3CODE_THREAD_ID`                                                  |

Project matching: id → `workspaceRoot` → ancestor under workspace → known thread `worktreePath`. Remote pairing without `--local` requires explicit `--project` or `T3CODE_PROJECT_*`.

## Workflows

**Check before using**

```sh
t3cli auth status [--format json]
t3cli model list
```

**Start and wait**

```sh
t3cli thread start "task" --format json --wait
t3cli thread start "task" --format ndjson --wait   # stream events
```

**Follow-up**

```sh
t3cli thread send "continue" --thread <id> --format json --wait
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
t3cli thread list --format json
t3cli thread messages --thread <id> --format json
printf '%s' "$PROMPT" | t3cli thread start --stdin --format json
```

## Output

Use `json` for one-shot results; `ndjson` with `--wait` for streaming (`dispatch`, `thread`, `message`, `status`, `done`). Details: [reference/commands.md](reference/commands.md#ndjson-stream).

## Reference

- First time setup and auth: [reference/setup.md](reference/setup.md)
- Command syntax, flags, errors, examples: [reference/commands.md](reference/commands.md)
