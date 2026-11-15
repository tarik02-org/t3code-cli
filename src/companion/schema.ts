import * as Schema from "effect/Schema";

export const ThreadRef = Schema.Struct({
  environment: Schema.String,
  threadId: Schema.String,
});
export type ThreadRef = typeof ThreadRef.Type;

export const threadRefKey = (ref: ThreadRef) => `${ref.environment}/${ref.threadId}`;

/** A thread as a caller names it; the daemon resolves environment aliases and the default. */
export const ThreadRefInput = Schema.Struct({
  environment: Schema.optional(Schema.String),
  threadId: Schema.String,
});
export type ThreadRefInput = typeof ThreadRefInput.Type;

/**
 * What a thread leaf waits for. `idle` is a run that ended, with or without the thread's own
 * background work still pending; `finished` is idle with none pending. `stalled` is work the
 * thread awaits still pending long after its run. `message` is an assistant message newer than
 * the wait.
 */
export const ThreadIs = Schema.Literals([
  "idle",
  "finished",
  "needs-input",
  "needs-approval",
  "failed",
  "stalled",
  "message",
]);
export type ThreadIs = typeof ThreadIs.Type;

/**
 * What a pull request leaf waits for, on the PR's current head. `comment` and `new-head` are
 * newer than the wait; `comment` counts people's comments and reviews, not bots'.
 */
export const PullRequestIs = Schema.Literals([
  "checks-done",
  "green",
  "red",
  "mergeable",
  "conflicting",
  "draft",
  "ready",
  "merged",
  "closed",
  "comment",
  "new-head",
]);
export type PullRequestIs = typeof PullRequestIs.Type;

export const ThreadLeaf = Schema.Struct({
  thread: Schema.String,
  environment: Schema.optional(Schema.String),
  is: ThreadIs,
  /** For `stalled`: how long after the run the awaited work may stay pending. Default 30. */
  minutes: Schema.optional(Schema.Number),
});
export type ThreadLeaf = typeof ThreadLeaf.Type;

export const PullRequestLeaf = Schema.Struct({
  /** `owner/repo#123`. */
  pr: Schema.String,
  is: PullRequestIs,
});
export type PullRequestLeaf = typeof PullRequestLeaf.Type;

/** True once this many seconds have passed since the wait was made, or last fired. */
export const AfterLeaf = Schema.Struct({ after: Schema.Number });
export type AfterLeaf = typeof AfterLeaf.Type;

export type Condition =
  | ThreadLeaf
  | PullRequestLeaf
  | AfterLeaf
  | { readonly any: ReadonlyArray<Condition> }
  | { readonly all: ReadonlyArray<Condition> }
  | { readonly not: Condition };

const nested = Schema.suspend((): Schema.Codec<Condition> => Condition);

export const Condition: Schema.Codec<Condition> = Schema.Union([
  ThreadLeaf,
  PullRequestLeaf,
  AfterLeaf,
  Schema.Struct({ any: Schema.Array(nested) }),
  Schema.Struct({ all: Schema.Array(nested) }),
  Schema.Struct({ not: nested }),
]);

/**
 * How a fired wait reaches its owner: `steer` at once, into a running turn if there is one;
 * `turn-end` once the owner's turn is over, together with whatever else fired; `none` not at
 * all, to be picked up from the list.
 */
export const WakePolicy = Schema.Literals(["steer", "turn-end", "none"]);
export type WakePolicy = typeof WakePolicy.Type;

export const Truth = Schema.Literals(["true", "false", "unknown"]);
export type Truth = typeof Truth.Type;

/** One leaf of a condition against the current state. */
export const LeafTruth = Schema.Struct({
  leaf: Schema.String,
  state: Truth,
  /** What the state is, in words: enough for a wake message's line. */
  detail: Schema.String,
});
export type LeafTruth = typeof LeafTruth.Type;

export const ThreadPayload = Schema.Struct({
  environment: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  state: Schema.String,
  /** The thread's own background work still pending. */
  pendingTasks: Schema.Array(Schema.String),
  /** The last assistant message, up to 10,000 characters. */
  lastMessage: Schema.NullOr(Schema.String),
});
export type ThreadPayload = typeof ThreadPayload.Type;

export const PullRequestRemark = Schema.Struct({
  author: Schema.String,
  bot: Schema.Boolean,
  at: Schema.String,
  excerpt: Schema.String,
  url: Schema.String,
});
export type PullRequestRemark = typeof PullRequestRemark.Type;

/** A pull request as GitHub reports it for its current head. */
export const PullRequestView = Schema.Struct({
  /** `owner/repo#123`. */
  pr: Schema.String,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  draft: Schema.Boolean,
  head: Schema.String,
  /** Checks on the head: how many there are, and the names of the failing and pending ones. */
  checks: Schema.Int,
  failing: Schema.Array(Schema.String),
  pending: Schema.Array(Schema.String),
  mergeable: Schema.Literals(["mergeable", "conflicting", "unknown"]),
  /** Recent comments and reviews, oldest first. */
  remarks: Schema.Array(PullRequestRemark),
});
export type PullRequestView = typeof PullRequestView.Type;

export const WaitResult = Schema.Struct({
  outcome: Schema.Literals(["matched", "timeout"]),
  at: Schema.String,
  leaves: Schema.Array(LeafTruth),
  threads: Schema.Array(ThreadPayload),
  pullRequests: Schema.Array(PullRequestView),
});
export type WaitResult = typeof WaitResult.Type;

export const Wait = Schema.Struct({
  id: Schema.Int,
  owner: ThreadRef,
  label: Schema.NullOr(Schema.String),
  condition: Condition,
  wake: WakePolicy,
  /** Fires again each time the condition becomes true after having been false. */
  repeat: Schema.Boolean,
  deadlineAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  status: Schema.Literals(["pending", "fired", "timeout", "cancelled"]),
});
export type Wait = typeof Wait.Type;

/** A pending wait as its owner sees it. */
export const PendingWait = Schema.Struct({
  id: Schema.Int,
  label: Schema.NullOr(Schema.String),
  condition: Schema.String,
  wake: WakePolicy,
  repeat: Schema.Boolean,
  deadlineAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  leaves: Schema.Array(LeafTruth),
});
export type PendingWait = typeof PendingWait.Type;

/** One firing of a wait. */
export const FiredWait = Schema.Struct({
  id: Schema.Int,
  label: Schema.NullOr(Schema.String),
  condition: Schema.String,
  /** The wake message's line for it. */
  summary: Schema.String,
  result: WaitResult,
});
export type FiredWait = typeof FiredWait.Type;

export const WaitRequest = Schema.Struct({
  owner: ThreadRefInput,
  /** Decoded as a {@link Condition} by the daemon, so a bad one is refused with its reason. */
  condition: Schema.Unknown,
  /** Seconds from now after which the wait fires with outcome `timeout`. */
  deadline: Schema.optional(Schema.Number),
  wake: Schema.optional(WakePolicy),
  label: Schema.optional(Schema.String),
  repeat: Schema.optional(Schema.Boolean),
});
export type WaitRequest = typeof WaitRequest.Type;

export const WaitCreated = Schema.Struct({
  id: Schema.Int,
  /** Set when the condition already held, so the wait fired on the spot. */
  fired: Schema.NullOr(FiredWait),
  leaves: Schema.Array(LeafTruth),
});
export type WaitCreated = typeof WaitCreated.Type;

export const WaitNowRequest = Schema.Struct({
  owner: ThreadRefInput,
  condition: Schema.Unknown,
  /** Seconds to block for. */
  timeout: Schema.Number,
});
export type WaitNowRequest = typeof WaitNowRequest.Type;

export const WaitsRequest = Schema.Struct({
  /** Every owner's waits when omitted. */
  owner: Schema.optional(ThreadRefInput),
  /** Hand over the waits that fired without a wake, so the next call no longer lists them. */
  collect: Schema.Boolean,
});
export type WaitsRequest = typeof WaitsRequest.Type;

export const WaitsListing = Schema.Struct({
  pending: Schema.Array(Schema.Struct({ owner: ThreadRef, ...PendingWait.fields })),
  fired: Schema.Array(FiredWait),
});
export type WaitsListing = typeof WaitsListing.Type;

export const WaitSelection = Schema.Struct({
  owner: ThreadRefInput,
  ids: Schema.Array(Schema.Int),
});
export type WaitSelection = typeof WaitSelection.Type;

export const WaitResultRequest = Schema.Struct({
  owner: ThreadRefInput,
  id: Schema.Int,
});
export type WaitResultRequest = typeof WaitResultRequest.Type;

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
