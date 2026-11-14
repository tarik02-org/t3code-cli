import type { OrchestrationV2ThreadShell, OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type {
  CompanionEventKind,
  PullRequestSummary,
  ThreadEvent,
  ThreadStatus,
} from "./schema.ts";

// Mirrors the server's auto-settle grace for a sent message the server has not adopted as a run.
const queuedTurnStartGraceMs = 2 * 60_000;

/**
 * How long a paused source keeps a snooze waiting after its run ended. Its background work
 * (a dev server, a PR watch) can run for hours, and a snoozed item has to come back.
 */
export const snoozePauseCapMs = 30 * 60_000;

const activeRunStatuses: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

const iso = (value: DateTime.Utc | null | undefined) =>
  value === null || value === undefined ? null : DateTime.formatIso(value);

const millis = (value: DateTime.Utc | null | undefined) =>
  value === null || value === undefined ? null : DateTime.toEpochMillis(value);

/** A sent message that no run has picked up yet, as the server's settlement service judges it. */
function hasQueuedTurnStart(shell: OrchestrationV2ThreadShell, nowMs: number): boolean {
  const messageAtMs = millis(shell.latestUserMessageAt);
  if (messageAtMs === null || shell.status === "failed") {
    return false;
  }
  if (Math.abs(nowMs - messageAtMs) > queuedTurnStartGraceMs) {
    return false;
  }
  if (shell.latestRunId === null) {
    return true;
  }
  return [
    millis(shell.latestRunRequestedAt),
    millis(shell.latestRunStartedAt),
    millis(shell.latestRunCompletedAt),
  ].every((value) => value === null || value < messageAtMs);
}

/** Why a thread is not idle, apart from pending background tasks; empty when nothing else runs. */
export function busyReasons(shell: OrchestrationV2ThreadShell, nowMs: number): Array<string> {
  const reasons: Array<string> = [];
  if (shell.activityRunStatus !== null && shell.activityRunStatus !== undefined) {
    reasons.push(`run ${shell.activityRunStatus}`);
  }
  if (activeRunStatuses.has(shell.status)) {
    reasons.push(`status ${shell.status}`);
  }
  if (hasQueuedTurnStart(shell, nowMs)) {
    reasons.push("queued turn");
  }
  if (shell.pendingRuntimeRequest !== null) {
    reasons.push(`pending ${shell.pendingRuntimeRequest.kind} request`);
  }
  if ((shell.pendingGuestMessageCount ?? 0) > 0) {
    reasons.push("pending guest messages");
  }
  if (shell.blockedOnThreadWait === true) {
    reasons.push("waiting on another thread");
  }
  return reasons;
}

/**
 * Whether a subscriber is in a turn. Unlike a source's state, its own background work does not
 * count: an orchestrator usually has delegates running between turns and must still be woken.
 */
export const inTurn = (shell: OrchestrationV2ThreadShell, nowMs: number) =>
  busyReasons(shell, nowMs).length > 0;

type PendingTask = NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]>[number];

const taskLabel = (task: PendingTask) => `${task.kind} ${task.description ?? task.taskId}`;

export const pendingTaskLabels = (shell: OrchestrationV2ThreadShell): Array<string> =>
  (shell.pendingBackgroundTasks ?? []).map(taskLabel);

/**
 * The thread's own pending background work: what makes an ended run a pause. T3 Code also lists
 * each PR watch as a pending task, but that waits on reviewers and CI, not on the thread, so a
 * run that ends with only watches pending has finished.
 */
const ownWork = (shell: OrchestrationV2ThreadShell) =>
  (shell.pendingBackgroundTasks ?? []).filter(
    (task) => !task.taskId.startsWith("pull-request-watch:"),
  );

export const ownTaskLabels = (shell: OrchestrationV2ThreadShell): Array<string> =>
  ownWork(shell).map(taskLabel);

/** Own work the agent declared it resumes after; T3 Code starts the next run when it ends. */
export const awaitedTaskLabels = (shell: OrchestrationV2ThreadShell): Array<string> =>
  ownWork(shell)
    .filter((task) => task.awaited === true)
    .map(taskLabel);

const checksRollup = { passing: "pass", pending: "pending", failing: "fail" } as const;

type PullRequestLink = NonNullable<OrchestrationV2ThreadShell["pullRequests"]>[number];

const linkedPullRequests = (shell: OrchestrationV2ThreadShell) =>
  (shell.pullRequests ?? []).filter((link) => link.source !== "stack-dismissed");

function summarizePullRequest(link: PullRequestLink): PullRequestSummary {
  const state = link.snapshot?.state ?? "open";
  return {
    number: link.number,
    repository: link.repository,
    url: link.url,
    state,
    draft: link.snapshot?.isDraft ?? false,
    // A merged or closed PR's mergeability is meaningless (GitHub reports it as unknown).
    mergeable: state === "open" ? (link.snapshot?.mergeability ?? null) : null,
    checks:
      link.snapshot?.checksState === null || link.snapshot?.checksState === undefined
        ? null
        : checksRollup[link.snapshot.checksState],
  };
}

/** The thread's linked pull requests, from the snapshot the server last synced. */
export const pullRequestSummaries = (
  shell: OrchestrationV2ThreadShell,
): Array<PullRequestSummary> => linkedPullRequests(shell).map(summarizePullRequest);

const pullRequestKey = (link: Pick<PullRequestLink, "repository" | "number">) =>
  `${link.repository.toLowerCase()}#${link.number}`;

/** The checks state last seen on one linked PR; `cycle` marks when its current run of checks began. */
export interface ChecksRecord {
  readonly key: string;
  readonly head: string | null;
  readonly state: PullRequestSummary["checks"];
  readonly cycle: string;
}

export interface ChecksTransition {
  readonly record: ChecksRecord;
  /** Set when the checks reached a final state: after pending, or already final on a new head. */
  readonly event: ThreadEvent | null;
}

/**
 * Follows one linked PR's checks across shell updates. The head comes from T3 Code's PR watch
 * when there is one; without it, a return to pending starts the next cycle.
 */
export function checksTransitions(
  environment: string,
  shell: OrchestrationV2ThreadShell,
  previous: ReadonlyMap<string, ChecksRecord>,
  nowIso: string,
): Array<ChecksTransition> {
  return linkedPullRequests(shell).map((link) => {
    const key = pullRequestKey(link);
    const summary = summarizePullRequest(link);
    const head = link.watch?.headSha ?? null;
    const before = previous.get(key);
    if (before === undefined) {
      return { record: { key, head, state: summary.checks, cycle: nowIso }, event: null };
    }
    const newHead = head !== null && before.head !== null && head !== before.head;
    const restarted = summary.checks === "pending" && before.state !== "pending";
    const record = {
      key,
      head: head ?? before.head,
      state: summary.checks,
      cycle: newHead || restarted ? nowIso : before.cycle,
    };
    const final = summary.checks === "pass" || summary.checks === "fail";
    if (!final || !(before.state === "pending" || newHead)) {
      return { record, event: null };
    }
    const headLabel = head?.slice(0, 10) ?? link.snapshot?.headBranch ?? "its head";
    const failed = link.watch?.failedChecks ?? [];
    const outcome =
      summary.checks === "pass"
        ? "pass"
        : `fail${failed.length === 0 ? "" : ` (failed jobs: ${failed.join(", ")})`}`;
    return {
      record,
      event: {
        ...makeEvent(
          environment,
          shell,
          "pr-checks",
          `${key}@${head ?? record.cycle}`,
          nowIso,
          `PR #${link.number} checks finished on ${headLabel}: ${outcome}`,
        ),
        pullRequests: [summary],
        head,
      },
    };
  });
}

/**
 * Whether a pr-checks event no longer describes its pull request: the checks have a different
 * result by now, or T3 Code watches a newer head.
 */
export function checksMovedOn(shell: OrchestrationV2ThreadShell, event: ThreadEvent): boolean {
  const reported = event.pullRequests[0];
  const link = linkedPullRequests(shell).find(
    (candidate) =>
      candidate.number === reported?.number && candidate.repository === reported.repository,
  );
  if (reported === undefined || link === undefined) {
    return false;
  }
  const watched = link.watch?.headSha ?? null;
  const head = event.head ?? null;
  return (
    summarizePullRequest(link).checks !== reported.checks ||
    (watched !== null && head !== null && watched !== head)
  );
}

/** Whether a thread has its own T3 Code watch on a pull request, which reports its checks. */
export const watchesPullRequest = (
  shell: OrchestrationV2ThreadShell,
  pr: Pick<PullRequestSummary, "number" | "repository">,
) =>
  linkedPullRequests(shell).some(
    (link) =>
      link.watch !== undefined && link.number === pr.number && link.repository === pr.repository,
  );

const lookItemTypes: ReadonlySet<string> = new Set([
  "command_execution",
  "dynamic_tool",
  "file_search",
  "web_search",
]);

const saysNothingToDo = (message: string) =>
  /\bnothing (new|to act on|to do|to fix|needs (doing|action)|requires action)\b|\bnothing\b.{0,24}\bneeds? (action|doing)\b|\bneeds? (nothing|no action)\b|\bno action (is )?(needed|required)\b/i.test(
    message,
  );

/**
 * Whether a run only acknowledged a watch update, changing nothing a subscriber could act on. A
 * monitor notice with nothing finished or failed must have started it (a new PR comment, say),
 * and it may not have edited files or used a subagent. It either called no tools at all, or
 * looked something up and then said itself that nothing needs doing: most such notices are a
 * bot's PR summary, which T3 Code does not tell apart from a person's comment.
 */
export function answersOnlyAWatch(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  lastMessage: string | null,
): boolean {
  const notices = items.flatMap((item) => (item.type === "notification" ? [item] : []));
  if (
    notices.length === 0 ||
    !notices.every((notice) => notice.source.kind === "monitor" && notice.outcome === "updated") ||
    items.some((item) => ["user_message", "file_change", "subagent"].includes(item.type))
  ) {
    return false;
  }
  return (
    !items.some((item) => lookItemTypes.has(item.type)) ||
    (lastMessage !== null && saysNothingToDo(lastMessage))
  );
}

/** Draft pull requests whose checks pass: the ones waiting to be marked ready. */
export const readyToMark = (pullRequests: ReadonlyArray<PullRequestSummary>) =>
  pullRequests.filter((pr) => pr.state === "open" && pr.draft && pr.checks === "pass");

type PendingRequest = NonNullable<OrchestrationV2ThreadShell["pendingRuntimeRequest"]>;

/**
 * Whether a pending request asks to approve a command or tool, rather than asking the user a
 * question or to sign in again. T3 Code's own waiting-for-approval state splits them the same way.
 */
const isApproval = (request: PendingRequest) =>
  request.kind !== "user_input" && request.kind !== "auth_refresh";

function threadState(shell: OrchestrationV2ThreadShell, nowMs: number): ThreadStatus["state"] {
  if (shell.archivedAt !== null || shell.deletedAt !== null) {
    return "archived";
  }
  if (shell.pendingRuntimeRequest !== null) {
    return isApproval(shell.pendingRuntimeRequest) ? "needs-approval" : "needs-input";
  }
  if (shell.status === "failed") {
    return "failed";
  }
  if (busyReasons(shell, nowMs).length > 0) {
    return "running";
  }
  if (ownTaskLabels(shell).length > 0) {
    return "paused";
  }
  return shell.settledOverride === "settled" ? "settled" : "idle";
}

/** Where a thread stands, in the same terms as its events: a pause here is an idle with `pause`. */
export function threadStatus(
  environment: string,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): ThreadStatus {
  return {
    environment,
    threadId: shell.id,
    projectId: shell.projectId,
    title: shell.title,
    state: threadState(shell, nowMs),
    latestRunStatus: shell.status,
    pendingTasks: pendingTaskLabels(shell),
    pullRequests: pullRequestSummaries(shell),
    updatedAt: DateTime.formatIso(shell.updatedAt),
  };
}

/** Whether a thread can still produce events worth a wake: neither settled nor archived. */
export function isLive(shell: OrchestrationV2ThreadShell, nowMs: number): boolean {
  const state = threadState(shell, nowMs);
  return state !== "settled" && state !== "archived";
}

/** Whether a source keeps its snoozed items hidden: it works, or it paused only recently. */
export function holdsSnooze(shell: OrchestrationV2ThreadShell, nowMs: number): boolean {
  const state = threadState(shell, nowMs);
  if (state !== "paused") {
    return state === "running";
  }
  const endedMs = DateTime.toEpochMillis(shell.latestRunCompletedAt ?? shell.updatedAt);
  return nowMs < endedMs + snoozePauseCapMs;
}

const makeEvent = (
  environment: string,
  shell: OrchestrationV2ThreadShell,
  kind: CompanionEventKind,
  key: string,
  occurredAt: string,
  summary: string,
  pendingTasks: ReadonlyArray<string> = [],
  pause = false,
): ThreadEvent => ({
  eventId: `${environment}/${shell.id}/${kind}/${key}`,
  kind,
  environment,
  threadId: shell.id,
  projectId: shell.projectId,
  title: shell.title,
  occurredAt,
  summary,
  runId: shell.latestRunId,
  pause,
  pendingTasks,
  // Shell rows carry no message text; the hub reads it when the event is delivered.
  lastMessage: null,
  pullRequests: pullRequestSummaries(shell),
});

/**
 * Events that hold as soon as the shell row shows them. Ids derive from the run, request, or
 * settle time, so replaying a snapshot after a restart yields the same ids.
 */
export function immediateEvents(
  environment: string,
  shell: OrchestrationV2ThreadShell,
): Array<ThreadEvent> {
  const events: Array<ThreadEvent> = [];
  const updatedAt = DateTime.formatIso(shell.updatedAt);
  if (shell.status === "failed" && shell.latestRunId !== null) {
    events.push(
      makeEvent(
        environment,
        shell,
        "failed",
        shell.latestRunId,
        iso(shell.latestRunCompletedAt) ?? updatedAt,
        `run failed${shell.lastError === null || shell.lastError === undefined ? "" : `: ${shell.lastError}`}`,
      ),
    );
  }
  const request = shell.pendingRuntimeRequest;
  if (request !== null) {
    const approval = isApproval(request);
    events.push({
      ...makeEvent(
        environment,
        shell,
        approval ? "needs-approval" : "needs-input",
        request.id,
        DateTime.formatIso(request.createdAt),
        // The hub replaces an approval's summary with what it is for, once it has read that.
        approval
          ? `waiting for approval of a ${request.kind} request`
          : `waiting for a ${request.kind} response`,
      ),
      requestId: request.id,
    });
  }
  const settledAt = iso(shell.settledAt);
  if (shell.settledOverride === "settled" && settledAt !== null) {
    events.push(makeEvent(environment, shell, "settled", settledAt, settledAt, "thread settled"));
  }
  return events;
}

/** Whether a message closes by asking something: its last paragraph has a line ending in "?". */
export const endsWithQuestion = (message: string) =>
  (
    message
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? ""
  )
    .split("\n")
    .some((line) => /\?[\s"'”’)*_`]*$/.test(line));

const namesPullRequest = (message: string) => /\/pull\/\d+|(?<![\w&/])#\d+\b/.test(message);

/**
 * What a run's last message holds that a subscriber acts on, as notes for the event's summary.
 * A pause with any of them is a report, not just a wait.
 */
export const reportNotes = (message: string | null): Array<string> =>
  message === null
    ? []
    : [
        ...(endsWithQuestion(message) ? ["its last message ends with a question"] : []),
        ...(namesPullRequest(message) ? ["its last message names a pull request"] : []),
      ];

/**
 * The idle event the shell would produce once it stays quiet, or null while a run is active. A
 * run that ends with its own background work still pending is a pause, carrying the tasks; once
 * they end without a new run, the same run gives a finished idle. The two have different ids, so
 * a run can report both.
 */
export function idleCandidate(
  environment: string,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): ThreadEvent | null {
  if (shell.latestRunId === null || shell.status === "failed") {
    return null;
  }
  if (busyReasons(shell, nowMs).length > 0) {
    return null;
  }
  const completedAt = iso(shell.latestRunCompletedAt) ?? DateTime.formatIso(shell.updatedAt);
  const pendingTasks = pendingTaskLabels(shell);
  const ownTasks = ownTaskLabels(shell);
  const pause = ownTasks.length > 0;
  return makeEvent(
    environment,
    shell,
    "idle",
    `${shell.latestRunId}@${completedAt}${pause ? "/pause" : ""}`,
    completedAt,
    pause
      ? `run ended; background task still pending: ${ownTasks.join(", ")}`
      : pendingTasks.length > 0
        ? "run finished; only a PR watch is still pending"
        : "run finished",
    pendingTasks,
    pause,
  );
}

/** How long T3 Code gets to start the next run once a thread's awaited work has ended. */
export const resumeGraceMs = 30_000;
/** How long a thread may wait on its awaited work before the wait is reported as overdue. */
export const overdueWaitMs = 30 * 60_000;

/** A thread's wait on its own awaited work after a run, followed across shell rows. */
export interface Wait {
  readonly runId: string;
  readonly tasks: ReadonlyArray<string>;
  /** When the awaited work was first seen gone with no new run; null while it is pending. */
  readonly endedAtMs: number | null;
}

/** The thread's wait after this row: none once it runs again, fails, or leaves the lists. */
export function trackWait(
  previous: Wait | undefined,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): Wait | undefined {
  if (
    shell.latestRunId === null ||
    shell.status === "failed" ||
    shell.archivedAt !== null ||
    shell.deletedAt !== null ||
    busyReasons(shell, nowMs).length > 0
  ) {
    return undefined;
  }
  const tasks = awaitedTaskLabels(shell);
  if (tasks.length > 0) {
    return { runId: shell.latestRunId, tasks, endedAtMs: null };
  }
  return previous?.runId === shell.latestRunId
    ? { ...previous, endedAtMs: previous.endedAtMs ?? nowMs }
    : undefined;
}

/**
 * What has gone wrong with a wait by now. T3 Code resumes a thread when its awaited work ends;
 * when it does not, or the work never ends, the thread stays silent and nothing else tells a
 * subscriber. Ids derive from the run, so each is reported once.
 */
export function stalledEvents(
  environment: string,
  shell: OrchestrationV2ThreadShell,
  wait: Wait,
  nowMs: number,
): Array<ThreadEvent> {
  const completedMs = DateTime.toEpochMillis(shell.latestRunCompletedAt ?? shell.updatedAt);
  const key = `${wait.runId}@${DateTime.formatIso(DateTime.makeUnsafe(completedMs))}`;
  const tasks = wait.tasks.join(", ");
  if (wait.endedAtMs !== null) {
    return nowMs < wait.endedAtMs + resumeGraceMs
      ? []
      : [
          makeEvent(
            environment,
            shell,
            "stalled",
            `${key}/resume`,
            DateTime.formatIso(DateTime.makeUnsafe(wait.endedAtMs)),
            `its awaited background work ended (${tasks}), but T3 Code started no new run; the thread may be working unrecorded or waiting for a message`,
          ),
        ];
  }
  const dueMs = completedMs + overdueWaitMs;
  return nowMs < dueMs
    ? []
    : [
        makeEvent(
          environment,
          shell,
          "stalled",
          `${key}/overdue`,
          DateTime.formatIso(DateTime.makeUnsafe(dueMs)),
          `still waiting on its awaited background work ${overdueWaitMs / 60_000} minutes after its run ended: ${tasks}`,
          wait.tasks,
          true,
        ),
      ];
}

/** The events a thread's current state already implies, for a subscription made just now. */
export function currentEvents(
  environment: string,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): Array<ThreadEvent> {
  const events = immediateEvents(environment, shell).filter((event) => event.kind !== "settled");
  const idle = idleCandidate(environment, shell, nowMs);
  return idle === null ? events : [...events, idle];
}
