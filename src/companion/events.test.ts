import "vite-plus/test/config";

import { RunId, RuntimeRequestId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import {
  derivePullRequestEvents,
  deriveThreadEvents,
  endsWithQuestion,
  isStale,
  seenThreadMemory,
  type ThreadFacts,
  threadPayload,
} from "./events.ts";
import type { CompanionEvent, PullRequestView, WatchMemory } from "./schema.ts";
import { threadPhase } from "./state.ts";
import { makeShell, monitorTask } from "./state.test-utils.ts";

const minute = 60_000;
const now = 100 * minute;

/** A thread whose run `run-1` ended a minute ago and has held its phase since. */
const facts = (
  overrides: Parameters<typeof makeShell>[0] = {},
  held: Partial<ThreadFacts> = {},
): ThreadFacts => {
  const shell = makeShell({ completedAtMs: now - minute, ...overrides });
  return {
    shell,
    phase: threadPhase(shell, now),
    phaseSinceMs: now - minute,
    progressMs: 0,
    ...held,
  };
};

const owed = (thread: ThreadFacts, memory: WatchMemory = {}, sinceMs = 0) =>
  deriveThreadEvents(thread, { sinceMs, memory }, now, 30);

type PendingRequest = NonNullable<ThreadFacts["shell"]["pendingRuntimeRequest"]>;

const request = (kind: PendingRequest["kind"], createdAtMs = now - minute) =>
  fromPartial<PendingRequest>({
    id: RuntimeRequestId.make("request-1"),
    kind,
    createdAt: DateTime.makeUnsafe(createdAtMs),
  });

describe("deriveThreadEvents", () => {
  it("reports a run that ended once, and the next run again", () => {
    assert.deepEqual(owed(facts()), [{ kind: "done", key: "run-1" }]);
    assert.deepEqual(owed(facts(), { done: "run-1" }), []);
    assert.deepEqual(owed(facts({ latestRunId: RunId.make("run-2") }), { done: "run-1" }), [
      { kind: "done", key: "run-2" },
    ]);
  });

  it("waits for a turn end to hold, since the next run may start at once", () => {
    assert.deepEqual(owed(facts({}, { phaseSinceMs: now - 1_000 })), []);
  });

  it("says nothing while the thread works, never ran, or ended before the watch", () => {
    assert.deepEqual(owed(facts({ activityRunStatus: "running" })), []);
    assert.deepEqual(owed(facts({ latestRunId: null, status: "idle" })), []);
    assert.deepEqual(owed(facts(), {}, now), []);
  });

  it("is not done while the thread awaits its own work, and is stuck after the limit", () => {
    const awaiting = { pendingBackgroundTasks: [{ ...monitorTask, awaited: true as const }] };
    assert.deepEqual(owed(facts(awaiting)), []);
    const long = facts({ ...awaiting, completedAtMs: now - 31 * minute });
    assert.deepEqual(owed(long), [{ kind: "stuck", key: "run-1" }]);
    assert.deepEqual(owed(long, { stuck: "run-1" }), []);
    // Its child worked ten minutes ago: that is progress.
    assert.deepEqual(owed({ ...long, progressMs: now - 10 * minute }), []);
  });

  it("is done with work it left running without awaiting it, and with a PR watch", () => {
    const left = facts({
      pendingBackgroundTasks: [
        monitorTask,
        { kind: "monitor", taskId: "pull-request-watch:acme/repo#1" },
      ],
    });
    assert.deepEqual(owed(left), [{ kind: "done", key: "run-1" }]);
    const { payload } = threadPayload({ kind: "done", key: "run-1" }, left, {
      link: null,
      lastMessage: "Server is up.",
      pullRequests: [],
      stuckMinutes: 30,
    });
    assert.deepEqual(payload.leftRunning, ["monitor Watching CI"]);
  });

  it("reports a pending request once, and a failed run once", () => {
    const asking = facts({ pendingRuntimeRequest: request("user_input") });
    assert.deepEqual(owed(asking), [{ kind: "asks", key: "request-1" }]);
    assert.deepEqual(owed(asking, { asks: "request-1" }), []);
    // Asked before the watch began: the caller saw it in the watch call.
    assert.deepEqual(owed(asking, {}, now), []);
    const failed = facts({ status: "failed", lastError: "provider gave up" });
    assert.deepEqual(owed(failed), [{ kind: "failed", key: "run-1" }]);
    assert.deepEqual(owed(failed, { failed: "run-1" }), []);
  });

  it("records the present as seen for an explicit watch", () => {
    assert.deepEqual(owed(facts(), seenThreadMemory(facts())), []);
  });
});

describe("threadPayload", () => {
  const extras = { link: null, pullRequests: [], stuckMinutes: 30 };

  it("marks a turn that closes on a question, and steers for it", () => {
    const asked = threadPayload({ kind: "done", key: "run-1" }, facts(), {
      ...extras,
      lastMessage: "Two ways to do it.\n\nShould I take (a) or (b)?",
    });
    assert.isTrue(asked.urgent);
    assert.isTrue(asked.payload.question);
    const told = threadPayload({ kind: "done", key: "run-1" }, facts(), {
      ...extras,
      lastMessage: "Done. See https://example.com/run?id=4",
    });
    assert.isFalse(told.urgent);
  });

  it("steers for a request and a failure, not for stuck work", () => {
    const urgent = (["asks", "failed", "stuck"] as const).map(
      (kind) =>
        threadPayload({ kind, key: "run-1" }, facts(), { ...extras, lastMessage: null }).urgent,
    );
    assert.deepEqual(urgent, [true, true, false]);
  });
});

describe("endsWithQuestion", () => {
  it("reads only the last paragraph", () => {
    assert.isTrue(endsWithQuestion("Report.\n\nWhich one do you want?\n"));
    assert.isFalse(endsWithQuestion("Is it right? Yes.\n\nMerged."));
  });
});

const view = (overrides: Partial<PullRequestView> = {}): PullRequestView => ({
  pr: "acme/repo#9",
  url: "https://github.com/acme/repo/pull/9",
  title: "A change",
  state: "open",
  draft: false,
  head: "aaaaaaaaaaaa",
  checks: 3,
  failing: [],
  pending: [],
  mergeable: "mergeable",
  remarks: [],
  rateLimitRemaining: null,
  ...overrides,
});

const failing = [{ name: "tests", url: "https://github.com/acme/repo/runs/1" }];
const watching = (memory: WatchMemory = {}, green = false) => ({ sinceMs: 0, memory, green });
const kinds = (result: ReturnType<typeof derivePullRequestEvents>) =>
  result.events.map((event) => `${event.kind}:${event.key}`);

const remark = (author: string, bot: boolean, at: string) => ({
  author,
  bot,
  at,
  excerpt: "please rename",
  url: `https://github.com/acme/repo/pull/9#${author}`,
});

describe("derivePullRequestEvents", () => {
  it("reports red once per head, urgent only when ready for review", () => {
    const first = derivePullRequestEvents(view({ failing }), watching());
    assert.deepEqual(kinds(first), ["red:aaaaaaaaaaaa"]);
    assert.isTrue(first.events[0]?.urgent);
    assert.deepEqual(kinds(derivePullRequestEvents(view({ failing }), watching(first.memory))), []);
    const pushed = derivePullRequestEvents(
      view({ failing, head: "bbbbbbbbbbbb", draft: true }),
      watching(first.memory),
    );
    assert.deepEqual(kinds(pushed), ["red:bbbbbbbbbbbb"]);
    assert.isFalse(pushed.events[0]?.urgent);
  });

  it("reports a conflict, and green only when asked", () => {
    const conflicting = view({ mergeable: "conflicting" });
    assert.deepEqual(kinds(derivePullRequestEvents(conflicting, watching())), [
      "conflict:aaaaaaaaaaaa",
    ]);
    assert.deepEqual(kinds(derivePullRequestEvents(view(), watching())), []);
    assert.deepEqual(kinds(derivePullRequestEvents(view(), watching({}, true))), [
      "green:aaaaaaaaaaaa",
    ]);
    assert.deepEqual(
      kinds(derivePullRequestEvents(view({ pending: ["build"] }), watching({}, true))),
      [],
    );
  });

  it("reports each comment by a person once, and none from before the watch", () => {
    const remarks = [
      remark("alice", false, "2026-01-01T00:00:00Z"),
      remark("robot", true, "2026-01-02T00:00:00Z"),
      remark("bob", false, "2026-01-03T00:00:00Z"),
    ];
    const since = { ...watching(), sinceMs: Date.parse("2026-01-02T12:00:00Z") };
    const first = derivePullRequestEvents(view({ remarks }), since);
    assert.deepEqual(
      first.events.map((event) => event.payload.remark?.author),
      ["bob"],
    );
    assert.deepEqual(
      kinds(derivePullRequestEvents(view({ remarks }), { ...since, memory: first.memory })),
      [],
    );
  });

  it("ends the watch when the pull request merges or closes", () => {
    const merged = derivePullRequestEvents(view({ state: "merged", failing }), watching());
    assert.deepEqual(kinds(merged), ["merged:merged"]);
    assert.isTrue(merged.ended);
    assert.deepEqual(kinds(derivePullRequestEvents(view({ state: "closed" }), watching())), [
      "closed:closed",
    ]);
  });

  it("only records what a baseline read finds", () => {
    const baseline = derivePullRequestEvents(view({ failing }), watching({ baseline: true }));
    assert.deepEqual(kinds(baseline), []);
    assert.deepEqual(baseline.memory, { red: "aaaaaaaaaaaa" });
    assert.deepEqual(
      kinds(derivePullRequestEvents(view({ failing }), watching(baseline.memory))),
      [],
    );
  });
});

const event = (kind: CompanionEvent["kind"], subject: string, key: string) =>
  fromPartial<CompanionEvent>({ kind, subject, key });
const world = (thread: ThreadFacts | undefined, pr: PullRequestView | undefined) => ({
  thread: () => thread,
  pullRequest: () => pr,
});

describe("isStale", () => {
  it("drops a thread event once the thread has moved on", () => {
    const done = event("done", "thread:local/thread-a", "run-1");
    assert.isFalse(isStale(done, world(facts(), undefined)));
    assert.isTrue(isStale(done, world(facts({ activityRunStatus: "running" }), undefined)));
    assert.isTrue(isStale(done, world(facts({ latestRunId: RunId.make("run-2") }), undefined)));
    const asks = event("asks", "thread:local/thread-a", "request-1");
    assert.isFalse(
      isStale(asks, world(facts({ pendingRuntimeRequest: request("user_input") }), undefined)),
    );
    assert.isTrue(isStale(asks, world(facts(), undefined)));
  });

  it("drops a pull request event on a new head, a merge, or a fixed check", () => {
    const red = event("red", "pr:acme/repo#9", "aaaaaaaaaaaa");
    assert.isFalse(isStale(red, world(undefined, view({ failing }))));
    assert.isTrue(isStale(red, world(undefined, view({ failing, head: "bbbbbbbbbbbb" }))));
    assert.isTrue(isStale(red, world(undefined, view({ failing, state: "merged" }))));
    assert.isTrue(isStale(red, world(undefined, view())));
  });

  it("keeps what cannot go stale, and what it cannot see", () => {
    assert.isFalse(isStale(event("merged", "pr:acme/repo#9", "merged"), world(undefined, view())));
    assert.isFalse(
      isStale(event("done", "thread:local/thread-a", "run-1"), world(undefined, undefined)),
    );
  });
});
