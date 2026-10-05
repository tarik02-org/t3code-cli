---
name: t3code-cli
description: >-
  t3cli drives a T3 Code server from the shell: start, message, wait on, and manage agent threads,
  plus projects, actions, and terminals. Use when running t3cli, automating T3 Code threads, or
  pairing t3cli with a server.
---

# t3cli

`t3cli <command> --help` is the flag reference. This skill covers what `--help` cannot: scope,
workflows, conventions, and output contracts.

```sh
export T3CLI_AGENT=1   # structured output by default; still pass --format in scripts
```

Not paired yet: [reference/setup.md](reference/setup.md).

## Scope

Flags win; otherwise the first set variable applies.

| Target      | Flag            | Variables                                                    |
| ----------- | --------------- | ------------------------------------------------------------ |
| Environment | `--environment` | `T3CLI_ENV`, then the configured default                     |
| Project     | `--project`     | `T3CODE_PROJECT_ROOT`, `T3CODE_PROJECT_ID`, cwd (local auth) |
| Worktree    | `--worktree`    | `T3CODE_WORKTREE_PATH`, inferred from cwd                    |
| Thread      | `--thread`      | `T3CODE_THREAD_ID`                                           |

A project ref matches an id, a `workspaceRoot`, a path under one, or a known thread worktree.

Inside a T3 Code thread, `T3CODE_THREAD_ID` is your own thread, so a command without `--thread`
targets yourself. Commands that change a thread (`send`, `ask --thread`, `thread interrupt`,
`archive`, `update`, `delete`, `queue …`) refuse your own thread unless you pass `--force`.

## Threads

```sh
START=$(t3cli start "task" --format json)                 # returns once the thread exists
THREAD=$(echo "$START" | jq -r .threadId)
t3cli send "follow-up" --thread "$THREAD" --format json --wait
t3cli wait --thread "$THREAD" --format ndjson             # blocks until the thread idles
t3cli ask "question" --project <ref>                      # one answer, temporary thread
t3cli transcript --thread "$THREAD" --format json
```

Spawn threads on your own provider and model unless the user asks otherwise: read
`.modelSelection.instanceId` and `.modelSelection.model` from `t3cli show --format json` and pass
them as `--provider` and `--model`.

Reach for [reference/behavior.md](reference/behavior.md) when using `ask`, `send --mode`,
`thread queue`, `thread callback`, `thread handoff`, `transcript` paging, or `action`.

| To…                                                | Use                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| block until a thread idles, then act on its result | `wait`, or `--wait` on `start`/`send`                                  |
| get notified later in another thread               | `thread callback --from <id> [--background]`                           |
| move your own thread into another worktree         | `thread handoff --worktree <path> --branch <name> --continue <prompt>` |

## Terminals

A T3 Code terminal is for a process the user should watch in T3 Code; run everything else yourself.

- List terminals first, then record every terminal id you create. Write only to terminals you
  created, or ones the user names.
- Type short, readable commands; prefer project actions and scripts.
- Destroy each terminal you created once its process ends or something supersedes it. Before you
  finish, every terminal you created is destroyed or still in use by the user; leave the rest as
  they are.
- `terminal write` sends raw bytes (`--hex`, `--base64`, `--stdin`); `terminal destroy` needs
  `--yes` when not interactive. `--from-sequence n` replays events with `sequence >= n`.

## Output

`json` suits one-shot commands; `ndjson` with `--wait` streams progress. Read
[reference/output.md](reference/output.md) before parsing either.
