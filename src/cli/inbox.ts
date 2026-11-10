import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { Command, Flag } from "effect/cli";

import { loadT3CliEnv } from "../config/env/env.ts";
import { withRunningCompanion } from "../companion/client.ts";
import { DeliveryPriority, type InboxEvent, allCompanionEventKinds } from "../companion/schema.ts";
import { MissingThreadError } from "./error.ts";
import { extraArgsConfig } from "./extra-args.ts";
import { formatFlag, threadFlag } from "./flags.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";
import { CliRuntime } from "./runtime/service.ts";
import { resolveThreadId } from "./scope/index.ts";

const decodePriorities = Schema.decodeUnknownEffect(Schema.Record(Schema.String, DeliveryPriority));

const callerEnvFlag = Flag.String("caller-env").pipe(
  Flag.withDescription("Environment of the subscriber thread (default: the default environment)"),
  Flag.optional,
);

const eventsFlag = Flag.Literals("event", allCompanionEventKinds).pipe(
  Flag.withDescription("Event kind to deliver; repeat for several (default: all)"),
  Flag.atLeast(0),
);

const withHttp = Effect.provide(FetchHttpClient.layer);

const resolveSubscriber = Effect.fn("resolveCompanionSubscriber")(function* (input: {
  readonly thread: Option.Option<string>;
  readonly callerEnv: Option.Option<string>;
}) {
  const t3CliEnv = yield* loadT3CliEnv;
  const threadId = resolveThreadId({
    value: Option.getOrUndefined(input.thread),
    scope: t3CliEnv.scope,
  });
  if (threadId === undefined) {
    return yield* new MissingThreadError({
      message: "subscriber thread id is required: pass --thread or set T3CODE_THREAD_ID",
    });
  }
  return { threadId, environment: Option.getOrUndefined(input.callerEnv) };
});

function formatInboxEvent(row: InboxEvent): string {
  const event = row.event;
  const state =
    row.resolvedAt !== null
      ? ` (resolved${row.disposition === null ? "" : `: ${row.disposition}`})`
      : row.snoozedUntil !== null
        ? ` (snoozed until ${row.snoozedUntil})`
        : "";
  const lines = [
    `[${row.id}] ${event.occurredAt} ${row.priority} ${event.kind}${event.pause ? " (pause)" : ""} ${event.environment}${event.threadId === null ? "" : `/${event.threadId}`} "${event.title}"${state}`,
    `    ${event.summary}`,
    ...event.pullRequests.map(
      (pr) =>
        `    PR #${pr.number} ${pr.state}${pr.draft ? " draft" : ""}, checks ${pr.checks ?? "unknown"}, ${pr.mergeable ?? "mergeability unknown"}`,
    ),
  ];
  if (event.lastMessage !== null) {
    lines.push(`    last message: ${event.lastMessage.slice(0, 300).replace(/\s+/g, " ")}`);
  }
  return lines.join("\n");
}

export const inboxCommand = Command.make(
  "inbox",
  {
    thread: threadFlag,
    callerEnv: callerEnvFlag,
    wait: Flag.Boolean("wait").pipe(
      Flag.withDescription("Block until an item arrives or --timeout passes"),
      Flag.withDefault(false),
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Seconds to wait with --wait (default 60, max 600)"),
      Flag.withDefault(60),
    ),
    event: eventsFlag,
    id: Flag.Int("id").pipe(
      Flag.withDescription(
        "Item to resolve or snooze; repeat for several (default: the listed ones)",
      ),
      Flag.atLeast(0),
    ),
    resolve: Flag.Boolean("resolve").pipe(
      Flag.withDescription("Resolve the items for good"),
      Flag.withDefault(false),
    ),
    disposition: Flag.String("disposition").pipe(
      Flag.withDescription('What was done with resolved items, e.g. "marked ready"'),
      Flag.optional,
    ),
    snooze: Flag.Int("snooze").pipe(
      Flag.withDescription(
        "Hide the items for at least this many seconds, until their source is idle",
      ),
      Flag.optional,
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Include resolved and snoozed items"),
      Flag.withDefault(false),
    ),
    format: formatFlag,
    ...extraArgsConfig,
  },
  (input) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const subscriber = yield* resolveSubscriber(input);
      const result = yield* withRunningCompanion((client) =>
        Effect.gen(function* () {
          const events = input.wait
            ? yield* client.wait({
                subscriber,
                afterId: 0,
                events: input.event,
                timeoutSeconds: input.timeout,
              })
            : yield* client.inbox({
                subscriber,
                includeResolved: input.all,
                afterId: 0,
                limit: 100,
              });
          const ids = input.id.length > 0 ? input.id : events.map((row) => row.id);
          const resolved =
            input.resolve && ids.length > 0
              ? yield* client.resolve({
                  subscriber,
                  ids,
                  disposition: Option.getOrNull(input.disposition),
                })
              : 0;
          const snoozed =
            Option.isSome(input.snooze) && ids.length > 0
              ? yield* client.snooze({ subscriber, ids, minSeconds: input.snooze.value })
              : 0;
          return { events, resolved, snoozed };
        }),
      );
      const { events, resolved, snoozed } = result;
      if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson({
          events,
          resolved,
          snoozed,
          timedOut: input.wait && events.length === 0,
        });
      }
      const lines =
        events.length === 0
          ? [input.wait ? "no items (timed out)" : "inbox empty"]
          : events.map(formatInboxEvent);
      return yield* output.printInfo(
        [
          ...lines,
          ...(resolved > 0 ? [`resolved ${resolved}`] : []),
          ...(snoozed > 0 ? [`snoozed ${snoozed}`] : []),
        ].join("\n"),
      );
    }).pipe(withHttp),
).pipe(Command.withDescription("list, wait for, resolve, or snooze companion inbox items"));

const priorityFlag = Flag.KeyValuePair("priority").pipe(
  Flag.withDescription("Per-kind digest priority, e.g. idle=low (urgent, normal, low)"),
  Flag.optional,
);

export const subscribeCommand = Command.make(
  "subscribe",
  {
    thread: threadFlag,
    callerEnv: callerEnvFlag,
    to: Flag.String("to").pipe(Flag.withDescription("Source thread id"), Flag.optional),
    project: Flag.String("project").pipe(
      Flag.withDescription("Source project id (every thread in it)"),
      Flag.optional,
    ),
    sourceEnv: Flag.String("source-env").pipe(
      Flag.withDescription("Environment of the source (default: the default environment)"),
      Flag.optional,
    ),
    event: eventsFlag,
    wake: Flag.Boolean("wake").pipe(
      Flag.withDescription("Also send digest messages to the subscriber thread"),
      Flag.withDefault(false),
    ),
    priority: priorityFlag,
    follow: Flag.Boolean("follow").pipe(
      Flag.withDescription("With --project: follow the subscriber's own new threads in it"),
      Flag.withDefault(false),
    ),
    format: formatFlag,
    ...extraArgsConfig,
  },
  (input) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const subscriber = yield* resolveSubscriber(input);
      const priorities = yield* decodePriorities(Option.getOrElse(input.priority, () => ({})));
      const result = yield* withRunningCompanion((client) =>
        client.subscribe({
          subscriber,
          source: {
            environment: Option.getOrUndefined(input.sourceEnv),
            threadId: Option.getOrUndefined(input.to),
            projectId: Option.getOrUndefined(input.project),
          },
          events: input.event.length === 0 ? allCompanionEventKinds : input.event,
          wake: input.wake,
          priorities,
          follow: input.follow,
        }),
      );
      if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson(result);
      }
      const { subscription, source: status } = result;
      const source =
        subscription.source.threadId === null
          ? `project ${subscription.source.projectId}`
          : `thread ${subscription.source.threadId}`;
      return yield* output.printInfo(
        [
          `subscription ${subscription.id}: ${subscription.subscriber.environment}/${subscription.subscriber.threadId} <- ${subscription.source.environment} ${source} [${subscription.events.join(", ")}]${subscription.wake ? (subscription.armed ? " +wake (armed)" : " +wake (disarmed)") : ""}`,
          ...(status === null
            ? []
            : [
                `source is ${status.state} (run ${status.latestRunStatus})${status.pendingTasks.length > 0 ? `, waiting on: ${status.pendingTasks.join(", ")}` : ""}`,
              ]),
        ].join("\n"),
      );
    }).pipe(withHttp),
).pipe(Command.withDescription("subscribe a thread to another thread's events via the companion"));
