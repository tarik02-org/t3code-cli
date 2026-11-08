import * as Schema from "effect/Schema";

export const CompanionEventKind = Schema.Literals(["idle", "failed", "needs-input", "settled"]);
export type CompanionEventKind = typeof CompanionEventKind.Type;

export const allCompanionEventKinds: ReadonlyArray<CompanionEventKind> = [
  "idle",
  "failed",
  "needs-input",
  "settled",
];

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
  createdAt: Schema.String,
});
export type Subscription = typeof Subscription.Type;

/** What the watcher observed on one source thread, before it is matched to subscriptions. */
export const ThreadEvent = Schema.Struct({
  eventId: Schema.String,
  kind: CompanionEventKind,
  environment: Schema.String,
  threadId: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  occurredAt: Schema.String,
  summary: Schema.String,
});
export type ThreadEvent = typeof ThreadEvent.Type;

export const InboxEvent = Schema.Struct({
  id: Schema.Int,
  subscriptionId: Schema.Int,
  subscriber: ThreadRef,
  event: ThreadEvent,
  deliveredAt: Schema.String,
  ackedAt: Schema.NullOr(Schema.String),
});
export type InboxEvent = typeof InboxEvent.Type;

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
