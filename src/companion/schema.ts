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

/** What a watch follows, as the key events and watches are stored under. */
export const threadSubject = (ref: ThreadRef) => `thread:${threadRefKey(ref)}`;
export const pullRequestSubject = (pr: string) => `pr:${pr}`;
export const reminderSubject = (id: number) => `reminder:${id}`;

/**
 * Everything the companion reports. Thread: `asks` is a pending question or approval, `done` a
 * turn that ended with nothing the thread resumes on, `failed` a failed run, `stuck` awaited
 * work that made no progress. Pull request: `red` is a failing check on the head, `green` every
 * check passed (only when asked for), `comment` a person's comment or review.
 */
export const EventKind = Schema.Literals([
  "asks",
  "done",
  "failed",
  "stuck",
  "red",
  "conflict",
  "comment",
  "merged",
  "closed",
  "green",
  "reminder",
]);
export type EventKind = typeof EventKind.Type;

/** Every kind asks its caller to act, except the `green` it asked to hear. */
export const isActionable = (kind: EventKind) => kind !== "green";

export const PullRequestRemark = Schema.Struct({
  author: Schema.String,
  bot: Schema.Boolean,
  at: Schema.String,
  excerpt: Schema.String,
  url: Schema.String,
});
export type PullRequestRemark = typeof PullRequestRemark.Type;

export const PullRequestCheck = Schema.Struct({
  name: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type PullRequestCheck = typeof PullRequestCheck.Type;

/** A pull request as GitHub reports it for its current head. */
export const PullRequestView = Schema.Struct({
  /** `owner/repo#123`. */
  pr: Schema.String,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  draft: Schema.Boolean,
  head: Schema.String,
  /** How many checks the head has, cancelled and ignored ones included. */
  checks: Schema.Int,
  /** Checks that really failed: not cancelled, skipped or on the ignore list. */
  failing: Schema.Array(PullRequestCheck),
  pending: Schema.Array(Schema.String),
  mergeable: Schema.Literals(["mergeable", "conflicting", "unknown"]),
  /** Recent comments and reviews, oldest first. */
  remarks: Schema.Array(PullRequestRemark),
  /** GraphQL points left this hour, when GitHub said. */
  rateLimitRemaining: Schema.NullOr(Schema.Int),
});
export type PullRequestView = typeof PullRequestView.Type;

/** A pull request a thread links, with the head the companion last read for it. */
export const LinkedPullRequest = Schema.Struct({
  pr: Schema.String,
  url: Schema.String,
  state: Schema.NullOr(Schema.String),
  head: Schema.NullOr(Schema.String),
});
export type LinkedPullRequest = typeof LinkedPullRequest.Type;

/** What an event carries; each kind fills the fields that describe it. */
export const EventPayload = Schema.Struct({
  /** The thread's or pull request's title, or the reminder's text. */
  title: Schema.String,
  /** A `t3-thread://` link or the pull request's URL. */
  link: Schema.NullOr(Schema.String),
  /** The event in one line, as the digest words it. */
  summary: Schema.String,
  runId: Schema.optional(Schema.String),
  /** How the run ended: `completed`, `interrupted`, `cancelled`, … */
  outcome: Schema.optional(Schema.String),
  /** The thread's last assistant message, up to 10,000 characters. */
  lastMessage: Schema.optional(Schema.NullOr(Schema.String)),
  /** The last message closes on a question. */
  question: Schema.optional(Schema.Boolean),
  /** Background work the thread left running without waiting on it. */
  leftRunning: Schema.optional(Schema.Array(Schema.String)),
  /** Work the thread waits on. */
  awaiting: Schema.optional(Schema.Array(Schema.String)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  requestId: Schema.optional(Schema.String),
  requestKind: Schema.optional(Schema.String),
  pullRequests: Schema.optional(Schema.Array(LinkedPullRequest)),
  head: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  failing: Schema.optional(Schema.Array(PullRequestCheck)),
  pendingChecks: Schema.optional(Schema.Int),
  remark: Schema.optional(PullRequestRemark),
  dueAt: Schema.optional(Schema.String),
});
export type EventPayload = typeof EventPayload.Type;

export const CompanionEvent = Schema.Struct({
  id: Schema.Int,
  caller: ThreadRef,
  /** `thread:<env>/<id>`, `pr:<owner>/<repo>#<n>` or `reminder:<id>`. */
  subject: Schema.String,
  kind: EventKind,
  /** The transition it reports: a run, a request, a head, a comment. One event per key. */
  key: Schema.String,
  /** Steers into the caller's running turn. */
  urgent: Schema.Boolean,
  at: Schema.String,
  /**
   * `pending` until a digest carries it; `taken` when the caller collected it itself; `dropped`
   * when it stopped holding before it was sent.
   */
  state: Schema.Literals(["pending", "delivered", "taken", "dropped"]),
  payload: EventPayload,
});
export type CompanionEvent = typeof CompanionEvent.Type;

/** What a watch has already reported, so each transition is reported once. */
export const WatchMemory = Schema.Struct({
  asks: Schema.optional(Schema.String),
  done: Schema.optional(Schema.String),
  failed: Schema.optional(Schema.String),
  stuck: Schema.optional(Schema.String),
  red: Schema.optional(Schema.String),
  green: Schema.optional(Schema.String),
  conflict: Schema.optional(Schema.String),
  /** URLs of the comments and reviews already reported, newest last. */
  remarks: Schema.optional(Schema.Array(Schema.String)),
  /** The first read only records what it finds: the caller already knows it. */
  baseline: Schema.optional(Schema.Boolean),
});
export type WatchMemory = typeof WatchMemory.Type;

/** Why a caller watches something: it launched or wrote to it, named it, or a thread links it. */
export const WatchOrigin = Schema.Literals(["launched", "sent", "explicit", "linked"]);
export type WatchOrigin = typeof WatchOrigin.Type;

/** One watch as its caller sees it. */
export const WatchView = Schema.Struct({
  subject: Schema.String,
  title: Schema.String,
  link: Schema.NullOr(Schema.String),
  origin: WatchOrigin,
  since: Schema.String,
  /** Where the thread or pull request stands now, in words. */
  state: Schema.String,
});
export type WatchView = typeof WatchView.Type;

export const Reminder = Schema.Struct({
  id: Schema.Int,
  dueAt: Schema.String,
  text: Schema.String,
});
export type Reminder = typeof Reminder.Type;

export const WatchRequest = Schema.Struct({
  caller: ThreadRefInput,
  /** A thread to watch; with neither this nor `pr` the call only makes the caller known. */
  thread: Schema.optional(ThreadRefInput),
  /** `owner/repo#123` or the pull request's URL. */
  pr: Schema.optional(Schema.String),
  green: Schema.optional(Schema.Boolean),
});
export type WatchRequest = typeof WatchRequest.Type;

export const WatchResult = Schema.Struct({
  /** Null when the call named nothing to watch. */
  watch: Schema.NullOr(WatchView),
  threads: Schema.Int,
  pullRequests: Schema.Int,
});
export type WatchResult = typeof WatchResult.Type;

export const UnwatchRequest = Schema.Struct({
  caller: ThreadRefInput,
  thread: Schema.optional(ThreadRefInput),
  pr: Schema.optional(Schema.String),
  reminder: Schema.optional(Schema.Int),
  /** Stop everything: the caller is forgotten with its watches, reminders and pending events. */
  all: Schema.optional(Schema.Boolean),
});
export type UnwatchRequest = typeof UnwatchRequest.Type;

export const WatchingRequest = Schema.Struct({
  /** Every caller when omitted. */
  caller: Schema.optional(ThreadRefInput),
});
export type WatchingRequest = typeof WatchingRequest.Type;

export const CallerWatching = Schema.Struct({
  caller: ThreadRef,
  threads: Schema.Array(WatchView),
  pullRequests: Schema.Array(WatchView),
  reminders: Schema.Array(Reminder),
  /** Events no digest has carried yet. */
  pending: Schema.Array(CompanionEvent),
});
export type CallerWatching = typeof CallerWatching.Type;

export const RemindRequest = Schema.Struct({
  caller: ThreadRefInput,
  /** Seconds from now. */
  in: Schema.optional(Schema.Number),
  /** An ISO 8601 time. */
  at: Schema.optional(Schema.String),
  text: Schema.String,
});
export type RemindRequest = typeof RemindRequest.Type;

export const EventsRequest = Schema.Struct({
  caller: ThreadRefInput,
  /** One event's whole payload, whatever its state; otherwise the pending ones are handed over. */
  id: Schema.optional(Schema.Int),
});
export type EventsRequest = typeof EventsRequest.Type;

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
