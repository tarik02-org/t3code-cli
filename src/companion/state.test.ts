import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import type { Subscription, ThreadEvent } from "./schema.ts";
import {
  backgroundTaskIdleCapMs,
  deliveryPriority,
  idleCandidate,
  pullRequestSummaries,
  readyToMark,
  threadStatus,
} from "./state.ts";
import { makePullRequest, makeShell, monitorTask } from "./state.test-utils.ts";

describe("idleCandidate", () => {
  it("is a finished idle that may fire now when nothing is pending", () => {
    const candidate = idleCandidate("local", makeShell({ completedAtMs: 1000 }), 5000);
    assert.isNotNull(candidate);
    assert.isFalse(candidate.event.pause);
    assert.deepEqual(candidate.event.pendingTasks, []);
    assert.equal(candidate.notBeforeMs, 5000);
  });

  it("is a pause carrying the tasks, firing like any idle, with its own id", () => {
    const shell = makeShell({ completedAtMs: 1000, pendingBackgroundTasks: [monitorTask] });
    const candidate = idleCandidate("local", shell, 5000);
    assert.isNotNull(candidate);
    assert.isTrue(candidate.event.pause);
    assert.deepEqual(candidate.event.pendingTasks, ["monitor Watching CI"]);
    assert.equal(candidate.notBeforeMs, 5000);
    assert.include(candidate.event.summary, "background task still pending");
    const finished = idleCandidate("local", makeShell({ completedAtMs: 1000 }), 5000);
    assert.equal(candidate.event.eventId, `${finished?.event.eventId}/pause`);
  });

  it("is null while a run is active", () => {
    assert.isNull(idleCandidate("local", makeShell({ activityRunStatus: "running" }), 0));
  });
});

describe("threadStatus", () => {
  it("counts pending background tasks as running until the cap passes", () => {
    const shell = makeShell({ completedAtMs: 0, pendingBackgroundTasks: [monitorTask] });
    assert.equal(threadStatus("local", shell, 1000).state, "running");
    assert.equal(threadStatus("local", shell, backgroundTaskIdleCapMs + 1).state, "idle");
  });

  it("reports failed, needs-input, and settled", () => {
    assert.equal(threadStatus("local", makeShell({ status: "failed" }), 0).state, "failed");
    const asking = makeShell({
      pendingRuntimeRequest: fromPartial({ id: "req-1", kind: "user_input" }),
    });
    assert.equal(threadStatus("local", asking, 0).state, "needs-input");
    const settled = makeShell({ settledOverride: "settled" });
    assert.equal(threadStatus("local", settled, 0).state, "settled");
  });
});

describe("pull requests", () => {
  it("summarizes checks and finds drafts ready to be marked ready", () => {
    const shell = makeShell({
      pullRequests: [
        makePullRequest({ number: 1, isDraft: true, checksState: "passing" }),
        makePullRequest({ number: 2, isDraft: true, checksState: "pending" }),
        makePullRequest({ number: 3, isDraft: false, checksState: "passing" }),
      ],
    });
    const summaries = pullRequestSummaries(shell);
    assert.deepEqual(
      summaries.map((pr) => [pr.number, pr.draft, pr.checks]),
      [
        [1, true, "pass"],
        [2, true, "pending"],
        [3, false, "pass"],
      ],
    );
    assert.deepEqual(
      readyToMark(summaries).map((pr) => pr.number),
      [1],
    );
    const merged = pullRequestSummaries(
      makeShell({
        pullRequests: [
          makePullRequest({ number: 4, isDraft: false, checksState: "passing", state: "merged" }),
        ],
      }),
    );
    assert.isNull(merged[0]?.mergeable);
  });
});

const subscription = (priorities: Record<string, "urgent" | "normal" | "low">) =>
  fromPartial<Subscription>({ priorities });
const event = (kind: ThreadEvent["kind"], pause = false) =>
  fromPartial<ThreadEvent>({ kind, pause });

describe("deliveryPriority", () => {
  it("steers failures and questions, queues idles, and holds the rest", () => {
    assert.equal(deliveryPriority(subscription({}), event("failed")), "urgent");
    assert.equal(deliveryPriority(subscription({}), event("needs-input")), "urgent");
    assert.equal(deliveryPriority(subscription({}), event("idle")), "normal");
    assert.equal(deliveryPriority(subscription({}), event("settled")), "low");
  });

  it("applies per-subscription overrides, but a pause stays low", () => {
    assert.equal(deliveryPriority(subscription({ idle: "urgent" }), event("idle")), "urgent");
    assert.equal(deliveryPriority(subscription({ idle: "urgent" }), event("idle", true)), "low");
  });
});
