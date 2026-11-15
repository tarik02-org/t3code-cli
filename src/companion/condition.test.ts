import "vite-plus/test/config";

import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import {
  type Baselines,
  baselinesFor,
  describe as describeCondition,
  evaluate,
  parsePullRequest,
  referencesOf,
  summarize,
  type World,
} from "./condition.ts";
import type { Condition, PullRequestIs, PullRequestView, ThreadIs } from "./schema.ts";
import { threadState } from "./state.ts";
import { makeShell, monitorTask } from "./state.test-utils.ts";

const pr = (overrides: Partial<PullRequestView> = {}): PullRequestView => ({
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
  ...overrides,
});

/** A world at `nowMs` whose threads have held their state since time 0. */
const worldOf = (
  nowMs: number,
  shells: ReadonlyArray<OrchestrationV2ThreadShell>,
  prs: ReadonlyArray<PullRequestView> = [],
  lastMessageId = "message-1",
): World => ({
  nowMs,
  thread: (ref) => {
    const shell = shells.find((candidate) => candidate.id === ref.threadId);
    return shell === undefined || ref.environment !== "local"
      ? undefined
      : {
          shell,
          state: threadState(shell, nowMs),
          sinceMs: 0,
          message: { id: lastMessageId, text: "Done.\nDetails follow." },
        };
  },
  pullRequest: (key) => prs.find((candidate) => candidate.pr === key),
});

const none: Baselines = { sinceMs: 0, messages: {}, heads: {} };
const thread = (is: ThreadIs, id = "thread-a"): Condition => ({
  thread: id,
  environment: "local",
  is,
});
const pull = (is: PullRequestIs): Condition => ({ pr: "acme/repo#9", is });
const truthOf = (condition: Condition, world: World, baselines = none) =>
  evaluate(condition, world, baselines).truth;

const asking = (kind: "user_input" | "command") =>
  makeShell({ pendingRuntimeRequest: fromPartial({ id: "request-1", kind }) });
const remark = (author: string, bot: boolean, ms: number) => ({
  author,
  bot,
  at: DateTime.formatIso(DateTime.makeUnsafe(ms)),
  excerpt: "Looks right.",
  url: "https://github.com/acme/repo/pull/9#c",
});
const commented = (remarks: PullRequestView["remarks"]) => worldOf(5_000, [], [pr({ remarks })]);
const of = (overrides: Partial<PullRequestView>) => worldOf(0, [], [pr(overrides)]);

const running = makeShell({ activityRunStatus: "running" });
const idle = makeShell();

describe("evaluate", () => {
  it("combines leaves with any, all and not", () => {
    const world = worldOf(10_000, [idle], [pr({ pending: ["build"] })]);
    assert.equal(truthOf({ any: [thread("failed"), thread("idle")] }, world), "true");
    assert.equal(truthOf({ any: [thread("failed"), pull("green")] }, world), "false");
    assert.equal(truthOf({ all: [thread("idle"), pull("green")] }, world), "false");
    assert.equal(truthOf({ all: [thread("idle"), { not: pull("green") }] }, world), "true");
    assert.equal(
      truthOf(
        { any: [thread("needs-input"), { all: [thread("idle"), pull("mergeable")] }] },
        world,
      ),
      "true",
    );
  });

  it("keeps what it has not seen unknown, so it never decides a wait", () => {
    const world = worldOf(10_000, [idle]);
    assert.equal(truthOf(thread("idle", "missing"), world), "unknown");
    assert.equal(truthOf({ not: thread("idle", "missing") }, world), "unknown");
    assert.equal(truthOf({ all: [thread("idle"), pull("green")] }, world), "unknown");
    // A branch that is known to hold still decides `any`, and one known not to decides `all`.
    assert.equal(truthOf({ any: [thread("idle"), pull("green")] }, world), "true");
    assert.equal(truthOf({ all: [thread("failed"), pull("green")] }, world), "false");
  });

  it("tells a run that ended from one with nothing left pending", () => {
    const paused = makeShell({ pendingBackgroundTasks: [monitorTask] });
    const watching = makeShell({
      pendingBackgroundTasks: [
        { kind: "monitor", taskId: "pull-request-watch:github.com/acme/repo#9" },
      ],
    });
    assert.equal(truthOf(thread("idle"), worldOf(10_000, [paused])), "true");
    assert.equal(truthOf(thread("finished"), worldOf(10_000, [paused])), "false");
    assert.equal(truthOf(thread("finished"), worldOf(10_000, [watching])), "true");
    assert.equal(truthOf(thread("idle"), worldOf(10_000, [running])), "false");
  });

  it("counts a thread's state only once it has held for a moment", () => {
    assert.equal(truthOf(thread("idle"), worldOf(2_000, [idle])), "false");
    assert.equal(truthOf(thread("idle"), worldOf(3_000, [idle])), "true");
  });

  it("splits a pending request into a question and an approval, and sees a failure", () => {
    const question = worldOf(10_000, [asking("user_input")]);
    const approval = worldOf(10_000, [asking("command")]);
    assert.equal(truthOf(thread("needs-input"), question), "true");
    assert.equal(truthOf(thread("needs-approval"), question), "false");
    assert.equal(truthOf(thread("needs-approval"), approval), "true");
    assert.equal(truthOf(thread("idle"), approval), "false");
    assert.equal(
      truthOf(thread("failed"), worldOf(10_000, [makeShell({ status: "failed" })])),
      "true",
    );
  });

  it("calls a thread stalled when the work it awaits outlasts its limit", () => {
    const awaiting = makeShell({
      pendingBackgroundTasks: [{ kind: "command", taskId: "task-9", awaited: true }],
    });
    const stalled: Condition = { thread: "thread-a", environment: "local", is: "stalled" };
    assert.equal(truthOf(stalled, worldOf(29 * 60_000, [awaiting])), "false");
    assert.equal(truthOf(stalled, worldOf(30 * 60_000, [awaiting])), "true");
    assert.equal(truthOf({ ...stalled, minutes: 5 }, worldOf(5 * 60_000, [awaiting])), "true");
    // Work nobody awaits, such as a dev server, is not a stall.
    assert.equal(
      truthOf(
        stalled,
        worldOf(60 * 60_000, [makeShell({ pendingBackgroundTasks: [monitorTask] })]),
      ),
      "false",
    );
  });

  it("sees a message, a comment and a head only when they are new", () => {
    const condition: Condition = { any: [thread("message"), pull("comment"), pull("new-head")] };
    const before = worldOf(1_000, [idle], [pr()]);
    const baselines = baselinesFor(condition, before);
    assert.equal(truthOf(condition, before, baselines), "false");

    const wrote = evaluate(thread("message"), worldOf(2_000, [idle], [], "message-2"), baselines);
    assert.equal(wrote.truth, "true");
    assert.include(wrote.leaves[0]?.detail ?? "", "wrote: Done.");
    assert.equal(
      truthOf(pull("comment"), commented([remark("alice", false, 500)]), baselines),
      "false",
    );
    assert.equal(
      truthOf(pull("comment"), commented([remark("github-actions", true, 4_000)]), baselines),
      "false",
    );
    assert.equal(
      truthOf(pull("comment"), commented([remark("alice", false, 4_000)]), baselines),
      "true",
    );
    assert.equal(
      truthOf(pull("new-head"), worldOf(5_000, [], [pr({ head: "bbbbbbbbbbbb" })]), baselines),
      "true",
    );
  });

  it("reads a pull request's checks and merge state on its head", () => {
    assert.equal(truthOf(pull("green"), of({})), "true");
    assert.equal(truthOf(pull("green"), of({ checks: 0 })), "false");
    assert.equal(truthOf(pull("checks-done"), of({ pending: ["build"] })), "false");
    assert.equal(truthOf(pull("checks-done"), of({ failing: ["lint"] })), "true");
    assert.equal(truthOf(pull("red"), of({ failing: ["lint"], pending: ["build"] })), "true");
    assert.equal(truthOf(pull("conflicting"), of({ mergeable: "conflicting" })), "true");
    assert.equal(truthOf(pull("ready"), of({ draft: true })), "false");
    assert.equal(truthOf(pull("draft"), of({ draft: true })), "true");
    assert.equal(truthOf(pull("merged"), of({ state: "merged" })), "true");
    assert.equal(truthOf(pull("ready"), of({ state: "merged" })), "false");
    assert.include(
      evaluate(pull("red"), of({ failing: ["lint"] }), none).leaves[0]?.detail ?? "",
      "failing lint on aaaaaaa",
    );
  });

  it("counts time from when the wait was made", () => {
    const after: Condition = { after: 30 };
    assert.equal(truthOf(after, worldOf(40_000, []), { ...none, sinceMs: 20_000 }), "false");
    assert.equal(truthOf(after, worldOf(50_000, []), { ...none, sinceMs: 20_000 }), "true");
  });
});

describe("conditions", () => {
  it("are described, and name what they read once", () => {
    const condition: Condition = {
      any: [thread("needs-input"), { all: [thread("idle"), pull("green")] }, { after: 60 }],
    };
    assert.equal(
      describeCondition(condition),
      "any(thread local/thread-a needs-input, all(thread local/thread-a idle, pr acme/repo#9 green), after 60s)",
    );
    assert.deepEqual(referencesOf(condition), {
      threads: [{ environment: "local", threadId: "thread-a" }],
      pullRequests: ["acme/repo#9"],
    });
  });

  it("take a pull request as owner/repo#number or as its URL", () => {
    assert.deepEqual(parsePullRequest("acme/repo#9"), { owner: "acme", name: "repo", number: 9 });
    assert.deepEqual(parsePullRequest("https://github.com/acme/repo/pull/9"), {
      owner: "acme",
      name: "repo",
      number: 9,
    });
    assert.isNull(parsePullRequest("#9"));
  });

  it("are summarized by what matched, or by everything when they timed out", () => {
    const world = worldOf(10_000, [idle], [pr({ pending: ["build"] })]);
    const { leaves } = evaluate({ any: [thread("idle"), pull("green")] }, world, none);
    assert.equal(summarize("matched", leaves), 'thread "Thread A" (local/thread-a) is idle: Done.');
    assert.include(summarize("timeout", leaves), "1 of 3 checks pending on aaaaaaa");
  });
});
