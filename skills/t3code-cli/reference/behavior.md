# Command behavior

What each command does beyond its flags. Flags: `t3cli <command> --help`.

## ask

`ask` sends one message, waits for the run it starts, and prints only the answer (`--format json`
for a result object).

- **Target.** Without `--thread` it creates a thread; `--title`, `--worktree`, `--provider`, and
  `--model` apply only then. `ask` never reads `T3CODE_THREAD_ID`, so an existing thread needs an
  explicit `--thread`.
- **Archiving.** A created thread defaults to `--archive on-success`, an existing one to `never`.
  A failed archive prints a warning and keeps the successful exit status.
- **Refusals.** Busy or archived threads, and threads waiting on an approval or user input, are
  rejected. A run that stops to ask for approval or input fails the `ask`.
- **Timeout.** `--timeout` takes durations such as `30s`, `5m`, `1h`. On timeout or interruption,
  `ask` stops the run it started, then applies the failure archive policy.

## send

`--mode` decides what a message does when the thread already has a run in flight:

| Mode      | Effect                                                      |
| --------- | ----------------------------------------------------------- |
| `auto`    | the server picks from the provider's capabilities (default) |
| `queue`   | runs after the active run                                   |
| `steer`   | joins the active run                                        |
| `restart` | interrupts the active run and starts over with this message |

An idle thread starts a new run in every mode.

## Message attribution

`send`, `ask --thread`, and `thread callback` record the calling thread (`T3CODE_THREAD_ID`, or
`--from` for `callback`) as the message's sender when that thread exists in the target environment;
`--as-user` leaves the sender out. The first message of a new thread never names a sender.

## thread queue

Lists and edits messages queued behind the active run, by run id from `thread queue list`. `steer`
delivers a queued message into the active run now; `resume` starts a queue the server held after a
restart.

## thread callback

Waits for the `--from` thread to idle, then sends `--prompt` to `--thread` (or
`T3CODE_THREAD_ID`). `--background` detaches a watcher process and returns at once.

## thread handoff

Switches a thread's worktree, which detaches its provider session. It stops the live run first,
switches once the run has ended, then sends `--continue` as the next message; the conversation
carries over. `thread update --worktree` refuses a thread with a live run for this reason.

- On your own thread it detaches and returns at once: end your turn. The stop cuts your current
  tool call short, so `--continue` carries the remaining work.
- Messages already queued run first, in the new worktree; a queue that was held stays held.
- A target the thread is already in does nothing and leaves the run going.
- Progress goes to the log file it prints. A failure after the stop is sent to the thread as a
  message.

## transcript

Loads the most recent window of the timeline; the server sizes pages. Pass the returned
`beforeCursor` to `--before-cursor` for the next older page while `hasMoreHistory` is true, or use
`--all` for the whole thread. `--full` adds tool calls, reasoning, and plans to JSON output;
`--limit` caps only the messages printed in human output.

## thread snooze

Presets use the local time zone. `evening` is unavailable within an hour of 18:00; use `tomorrow`
or `--until` then.

## action

Actions are a project's toolbar scripts. `list`, `add`, `update`, and `delete` resolve the project
like other commands; `run` takes the thread and uses its project.

- Selectors take exactly one of `--id` or `--name`. Names match trimmed and case-insensitive, and
  must match exactly one action.
- `add` derives the id from `--name` and defaults to `--icon play`, non-setup. `--setup` makes this
  the project's only setup action.
- `run` opens a new terminal unless `--terminal` names one, and does not open previews.
