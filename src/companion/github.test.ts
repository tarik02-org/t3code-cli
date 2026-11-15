import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import { toPullRequestView } from "./github.ts";

type Reply = Parameters<typeof toPullRequestView>[1];
type Suite = Reply["commits"]["nodes"][number]["commit"]["checkSuites"]["nodes"][number];

const passedRun = { kind: "CheckRun", name: "targets", status: "COMPLETED", conclusion: "SUCCESS" };
const replyWith = (suites: ReadonlyArray<Suite>): Reply =>
  fromPartial({
    url: "https://github.com/acme/repo/pull/9",
    title: "A change",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    headRefOid: "aaaaaaaaaaaa",
    commits: {
      nodes: [
        {
          commit: {
            checkSuites: { nodes: suites },
            statusCheckRollup: { contexts: { nodes: [passedRun] } },
          },
        },
      ],
    },
    comments: { nodes: [] },
    reviews: { nodes: [] },
  });

const suite = (status: string, workflow: string | null, runs: ReadonlyArray<string>): Suite => ({
  status,
  workflowRun: workflow === null ? null : { workflow: { name: workflow } },
  checkRuns: { nodes: runs.map((run) => ({ status: run })) },
});

describe("toPullRequestView", () => {
  it("keeps checks pending while a workflow run still has jobs to start", () => {
    const early = toPullRequestView(
      "acme/repo#9",
      replyWith([suite("COMPLETED", "Summary", ["COMPLETED"]), suite("QUEUED", "Tests", [])]),
    );
    assert.deepEqual(early.pending, ["workflow Tests (jobs yet to start)"]);
    assert.equal(early.checks, 2);

    // Another app's suite that never reports stays queued for good and says nothing.
    const done = toPullRequestView(
      "acme/repo#9",
      replyWith([suite("COMPLETED", "Summary", ["COMPLETED"]), suite("QUEUED", null, [])]),
    );
    assert.deepEqual(done.pending, []);
    assert.equal(done.checks, 1);
  });
});
