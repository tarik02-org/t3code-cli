# companion: a watchlist and a digest

The companion tells a coordinating agent (a **caller**) about the events it must act on in the
threads and pull requests it is responsible for. The caller arms nothing: the companion works out
what to watch, derives a small set of events from T3 Code and GitHub, sends each once, and groups
what is pending into one message.

## model

- **Caller**: a T3 Code thread that receives digests. A thread becomes a caller with its first
  companion tool call and stays one until `unwatch { all: true }`, or until it is archived or
  deleted.
- **Watch**: one caller following one thread or one pull request. A watch has a `since` instant;
  only what happens after it is an event.
- **Event**: one transition of a watched object, in a fixed vocabulary (below). Stored once per
  caller, object and transition.
- **Digest**: one message to a caller that carries every pending event, grouped by object.
- **Reminder**: a text the caller asked to get back at a time. It arrives as an event.

### what is watched

1. **Threads the caller launched or wrote to.** T3 Code does not record the sender of a message
   sent through the gateway (`senderThreadId` is absent on every such message on a live server),
   so the companion reads the caller's own transcript instead. Every completed tool call whose
   name ends in `t3_thread_launch`, `t3_thread_send`, `t3_thread_send_attachments` or
   `create_threads` names the target thread in its input or output. The watch starts at the tool
   call's `startedAt`. The transcript is read when the caller's row shows new items: at most every
   10 seconds during a turn, and once when the turn ends. `delegate_task` children are skipped,
   because T3 Code already reports them to their parent.
2. **Pull requests linked to those threads and to the caller's own thread**: every entry of
   `shell.pullRequests` that is not `stack-dismissed` and whose snapshot is open or unknown.
3. **Extras** named with `watch { thread }` or `watch { pr }`.

A watch ends by itself when the pull request merges or closes (after that event), or the thread is
archived or deleted. `unwatch` ends it at once; a thread the caller unwatched is watched again
only by a later send.

## events

Each event has a **key**. The watch remembers the last key it emitted for every kind, and the
event row and that memory are written in one transaction, so an event exists once per transition.

### thread

A thread is **busy** when a run is active, a sent message has not become a run yet (2 minute
grace, as T3 Code judges it), or it is blocked on another thread. Its **own work** is
`pendingBackgroundTasks` without `pull-request-watch:*` entries. Own work is **awaited** when the
task has `awaited: true` or is a subagent.

| event    | holds when                                                                                                    | key                  | acts |
| -------- | ------------------------------------------------------------------------------------------------------------- | -------------------- | ---- |
| `asks`   | `pendingRuntimeRequest` is set and was created after `since`                                                    | request id           | yes  |
| `done`   | not busy for 5 s, no pending request, status not `failed`, no awaited own work, latest run ended after `since` | latest run id        | yes  |
| `failed` | status `failed`, not busy for 5 s, latest run ended after `since`                                              | latest run id        | yes  |
| `stuck`  | not busy, awaited own work pending, and nothing changed for N minutes (default 30) since the run ended          | latest run id        | yes  |

- `done` carries the whole last assistant message (up to 10,000 characters), the run's outcome
  (`completed`, `interrupted`, `cancelled`), the thread's linked pull requests with their heads,
  own work left running without `awaited` (a dev server), and `question: true` when the message's
  last paragraph holds a question mark. A thread that asks in prose is a `done` that says so.
- `asks` says whether it is a question (`user_input`, `auth_refresh`) or an approval.
- For a subagent task, `stuck` counts only time in which its child thread is not busy either.
- Nothing is emitted for a pause on awaited work, for `settled`, or for a run that a queued
  message supersedes within the 5 seconds.

### pull request

Read with one GraphQL query per pull request through `gh`. A check **fails** when it completed
with `FAILURE`, `TIMED_OUT`, `ACTION_REQUIRED` or `STARTUP_FAILURE`, or a status context is
`FAILURE` or `ERROR`. `CANCELLED`, `SKIPPED`, `NEUTRAL` and `STALE` do not fail, and neither does
a check whose name is on the ignore list (`--ignore-check`, repeatable, case-insensitive, `*`
wildcard).

| event      | holds when                                                              | key           | acts |
| ---------- | ----------------------------------------------------------------------- | ------------- | ---- |
| `red`      | open, at least one failing check on the head                             | head sha      | yes  |
| `conflict` | open and `mergeable` is `CONFLICTING`                                    | head sha      | yes  |
| `comment`  | a comment or review by a person, created after `since`                   | its URL       | yes  |
| `merged`   | state `MERGED`; ends the watch                                           | `merged`      | yes  |
| `closed`   | state `CLOSED`; ends the watch                                           | `closed`      | yes  |
| `green`    | asked for with `watch { pr, green: true }`: every check finished, none failing, no workflow with jobs yet to start, no conflict | head sha | no |

`red` fires on the first failing check, without waiting for the rest, and names the failing
checks with their URLs. A pull request is polled every 30 seconds while a check is pending or
something changed in the last 10 minutes, every 2 minutes otherwise, up to four at a time. The
query also reads the GraphQL rate limit; below 500 points every interval is four times longer.

An explicit `watch` returns the object's current state in the call, and records it as already
seen. A pull request picked up from a thread link reports what its first read shows.

Agents usually comment through the owner's `gh` login, so the companion cannot tell the owner's
comment from an agent's. It reports every comment that is not a bot's.

### reminder

`remind { in | at, text }` stores a reminder. When it is due it becomes a `reminder` event.

## staleness

Right before a digest is built, every pending event is judged against the current state and
dropped, not sent, when it no longer holds:

- `done`, `failed`, `stuck`: the thread has a newer run, is busy again, or is gone.
- `asks`: the request is no longer pending.
- `red`, `green`, `conflict`: the head changed, the pull request merged or closed, or the
  condition no longer holds on that head.
- `comment`, `merged`, `closed`, `reminder`: never stale.

A dropped event keeps its key, so it is not emitted again.

## delivery

Delivery is level-triggered. Every 2 seconds, and at once on a new event or a new row of the
caller, the companion decides for each caller with pending events:

| caller          | pending events        | action                                   |
| --------------- | --------------------- | ---------------------------------------- |
| not in a turn   | any                   | send after the oldest is 5 s old (`auto`) |
| in a turn       | an urgent one         | send after 5 s as a steer                |
| in a turn       | none urgent           | hold                                     |

Urgent: `asks`, and `red` on a pull request that is not a draft. Because the decision is taken
from the current state on a clock, no edge can be missed: a turn end seen only by a snapshot
re-read, or a queued-turn grace that runs out, releases the digest on the next tick.

A send is made once:

1. The digest is stored with its text and its events before it is sent.
2. It goes through T3 Code's `/mcp` `t3_thread_send` with `clientRequestId` set to the digest's
   id, so a retry cannot add a second message.
3. A refusal is definite: the digest falls back to `application.sendThread`. A failure that leaves
   the outcome unknown (a timeout, a dropped connection) is not retried blindly. The next tick
   reads the caller's last messages for the digest's tag and resends only when it is absent.
4. Its events are marked delivered with the digest in one transaction.

A digest opens with `t3 companion digest <id>` and lists objects, each with its link, its events
and what they carry. Last messages are cut to fit 30,000 characters; `events { id }` returns the
whole payload.

## MCP tools (server `t3-companion`)

| tool       | does                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| `watch`    | with no target: makes the caller a caller. With `thread` or `pr` (and `green`): watches it and returns its state |
| `unwatch`  | ends a watch (`thread`, `pr`), cancels a reminder (`reminder`), or stops everything (`all`)    |
| `watching` | the caller's watches with their current state, its reminders, and its pending events           |
| `remind`   | `in` (seconds) or `at` (ISO time), and `text`                                                  |
| `events`   | hands over pending events now (they will not come in a digest), or one event's payload by `id` |

## storage

SQLite, schema version 9: `callers`, `watches`, `events`, `digests`, `reminders`. The `waits`
and `fires` tables are dropped. Owners of waits still pending at the upgrade become callers, so
they keep being told without a new call.

## decisions to confirm

1. Which events steer into a running turn besides `asks` and `red` on a ready pull request.
2. Whether a thread that ends its turn with background work it did not mark as awaited is `done`
   at once or only when that work ends.
