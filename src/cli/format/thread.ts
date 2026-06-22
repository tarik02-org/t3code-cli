import type { ThreadShow } from "../../application/threads.ts";
import type { WaitEvent } from "../../application/service.ts";
import type { OrchestrationThread, OrchestrationThreadShell } from "@t3tools/contracts";
import { latestAssistantMessage, threadStatus } from "../../domain/thread-lifecycle.ts";

export function formatThreadShowJson(thread: ThreadShow) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    status: thread.status,
    session: thread.session,
    latestTurn: thread.latestTurn,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    archivedAt: thread.archivedAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messageCount,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
    pendingApprovals: thread.pendingApprovals,
    pendingUserInputs: thread.pendingUserInputs,
  };
}

export function formatThreadShowHuman(thread: ThreadShow) {
  const lines = [
    `title: ${thread.title}`,
    `id: ${thread.id}`,
    `status: ${thread.status}`,
    `model: ${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
    ...(thread.branch !== null ? [`branch: ${thread.branch}`] : []),
    ...(thread.worktreePath !== null ? [`worktree: ${thread.worktreePath}`] : []),
    `messages: ${thread.messageCount}`,
  ];
  if (thread.pendingApprovals.length > 0) {
    const requestIds = thread.pendingApprovals.map((approval) => approval.requestId).join(", ");
    lines.push(`pending approvals: ${thread.pendingApprovals.length} (${requestIds})`);
  }
  if (thread.pendingUserInputs.length > 0) {
    const requestIds = thread.pendingUserInputs.map((input) => input.requestId).join(", ");
    lines.push(`pending user inputs: ${thread.pendingUserInputs.length} (${requestIds})`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatThreadsHuman(threads: ReadonlyArray<OrchestrationThreadShell>) {
  return threads
    .map(
      (thread) =>
        `- ${thread.title}${thread.archivedAt !== null ? " (archived)" : ""}\n  id: ${thread.id}\n  status: ${threadStatus(thread)}\n  updated: ${thread.updatedAt}\n`,
    )
    .join("");
}

export function formatThreadDeletedHuman(input: {
  readonly threadId: string;
  readonly dispatch: { readonly sequence: number };
}) {
  return `thread deleted: ${input.threadId}\nsequence: ${input.dispatch.sequence}`;
}

export function formatThreadStartedHuman(input: {
  readonly thread: OrchestrationThread;
  readonly sequence: number;
}) {
  return `thread started: ${input.thread.title}\nid: ${input.thread.id}\nstatus: ${threadStatus(input.thread)}\nsequence: ${input.sequence}`;
}

export function formatThreadMessagesHuman(thread: OrchestrationThread, limit: number) {
  const messages = limit === 0 ? thread.messages : thread.messages.slice(-limit);
  return messages.map((message) => `\n### ${message.role}\n\n${message.text}\n`).join("");
}

export function formatWaitDoneHuman(thread: OrchestrationThread) {
  const latest = latestAssistantMessage(thread);
  return `status: ${threadStatus(thread)}\n${latest !== undefined ? `\n### ${latest.role}\n\n${latest.text}\n` : ""}`;
}

export function formatThreadMessagesJson(thread: OrchestrationThread, full: boolean) {
  return full ? thread : { thread: stripThreadMessages(thread), messages: thread.messages };
}

export function formatWaitEventNdjson(event: WaitEvent) {
  if (event.type !== "thread" && event.type !== "done") {
    return event;
  }
  const compactThread = stripThreadHeavy(event.thread);
  return event.type === "done"
    ? {
        type: "done",
        thread: compactThread,
        latestAssistantMessage: latestAssistantMessage(event.thread) ?? null,
      }
    : {
        type: "thread",
        thread: compactThread,
        messageCount: event.thread.messages.length,
      };
}

function stripThreadMessages<T extends { readonly messages: unknown }>(thread: T) {
  const { messages: _messages, ...rest } = thread;
  return rest;
}

function stripThreadHeavy<
  T extends {
    readonly messages: unknown;
    readonly activities?: unknown;
    readonly proposedPlans?: unknown;
    readonly checkpoints?: unknown;
  },
>(thread: T) {
  const {
    messages: _messages,
    activities: _activities,
    proposedPlans: _proposedPlans,
    checkpoints: _checkpoints,
    ...rest
  } = thread;
  return rest;
}
