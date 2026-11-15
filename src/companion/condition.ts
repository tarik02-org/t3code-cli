import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";

import {
  threadRefKey,
  type Condition,
  type LeafTruth,
  type PullRequestLeaf,
  type PullRequestView,
  type ThreadLeaf,
  type ThreadRef,
  type Truth,
} from "./schema.ts";
import { awaitedTaskLabels, ownTaskLabels, runEndedMs, type ThreadState } from "./state.ts";

/**
 * How long a thread must hold a state before a leaf counts it. A run that ends and the next one
 * that T3 Code starts for a queued message or a finished background task are moments apart.
 */
export const settleMs = 3_000;
export const defaultStalledMinutes = 30;

/** A thread's latest shell row, with the state it shows and since when. */
export interface ThreadView {
  readonly shell: OrchestrationV2ThreadShell;
  readonly state: ThreadState;
  readonly sinceMs: number;
  /**
   * The thread's last assistant message, read from the thread itself: T3 Code keeps message
   * text out of shell rows. Null when it has none, undefined until it has been read.
   */
  readonly message: { readonly id: string; readonly text: string } | null | undefined;
}

/** What "new" is measured against: the state when the wait was made, or last fired. */
export interface Baselines {
  readonly sinceMs: number;
  /** The last assistant message of each thread, by thread key. */
  readonly messages: Readonly<Record<string, string | null>>;
  /** The head of each pull request. */
  readonly heads: Readonly<Record<string, string>>;
}

export interface World {
  readonly nowMs: number;
  readonly thread: (ref: ThreadRef) => ThreadView | undefined;
  readonly pullRequest: (pr: string) => PullRequestView | undefined;
}

export interface Evaluation {
  readonly truth: Truth;
  /** Every leaf in the order the condition names them. */
  readonly leaves: ReadonlyArray<LeafTruth>;
}

export const threadRefOf = (leaf: ThreadLeaf): ThreadRef => ({
  environment: leaf.environment ?? "",
  threadId: leaf.thread,
});

const firstLine = (text: string, length = 160) =>
  (text.trim().split("\n")[0] ?? "").slice(0, length);

const statesFor: Record<Exclude<ThreadLeaf["is"], "stalled" | "message">, ReadonlyArray<string>> = {
  idle: ["paused", "idle", "settled"],
  finished: ["idle", "settled"],
  "needs-input": ["needs-input"],
  "needs-approval": ["needs-approval"],
  failed: ["failed"],
};

function evaluateThread(leaf: ThreadLeaf, world: World, baselines: Baselines): LeafTruth {
  const ref = threadRefOf(leaf);
  const name = `thread ${threadRefKey(ref)} ${leaf.is}`;
  const view = world.thread(ref);
  if (view === undefined) {
    return { leaf: name, state: "unknown", detail: `thread ${threadRefKey(ref)} is not known` };
  }
  const who = `thread "${view.shell.title}" (${threadRefKey(ref)})`;
  const message = view.message;
  const said = message === null || message === undefined ? "" : `: ${firstLine(message.text)}`;
  const pending = ownTaskLabels(view.shell);
  const standing = `${who} is ${view.state}${pending.length === 0 ? "" : `, waiting on ${pending.join(", ")}`}`;
  if (leaf.is === "message") {
    if (message === undefined) {
      return { leaf: name, state: "unknown", detail: `${who} has not had its messages read` };
    }
    const fresh =
      message !== null && message.id !== (baselines.messages[threadRefKey(ref)] ?? null);
    return {
      leaf: name,
      state: fresh ? "true" : "false",
      detail: fresh ? `${who} wrote${said}` : `${who} has no new message`,
    };
  }
  if (leaf.is === "stalled") {
    const minutes = leaf.minutes ?? defaultStalledMinutes;
    const awaited = awaitedTaskLabels(view.shell);
    const overdue =
      view.state === "paused" &&
      awaited.length > 0 &&
      world.nowMs >= runEndedMs(view.shell) + minutes * 60_000;
    return {
      leaf: name,
      state: overdue ? "true" : "false",
      detail: overdue
        ? `${who} still waits on ${awaited.join(", ")} ${minutes} minutes after its run ended`
        : standing,
    };
  }
  const holds = statesFor[leaf.is].includes(view.state) && world.nowMs - view.sinceMs >= settleMs;
  return {
    leaf: name,
    state: holds ? "true" : "false",
    detail: holds ? `${standing}${said}` : standing,
  };
}

const shortHead = (view: PullRequestView) => view.head.slice(0, 7);

/** A pull request's checks in words. */
export const checksInWords = (view: PullRequestView) =>
  view.checks === 0
    ? "no checks yet"
    : view.failing.length > 0
      ? `failing ${view.failing.join(", ")}${view.pending.length === 0 ? "" : ` (${view.pending.length} pending)`}`
      : view.pending.length > 0
        ? `${view.pending.length} of ${view.checks} checks pending`
        : `all ${view.checks} checks pass`;

function evaluatePullRequest(leaf: PullRequestLeaf, world: World, baselines: Baselines): LeafTruth {
  const name = `pr ${leaf.pr} ${leaf.is}`;
  const view = world.pullRequest(leaf.pr);
  if (view === undefined) {
    return { leaf: name, state: "unknown", detail: `PR ${leaf.pr} has not been read` };
  }
  const who = `PR ${view.pr}`;
  const onHead = `on ${shortHead(view)}`;
  const answer = (holds: boolean, detail: string): LeafTruth => ({
    leaf: name,
    state: holds ? "true" : "false",
    detail: `${who} ${detail}`,
  });
  switch (leaf.is) {
    case "checks-done":
      return answer(
        view.checks > 0 && view.pending.length === 0,
        `${checksInWords(view)} ${onHead}`,
      );
    case "green":
      return answer(
        view.checks > 0 && view.failing.length === 0 && view.pending.length === 0,
        `${checksInWords(view)} ${onHead}`,
      );
    case "red":
      return answer(view.failing.length > 0, `${checksInWords(view)} ${onHead}`);
    case "mergeable":
    case "conflicting":
      return answer(view.mergeable === leaf.is, `is ${view.mergeable} ${onHead}`);
    case "draft":
      return answer(
        view.state === "open" && view.draft,
        `is ${view.draft ? "a draft" : view.state}`,
      );
    case "ready":
      return answer(
        view.state === "open" && !view.draft,
        `is ${view.state === "open" ? (view.draft ? "a draft" : "ready for review") : view.state}`,
      );
    case "merged":
    case "closed":
      return answer(view.state === leaf.is, `is ${view.state}`);
    case "new-head":
      return answer(view.head !== baselines.heads[view.pr], `has head ${shortHead(view)}`);
    case "comment": {
      const fresh = view.remarks.filter(
        (remark) => !remark.bot && Date.parse(remark.at) > baselines.sinceMs,
      );
      const last = fresh.at(-1);
      return answer(
        last !== undefined,
        last === undefined
          ? "has no new comment from a person"
          : `has ${fresh.length === 1 ? "a new comment" : `${fresh.length} new comments`}, the last by ${last.author}: ${firstLine(last.excerpt)}`,
      );
    }
  }
  return answer(false, "is in an unknown state");
}

const combine = (truths: ReadonlyArray<Truth>, decisive: Truth, otherwise: Truth): Truth =>
  truths.includes(decisive) ? decisive : truths.includes("unknown") ? "unknown" : otherwise;

/**
 * A condition against the current state. Unknown stays unknown through every combinator, so a
 * wait never fires on state the companion has not seen.
 */
export function evaluate(condition: Condition, world: World, baselines: Baselines): Evaluation {
  if ("any" in condition || "all" in condition) {
    const parts = ("any" in condition ? condition.any : condition.all).map((part) =>
      evaluate(part, world, baselines),
    );
    const truths = parts.map((part) => part.truth);
    return {
      truth:
        "any" in condition ? combine(truths, "true", "false") : combine(truths, "false", "true"),
      leaves: parts.flatMap((part) => part.leaves),
    };
  }
  if ("not" in condition) {
    const inner = evaluate(condition.not, world, baselines);
    return {
      truth: inner.truth === "unknown" ? "unknown" : inner.truth === "true" ? "false" : "true",
      leaves: inner.leaves,
    };
  }
  const leaf =
    "thread" in condition
      ? evaluateThread(condition, world, baselines)
      : "pr" in condition
        ? evaluatePullRequest(condition, world, baselines)
        : {
            leaf: `after ${condition.after}s`,
            state:
              world.nowMs >= baselines.sinceMs + condition.after * 1000
                ? ("true" as const)
                : ("false" as const),
            detail: `${condition.after}s ${world.nowMs >= baselines.sinceMs + condition.after * 1000 ? "have" : "have not"} passed`,
          };
  return { truth: leaf.state, leaves: [leaf] };
}

/** The condition as its owner would write it. */
export function describe(condition: Condition): string {
  if ("any" in condition) {
    return `any(${condition.any.map(describe).join(", ")})`;
  }
  if ("all" in condition) {
    return `all(${condition.all.map(describe).join(", ")})`;
  }
  if ("not" in condition) {
    return `not(${describe(condition.not)})`;
  }
  if ("thread" in condition) {
    return `thread ${threadRefKey(threadRefOf(condition))} ${condition.is}`;
  }
  return "pr" in condition ? `pr ${condition.pr} ${condition.is}` : `after ${condition.after}s`;
}

/** Every leaf of a condition, depth first. */
export function leavesOf(
  condition: Condition,
): Array<ThreadLeaf | PullRequestLeaf | { after: number }> {
  if ("any" in condition) {
    return condition.any.flatMap(leavesOf);
  }
  if ("all" in condition) {
    return condition.all.flatMap(leavesOf);
  }
  return "not" in condition ? leavesOf(condition.not) : [condition];
}

/** The threads and pull requests a condition reads, each once. */
export function referencesOf(condition: Condition): {
  readonly threads: ReadonlyArray<ThreadRef>;
  readonly pullRequests: ReadonlyArray<string>;
} {
  const threads = new Map<string, ThreadRef>();
  const pullRequests = new Set<string>();
  for (const leaf of leavesOf(condition)) {
    if ("thread" in leaf) {
      threads.set(threadRefKey(threadRefOf(leaf)), threadRefOf(leaf));
    } else if ("pr" in leaf) {
      pullRequests.add(leaf.pr);
    }
  }
  return { threads: [...threads.values()], pullRequests: [...pullRequests] };
}

/** `owner/repo#123` from that form or from a pull request's URL; null for anything else. */
export function parsePullRequest(
  text: string,
): { owner: string; name: string; number: number } | null {
  const match =
    /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text.trim()) ??
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/.exec(text.trim());
  const [, owner, name, number] = match ?? [];
  return owner === undefined || name === undefined || number === undefined
    ? null
    : { owner, name, number: Number(number) };
}

/** What "new" is measured against for a wait made, or fired, now. */
export function baselinesFor(condition: Condition, world: World): Baselines {
  const { threads, pullRequests } = referencesOf(condition);
  return {
    sinceMs: world.nowMs,
    messages: Object.fromEntries(
      threads.map((ref) => [threadRefKey(ref), world.thread(ref)?.message?.id ?? null]),
    ),
    heads: Object.fromEntries(
      pullRequests.flatMap((pr) => {
        const view = world.pullRequest(pr);
        return view === undefined ? [] : [[pr, view.head]];
      }),
    ),
  };
}

/** A fired wait in one line: what matched, or where everything stood when it timed out. */
export function summarize(
  outcome: "matched" | "timeout",
  leaves: ReadonlyArray<LeafTruth>,
): string {
  const matched = leaves.filter((leaf) => leaf.state === "true");
  const shown = outcome === "matched" && matched.length > 0 ? matched : leaves;
  return shown.map((leaf) => leaf.detail).join("; ");
}
