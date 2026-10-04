# Output

## Formats

`--format auto` prints human output on an interactive terminal and the command's structured default
everywhere else: `json`, except `wait` (`ndjson`) and `start`/`send --wait` (`ndjson`). Agent
environments (`T3CLI_AGENT`, `CI`, `CODEX_CI`, `CODEX_THREAD_ID`) never count as interactive.
`wait` offers no `json`; the `done` event carries the final state.

In JSON, `thread` is the thread record without its timeline; read the timeline with `transcript`.

## JSON results

| Command                       | Object                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `start`                       | `{ threadId, project, thread, status, latestAssistantMessage }`                               |
| `start --wait`                | `{ threadId, thread, status, latestAssistantMessage }`                                        |
| `send` (with or without wait) | `{ dispatch, threadId, messageId, thread, status, latestAssistantMessage }`                   |
| `ask`                         | `{ answer, threadId, runId, created, archive }`                                               |
| `show`                        | thread summary, including `status`, `modelSelection`, `pendingApprovals`, `pendingUserInputs` |
| `transcript`                  | `{ threadId, snapshotSequence, messages, hasMoreHistory, beforeCursor }`                      |

## NDJSON stream

One object per line:

```json
{ "type": "started", "threadId": "..." }
{ "type": "thread", "thread": {}, "status": "running", "messageCount": 3 }
{ "type": "message", "message": { "role": "assistant", "text": "...", "runId": "..." } }
{ "type": "status", "status": "running", "threadId": "..." }
{ "type": "done", "thread": {}, "status": "completed", "latestAssistantMessage": {} }
```

- The first line names what was sent: `started` (`start`), `dispatch` with the command `sequence`
  (`send`), or `dispatched` with `threadId` and `messageId` (`ask`).
- `message` lines repeat as a message streams; the latest line for an id holds its full text.
- `status` lines appear only when the status changes.
- `ask` ends with `{ "type": "result", … }` holding the JSON result above.

## Status values

`idle`, or the status of the run that owns the thread's work: `preparing`, `queued`, `starting`,
`running`, `waiting` (on an approval or user input), `completed`, `interrupted`, `failed`,
`cancelled`, `rolled_back`. `wait` treats everything up to `waiting` as still working.
