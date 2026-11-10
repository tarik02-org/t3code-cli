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
import { CompanionHub, maxWaitSeconds, type ThreadRefInput } from "./hub.ts";
import { SubscribeResult } from "./rpc.ts";
import {
  CompanionEventKind,
  DeliveryPriority,
  InboxEvent,
  OpenWorkItem,
  Subscription,
  allCompanionEventKinds,
} from "./schema.ts";

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
  description:
    "Events to deliver: idle, failed, needs-input, settled, pr-checks (env-down and env-up always come). Defaults to all.",
});

const Wake = Schema.optional(Schema.Boolean).annotate({
  description:
    "Let events wake your thread with a digest message. Each subscription wakes you once, then disarms until you arm it (or subscribe to the same source again); later events still reach your inbox and ride along in other digests. Failures and questions always wake. Events always go to the inbox.",
});

const Priorities = Schema.optional(Schema.Record(Schema.String, DeliveryPriority)).annotate({
  description:
    'Per-kind digest priority overrides, e.g. {"idle": "low"}. urgent steers into your running turn at once, carrying everything else pending; normal and low wait until your turn ends and arrive together as one new turn. Defaults: failed and needs-input urgent; idle and env-down normal; settled, env-up, pauses and snoozed items low.',
});

const Ids = Schema.Array(Schema.Int);

const SubscribeTool = Tool.make("subscribe", {
  description:
    "Subscribe your thread to another thread (or every thread of a project) so its events land in your inbox instead of polling it. Subscribing again to the same source updates and re-arms that subscription. Returns the source's current state; if it already failed, needs input, or finished, that item is in your inbox right away.",
  parameters: Schema.Struct({
    ...Caller,
    environment: Schema.optional(Schema.String).annotate({
      description: "Environment of the source thread or project. Defaults to the default one.",
    }),
    threadId: Schema.optional(Schema.String),
    projectId: Schema.optional(Schema.String),
    follow: Schema.optional(Schema.Boolean).annotate({
      description:
        "With projectId: instead of every thread's events, subscribe you to each new thread you launch in that project, with these events and settings.",
    }),
    events: Events,
    wake: Wake,
    priorities: Priorities,
  }),
  success: SubscribeResult,
  failure: CompanionToolError,
});

const ArmTool = Tool.make("arm", {
  description:
    "Arm your subscriptions by id so the next event from each wakes you once. A wake disarms a subscription; until you arm it again (or subscribe to the same source again), its events reach your inbox and your digests without waking you. Failures and questions always wake.",
  parameters: Schema.Struct({ ...Caller, ids: Ids }),
  success: Schema.Struct({ armed: Schema.Int }),
  failure: CompanionToolError,
});

const UnsubscribeTool = Tool.make("unsubscribe", {
  description: "Remove your subscriptions by id.",
  parameters: Schema.Struct({ ...Caller, ids: Ids }),
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
  description:
    "List your open inbox items, oldest first. Each carries the source's last message and its PR states. Items stay open until you resolve them; snoozed ones are hidden until they come back.",
  parameters: Schema.Struct({
    ...Caller,
    includeResolved: Schema.optional(Schema.Boolean).annotate({
      description: "Also list resolved and snoozed items.",
    }),
    afterId: Schema.optional(Schema.Int),
    limit: Schema.optional(Schema.Int),
  }),
  success: Schema.Struct({ events: Schema.Array(InboxEvent) }),
  failure: CompanionToolError,
});

const InboxResolveTool = Tool.make("inbox_resolve", {
  description: "Close inbox items for good, optionally noting what you did with them.",
  parameters: Schema.Struct({
    ...Caller,
    ids: Ids,
    disposition: Schema.optional(Schema.String).annotate({
      description: 'Free text, e.g. "marked ready" or "sent back".',
    }),
  }),
  success: Schema.Struct({ resolved: Schema.Int }),
  failure: CompanionToolError,
});

const InboxSnoozeTool = Tool.make("inbox_snooze", {
  description:
    "Hide inbox items until at least minSeconds pass and their source thread is idle; then they come back at low priority. Use it for results you can only act on later, such as a thread waiting on CI.",
  parameters: Schema.Struct({ ...Caller, ids: Ids, minSeconds: Schema.Int }),
  success: Schema.Struct({ snoozed: Schema.Int }),
  failure: CompanionToolError,
});

const InboxWaitTool = Tool.make("inbox_wait", {
  description:
    "Block until an open inbox item arrives (or one is already there), or until the timeout passes.",
  parameters: Schema.Struct({
    ...Caller,
    afterId: Schema.optional(Schema.Int).annotate({
      description: "Only return items with a larger id.",
    }),
    events: Schema.optional(Schema.Array(CompanionEventKind)),
    timeoutSeconds: Schema.optional(Schema.Int).annotate({
      description: `Defaults to 60, at most ${maxWaitSeconds}.`,
    }),
  }),
  success: Schema.Struct({ events: Schema.Array(InboxEvent), timedOut: Schema.Boolean }),
  failure: CompanionToolError,
});

const OpenWorkTool = Tool.make("open_work", {
  description:
    "List your subscribed threads that have draft pull requests whose checks pass: the ones waiting to be marked ready.",
  parameters: Schema.Struct(Caller),
  success: Schema.Struct({ threads: Schema.Array(OpenWorkItem) }),
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
    priorities: Priorities,
  }),
  success: Schema.Struct({ threadId: Schema.String, ...SubscribeResult.fields }),
  failure: CompanionToolError,
});

const ThreadStartTool = Tool.make("thread_start", {
  description:
    "Start a new thread in a project and, unless subscribe is false, subscribe your thread to it in the same call, so even a failure at launch reaches your inbox.",
  parameters: Schema.Struct({
    ...Caller,
    environment: Schema.optional(Schema.String),
    project: Schema.optional(Schema.String).annotate({
      description: "Project id, title, or path. Defaults to the server's default project.",
    }),
    message: Schema.String,
    title: Schema.optional(Schema.String),
    subscribe: Schema.optional(Schema.Boolean).annotate({ description: "Defaults to true." }),
    events: Events,
    wake: Wake,
    priorities: Priorities,
  }),
  success: Schema.Struct({
    threadId: Schema.String,
    subscription: Schema.NullOr(Subscription),
    source: SubscribeResult.fields.source,
  }),
  failure: CompanionToolError,
});

export const CompanionToolkit = Toolkit.make(
  SubscribeTool,
  ArmTool,
  UnsubscribeTool,
  SubscriptionsListTool,
  InboxListTool,
  InboxResolveTool,
  InboxSnoozeTool,
  InboxWaitTool,
  OpenWorkTool,
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

const callerRef = (input: {
  readonly callerThreadId: string;
  readonly callerEnvironment?: string | undefined;
}): ThreadRefInput => ({ threadId: input.callerThreadId, environment: input.callerEnvironment });

const CompanionToolkitHandlers = CompanionToolkit.toLayer(
  Effect.gen(function* () {
    const hub = yield* CompanionHub;
    const environments = yield* CompanionEnvironments;

    const subscribeTo = (
      input: {
        readonly callerThreadId: string;
        readonly callerEnvironment?: string | undefined;
        readonly events?: ReadonlyArray<CompanionEventKind> | undefined;
        readonly wake?: boolean | undefined;
        readonly priorities?: Readonly<Record<string, DeliveryPriority>> | undefined;
      },
      source: { readonly environment: string; readonly threadId: string },
    ) =>
      hub.subscribe({
        subscriber: callerRef(input),
        source,
        events: input.events ?? allCompanionEventKinds,
        wake: input.wake ?? false,
        priorities: input.priorities ?? {},
      });

    return CompanionToolkit.of({
      subscribe: (input) =>
        hub
          .subscribe({
            subscriber: callerRef(input),
            source: {
              environment: input.environment,
              threadId: input.threadId,
              projectId: input.projectId,
            },
            events: input.events ?? allCompanionEventKinds,
            wake: input.wake ?? false,
            priorities: input.priorities ?? {},
            follow: input.follow ?? false,
          })
          .pipe(asToolError("subscribe")),
      arm: (input) =>
        hub.arm({ subscriber: callerRef(input), ids: input.ids }).pipe(
          Effect.map((armed) => ({ armed })),
          asToolError("arm"),
        ),
      unsubscribe: (input) =>
        hub.unsubscribe({ subscriber: callerRef(input), ids: input.ids }).pipe(
          Effect.map((removed) => ({ removed })),
          asToolError("unsubscribe"),
        ),
      subscriptions_list: (input) =>
        hub.listSubscriptions(callerRef(input)).pipe(
          Effect.map((subscriptions) => ({ subscriptions })),
          asToolError("subscriptions_list"),
        ),
      inbox_list: (input) =>
        hub
          .listInbox({
            subscriber: callerRef(input),
            includeResolved: input.includeResolved ?? false,
            afterId: input.afterId ?? 0,
            limit: input.limit ?? 50,
          })
          .pipe(
            Effect.map((events) => ({ events })),
            asToolError("inbox_list"),
          ),
      inbox_resolve: (input) =>
        hub
          .resolve({
            subscriber: callerRef(input),
            ids: input.ids,
            disposition: input.disposition ?? null,
          })
          .pipe(
            Effect.map((resolved) => ({ resolved })),
            asToolError("inbox_resolve"),
          ),
      inbox_snooze: (input) =>
        hub
          .snooze({ subscriber: callerRef(input), ids: input.ids, minSeconds: input.minSeconds })
          .pipe(
            Effect.map((snoozed) => ({ snoozed })),
            asToolError("inbox_snooze"),
          ),
      inbox_wait: (input) =>
        hub
          .wait({
            subscriber: callerRef(input),
            afterId: input.afterId ?? 0,
            kinds: input.events ?? [],
            timeout: Duration.seconds(
              Math.min(Math.max(input.timeoutSeconds ?? 60, 0), maxWaitSeconds),
            ),
          })
          .pipe(
            Effect.map((events) => ({ events, timedOut: events.length === 0 })),
            asToolError("inbox_wait"),
          ),
      open_work: (input) =>
        hub.openWork(callerRef(input)).pipe(
          Effect.map((threads) => ({ threads })),
          asToolError("open_work"),
        ),
      thread_send: Effect.fn("CompanionMcp.threadSend")(function* (input) {
        const environment = yield* environments
          .resolve(input.environment)
          .pipe(asToolError("thread_send"));
        // Subscribe first so the run this message starts cannot finish unobserved.
        const subscribed = yield* subscribeTo(input, {
          environment: environment.name,
          threadId: input.threadId,
        }).pipe(asToolError("thread_send"));
        yield* environment.application
          .sendThread({
            threadId: input.threadId,
            message: input.message,
            author: { kind: "agent", senderThreadId: input.callerThreadId },
          })
          .pipe(asToolError("thread_send"));
        return { threadId: input.threadId, ...subscribed };
      }),
      thread_start: Effect.fn("CompanionMcp.threadStart")(function* (input) {
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
        if (input.subscribe === false) {
          return { threadId: started.threadId, subscription: null, source: null };
        }
        // The subscription reads the thread's state, so a run that already failed is reported.
        const subscribed = yield* subscribeTo(input, {
          environment: environment.name,
          threadId: started.threadId,
        }).pipe(asToolError("thread_start"));
        return { threadId: started.threadId, ...subscribed };
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
      "Subscribe to other T3 Code threads and get their idle/failed/needs-input/settled events in an inbox instead of polling. Identify yourself with callerThreadId (your T3CODE_THREAD_ID). Items stay open until inbox_resolve; inbox_snooze hides one until its source is idle again. An idle with pause=true means the thread only waits on its own background work.",
    path: companionMcpPath,
    protocols: [McpProtocol.v2025_06_18, McpProtocol.v2026_07_28],
    allowSessionTermination: true,
    registrations: McpServer.toolkit(CompanionToolkit).pipe(
      Layer.provide(CompanionToolkitHandlers),
    ),
  });
