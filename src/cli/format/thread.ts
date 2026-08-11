import type { ThreadSearchResult, ThreadShow } from "../../application/threads.ts";
import type { WaitEvent } from "../../application/service.ts";
import type { OrchestrationThread, OrchestrationThreadShell } from "@t3tools/contracts";
import { latestAssistantMessage, threadStatus } from "../../domain/thread-lifecycle.ts";
import { formatChatTranscript, formatRecord, formatTable } from "./human.ts";

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
  const sections = [
    formatRecord([
      { field: "title", value: thread.title },
      { field: "id", value: thread.id },
      { field: "project", value: thread.projectId },
      { field: "status", value: thread.status },
      {
        field: "model",
        value: `${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
      },
      { field: "runtime", value: thread.runtimeMode },
      { field: "interaction", value: thread.interactionMode },
      ...(thread.branch !== null ? [{ field: "branch", value: thread.branch }] : []),
      ...(thread.worktreePath !== null ? [{ field: "worktree", value: thread.worktreePath }] : []),
      ...(thread.archivedAt !== null ? [{ field: "archived", value: thread.archivedAt }] : []),
      { field: "messages", value: String(thread.messageCount) },
      { field: "updated", value: thread.updatedAt },
    ]),
  ];
  if (thread.pendingApprovals.length > 0) {
    sections.push(
      `\npending approvals\n${formatTable(
        [
          { header: "request", value: (approval) => approval.requestId, maxWidth: 40 },
          { header: "kind", value: (approval) => approval.requestKind, maxWidth: 16 },
          { header: "created", value: (approval) => approval.createdAt, maxWidth: 28 },
          { header: "detail", value: (approval) => approval.detail ?? "-", maxWidth: 72 },
        ],
        thread.pendingApprovals,
      )}`,
    );
  }
  if (thread.pendingUserInputs.length > 0) {
    sections.push(
      `\npending user inputs\n${formatTable(
        [
          { header: "request", value: (input) => input.requestId, maxWidth: 40 },
          { header: "questions", value: (input) => String(input.questions.length), maxWidth: 9 },
          { header: "created", value: (input) => input.createdAt, maxWidth: 28 },
          {
            header: "prompt",
            value: (input) => input.questions.map((question) => question.question).join("\n"),
            maxWidth: 72,
          },
        ],
        thread.pendingUserInputs,
      )}`,
    );
  }
  return `${sections.join("\n")}\n`;
}

export function formatThreadsHuman(threads: ReadonlyArray<OrchestrationThreadShell>) {
  if (threads.length === 0) {
    return "no threads\n";
  }
  return `${formatTable(
    [
      { header: "title", value: (thread) => thread.title, maxWidth: 36 },
      { header: "id", value: (thread) => thread.id, maxWidth: 40 },
      { header: "status", value: (thread) => threadStatus(thread), maxWidth: 18 },
      { header: "updated", value: (thread) => thread.updatedAt, maxWidth: 28 },
      { header: "flags", value: formatThreadFlags, maxWidth: 34 },
    ],
    threads,
  )}\n`;
}

export function formatThreadSearchHuman(matches: ReadonlyArray<ThreadSearchResult>) {
  if (matches.length === 0) {
    return "no matches\n";
  }
  return `${matches
    .map((match) =>
      formatRecord([
        { field: "thread", value: match.threadTitle ?? "-" },
        { field: "thread id", value: match.threadId },
        { field: "project", value: match.projectTitle ?? "-" },
        { field: "project id", value: match.projectId },
        { field: "workspace", value: match.workspaceRoot ?? "-" },
        { field: "branch", value: match.branch ?? "-" },
        { field: "worktree", value: match.worktreePath ?? "-" },
        { field: "source", value: match.source },
        { field: "created", value: match.messageCreatedAt ?? "-" },
        { field: "snippet", value: match.snippet },
      ]),
    )
    .join("\n\n")}\n`;
}

export function formatThreadDeletedHuman(input: {
  readonly threadId: string;
  readonly dispatch: { readonly sequence: number };
}) {
  return `thread deleted: ${input.threadId} (sequence ${input.dispatch.sequence})`;
}

export function formatThreadStartedHuman(input: {
  readonly thread: OrchestrationThread;
  readonly sequence: number;
}) {
  return `thread started\n${formatRecord([
    { field: "title", value: input.thread.title },
    { field: "id", value: input.thread.id },
    { field: "status", value: threadStatus(input.thread) },
    { field: "sequence", value: String(input.sequence) },
  ])}`;
}

export function formatThreadMessagesHuman(thread: OrchestrationThread, limit: number) {
  const messages = limit === 0 ? thread.messages : thread.messages.slice(-limit);
  return formatChatTranscript(messages);
}

export function formatWaitDoneHuman(thread: OrchestrationThread) {
  const latest = latestAssistantMessage(thread);
  return `status: ${threadStatus(thread)}\n${
    latest !== undefined ? `\n${formatChatTranscript([latest])}` : ""
  }`;
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

function formatThreadFlags(thread: OrchestrationThreadShell) {
  const flags = [
    thread.archivedAt !== null ? "archived" : null,
    thread.hasPendingApprovals ? "approval" : null,
    thread.hasPendingUserInput ? "input" : null,
    thread.hasActionableProposedPlan ? "plan" : null,
  ].filter((flag): flag is string => flag !== null);
  return flags.length > 0 ? flags.join(", ") : "-";
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
