import "vite-plus/test/config";

import * as DateTime from "effect/DateTime";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import { deliveryPriority } from "./delivery.ts";
import type { Subscription, ThreadEvent } from "./schema.ts";
import {
  holdsSnooze,
  idleCandidate,
  immediateEvents,
  pullRequestSummaries,
  readyToMark,
  snoozePauseCapMs,
  threadStatus,
} from "./state.ts";
import { makePullRequest, makeShell, monitorTask } from "./state.test-utils.ts";

const now = DateTime.makeUnsafe(0);

describe("idleCandidate", () => {
  it("is a finished idle when nothing is pending", () => {
    const candidate = idleCandidate("local", makeShell({ completedAtMs: 1000 }), 5000);
    assert.isNotNull(candidate);
    assert.isFalse(candidate.pause);
    assert.deepEqual(candidate.pendingTasks, []);
  });

  it("is a pause carrying the tasks, with its own id", () => {
    const shell = makeShell({ completedAtMs: 1000, pendingBackgroundTasks: [monitorTask] });
    const candidate = idleCandidate("local", shell, 5000);
    assert.isNotNull(candidate);
    assert.isTrue(candidate.pause);
    assert.deepEqual(candidate.pendingTasks, ["monitor Watching CI"]);
    assert.include(candidate.summary, "background task still pending");
    const finished = idleCandidate("local", makeShell({ completedAtMs: 1000 }), 5000);
    assert.equal(candidate.eventId, `${finished?.eventId}/pause`);
  });

  it("is null while a run is active", () => {
    assert.isNull(idleCandidate("local", makeShell({ activityRunStatus: "running" }), 0));
  });
});

describe("threadStatus", () => {
  it("is paused while only background work is pending, which holds snoozes until the cap", () => {
    const shell = makeShell({ completedAtMs: 0, pendingBackgroundTasks: [monitorTask] });
    assert.equal(threadStatus("local", shell, 1000).state, "paused");
    assert.equal(threadStatus("local", shell, snoozePauseCapMs + 1).state, "paused");
    assert.isTrue(holdsSnooze(shell, 1000));
    assert.isFalse(holdsSnooze(shell, snoozePauseCapMs + 1));
    assert.isTrue(holdsSnooze(makeShell({ activityRunStatus: "running" }), snoozePauseCapMs + 1));
    assert.isFalse(holdsSnooze(makeShell(), 1000));
  });

  it("reports failed, needs-input, needs-approval, and settled", () => {
    assert.equal(threadStatus("local", makeShell({ status: "failed" }), 0).state, "failed");
    const asking = makeShell({
      pendingRuntimeRequest: fromPartial({ id: "req-1", kind: "user_input" }),
    });
    assert.equal(threadStatus("local", asking, 0).state, "needs-input");
    const approving = makeShell({
      pendingRuntimeRequest: fromPartial({ id: "req-2", kind: "command", createdAt: now }),
    });
    assert.equal(threadStatus("local", approving, 0).state, "needs-approval");
    assert.deepEqual(
      immediateEvents("local", approving).map((event) => [event.kind, event.requestId]),
      [["needs-approval", "req-2"]],
    );
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
