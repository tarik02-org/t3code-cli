import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import { checkMatcher, parsePullRequest, toPullRequestView } from "./github.ts";

type Reply = Parameters<typeof toPullRequestView>[1];
type Commit = Reply["commits"]["nodes"][number]["commit"];
type Suite = Commit["checkSuites"]["nodes"][number];
type Check = NonNullable<Commit["statusCheckRollup"]>["contexts"]["nodes"][number];

const run = (name: string, conclusion: string | null): Check => ({
  kind: "CheckRun",
  name,
  status: conclusion === null ? "IN_PROGRESS" : "COMPLETED",
  conclusion,
  url: `https://github.com/acme/repo/runs/${name}`,
});

const replyWith = (suites: ReadonlyArray<Suite>, checks: ReadonlyArray<Check>): Reply =>
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
            statusCheckRollup: { contexts: { nodes: checks } },
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
  checkRuns: { nodes: runs.map((state) => ({ status: state })) },
});

describe("toPullRequestView", () => {
  it("keeps checks pending while a workflow run still has jobs to start", () => {
    const passed = [run("targets", "SUCCESS")];
    const early = toPullRequestView(
      "acme/repo#9",
      replyWith(
        [suite("COMPLETED", "Summary", ["COMPLETED"]), suite("QUEUED", "Tests", [])],
        passed,
      ),
    );
    assert.deepEqual(early.pending, ["workflow Tests (jobs yet to start)"]);
    assert.equal(early.checks, 2);

    // Another app's suite that never reports stays queued for good and says nothing.
    const done = toPullRequestView(
      "acme/repo#9",
      replyWith([suite("COMPLETED", "Summary", ["COMPLETED"]), suite("QUEUED", null, [])], passed),
    );
    assert.deepEqual(done.pending, []);
    assert.equal(done.checks, 1);
  });

  it("counts a real failure, not a cancelled, skipped or stale job", () => {
    const view = toPullRequestView(
      "acme/repo#9",
      replyWith(
        [],
        [
          run("comment", "CANCELLED"),
          run("docs", "SKIPPED"),
          run("old", "STALE"),
          run("tests", "FAILURE"),
          run("build", "TIMED_OUT"),
          { kind: "StatusContext", context: "deploy", state: "ERROR", url: null },
          run("lint", null),
        ],
      ),
    );
    assert.deepEqual(
      view.failing.map((check) => check.name),
      ["tests", "build", "deploy"],
    );
    assert.equal(view.failing[0]?.url, "https://github.com/acme/repo/runs/tests");
    assert.deepEqual(view.pending, ["lint"]);
  });

  it("leaves ignored checks out, failing or pending", () => {
    const view = toPullRequestView(
      "acme/repo#9",
      replyWith([], [run("comment", "FAILURE"), run("Preview / deploy", null)]),
      { ignored: checkMatcher(["COMMENT", "preview*"]) },
    );
    assert.deepEqual(view.failing, []);
    assert.deepEqual(view.pending, []);
    assert.equal(view.checks, 2);
  });
});

describe("parsePullRequest", () => {
  it("reads owner/repo#123 and a pull request's URL", () => {
    const expected = { owner: "acme", name: "repo", number: 9 };
    assert.deepEqual(parsePullRequest("acme/repo#9"), expected);
    assert.deepEqual(parsePullRequest("https://github.com/acme/repo/pull/9/files"), expected);
    assert.isNull(parsePullRequest("https://github.com/acme/repo/issues/9"));
  });
});
