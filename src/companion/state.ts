import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

// Mirrors the server's auto-settle grace for a sent message the server has not adopted as a run.
const queuedTurnStartGraceMs = 2 * 60_000;

const activeRunStatuses: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

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

/** Why a thread is in a turn, apart from pending background tasks; empty when it is not. */
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
 * Whether a wait's owner is in a turn. Its own background work does not count: a coordinator
 * usually has delegates running between turns and must still be woken.
 */
export const inTurn = (shell: OrchestrationV2ThreadShell, nowMs: number) =>
  busyReasons(shell, nowMs).length > 0;

type PendingTask = NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]>[number];

const taskLabel = (task: PendingTask) => `${task.kind} ${task.description ?? task.taskId}`;

/**
 * The thread's own pending background work. T3 Code also lists each PR watch as a pending task,
 * but that waits on reviewers and CI, not on the thread, so a run that ends with only watches
 * pending has finished.
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

export type ThreadState =
  | "running"
  /** The run ended with the thread's own background work still pending. */
  | "paused"
  | "idle"
  | "settled"
  | "failed"
  | "needs-input"
  | "needs-approval"
  | "archived";

/**
 * Where a thread stands. A pending request is an approval unless it asks the user a question or
 * to sign in again, which is how T3 Code's own waiting states split them.
 */
export function threadState(shell: OrchestrationV2ThreadShell, nowMs: number): ThreadState {
  if (shell.archivedAt !== null || shell.deletedAt !== null) {
    return "archived";
  }
  const request = shell.pendingRuntimeRequest;
  if (request !== null) {
    return request.kind === "user_input" || request.kind === "auth_refresh"
      ? "needs-input"
      : "needs-approval";
  }
  if (shell.status === "failed") {
    return "failed";
  }
  if (busyReasons(shell, nowMs).length > 0) {
    return "running";
  }
  if (ownWork(shell).length > 0) {
    return "paused";
  }
  return shell.settledOverride === "settled" ? "settled" : "idle";
}

/** When the thread's latest run ended, as epoch milliseconds. */
export const runEndedMs = (shell: OrchestrationV2ThreadShell) =>
  DateTime.toEpochMillis(shell.latestRunCompletedAt ?? shell.updatedAt);
