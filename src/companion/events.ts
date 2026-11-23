import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type {
  CompanionEvent,
  EventKind,
  EventPayload,
  LinkedPullRequest,
  PullRequestView,
  WatchMemory,
} from "./schema.ts";
import {
  awaitedTaskLabels,
  isQuestion,
  leftRunningLabels,
  runEndedMs,
  type ThreadPhase,
} from "./state.ts";

/**
 * How long a thread must hold a phase before it counts. A run that ends and the next one that
 * T3 Code starts for a queued message or a finished background task are moments apart.
 */
export const settleMs = 5_000;
export const defaultStuckMinutes = 30;
/** The most of a thread's last message an event carries. */
export const lastMessageLength = 10_000;
const rememberedRemarks = 200;

/** A thread's latest row with what the companion tracks about it between rows. */
export interface ThreadFacts {
  readonly shell: OrchestrationV2ThreadShell;
  readonly phase: ThreadPhase;
  readonly phaseSinceMs: number;
  /** The last moment the work the thread awaits showed life, or 0 when none was seen. */
  readonly progressMs: number;
}

/** A transition a watch has not reported yet. */
export interface Candidate {
  readonly kind: EventKind;
  readonly key: string;
}

const short = (head: string) => head.slice(0, 7);

/**
 * The thread events a watch owes. `sinceMs` is when the watch began: a run that ended, or a
 * request made, before it is not news.
 */
export function deriveThreadEvents(
  facts: ThreadFacts,
  watch: { readonly sinceMs: number; readonly memory: WatchMemory },
  nowMs: number,
  stuckMinutes: number,
): Array<Candidate> {
  const { shell, phase } = facts;
  const settled = nowMs - facts.phaseSinceMs >= settleMs;
  const request = shell.pendingRuntimeRequest;
  if (phase === "asks" && request !== null) {
    return DateTime.toEpochMillis(request.createdAt) > watch.sinceMs &&
      watch.memory.asks !== request.id
      ? [{ kind: "asks", key: request.id }]
      : [];
  }
  const run = shell.latestRunId;
  if (run === null || !settled) {
    return [];
  }
  const fresh = runEndedMs(shell) > watch.sinceMs;
  if (phase === "done" && fresh && watch.memory.done !== run) {
    return [{ kind: "done", key: run }];
  }
  if (phase === "failed" && fresh && watch.memory.failed !== run) {
    return [{ kind: "failed", key: run }];
  }
  if (
    phase === "waiting" &&
    watch.memory.stuck !== run &&
    nowMs - Math.max(runEndedMs(shell), facts.progressMs) >= stuckMinutes * 60_000
  ) {
    return [{ kind: "stuck", key: run }];
  }
  return [];
}

/** What an explicit watch records as known, so only later transitions are reported. */
export function seenThreadMemory(facts: ThreadFacts): WatchMemory {
  const run = facts.shell.latestRunId ?? undefined;
  return {
    asks: facts.shell.pendingRuntimeRequest?.id,
    done: facts.phase === "done" ? run : undefined,
    failed: facts.phase === "failed" ? run : undefined,
  };
}

/**
 * Whether a message closes on a question: a question mark in its last paragraph. A thread that
 * ends its turn this way waits for an answer though no request is pending.
 */
export function endsWithQuestion(text: string): boolean {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim().length > 0);
  // A URL's query string is not a question.
  return (paragraphs.at(-1) ?? "").replaceAll(/https?:\/\/\S+/g, "").includes("?");
}

export function threadPayload(
  candidate: Candidate,
  facts: ThreadFacts,
  extras: {
    readonly link: string | null;
    readonly lastMessage: string | null;
    readonly pullRequests: ReadonlyArray<LinkedPullRequest>;
    readonly stuckMinutes: number;
  },
): { readonly payload: EventPayload; readonly urgent: boolean } {
  const { shell } = facts;
  const base = { title: shell.title, link: extras.link, runId: shell.latestRunId ?? undefined };
  switch (candidate.kind) {
    case "asks": {
      const kind = shell.pendingRuntimeRequest?.kind ?? "request";
      return {
        urgent: true,
        payload: {
          ...base,
          summary: isQuestion(kind) ? "asks a question" : `asks for an approval (${kind})`,
          requestId: candidate.key,
          requestKind: kind,
        },
      };
    }
    case "failed":
      return {
        urgent: true,
        payload: {
          ...base,
          summary: `its run failed${shell.lastError === null || shell.lastError === undefined ? "" : `: ${shell.lastError.slice(0, 500)}`}`,
          error: shell.lastError ?? null,
          lastMessage: extras.lastMessage,
          pullRequests: extras.pullRequests,
        },
      };
    case "stuck": {
      const awaiting = awaitedTaskLabels(shell);
      return {
        urgent: false,
        payload: {
          ...base,
          summary: `still waits on ${awaiting.join(", ")}, with no progress for ${extras.stuckMinutes} minutes`,
          awaiting,
        },
      };
    }
    default: {
      const question = extras.lastMessage !== null && endsWithQuestion(extras.lastMessage);
      const leftRunning = leftRunningLabels(shell);
      return {
        urgent: question,
        payload: {
          ...base,
          summary: `its turn ended (${shell.status})${question ? " on a question" : ""}${
            leftRunning.length === 0 ? "" : `; left running: ${leftRunning.join(", ")}`
          }`,
          outcome: shell.status,
          lastMessage: extras.lastMessage,
          question,
          leftRunning,
          pullRequests: extras.pullRequests,
        },
      };
    }
  }
}

/** A pull request's checks on its head, in words. */
export function checksInWords(view: PullRequestView): string {
  const pending = view.pending.length === 0 ? "" : `${view.pending.length} pending`;
  if (view.failing.length > 0) {
    return `failing ${view.failing.map((check) => check.name).join(", ")}${pending.length === 0 ? "" : ` (${pending})`}`;
  }
  if (view.checks === 0) {
    return "no checks yet";
  }
  return pending.length > 0 ? `${pending} of ${view.checks} checks` : `${view.checks} checks done`;
}

/** A pull request's standing in a few words, for a watch listing. */
export const describePullRequest = (view: PullRequestView) =>
  view.state === "open"
    ? `${view.draft ? "draft" : "open"} at ${short(view.head)}: ${checksInWords(view)}; ${view.mergeable}`
    : view.state;

const isGreen = (view: PullRequestView) =>
  view.checks > 0 &&
  view.failing.length === 0 &&
  view.pending.length === 0 &&
  view.mergeable !== "conflicting";

/**
 * The pull request events a watch owes for this read, and what the watch remembers after it.
 * A watch on its baseline read only remembers.
 */
export function derivePullRequestEvents(
  view: PullRequestView,
  watch: { readonly sinceMs: number; readonly memory: WatchMemory; readonly green: boolean },
): {
  readonly events: ReadonlyArray<
    Candidate & { readonly urgent: boolean; readonly payload: EventPayload }
  >;
  readonly memory: WatchMemory;
  readonly ended: boolean;
} {
  const { baseline, ...known } = watch.memory;
  const base = { title: view.title, link: view.url, head: view.head, draft: view.draft };
  const events: Array<Candidate & { readonly urgent: boolean; readonly payload: EventPayload }> =
    [];
  if (view.state !== "open") {
    events.push({
      kind: view.state,
      key: view.state,
      urgent: false,
      payload: {
        ...base,
        summary: view.state === "merged" ? "was merged" : "was closed without merging",
      },
    });
    return { events: baseline === true ? [] : events, memory: known, ended: true };
  }
  const memory: { -readonly [K in keyof WatchMemory]: WatchMemory[K] } = { ...known };
  if (view.failing.length > 0 && known.red !== view.head) {
    memory.red = view.head;
    events.push({
      kind: "red",
      key: view.head,
      urgent: !view.draft,
      payload: {
        ...base,
        summary: `${checksInWords(view)} on ${short(view.head)}${view.draft ? " (draft)" : ""}`,
        failing: view.failing,
        pendingChecks: view.pending.length,
      },
    });
  }
  if (view.mergeable === "conflicting" && known.conflict !== view.head) {
    memory.conflict = view.head;
    events.push({
      kind: "conflict",
      key: view.head,
      urgent: false,
      payload: { ...base, summary: `conflicts with its base at ${short(view.head)}` },
    });
  }
  if (watch.green && isGreen(view) && known.green !== view.head) {
    memory.green = view.head;
    events.push({
      kind: "green",
      key: view.head,
      urgent: false,
      payload: { ...base, summary: `all ${view.checks} checks pass on ${short(view.head)}` },
    });
  }
  const seen = new Set(known.remarks ?? []);
  const remarks = view.remarks.filter(
    (remark) => !remark.bot && !seen.has(remark.url) && Date.parse(remark.at) > watch.sinceMs,
  );
  for (const remark of remarks) {
    events.push({
      kind: "comment",
      key: remark.url,
      urgent: false,
      payload: {
        ...base,
        summary: `${remark.author} wrote: ${remark.excerpt}`,
        remark,
      },
    });
  }
  if (remarks.length > 0) {
    memory.remarks = [...(known.remarks ?? []), ...remarks.map((remark) => remark.url)].slice(
      -rememberedRemarks,
    );
  }
  return { events: baseline === true ? [] : events, memory, ended: false };
}

/** The current state an undelivered event is judged against; undefined is state not seen. */
export interface World {
  readonly thread: (subject: string) => ThreadFacts | undefined;
  readonly pullRequest: (subject: string) => PullRequestView | undefined;
}

/**
 * Whether an event that was not sent yet no longer holds: the thread moved on to another run,
 * the request was answered, the pull request got a new head or left the state it reports.
 * State the companion cannot see keeps the event.
 */
export function isStale(event: CompanionEvent, world: World): boolean {
  switch (event.kind) {
    case "asks": {
      const facts = world.thread(event.subject);
      return facts !== undefined && facts.shell.pendingRuntimeRequest?.id !== event.key;
    }
    case "done":
    case "failed":
    case "stuck": {
      const facts = world.thread(event.subject);
      const phase = event.kind === "stuck" ? "waiting" : event.kind;
      return (
        facts !== undefined && (facts.shell.latestRunId !== event.key || facts.phase !== phase)
      );
    }
    case "red":
    case "green":
    case "conflict": {
      const view = world.pullRequest(event.subject);
      if (view === undefined) {
        return false;
      }
      if (view.state !== "open" || view.head !== event.key) {
        return true;
      }
      return event.kind === "red"
        ? view.failing.length === 0
        : event.kind === "green"
          ? !isGreen(view)
          : view.mergeable !== "conflicting";
    }
    default:
      return false;
  }
}
