import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import { CompanionToolError } from "./error.ts";
import {
  FiredWait,
  LeafTruth,
  PendingWait,
  type ThreadRefInput,
  WaitResult,
  WakePolicy,
} from "./schema.ts";
import { CompanionWaits, maxWaitNowSeconds } from "./waits.ts";

const Caller = {
  callerThreadId: Schema.String.annotate({
    description: "Your own T3 Code thread id (T3CODE_THREAD_ID). Waits belong to it.",
  }),
  callerEnvironment: Schema.optional(Schema.String).annotate({
    description:
      "The t3cli environment name your thread lives in. Defaults to the companion's default environment.",
  }),
};

// Decoded by the daemon rather than declared here: the grammar is recursive, and a bad
// condition then comes back with the reason it was refused.
const ConditionParameter = Schema.Record(Schema.String, Schema.Unknown).annotate({
  description: [
    "What to wait for, as JSON. A leaf, or leaves combined:",
    '{"any": [condition, …]}, {"all": [condition, …]}, {"not": condition}.',
    'Thread leaf: {"thread": "<thread id>", "environment": "<env, optional>", "is": "idle" | "finished" | "needs-input" | "needs-approval" | "failed" | "stalled" | "message"}.',
    'idle: its run ended (its own background work may still be pending). finished: idle with none pending; a PR watch alone does not count. needs-input: a question for the user. needs-approval: a command or tool call awaits approval. stalled: work it awaits is still pending 30 minutes after its run (set "minutes" to change that). message: a new assistant message.',
    'Pull request leaf: {"pr": "owner/repo#123", "is": "checks-done" | "green" | "red" | "mergeable" | "conflicting" | "draft" | "ready" | "merged" | "closed" | "comment" | "new-head"}, on the PR\'s current head. comment: a new comment or review from a person, not a bot.',
    'Time leaf: {"after": <seconds>}.',
    "message, comment and new-head mean new since the wait was made (or last fired). Everything else is judged against the current state, so a wait on something that already holds fires at once.",
    'Example: {"any": [{"thread": "T", "is": "needs-input"}, {"all": [{"thread": "T", "is": "idle"}, {"pr": "o/r#12", "is": "green"}]}]}.',
  ].join(" "),
});

const WaitTool = Tool.make("wait", {
  description:
    "Wait until a condition holds, without blocking your turn. Returns the wait's id; if the condition already holds, the result comes back in this call instead. Otherwise you are woken with one line per fired wait when it holds, or when its deadline passes. A fired wait is done: nothing to resolve or re-arm.",
  parameters: Schema.Struct({
    ...Caller,
    condition: ConditionParameter,
    deadline: Schema.optional(Schema.Number).annotate({
      description: "Seconds from now after which the wait fires with outcome timeout.",
    }),
    wake: Schema.optional(WakePolicy).annotate({
      description:
        "How a fired wait reaches you. turn-end (default): after your current turn ends, together with whatever else fired, as one message. steer: at once, into your running turn. none: no message; waits hands the result over.",
    }),
    label: Schema.optional(Schema.String).annotate({
      description: "A few words that will tell you what this wait was for when it fires.",
    }),
    repeat: Schema.optional(Schema.Boolean).annotate({
      description:
        "Fire again every time the condition becomes true after having been false, until cancelled.",
    }),
  }),
  success: Schema.Struct({
    id: Schema.Int,
    fired: Schema.NullOr(FiredWait),
    leaves: Schema.Array(LeafTruth),
  }),
  failure: CompanionToolError,
});

const WaitNowTool = Tool.make("wait_now", {
  description: `Block inside your turn until a condition holds or the timeout passes (at most ${maxWaitNowSeconds} seconds). Use it for short waits; for anything longer use wait and end your turn.`,
  parameters: Schema.Struct({
    ...Caller,
    condition: ConditionParameter,
    timeout: Schema.Number.annotate({ description: "Seconds to block for." }),
  }),
  success: WaitResult,
  failure: CompanionToolError,
});

const WaitsTool = Tool.make("waits", {
  description:
    "List your pending waits, each with where every part of its condition stands now, and hand over the waits that fired with wake none (each is handed over once).",
  parameters: Schema.Struct(Caller),
  success: Schema.Struct({
    pending: Schema.Array(PendingWait),
    fired: Schema.Array(FiredWait),
  }),
  failure: CompanionToolError,
});

const WaitCancelTool = Tool.make("wait_cancel", {
  description: "Cancel pending waits of yours by id.",
  parameters: Schema.Struct({ ...Caller, ids: Schema.Array(Schema.Int) }),
  success: Schema.Struct({ cancelled: Schema.Int }),
  failure: CompanionToolError,
});

const WaitResultTool = Tool.make("wait_result", {
  description:
    "The whole payload of a wait that fired: every part of its condition, each thread's last message (up to 10,000 characters) and each pull request's state. Kept for 24 hours.",
  parameters: Schema.Struct({ ...Caller, id: Schema.Int }),
  success: FiredWait,
  failure: CompanionToolError,
});

export const CompanionToolkit = Toolkit.make(
  WaitTool,
  WaitNowTool,
  WaitsTool,
  WaitCancelTool,
  WaitResultTool,
);

/** Keeps the full cause in the daemon log and hands callers a stable message. */
const asToolError =
  (tool: string) =>
  <A, E extends { readonly message: string }, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.tapError((error) => Effect.logWarning(`tool ${tool} failed`, error)),
      Effect.mapError((error) => new CompanionToolError({ message: error.message, tool })),
    );

const callerRef = (input: {
  readonly callerThreadId: string;
  readonly callerEnvironment?: string | undefined;
}): ThreadRefInput => ({ threadId: input.callerThreadId, environment: input.callerEnvironment });

const CompanionToolkitHandlers = CompanionToolkit.toLayer(
  Effect.gen(function* () {
    const waits = yield* CompanionWaits;
    return CompanionToolkit.of({
      wait: (input) =>
        waits
          .create({
            owner: callerRef(input),
            condition: input.condition,
            deadline: input.deadline,
            wake: input.wake,
            label: input.label,
            repeat: input.repeat,
          })
          .pipe(asToolError("wait")),
      wait_now: (input) =>
        waits
          .now({ owner: callerRef(input), condition: input.condition, timeout: input.timeout })
          .pipe(asToolError("wait_now")),
      waits: (input) =>
        waits.list({ owner: callerRef(input), collect: true }).pipe(
          Effect.map((listing) => ({
            pending: listing.pending.map(({ owner: _owner, ...wait }) => wait),
            fired: listing.fired,
          })),
          asToolError("waits"),
        ),
      wait_cancel: (input) =>
        waits.cancel({ owner: callerRef(input), ids: input.ids }).pipe(
          Effect.map((cancelled) => ({ cancelled })),
          asToolError("wait_cancel"),
        ),
      wait_result: (input) =>
        waits.result({ owner: callerRef(input), id: input.id }).pipe(asToolError("wait_result")),
    });
  }),
);

export const companionMcpPath = "/mcp";

export const CompanionMcpLive = (version: string) =>
  McpServer.layerHttp({
    name: "t3-companion",
    version,
    instructions:
      "Wait for T3 Code threads and pull requests instead of polling them. One tool does it: wait, with a condition (a thread's state, a pull request's state, a time, combined with any/all/not), an optional deadline, and how it should wake you. Identify yourself with callerThreadId (your T3CODE_THREAD_ID). A wait is judged against the current state, so nothing is lost if an update is missed, and a fired wait is done: there is nothing to resolve, arm or snooze. wait_now blocks inside your turn for short waits; waits lists what is pending; wait_result gives a fired wait's whole payload.",
    path: companionMcpPath,
    protocols: [McpProtocol.v2025_06_18, McpProtocol.v2026_07_28],
    allowSessionTermination: true,
    registrations: McpServer.toolkit(CompanionToolkit).pipe(
      Layer.provide(CompanionToolkitHandlers),
    ),
  });
