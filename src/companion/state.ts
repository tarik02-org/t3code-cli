import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type {
  CompanionEventKind,
  DeliveryPriority,
  PullRequestSummary,
  Subscription,
  ThreadEvent,
  ThreadStatus,
} from "./schema.ts";

// Mirrors the server's auto-settle grace for a sent message the server has not adopted as a run.
const queuedTurnStartGraceMs = 2 * 60_000;

/**
 * A background task (Claude `Monitor`, a `run_in_background` command, a subagent) wakes the
 * thread later, so it holds idle. Past this age the task is reported as still pending instead,
 * since dev servers and PR watches can run for hours.
 */
export const backgroundTaskIdleCapMs = 30 * 60_000;

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

const taskLabel = (
  task: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]>[number],
) => `${task.kind} ${task.description ?? task.taskId}`;

export const pendingTaskLabels = (shell: OrchestrationV2ThreadShell): Array<string> =>
  (shell.pendingBackgroundTasks ?? []).map(taskLabel);

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
      },
    };
  });
}

/** Draft pull requests whose checks pass: the ones waiting to be marked ready. */
export const readyToMark = (pullRequests: ReadonlyArray<PullRequestSummary>) =>
  pullRequests.filter((pr) => pr.state === "open" && pr.draft && pr.checks === "pass");

/**
 * Where a thread stands. Pending background tasks count as running until the idle cap passes
 * after the run completed, matching when `idleCandidate` lets idle fire.
 */
export function threadStatus(
  environment: string,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): ThreadStatus {
  const pendingTasks = pendingTaskLabels(shell);
  const completedMs = DateTime.toEpochMillis(shell.latestRunCompletedAt ?? shell.updatedAt);
  const waitingOnTasks = pendingTasks.length > 0 && nowMs < completedMs + backgroundTaskIdleCapMs;
  const state: ThreadStatus["state"] =
    shell.archivedAt !== null || shell.deletedAt !== null
      ? "archived"
      : shell.pendingRuntimeRequest !== null
        ? "needs-input"
        : shell.status === "failed"
          ? "failed"
          : busyReasons(shell, nowMs).length > 0 || waitingOnTasks
            ? "running"
            : shell.settledOverride === "settled"
              ? "settled"
              : "idle";
  return {
    environment,
    threadId: shell.id,
    projectId: shell.projectId,
    title: shell.title,
    state,
    latestRunStatus: shell.status,
    pendingTasks,
    pullRequests: pullRequestSummaries(shell),
    updatedAt: DateTime.formatIso(shell.updatedAt),
  };
}

const makeEvent = (
  environment: string,
  shell: OrchestrationV2ThreadShell,
  kind: CompanionEventKind,
  key: string,
  occurredAt: string,
  summary: string,
  pendingTasks: ReadonlyArray<string> = [],
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
  pause: pendingTasks.length > 0,
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
    events.push(
      makeEvent(
        environment,
        shell,
        "needs-input",
        request.id,
        DateTime.formatIso(request.createdAt),
        `waiting for a ${request.kind} response`,
      ),
    );
  }
  const settledAt = iso(shell.settledAt);
  if (shell.settledOverride === "settled" && settledAt !== null) {
    events.push(makeEvent(environment, shell, "settled", settledAt, settledAt, "thread settled"));
  }
  return events;
}

export interface IdleCandidate {
  readonly event: ThreadEvent;
  /** Epoch ms before which the event must not fire; the caller adds the debounce on top. */
  readonly notBeforeMs: number;
}

/**
 * The idle event the shell would produce once it stays quiet, or null while it is busy. With
 * background tasks pending, idle waits until the cap passes after the run completed and is then
 * a pause, carrying the tasks. The id is the same either way, so a capped idle and a later real
 * one are delivered once.
 */
export function idleCandidate(
  environment: string,
  shell: OrchestrationV2ThreadShell,
  nowMs: number,
): IdleCandidate | null {
  if (shell.latestRunId === null || shell.status === "failed") {
    return null;
  }
  if (busyReasons(shell, nowMs).length > 0) {
    return null;
  }
  const completedAt = iso(shell.latestRunCompletedAt) ?? DateTime.formatIso(shell.updatedAt);
  const pendingTasks = pendingTaskLabels(shell);
  return {
    event: makeEvent(
      environment,
      shell,
      "idle",
      `${shell.latestRunId}@${completedAt}`,
      completedAt,
      pendingTasks.length === 0
        ? "run finished"
        : `run ended; background task still pending: ${pendingTasks.join(", ")}`,
      pendingTasks,
    ),
    notBeforeMs:
      pendingTasks.length === 0
        ? nowMs
        : DateTime.toEpochMillis(shell.latestRunCompletedAt ?? shell.updatedAt) +
          backgroundTaskIdleCapMs,
  };
}

const defaultPriorities: Record<CompanionEventKind, DeliveryPriority> = {
  failed: "urgent",
  "needs-input": "urgent",
  idle: "normal",
  "pr-checks": "normal",
  "env-down": "normal",
  settled: "low",
  "env-up": "low",
};

/**
 * The priority one subscription delivers an event at. A pause is always low: the thread is only
 * waiting on its own background work, which wakes it again.
 */
export function deliveryPriority(subscription: Subscription, event: ThreadEvent): DeliveryPriority {
  if (event.pause) {
    return "low";
  }
  return subscription.priorities[event.kind] ?? defaultPriorities[event.kind];
}
