import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";

import type { CompanionEventKind, ThreadEvent } from "./schema.ts";

// Mirrors the server's auto-settle grace for a sent message the server has not adopted as a run.
const queuedTurnStartGraceMs = 2 * 60_000;

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

/** Why a thread is not idle, or an empty list when it is. */
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
  if (backgroundWorkHoldsCompletion(shell.pendingBackgroundTasks ?? [])) {
    reasons.push("background work");
  }
  if (shell.blockedOnThreadWait === true) {
    reasons.push("waiting on another thread");
  }
  return reasons;
}

const makeEvent = (
  environment: string,
  shell: OrchestrationV2ThreadShell,
  kind: CompanionEventKind,
  key: string,
  occurredAt: string,
  summary: string,
): ThreadEvent => ({
  eventId: `${environment}/${shell.id}/${kind}/${key}`,
  kind,
  environment,
  threadId: shell.id,
  projectId: shell.projectId,
  title: shell.title,
  occurredAt,
  summary,
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

/** The idle event the shell would produce once it stays quiet, or null while it is busy. */
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
  const summary =
    shell.latestVisibleMessage === null
      ? "run finished"
      : `run finished: ${shell.latestVisibleMessage.text.slice(0, 280)}`;
  return makeEvent(
    environment,
    shell,
    "idle",
    `${shell.latestRunId}@${completedAt}`,
    completedAt,
    summary,
  );
}
