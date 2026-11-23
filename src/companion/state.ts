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

/** Why a thread works on something right now; empty when no run is active or about to start. */
export function runReasons(shell: OrchestrationV2ThreadShell, nowMs: number): Array<string> {
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
  if (shell.blockedOnThreadWait === true) {
    reasons.push("waiting on another thread");
  }
  return reasons;
}

/**
 * Whether a caller is in a turn, so a digest would interrupt it. Its own background work does
 * not count: a coordinator usually has delegates running between turns and must still be told.
 */
export const inTurn = (shell: OrchestrationV2ThreadShell, nowMs: number) =>
  runReasons(shell, nowMs).length > 0 ||
  shell.pendingRuntimeRequest !== null ||
  (shell.pendingGuestMessageCount ?? 0) > 0;

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

/**
 * Work the thread resumes after: the agent marked it so, or it is a subagent, whose result
 * T3 Code hands back by starting the next run.
 */
const isAwaited = (task: PendingTask) => task.awaited === true || task.kind === "subagent";

export const awaitedTasks = (shell: OrchestrationV2ThreadShell) => ownWork(shell).filter(isAwaited);

export const awaitedTaskLabels = (shell: OrchestrationV2ThreadShell): Array<string> =>
  awaitedTasks(shell).map(taskLabel);

/** Work the thread started and left running without saying it waits for it, like a dev server. */
export const leftRunningLabels = (shell: OrchestrationV2ThreadShell): Array<string> =>
  ownWork(shell)
    .filter((task) => !isAwaited(task))
    .map(taskLabel);

/** The threads of the subagents this thread waits on. */
export const awaitedChildThreadIds = (shell: OrchestrationV2ThreadShell): Array<string> =>
  awaitedTasks(shell).flatMap((task) =>
    task.kind === "subagent" && task.childThreadId !== undefined ? [task.childThreadId] : [],
  );

export type ThreadPhase =
  /** Archived or deleted. */
  | "gone"
  /** A question or an approval waits for an answer. */
  | "asks"
  | "failed"
  | "busy"
  /** The run ended and the thread resumes when work it awaits ends. */
  | "waiting"
  /** The run ended with nothing the thread resumes on. */
  | "done"
  /** No run yet. */
  | "new";

export function threadPhase(shell: OrchestrationV2ThreadShell, nowMs: number): ThreadPhase {
  if (shell.archivedAt !== null || shell.deletedAt !== null) {
    return "gone";
  }
  if (shell.pendingRuntimeRequest !== null) {
    return "asks";
  }
  if (shell.status === "failed") {
    return "failed";
  }
  if (runReasons(shell, nowMs).length > 0) {
    return "busy";
  }
  if (awaitedTasks(shell).length > 0) {
    return "waiting";
  }
  return shell.latestRunId === null ? "new" : "done";
}

/** When the thread's latest run ended, as epoch milliseconds. */
export const runEndedMs = (shell: OrchestrationV2ThreadShell) =>
  DateTime.toEpochMillis(shell.latestRunCompletedAt ?? shell.updatedAt);

/** A pending request is an approval unless it asks the user a question or to sign in again. */
export const isQuestion = (kind: string) => kind === "user_input" || kind === "auth_refresh";

/** A thread's standing in a few words, for a watch listing. */
export function describeThread(shell: OrchestrationV2ThreadShell, nowMs: number): string {
  const phase = threadPhase(shell, nowMs);
  switch (phase) {
    case "gone":
      return "archived";
    case "asks":
      return isQuestion(shell.pendingRuntimeRequest?.kind ?? "")
        ? "asks a question"
        : "asks for an approval";
    case "failed":
      return `failed${shell.lastError === null || shell.lastError === undefined ? "" : `: ${shell.lastError.slice(0, 200)}`}`;
    case "busy":
      return `busy (${runReasons(shell, nowMs).join(", ")})`;
    case "waiting":
      return `waiting on ${awaitedTaskLabels(shell).join(", ")}`;
    case "done": {
      const left = leftRunningLabels(shell);
      return `done (${shell.status})${left.length === 0 ? "" : `, left running ${left.join(", ")}`}`;
    }
    default:
      return "has not run";
  }
}
