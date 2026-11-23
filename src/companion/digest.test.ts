import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";

import { decideDelivery, digestLength, digestTag, formatDigest, longestHoldMs } from "./digest.ts";
import type { CompanionEvent } from "./schema.ts";

const caller = { environment: "local", threadId: "coordinator" };
const now = Date.parse("2026-01-01T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

const event = (id: number, overrides: Partial<CompanionEvent>): CompanionEvent => ({
  id,
  caller,
  subject: "thread:local/worker",
  kind: "done",
  key: "run-1",
  urgent: false,
  at: ago(60_000),
  state: "pending",
  payload: { title: "Worker", link: "<t3-thread://v2/env/worker>", summary: "its turn ended" },
  ...overrides,
});

const decide = (events: ReadonlyArray<Partial<CompanionEvent>>, callerInTurn: boolean) =>
  decideDelivery({
    events: events.map((overrides, index) => event(index, overrides)),
    callerInTurn,
    nowMs: now,
  });

describe("decideDelivery", () => {
  it("sends to an idle caller once the last event has aged a little", () => {
    assert.deepEqual(decide([{}], false), { action: "send", mode: "auto" });
    assert.deepEqual(decide([{ at: ago(1_000) }], false), { action: "wait" });
    // A stream of events does not put the digest off for good.
    assert.deepEqual(decide([{ at: ago(40_000) }, { at: ago(1_000) }], false), {
      action: "send",
      mode: "auto",
    });
  });

  it("holds for a caller in a turn, unless something is urgent or has waited too long", () => {
    assert.deepEqual(decide([{}], true), { action: "wait" });
    assert.deepEqual(decide([{}, { urgent: true }], true), { action: "send", mode: "steer" });
    assert.deepEqual(decide([{ at: ago(longestHoldMs) }], true), {
      action: "send",
      mode: "steer",
    });
  });

  it("has nothing to send without events", () => {
    assert.deepEqual(decide([], false), { action: "wait" });
  });
});

const longReport = (id: number) =>
  event(id, {
    subject: `thread:local/worker-${id}`,
    payload: {
      title: "Worker",
      link: null,
      summary: "its turn ended",
      lastMessage: "x".repeat(10_000),
    },
  });

describe("formatDigest", () => {
  it("groups events by object, the urgent object first, with links and the last message", () => {
    const text = formatDigest(7, caller, [
      event(1, {
        payload: {
          title: "Worker",
          link: "<t3-thread://v2/env/worker>",
          summary: "its turn ended (completed)",
          lastMessage: "All done.\nSee the PR.",
          pullRequests: [
            {
              pr: "acme/repo#9",
              url: "https://github.com/acme/repo/pull/9",
              state: "open",
              head: "aaaaaaaaaaaa",
            },
          ],
        },
      }),
      event(2, {
        subject: "pr:acme/repo#9",
        kind: "red",
        key: "aaaaaaaaaaaa",
        urgent: true,
        payload: {
          title: "A change",
          link: "https://github.com/acme/repo/pull/9",
          summary: "failing tests on aaaaaaa",
          failing: [{ name: "tests", url: "https://github.com/acme/repo/runs/1" }],
        },
      }),
      event(3, {
        subject: "pr:acme/repo#9",
        kind: "green",
        payload: {
          title: "A change",
          link: "https://github.com/acme/repo/pull/9",
          summary: "all 3 checks pass",
        },
      }),
    ]);
    assert.equal(
      text,
      [
        "t3 companion digest 7: 3 events on 2 objects.",
        "",
        'PR acme/repo#9 "A change" https://github.com/acme/repo/pull/9',
        "- RED [2]: failing tests on aaaaaaa",
        "  tests: https://github.com/acme/repo/runs/1",
        "- GREEN (for information) [3]: all 3 checks pass",
        "",
        'Thread "Worker" <t3-thread://v2/env/worker>',
        "- DONE [1]: its turn ended (completed)",
        "  Pull requests: https://github.com/acme/repo/pull/9 at aaaaaaa (open)",
        "  Its last message:",
        "  > All done.",
        "  > See the PR.",
        "",
        'An event\'s whole payload: events {"callerThreadId":"coordinator","callerEnvironment":"local","id":1}. What you watch: watching.',
      ].join("\n"),
    );
    assert.isTrue(text.startsWith(digestTag(7)));
  });

  it("cuts last messages so the digest stays within its length", () => {
    const text = formatDigest(1, caller, [1, 2, 3, 4, 5].map(longReport));
    assert.isAtMost(text.length, digestLength);
    assert.include(text, "of 10000 characters");
  });
});
