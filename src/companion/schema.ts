import * as Schema from "effect/Schema";

export const CompanionEventKind = Schema.Literals([
  "idle",
  "failed",
  "needs-input",
  "needs-approval",
  "settled",
  "pr-checks",
  "env-down",
  "env-up",
]);
export type CompanionEventKind = typeof CompanionEventKind.Type;

export const allCompanionEventKinds = CompanionEventKind.literals;

/** Environment events reach every subscription on that environment, whatever it asked for. */
export const environmentEventKinds: ReadonlyArray<CompanionEventKind> = ["env-down", "env-up"];

/**
 * How a wake digest reaches the subscriber: `urgent` steers into its running turn at once, with
 * everything else pending; `normal` and `low` wait until that turn ends and then go out together as
 * one new turn (sorted after higher priorities). An idle subscriber gets the digest right away.
 */
export const DeliveryPriority = Schema.Literals(["urgent", "normal", "low"]);
export type DeliveryPriority = typeof DeliveryPriority.Type;

export const ThreadRef = Schema.Struct({
  environment: Schema.String,
  threadId: Schema.String,
});
export type ThreadRef = typeof ThreadRef.Type;

export const threadRefKey = (ref: ThreadRef) => `${ref.environment}/${ref.threadId}`;

/** A whole project when `threadId` is null, otherwise one thread. */
export const SubscriptionSource = Schema.Struct({
  environment: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
});
export type SubscriptionSource = typeof SubscriptionSource.Type;

export const Subscription = Schema.Struct({
  id: Schema.Int,
  subscriber: ThreadRef,
  source: SubscriptionSource,
  events: Schema.Array(CompanionEventKind),
  wake: Schema.Boolean,
  /**
   * On a project subscription: instead of every thread's events, subscribe the subscriber to each
   * new thread in the project that it launched, with this subscription's events and settings.
   */
  follow: Schema.Boolean,
  /**
   * Whether the next event may wake the subscriber. A wake disarms the subscription; later events
   * arrive passively until it is armed again. Failures and questions wake regardless.
   */
  armed: Schema.Boolean,
  /** Per-kind overrides of the default priority, keyed by event kind. */
  priorities: Schema.Record(Schema.String, DeliveryPriority),
  createdAt: Schema.String,
});
export type Subscription = typeof Subscription.Type;

/** A linked pull request as the thread's shell row last saw it. */
export const PullRequestSummary = Schema.Struct({
  number: Schema.Int,
  repository: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  draft: Schema.Boolean,
  mergeable: Schema.NullOr(Schema.Literals(["mergeable", "conflicting", "unknown"])),
  checks: Schema.NullOr(Schema.Literals(["pass", "pending", "fail"])),
});
export type PullRequestSummary = typeof PullRequestSummary.Type;

/** Where a thread stands right now, from its latest shell row. */
export const ThreadStatus = Schema.Struct({
  environment: Schema.String,
  threadId: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  /**
   * `paused`: the run ended but the thread's own background work is still pending, like an idle
   * event marked `pause`.
   */
  state: Schema.Literals([
    "running",
    "paused",
    "idle",
    "failed",
    "needs-input",
    "needs-approval",
    "settled",
    "archived",
  ]),
  /** The shell's run status: `idle` or the latest run's status. */
  latestRunStatus: Schema.String,
  /** Background work the thread is waiting on, such as a command, monitor, or PR watch. */
  pendingTasks: Schema.Array(Schema.String),
  pullRequests: Schema.Array(PullRequestSummary),
  updatedAt: Schema.String,
});
export type ThreadStatus = typeof ThreadStatus.Type;

/**
 * What the watcher observed, before it is matched to subscriptions: a thread event, or an
 * environment event with null `threadId` and `projectId`.
 */
export const ThreadEvent = Schema.Struct({
  eventId: Schema.String,
  kind: CompanionEventKind,
  environment: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  title: Schema.String,
  occurredAt: Schema.String,
  summary: Schema.String,
  /** The source's latest run when the event was taken; a newer run makes idle and settled stale. */
  runId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** The pending request behind a needs-input or needs-approval event. */
  requestId: Schema.optionalKey(Schema.String),
  /**
   * An idle whose run ended while the thread's own background work was still pending: a pause,
   * not done. A PR watch alone does not make one.
   */
  pause: Schema.Boolean,
  /** A pause whose last message asks a question or names a pull request; it wakes like an idle. */
  notable: Schema.optionalKey(Schema.Boolean),
  pendingTasks: Schema.Array(Schema.String),
  /** The source thread's last assistant message, truncated. */
  lastMessage: Schema.NullOr(Schema.String),
  pullRequests: Schema.Array(PullRequestSummary),
});
export type ThreadEvent = typeof ThreadEvent.Type;

export const InboxEvent = Schema.Struct({
  id: Schema.Int,
  subscriptionId: Schema.Int,
  subscriber: ThreadRef,
  event: ThreadEvent,
  priority: DeliveryPriority,
  /** Never starts a digest; on a wake subscription it rides along in one another item starts. */
  passive: Schema.Boolean,
  deliveredAt: Schema.String,
  /** While set, the item is hidden; it comes back once this passes and the source is idle. */
  snoozedUntil: Schema.NullOr(Schema.String),
  /** How many times a snooze has brought the item back. */
  redelivered: Schema.Int,
  resolvedAt: Schema.NullOr(Schema.String),
  disposition: Schema.NullOr(Schema.String),
});
export type InboxEvent = typeof InboxEvent.Type;

export const OpenWorkItem = Schema.Struct({
  environment: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  state: ThreadStatus.fields.state,
  /** Draft pull requests whose checks pass: ready to be marked ready. */
  readyToMark: Schema.Array(PullRequestSummary),
});
export type OpenWorkItem = typeof OpenWorkItem.Type;

/** A thread as a caller names it; the daemon resolves environment aliases and the default. */
export const ThreadRefInput = Schema.Struct({
  environment: Schema.optional(Schema.String),
  threadId: Schema.String,
});
export type ThreadRefInput = typeof ThreadRefInput.Type;

export const SubscriberRequest = Schema.Struct({ subscriber: ThreadRefInput });
export type SubscriberRequest = typeof SubscriberRequest.Type;

export const SubscribeRequest = Schema.Struct({
  subscriber: ThreadRefInput,
  /** Exactly one of a thread or a project. */
  source: Schema.Struct({
    environment: Schema.optional(Schema.String),
    threadId: Schema.optional(Schema.String),
    projectId: Schema.optional(Schema.String),
  }),
  events: Schema.Array(CompanionEventKind),
  wake: Schema.Boolean,
  priorities: Schema.Record(Schema.String, DeliveryPriority),
  /** With a project source: follow the subscriber's own new threads in it instead. */
  follow: Schema.optional(Schema.Boolean),
});
export type SubscribeRequest = typeof SubscribeRequest.Type;

export const SubscribeResult = Schema.Struct({
  subscription: Subscription,
  /** The source thread's state when the subscription was made; null for a project or unknown thread. */
  source: Schema.NullOr(ThreadStatus),
});
export type SubscribeResult = typeof SubscribeResult.Type;

/** Subscriptions or inbox items of one subscriber, by id. */
export const SelectionRequest = Schema.Struct({
  subscriber: ThreadRefInput,
  ids: Schema.Array(Schema.Int),
});
export type SelectionRequest = typeof SelectionRequest.Type;

export const InboxListRequest = Schema.Struct({
  subscriber: ThreadRefInput,
  /** Also lists resolved and snoozed items. */
  includeResolved: Schema.Boolean,
  afterId: Schema.Int,
  limit: Schema.Int,
});
export type InboxListRequest = typeof InboxListRequest.Type;

export const ResolveRequest = Schema.Struct({
  ...SelectionRequest.fields,
  disposition: Schema.NullOr(Schema.String),
});
export type ResolveRequest = typeof ResolveRequest.Type;

export const SnoozeRequest = Schema.Struct({
  ...SelectionRequest.fields,
  minSeconds: Schema.Int,
});
export type SnoozeRequest = typeof SnoozeRequest.Type;

export const WaitRequest = Schema.Struct({
  subscriber: ThreadRefInput,
  afterId: Schema.Int,
  /** Kinds to wait for; empty means any. */
  events: Schema.Array(CompanionEventKind),
  timeoutSeconds: Schema.Int,
});
export type WaitRequest = typeof WaitRequest.Type;

export const CompanionEnvironmentStatus = Schema.Struct({
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  url: Schema.String,
  state: Schema.Literals(["connecting", "connected", "disconnected"]),
  lastError: Schema.NullOr(Schema.String),
});
export type CompanionEnvironmentStatus = typeof CompanionEnvironmentStatus.Type;

export const CompanionRuntimeFile = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  url: Schema.String,
  startedAt: Schema.String,
});
export type CompanionRuntimeFile = typeof CompanionRuntimeFile.Type;

export const CompanionHealth = Schema.Struct({
  pid: Schema.Int,
  startedAt: Schema.String,
  mcpUrl: Schema.String,
  database: Schema.String,
  environments: Schema.Array(CompanionEnvironmentStatus),
});
export type CompanionHealth = typeof CompanionHealth.Type;
