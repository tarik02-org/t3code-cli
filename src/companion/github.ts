import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";

import { CompanionPullRequestError } from "./error.ts";
import type { PullRequestCheck, PullRequestRemark, PullRequestView } from "./schema.ts";

/** `owner/repo#123` from that form or from a pull request's URL; null for anything else. */
export function parsePullRequest(
  text: string,
): { owner: string; name: string; number: number } | null {
  const match =
    /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text.trim()) ??
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(text.trim());
  const [, owner, name, number] = match ?? [];
  return owner === undefined || name === undefined || number === undefined
    ? null
    : { owner, name, number: Number(number) };
}

/** Reads a pull request's current state from where it lives, for any repository. */
export class CompanionPullRequests extends Context.Service<
  CompanionPullRequests,
  {
    /** `pr` is `owner/repo#123`. */
    readonly read: (pr: string) => Effect.Effect<PullRequestView, CompanionPullRequestError>;
  }
>()("t3cli/companion/CompanionPullRequests") {}

const query = `query($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining }
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
          ... on CheckRun { name status conclusion url: detailsUrl }
          ... on StatusContext { context state url: targetUrl }
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
  url: Schema.optional(Schema.NullOr(Schema.String)),
});

const Response = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        rateLimit: Schema.optional(Schema.NullOr(Schema.Struct({ remaining: Schema.Int }))),
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

/**
 * How a finished check run ended badly. `CANCELLED` is absent on purpose: a concurrency group
 * cancels a job by design, and a cancelled job says nothing about the head. `STALE` and
 * `SKIPPED` say nothing either.
 */
const failed: ReadonlySet<string> = new Set([
  "FAILURE",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

const checkOutcome = (check: typeof CheckContext.Type): "pass" | "fail" | "pending" => {
  if (check.kind === "CheckRun") {
    return check.status !== "COMPLETED"
      ? "pending"
      : failed.has(check.conclusion ?? "")
        ? "fail"
        : "pass";
  }
  return check.state === "FAILURE" || check.state === "ERROR"
    ? "fail"
    : check.state === "PENDING" || check.state === "EXPECTED"
      ? "pending"
      : "pass";
};

const checkName = (check: typeof CheckContext.Type) => check.name ?? check.context ?? "unnamed";

/** A check name pattern as a test: case-insensitive, `*` standing for any run of characters. */
export const checkMatcher = (patterns: ReadonlyArray<string>) => {
  const tests = patterns.map(
    (pattern) =>
      new RegExp(
        `^${pattern
          .trim()
          .split("*")
          .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`))
          .join(".*")}$`,
        "i",
      ),
  );
  return (name: string) => tests.some((test) => test.test(name));
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

/**
 * `ignored` names checks that never count: the caller's repository runs them for their side
 * effect, and they fail or hang for reasons that are not the change's.
 */
export function toPullRequestView(
  pr: string,
  reply: Reply,
  options: {
    readonly ignored?: (name: string) => boolean;
    readonly rateLimitRemaining?: number | null;
  } = {},
): PullRequestView {
  const commit = reply.commits.nodes[0]?.commit;
  const all = commit?.statusCheckRollup?.contexts.nodes ?? [];
  const checks = all.filter((check) => options.ignored?.(checkName(check)) !== true);
  const failing: Array<PullRequestCheck> = checks
    .filter((check) => checkOutcome(check) === "fail")
    .map((check) => ({ name: checkName(check), url: check.url ?? null }));
  const pending = checks.filter((check) => checkOutcome(check) === "pending").map(checkName);
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
    checks: all.length + unstarted.length,
    failing,
    pending: [...pending, ...unstarted],
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
    rateLimitRemaining: options.rateLimitRemaining ?? null,
  };
}

/** Reads pull requests through the GitHub CLI, which already holds the user's sign-in. */
export const makeGitHubPullRequests = Effect.fn("makeGitHubPullRequests")(function* (
  ignoreChecks: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner;
  const ignored = checkMatcher(ignoreChecks);

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
    return toPullRequestView(`${parsed.owner}/${parsed.name}#${parsed.number}`, found, {
      ignored,
      rateLimitRemaining: reply?.data?.rateLimit?.remaining ?? null,
    });
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

export const GitHubPullRequestsLive = (ignoreChecks: ReadonlyArray<string>) =>
  Layer.effect(CompanionPullRequests, makeGitHubPullRequests(ignoreChecks));
