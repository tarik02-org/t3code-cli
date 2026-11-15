import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";

import { parsePullRequest } from "./condition.ts";
import { CompanionPullRequestError } from "./error.ts";
import type { PullRequestRemark, PullRequestView } from "./schema.ts";

/** Reads a pull request's current state from where it lives, for any repository. */
export class CompanionPullRequests extends Context.Service<
  CompanionPullRequests,
  {
    /** `pr` is `owner/repo#123`. */
    readonly read: (pr: string) => Effect.Effect<PullRequestView, CompanionPullRequestError>;
  }
>()("t3cli/companion/CompanionPullRequests") {}

const query = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url title state isDraft mergeable headRefOid
      commits(last: 1) { nodes { commit {
        checkSuites(first: 50) { nodes {
          status
          workflowRun { workflow { name } }
          checkRuns(first: 100) { nodes { status } }
        } }
        statusCheckRollup { contexts(first: 100) { nodes {
          kind: __typename
          ... on CheckRun { name status conclusion }
          ... on StatusContext { context state }
        } } }
      } } }
      comments(last: 30) { nodes { author { kind: __typename login } createdAt bodyText url } }
      reviews(last: 30) { nodes { author { kind: __typename login } submittedAt state bodyText url } }
    }
  }
}`;

const Actor = Schema.NullOr(Schema.Struct({ kind: Schema.String, login: Schema.String }));

const CheckContext = Schema.Struct({
  kind: Schema.String,
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  context: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
});

const Response = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequest: Schema.NullOr(
              Schema.Struct({
                url: Schema.String,
                title: Schema.String,
                state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
                isDraft: Schema.Boolean,
                mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
                headRefOid: Schema.String,
                commits: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.Struct({
                      commit: Schema.Struct({
                        checkSuites: Schema.Struct({
                          nodes: Schema.Array(
                            Schema.Struct({
                              status: Schema.String,
                              workflowRun: Schema.NullOr(
                                Schema.Struct({
                                  workflow: Schema.Struct({ name: Schema.String }),
                                }),
                              ),
                              checkRuns: Schema.Struct({
                                nodes: Schema.Array(Schema.Struct({ status: Schema.String })),
                              }),
                            }),
                          ),
                        }),
                        statusCheckRollup: Schema.NullOr(
                          Schema.Struct({
                            contexts: Schema.Struct({ nodes: Schema.Array(CheckContext) }),
                          }),
                        ),
                      }),
                    }),
                  ),
                }),
                comments: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.Struct({
                      author: Actor,
                      createdAt: Schema.String,
                      bodyText: Schema.String,
                      url: Schema.String,
                    }),
                  ),
                }),
                reviews: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.Struct({
                      author: Actor,
                      submittedAt: Schema.NullOr(Schema.String),
                      state: Schema.String,
                      bodyText: Schema.String,
                      url: Schema.String,
                    }),
                  ),
                }),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
});
const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(Response));

type Reply = NonNullable<
  NonNullable<NonNullable<(typeof Response.Type)["data"]>["repository"]>["pullRequest"]
>;

const passed: ReadonlySet<string> = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

const checkOutcome = (check: typeof CheckContext.Type): "pass" | "fail" | "pending" => {
  if (check.kind === "CheckRun") {
    return check.status !== "COMPLETED"
      ? "pending"
      : passed.has(check.conclusion ?? "")
        ? "pass"
        : "fail";
  }
  return check.state === "SUCCESS"
    ? "pass"
    : check.state === "PENDING" || check.state === "EXPECTED"
      ? "pending"
      : "fail";
};

const remarkBy = (
  author: typeof Actor.Type,
  at: string,
  text: string,
  url: string,
): PullRequestRemark => ({
  author: author?.login ?? "ghost",
  bot: author !== null && (author.kind === "Bot" || author.login.endsWith("[bot]")),
  at,
  excerpt: text.slice(0, 300),
  url,
});

export function toPullRequestView(pr: string, reply: Reply): PullRequestView {
  const commit = reply.commits.nodes[0]?.commit;
  const checks = commit?.statusCheckRollup?.contexts.nodes ?? [];
  const named = (outcome: "fail" | "pending") =>
    checks
      .filter((check) => checkOutcome(check) === outcome)
      .map((check) => check.name ?? check.context ?? "unnamed");
  // A workflow run registers a job as a check only when the job starts. A run that is still
  // going while every check it registered has finished therefore has checks yet to come, and
  // the head's checks are not done. Other apps' suites can stay queued forever with no checks.
  const unstarted = (commit?.checkSuites.nodes ?? []).flatMap((suite) =>
    suite.workflowRun !== null &&
    suite.status !== "COMPLETED" &&
    suite.checkRuns.nodes.every((run) => run.status === "COMPLETED")
      ? [`workflow ${suite.workflowRun.workflow.name} (jobs yet to start)`]
      : [],
  );
  return {
    pr,
    url: reply.url,
    title: reply.title,
    state: reply.state === "OPEN" ? "open" : reply.state === "MERGED" ? "merged" : "closed",
    draft: reply.isDraft,
    head: reply.headRefOid,
    checks: checks.length + unstarted.length,
    failing: named("fail"),
    pending: [...named("pending"), ...unstarted],
    mergeable:
      reply.mergeable === "MERGEABLE"
        ? "mergeable"
        : reply.mergeable === "CONFLICTING"
          ? "conflicting"
          : "unknown",
    remarks: [
      ...reply.comments.nodes.map((comment) =>
        remarkBy(comment.author, comment.createdAt, comment.bodyText, comment.url),
      ),
      ...reply.reviews.nodes.flatMap((review) =>
        review.submittedAt === null
          ? []
          : [
              remarkBy(
                review.author,
                review.submittedAt,
                review.bodyText.length > 0
                  ? review.bodyText
                  : `review: ${review.state.toLowerCase().replaceAll("_", " ")}`,
                review.url,
              ),
            ],
      ),
    ].toSorted((left, right) => left.at.localeCompare(right.at)),
  };
}

/** Reads pull requests through the GitHub CLI, which already holds the user's sign-in. */
export const makeGitHubPullRequests = Effect.fn("makeGitHubPullRequests")(function* () {
  const spawner = yield* ChildProcessSpawner;

  const read = Effect.fn("CompanionPullRequests.read")(function* (pr: string) {
    const parsed = parsePullRequest(pr);
    if (parsed === null) {
      return yield* new CompanionPullRequestError({
        message: `"${pr}" is not a pull request; write owner/repo#123`,
        pr,
        cause: null,
      });
    }
    const child = yield* spawner.spawn(
      ChildProcess.make("gh", [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${parsed.owner}`,
        "-F",
        `name=${parsed.name}`,
        "-F",
        `number=${parsed.number}`,
      ]),
    );
    const [output, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(child.all)), child.exitCode],
      { concurrency: "unbounded" },
    );
    const reply = Option.getOrNull(yield* decodeResponse(output).pipe(Effect.option));
    const found = reply?.data?.repository?.pullRequest ?? null;
    if (found === null) {
      const reason =
        reply === null
          ? `gh exited with code ${Number(exitCode)}: ${output.trim().slice(0, 300)}`
          : (reply.errors?.map((error) => error.message).join("; ") ?? "no such pull request");
      return yield* new CompanionPullRequestError({
        message: `could not read PR ${pr}: ${reason}`,
        pr,
        cause: null,
      });
    }
    return toPullRequestView(`${parsed.owner}/${parsed.name}#${parsed.number}`, found);
  }, Effect.scoped);

  return CompanionPullRequests.of({
    read: (pr) =>
      read(pr).pipe(
        Effect.timeout(Duration.seconds(30)),
        Effect.catchIf(
          (error) => !(error instanceof CompanionPullRequestError),
          (cause) =>
            Effect.fail(
              new CompanionPullRequestError({ message: `could not read PR ${pr}`, pr, cause }),
            ),
        ),
      ),
  });
});

export const GitHubPullRequestsLive = Layer.effect(CompanionPullRequests, makeGitHubPullRequests());
