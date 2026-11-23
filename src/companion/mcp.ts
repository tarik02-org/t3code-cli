import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import { CompanionToolError } from "./error.ts";
import { CompanionEvent, Reminder, type ThreadRefInput, WatchView } from "./schema.ts";
import { CompanionWatchlist } from "./watchlist.ts";

const Caller = {
  callerThreadId: Schema.String.annotate({
    description: "Your own T3 Code thread id (T3CODE_THREAD_ID). Digests are sent to it.",
  }),
  callerEnvironment: Schema.optional(Schema.String).annotate({
    description:
      "The t3cli environment name your thread lives in. Defaults to the companion's default environment.",
  }),
};

const ThreadTarget = {
  thread: Schema.optional(Schema.String).annotate({ description: "A thread id." }),
  environment: Schema.optional(Schema.String).annotate({
    description:
      "The t3cli environment name of `thread`. Needed only when the id exists on more than one.",
  }),
  pr: Schema.optional(Schema.String).annotate({
    description: "A pull request, as owner/repo#123 or its URL.",
  }),
};

const WatchTool = Tool.make("watch", {
  description:
    "Call once with only your thread id to be told about your threads and pull requests; nothing else is needed. From then on every thread you launch or write to (t3_thread_launch, t3_thread_send, create_threads) is watched by itself, and so is every pull request linked to those threads or to your own. Name a `thread` or a `pr` only to watch one you did not launch or write to, such as someone else's pull request; the call returns where it stands now, and only later changes are reported. `green: true` also reports a pull request whose checks all passed.",
  parameters: Schema.Struct({
    ...Caller,
    ...ThreadTarget,
    green: Schema.optional(Schema.Boolean).annotate({
      description: "For `pr`: also report when every check on its head has passed.",
    }),
  }),
  success: Schema.Struct({
    watch: Schema.NullOr(WatchView),
    threads: Schema.Int,
    pullRequests: Schema.Int,
  }),
  failure: CompanionToolError,
});

const UnwatchTool = Tool.make("unwatch", {
  description:
    "Stop watching a thread or a pull request, or cancel a reminder. A thread you unwatched is watched again only when you write to it again. `all: true` stops everything: you are no longer told about anything until you call a companion tool again.",
  parameters: Schema.Struct({
    ...Caller,
    ...ThreadTarget,
    reminder: Schema.optional(Schema.Int).annotate({ description: "A reminder's id." }),
    all: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ ended: Schema.Int }),
  failure: CompanionToolError,
});

const WatchingTool = Tool.make("watching", {
  description:
    "Everything watched for you with where it stands now, your reminders, and the events no digest has carried yet.",
  parameters: Schema.Struct(Caller),
  success: Schema.Struct({
    threads: Schema.Array(WatchView),
    pullRequests: Schema.Array(WatchView),
    reminders: Schema.Array(Reminder),
    pending: Schema.Array(CompanionEvent),
  }),
  failure: CompanionToolError,
});

const RemindTool = Tool.make("remind", {
  description:
    "Get a text back at a time: it arrives in a digest like any event. Give `in` (seconds from now) or `at` (an ISO 8601 time).",
  parameters: Schema.Struct({
    ...Caller,
    in: Schema.optional(Schema.Number).annotate({ description: "Seconds from now." }),
    at: Schema.optional(Schema.String).annotate({ description: "An ISO 8601 time." }),
    text: Schema.String.annotate({ description: "What to be reminded of." }),
  }),
  success: Reminder,
  failure: CompanionToolError,
});

const EventsTool = Tool.make("events", {
  description:
    "With `id`: one event's whole payload, such as a thread's last message that a digest cut short. Without: your pending events now, instead of in a digest; they are handed over once.",
  parameters: Schema.Struct({ ...Caller, id: Schema.optional(Schema.Int) }),
  success: Schema.Struct({ events: Schema.Array(CompanionEvent) }),
  failure: CompanionToolError,
});

export const CompanionToolkit = Toolkit.make(
  WatchTool,
  UnwatchTool,
  WatchingTool,
  RemindTool,
  EventsTool,
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

const threadTarget = (input: {
  readonly thread?: string | undefined;
  readonly environment?: string | undefined;
}): ThreadRefInput | undefined =>
  input.thread === undefined
    ? undefined
    : { threadId: input.thread, environment: input.environment };

const CompanionToolkitHandlers = CompanionToolkit.toLayer(
  Effect.gen(function* () {
    const watchlist = yield* CompanionWatchlist;
    return CompanionToolkit.of({
      watch: (input) =>
        watchlist
          .watch({
            caller: callerRef(input),
            thread: threadTarget(input),
            pr: input.pr,
            green: input.green,
          })
          .pipe(asToolError("watch")),
      unwatch: (input) =>
        watchlist
          .unwatch({
            caller: callerRef(input),
            thread: threadTarget(input),
            pr: input.pr,
            reminder: input.reminder,
            all: input.all,
          })
          .pipe(
            Effect.map((ended) => ({ ended })),
            asToolError("unwatch"),
          ),
      watching: (input) =>
        watchlist.watching({ caller: callerRef(input) }).pipe(
          Effect.map(([mine]) => ({
            threads: mine?.threads ?? [],
            pullRequests: mine?.pullRequests ?? [],
            reminders: mine?.reminders ?? [],
            pending: mine?.pending ?? [],
          })),
          asToolError("watching"),
        ),
      remind: (input) =>
        watchlist
          .remind({ caller: callerRef(input), in: input.in, at: input.at, text: input.text })
          .pipe(asToolError("remind")),
      events: (input) =>
        watchlist.events({ caller: callerRef(input), id: input.id }).pipe(
          Effect.map((events) => ({ events })),
          asToolError("events"),
        ),
    });
  }),
);

export const companionMcpPath = "/mcp";

export const CompanionMcpLive = (version: string) =>
  McpServer.layerHttp({
    name: "t3-companion",
    version,
    instructions:
      "Tells you what needs you in the T3 Code threads and pull requests you are responsible for, so you neither poll them nor arm anything. Call watch once with callerThreadId (your T3CODE_THREAD_ID). After that the threads you launch or write to, and the pull requests linked to them or to you, are watched by themselves. You get one message, a digest, grouping what happened: a thread asks (a pending question or approval), is done (its turn ended; the digest carries its whole last message, and says when it closes on a question), failed, or is stuck; a pull request is red (a check really failed on its head; cancelled jobs do not count), conflicts, got a person's comment or review, merged or closed. Each is sent once and dropped if it stopped being true before it was sent. A digest waits for your turn to end; a thread that asks, a failed thread and a red ready pull request reach you mid-turn. remind sends you a text at a time; watching lists what is watched; events gives an event's whole payload.",
    path: companionMcpPath,
    protocols: [McpProtocol.v2025_06_18, McpProtocol.v2026_07_28],
    allowSessionTermination: true,
    registrations: McpServer.toolkit(CompanionToolkit).pipe(
      Layer.provide(CompanionToolkitHandlers),
    ),
  });
