import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2Run,
  OrchestrationV2ShellThreadStatus,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { deriveThreadRuntime } from "@t3tools/client-runtime/state/thread-execution";

export type ThreadLifecycleStatus = OrchestrationV2ShellThreadStatus;

const LIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

const TERMINAL_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

export function threadStatus(projection: OrchestrationV2ThreadProjection): ThreadLifecycleStatus {
  const status = deriveThreadRuntime(projection)?.status ?? "idle";
  if (status !== "cancelled") {
    return status;
  }
  // A queued message that was cancelled or steered into the active run leaves a newer run
  // that never started; the outcome is the run that actually ran.
  return projection.runs.findLast((run) => run.startedAt !== null)?.status ?? status;
}

/** Includes queued runs and runs waiting on an approval or user input. */
export function isThreadActive(projection: OrchestrationV2ThreadProjection) {
  return threadRuntimeIsActive(deriveThreadRuntime(projection));
}

export function threadLastError(projection: OrchestrationV2ThreadProjection) {
  return deriveThreadRuntime(projection)?.lastError ?? null;
}

/** The newest run that owns live provider work, which is what a Stop targets. */
export function liveRun(projection: OrchestrationV2ThreadProjection) {
  return projection.runs.findLast((run) => LIVE_RUN_STATUSES.has(run.status));
}

export function isRunTerminal(run: OrchestrationV2Run) {
  return TERMINAL_RUN_STATUSES.has(run.status);
}

export function runForUserMessage(projection: OrchestrationV2ThreadProjection, messageId: string) {
  return projection.runs.find((run) => run.userMessageId === messageId);
}

export function latestAssistantMessage(
  projection: Pick<OrchestrationV2ThreadProjection, "messages">,
): OrchestrationV2ConversationMessage | undefined {
  return projection.messages.findLast((message) => message.role === "assistant");
}

/** The final answer of a run: its newest complete, non-empty assistant message. */
export function runAnswer(projection: OrchestrationV2ThreadProjection, runId: string) {
  return projection.messages.findLast(
    (message) =>
      message.runId === runId &&
      message.role === "assistant" &&
      !message.streaming &&
      message.text.trim().length > 0,
  );
}
