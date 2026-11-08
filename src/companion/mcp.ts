import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import { CompanionEnvironments } from "./environments.ts";
import { CompanionToolError } from "./error.ts";
import { CompanionHub, maxWaitSeconds } from "./hub.ts";
import {
  CompanionEventKind,
  InboxEvent,
  Subscription,
  allCompanionEventKinds,
  type ThreadRef,
} from "./schema.ts";
import { CompanionStore } from "./store.ts";

const Caller = {
  callerThreadId: Schema.String.annotate({
    description: "Your own T3 Code thread id (T3CODE_THREAD_ID). Inbox rows are keyed on it.",
  }),
  callerEnvironment: Schema.optional(Schema.String).annotate({
    description:
      "The t3cli environment name your thread lives in. Defaults to the companion's default environment.",
  }),
};

const Events = Schema.optional(Schema.Array(CompanionEventKind)).annotate({
  description: "Events to deliver: idle, failed, needs-input, settled. Defaults to all of them.",
});

const Wake = Schema.optional(Schema.Boolean).annotate({
  description:
    "Also send one coalesced digest message to your thread when events arrive, so an idle thread resumes. Events always go to the inbox.",
});

const SubscribeTool = Tool.make("subscribe", {
  description:
    "Subscribe your thread to another thread (or every thread of a project) so its idle, failed, needs-input, and settled events land in your inbox instead of polling it.",
  parameters: Schema.Struct({
    ...Caller,
    environment: Schema.optional(Schema.String).annotate({
      description: "Environment of the source thread or project. Defaults to the default one.",
    }),
    threadId: Schema.optional(Schema.String),
    projectId: Schema.optional(Schema.String),
    events: Events,
    wake: Wake,
  }),
  success: Subscription,
  failure: CompanionToolError,
});

const UnsubscribeTool = Tool.make("unsubscribe", {
  description: "Remove your subscriptions by id.",
  parameters: Schema.Struct({ ...Caller, ids: Schema.Array(Schema.Int) }),
  success: Schema.Struct({ removed: Schema.Int }),
  failure: CompanionToolError,
});

const SubscriptionsListTool = Tool.make("subscriptions_list", {
  description: "List your subscriptions.",
  parameters: Schema.Struct(Caller),
  success: Schema.Struct({ subscriptions: Schema.Array(Subscription) }),
  failure: CompanionToolError,
});

const InboxListTool = Tool.make("inbox_list", {
  description: "List events in your inbox, oldest first. Unacknowledged ones only by default.",
  parameters: Schema.Struct({
    ...Caller,
    includeAcked: Schema.optional(Schema.Boolean),
    afterId: Schema.optional(Schema.Int),
    limit: Schema.optional(Schema.Int),
  }),
  success: Schema.Struct({ events: Schema.Array(InboxEvent) }),
  failure: CompanionToolError,
});

const InboxAckTool = Tool.make("inbox_ack", {
  description: "Acknowledge inbox events by id so they stop showing up.",
  parameters: Schema.Struct({ ...Caller, ids: Schema.Array(Schema.Int) }),
  success: Schema.Struct({ acked: Schema.Int }),
  failure: CompanionToolError,
});

const InboxWaitTool = Tool.make("inbox_wait", {
  description:
    "Block until an unacknowledged inbox event arrives (or one is already there), or until the timeout passes.",
  parameters: Schema.Struct({
    ...Caller,
    afterId: Schema.optional(Schema.Int).annotate({
      description: "Only return events with a larger id.",
    }),
    events: Schema.optional(Schema.Array(CompanionEventKind)),
    timeoutSeconds: Schema.optional(Schema.Int).annotate({
      description: `Defaults to 60, at most ${maxWaitSeconds}.`,
    }),
  }),
  success: Schema.Struct({ events: Schema.Array(InboxEvent), timedOut: Schema.Boolean }),
  failure: CompanionToolError,
});

const ThreadSendTool = Tool.make("thread_send", {
  description:
    "Send a message to another thread and subscribe your thread to it, so its result arrives in your inbox.",
  parameters: Schema.Struct({
    ...Caller,
    environment: Schema.optional(Schema.String),
    threadId: Schema.String,
    message: Schema.String,
    events: Events,
    wake: Wake,
  }),
  success: Schema.Struct({ threadId: Schema.String, subscription: Subscription }),
  failure: CompanionToolError,
});

const ThreadStartTool = Tool.make("thread_start", {
  description:
    "Start a new thread in a project and subscribe your thread to it, so its result arrives in your inbox.",
  parameters: Schema.Struct({
    ...Caller,
    environment: Schema.optional(Schema.String),
    project: Schema.optional(Schema.String).annotate({
      description: "Project id, title, or path. Defaults to the server's default project.",
    }),
    message: Schema.String,
    title: Schema.optional(Schema.String),
    events: Events,
    wake: Wake,
  }),
  success: Schema.Struct({ threadId: Schema.String, subscription: Subscription }),
  failure: CompanionToolError,
});

export const CompanionToolkit = Toolkit.make(
  SubscribeTool,
  UnsubscribeTool,
  SubscriptionsListTool,
  InboxListTool,
  InboxAckTool,
  InboxWaitTool,
  ThreadSendTool,
  ThreadStartTool,
);

/** Keeps the full cause in the daemon log and hands callers a stable message. */
const asToolError =
  (tool: string) =>
  <A, E extends { readonly message: string }, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.tapError((error) => Effect.logWarning(`tool ${tool} failed`, error)),
      Effect.mapError((error) => new CompanionToolError({ message: error.message, tool })),
    );

const CompanionToolkitHandlers = CompanionToolkit.toLayer(
  Effect.gen(function* () {
    const hub = yield* CompanionHub;
    const store = yield* CompanionStore;
    const environments = yield* CompanionEnvironments;
    const caller = (input: {
      readonly callerThreadId: string;
      readonly callerEnvironment?: string | undefined;
    }): Effect.Effect<ThreadRef, CompanionToolError> =>
      hub
        .normalizeRef({
          threadId: input.callerThreadId,
          ...(input.callerEnvironment === undefined
            ? {}
            : { environment: input.callerEnvironment }),
        })
        .pipe(asToolError("caller"));

    const subscribeCaller = (input: {
      readonly subscriber: ThreadRef;
      readonly environment: string;
      readonly threadId: string;
      readonly events: ReadonlyArray<CompanionEventKind> | undefined;
      readonly wake: boolean | undefined;
    }) =>
      hub.subscribe({
        subscriber: input.subscriber,
        source: { environment: input.environment, threadId: input.threadId },
        events: input.events ?? allCompanionEventKinds,
        wake: input.wake ?? false,
      });

    return CompanionToolkit.of({
      subscribe: Effect.fn("CompanionMcp.subscribe")(function* (input) {
        const subscriber = yield* caller(input);
        return yield* hub
          .subscribe({
            subscriber,
            source: {
              ...(input.environment === undefined ? {} : { environment: input.environment }),
              ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
              ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
            },
            events: input.events ?? allCompanionEventKinds,
            wake: input.wake ?? false,
          })
          .pipe(asToolError("subscribe"));
      }),
      unsubscribe: Effect.fn("CompanionMcp.unsubscribe")(function* (input) {
        const subscriber = yield* caller(input);
        const removed = yield* hub
          .unsubscribe({ subscriber, ids: input.ids })
          .pipe(asToolError("unsubscribe"));
        return { removed };
      }),
      subscriptions_list: Effect.fn("CompanionMcp.subscriptionsList")(function* (input) {
        const subscriber = yield* caller(input);
        const subscriptions = yield* store
          .listSubscriptions(subscriber)
          .pipe(asToolError("subscriptions_list"));
        return { subscriptions };
      }),
      inbox_list: Effect.fn("CompanionMcp.inboxList")(function* (input) {
        const subscriber = yield* caller(input);
        const events = yield* store
          .listInbox({
            subscriber,
            includeAcked: input.includeAcked ?? false,
            afterId: input.afterId ?? 0,
            limit: input.limit ?? 50,
          })
          .pipe(asToolError("inbox_list"));
        return { events };
      }),
      inbox_ack: Effect.fn("CompanionMcp.inboxAck")(function* (input) {
        const subscriber = yield* caller(input);
        const acked = yield* store
          .ack({ subscriber, ids: input.ids })
          .pipe(asToolError("inbox_ack"));
        return { acked };
      }),
      inbox_wait: Effect.fn("CompanionMcp.inboxWait")(function* (input) {
        const subscriber = yield* caller(input);
        const seconds = Math.min(Math.max(input.timeoutSeconds ?? 60, 0), maxWaitSeconds);
        const events = yield* hub
          .wait({
            subscriber,
            afterId: input.afterId ?? 0,
            kinds: input.events ?? [],
            timeout: Duration.seconds(seconds),
          })
          .pipe(asToolError("inbox_wait"));
        return { events, timedOut: events.length === 0 };
      }),
      thread_send: Effect.fn("CompanionMcp.threadSend")(function* (input) {
        const subscriber = yield* caller(input);
        const environment = yield* environments
          .resolve(input.environment)
          .pipe(asToolError("thread_send"));
        // Subscribe first so the run this message starts cannot finish unobserved.
        const subscription = yield* subscribeCaller({
          subscriber,
          environment: environment.name,
          threadId: input.threadId,
          events: input.events,
          wake: input.wake,
        }).pipe(asToolError("thread_send"));
        yield* environment.application
          .sendThread({
            threadId: input.threadId,
            message: input.message,
            author: { kind: "agent", senderThreadId: subscriber.threadId },
          })
          .pipe(asToolError("thread_send"));
        return { threadId: input.threadId, subscription };
      }),
      thread_start: Effect.fn("CompanionMcp.threadStart")(function* (input) {
        const subscriber = yield* caller(input);
        const environment = yield* environments
          .resolve(input.environment)
          .pipe(asToolError("thread_start"));
        const started = yield* environment.application
          .startThread({
            message: input.message,
            ...(input.project === undefined ? {} : { projectRef: input.project }),
            ...(input.title === undefined ? {} : { title: input.title }),
          })
          .pipe(asToolError("thread_start"));
        const subscription = yield* subscribeCaller({
          subscriber,
          environment: environment.name,
          threadId: started.threadId,
          events: input.events,
          wake: input.wake,
        }).pipe(asToolError("thread_start"));
        return { threadId: started.threadId, subscription };
      }),
    });
  }),
);

export const companionMcpPath = "/mcp";

export const CompanionMcpLive = (version: string) =>
  McpServer.layerHttp({
    name: "t3-companion",
    version,
    instructions:
      "Subscribe to other T3 Code threads and read their idle/failed/needs-input/settled events from an inbox instead of polling. Identify yourself with callerThreadId (your T3CODE_THREAD_ID).",
    path: companionMcpPath,
    protocols: [McpProtocol.v2025_06_18, McpProtocol.v2026_07_28],
    allowSessionTermination: true,
    registrations: McpServer.toolkit(CompanionToolkit).pipe(
      Layer.provide(CompanionToolkitHandlers),
    ),
  });
