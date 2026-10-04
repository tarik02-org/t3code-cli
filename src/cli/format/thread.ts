import * as DateTime from "effect/DateTime";
import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";

import type {
  ThreadSearchResult,
  ThreadShow,
  ThreadTranscript,
} from "../../application/threads.ts";
import type { WaitEvent } from "../../application/service.ts";
import type { QueuedRun } from "../../application/thread-queue.ts";
import { latestAssistantMessage, threadStatus } from "../../domain/thread-lifecycle.ts";
import { formatChatTranscript, formatRecord, formatTable } from "./human.ts";

export function formatThreadShowJson(thread: ThreadShow) {
  return thread;
}

export function formatThreadShowHuman(thread: ThreadShow) {
  const sections = [
    formatRecord([
      { field: "title", value: thread.title },
      { field: "id", value: thread.id },
      { field: "project", value: thread.projectId },
      { field: "status", value: thread.status },
      ...(thread.lastError !== null ? [{ field: "error", value: thread.lastError }] : []),
      ...(thread.queuedRunCount > 0
        ? [{ field: "queued", value: String(thread.queuedRunCount) }]
        : []),
      {
        field: "model",
        value: `${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
      },
      { field: "runtime", value: thread.runtimeMode },
      { field: "interaction", value: thread.interactionMode },
      ...(thread.branch !== null ? [{ field: "branch", value: thread.branch }] : []),
      ...(thread.worktreePath !== null ? [{ field: "worktree", value: thread.worktreePath }] : []),
      ...(thread.archivedAt !== null ? [{ field: "archived", value: thread.archivedAt }] : []),
      ...(thread.settledAt !== null ? [{ field: "settled", value: thread.settledAt }] : []),
      ...(thread.snoozedUntil !== null
        ? [{ field: "snoozed until", value: thread.snoozedUntil }]
        : []),
      ...(thread.pinnedAt !== null ? [{ field: "pinned", value: thread.pinnedAt }] : []),
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

export function formatThreadsHuman(threads: ReadonlyArray<OrchestrationV2ThreadShell>) {
  if (threads.length === 0) {
    return "no threads\n";
  }
  return `${formatTable(
    [
      { header: "title", value: (thread) => thread.title, maxWidth: 36 },
      { header: "id", value: (thread) => thread.id, maxWidth: 40 },
      { header: "status", value: (thread) => thread.status, maxWidth: 18 },
      { header: "updated", value: (thread) => DateTime.formatIso(thread.updatedAt), maxWidth: 28 },
      { header: "flags", value: formatThreadFlags, maxWidth: 34 },
    ],
    threads,
  )}\n`;
}

export function formatQueuedRunsHuman(runs: ReadonlyArray<QueuedRun>) {
  if (runs.length === 0) {
    return "queue is empty\n";
  }
  return `${formatTable(
    [
      { header: "#", value: (run) => String(run.position), maxWidth: 4 },
      { header: "run", value: (run) => run.runId, maxWidth: 64 },
      { header: "held", value: (run) => (run.held ? "yes" : "-"), maxWidth: 4 },
      { header: "requested", value: (run) => run.requestedAt, maxWidth: 28 },
      { header: "message", value: (run) => run.text.replace(/\s+/g, " ").trim(), maxWidth: 60 },
    ],
    runs,
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

export function formatThreadStartedHuman(projection: OrchestrationV2ThreadProjection) {
  return `thread started\n${formatRecord([
    { field: "title", value: projection.thread.title },
    { field: "id", value: projection.thread.id },
    { field: "status", value: threadStatus(projection) },
  ])}`;
}

export function formatThreadTranscriptHuman(transcript: ThreadTranscript, limit: number) {
  const messages = transcript.items.flatMap(transcriptMessage);
  const transcriptText = formatChatTranscript(limit === 0 ? messages : messages.slice(-limit));
  return transcript.hasMoreHistory && transcript.beforeCursor !== null
    ? `${transcriptText}\nearlier history available\nbefore cursor: ${transcript.beforeCursor}\n`
    : transcriptText;
}

export function formatThreadTranscriptJson(transcript: ThreadTranscript, full: boolean) {
  return {
    threadId: transcript.threadId,
    snapshotSequence: transcript.snapshotSequence,
    hasMoreHistory: transcript.hasMoreHistory,
    beforeCursor: transcript.beforeCursor,
    ...(full
      ? { items: transcript.items, projection: transcript.projection }
      : { messages: transcript.items.flatMap(transcriptMessage) }),
  };
}

/** Thread metadata, status, and latest answer: a projection without its heavy timeline arrays. */
export function formatThreadResultJson(projection: OrchestrationV2ThreadProjection) {
  return {
    thread: projection.thread,
    status: threadStatus(projection),
    latestAssistantMessage: latestAssistantMessage(projection) ?? null,
  };
}

export function formatWaitDoneHuman(projection: OrchestrationV2ThreadProjection) {
  const latest = latestAssistantMessage(projection);
  return `status: ${threadStatus(projection)}\n${
    latest !== undefined ? `\n${formatChatTranscript([latest])}` : ""
  }`;
}

export function formatWaitEventNdjson(event: WaitEvent) {
  if (event.type === "thread") {
    return {
      type: "thread",
      thread: event.projection.thread,
      status: threadStatus(event.projection),
      messageCount: event.projection.messages.length,
    };
  }
  if (event.type === "done") {
    return { type: "done", ...formatThreadResultJson(event.projection) };
  }
  if (event.type === "status") {
    return { type: "status", status: event.status, threadId: event.threadId };
  }
  return event;
}

/** User and assistant turns of the timeline; tool activity stays in `--full` output. */
function transcriptMessage(row: OrchestrationV2ProjectedTurnItem) {
  const item = row.item;
  if (item.type !== "user_message" && item.type !== "assistant_message") {
    return [];
  }
  return [
    {
      id: item.messageId,
      role: item.type === "user_message" ? "user" : "assistant",
      text: item.text,
      runId: item.runId,
      streaming: item.type === "assistant_message" && item.streaming,
      createdAt: item.startedAt ?? item.updatedAt,
      ...(row.visibility !== "local" ? { sourceThreadId: row.sourceThreadId } : {}),
    },
  ];
}

function formatThreadFlags(thread: OrchestrationV2ThreadShell) {
  const pendingKind = thread.pendingRuntimeRequest?.kind;
  const flags = [
    thread.archivedAt !== null ? "archived" : null,
    thread.pinnedAt !== null && thread.pinnedAt !== undefined ? "pinned" : null,
    pendingKind === undefined ? null : pendingKind === "user_input" ? "input" : "approval",
    thread.hasActionableProposedPlan ? "plan" : null,
  ].filter((flag): flag is string => flag !== null);
  return flags.length > 0 ? flags.join(", ") : "-";
}
