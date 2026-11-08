import * as Schema from "effect/Schema";

export const CompanionEventKind = Schema.Literals([
  "idle",
  "failed",
  "needs-input",
  "settled",
  "env-down",
  "env-up",
]);
export type CompanionEventKind = typeof CompanionEventKind.Type;

export const allCompanionEventKinds: ReadonlyArray<CompanionEventKind> = [
  "idle",
  "failed",
  "needs-input",
  "settled",
  "env-down",
  "env-up",
];

/** Environment events reach every subscription on that environment, whatever it asked for. */
export const environmentEventKinds: ReadonlyArray<CompanionEventKind> = ["env-down", "env-up"];

/**
 * How a wake digest reaches the subscriber: `urgent` steers into its running turn, `normal`
 * queues for its next turn, `low` waits until its current turn ends.
 */
export const DeliveryPriority = Schema.Literals(["urgent", "normal", "low"]);
export type DeliveryPriority = typeof DeliveryPriority.Type;

export const ThreadRef = Schema.Struct({
  environment: Schema.String,
  threadId: Schema.String,
});
export type ThreadRef = typeof ThreadRef.Type;

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
  state: Schema.Literals(["running", "idle", "failed", "needs-input", "settled", "archived"]),
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
  /** An idle whose run ended while background tasks were still pending: a pause, not done. */
  pause: Schema.Boolean,
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
