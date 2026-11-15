import "vite-plus/test/config";

import { RunId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import type { SendThreadInput, T3Application } from "../application/service.ts";
import type { Orchestration } from "../orchestration/service.ts";
import type { AgentSender } from "./agent-sender.ts";
import { type CompanionEnvironment, CompanionEnvironments } from "./environments.ts";
import { CompanionPullRequestError, type CompanionStoreError } from "./error.ts";
import { CompanionPullRequests } from "./github.ts";
import type { PullRequestView } from "./schema.ts";
import { makeShell } from "./state.test-utils.ts";
import { CompanionStore, makeCompanionStore } from "./store.ts";
import { type CompanionWaits, makeCompanionWaits } from "./waits.ts";

const owner = { environment: "local", threadId: "coordinator" };

const pullRequest = (overrides: Partial<PullRequestView> = {}): PullRequestView => ({
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

/** One environment, `local`, whose snapshot, pull requests and sent messages the test controls. */
const withCompanion = <A, E>(
  body: (fixture: {
    readonly sent: Ref.Ref<ReadonlyArray<SendThreadInput>>;
    /** What the environment's shell snapshot returns: the state the stream may not have sent. */
    readonly shells: Ref.Ref<ReadonlyArray<OrchestrationV2ThreadShell>>;
    readonly pullRequests: Ref.Ref<ReadonlyArray<PullRequestView>>;
    /** Every thread's last assistant message, which only the thread itself carries. */
    readonly message: Ref.Ref<{ readonly id: string; readonly text: string }>;
    /** Starts a daemon's waits over the same store; calling it again is a restart. */
    readonly start: () => Effect.Effect<
      CompanionWaits["Service"],
      CompanionStoreError,
      Scope.Scope
    >;
  }) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<SendThreadInput>>([]);
    const shells = yield* Ref.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
    const pullRequests = yield* Ref.make<ReadonlyArray<PullRequestView>>([]);
    const message = yield* Ref.make({ id: "message-1", text: "final report\nand its details" });
    const environment = fromPartial<CompanionEnvironment>({
      name: "local",
      aliases: [],
      url: "http://127.0.0.1:3774",
      agentSender: Option.none<AgentSender>(),
      orchestration: fromPartial<Orchestration>({
        getShellSnapshot: () =>
          Ref.get(shells).pipe(Effect.map((threads) => fromPartial({ threads }))),
        getThreadBoundedSnapshot: () =>
          Ref.get(message).pipe(
            Effect.map((last) =>
              fromPartial({
                projection: { turnItems: [{ type: "assistant_message", ...last }] },
              }),
            ),
          ),
      }),
      application: fromPartial<T3Application["Service"]>({
        sendThread: (input: SendThreadInput) =>
          Ref.update(sent, (all) => [...all, input]).pipe(
            Effect.as(fromPartial({ threadId: input.threadId })),
          ),
      }),
    });
    const store = yield* makeCompanionStore();
    const start = () =>
      makeCompanionWaits().pipe(
        Effect.provideService(CompanionStore, store),
        Effect.provideService(
          CompanionEnvironments,
          CompanionEnvironments.of({
            all: Effect.succeed([environment]),
            changes: Stream.make([environment]),
            resolve: () => Effect.succeed(environment),
            statuses: Effect.succeed([]),
            reload: Effect.void,
          }),
        ),
        Effect.provideService(
          CompanionPullRequests,
          CompanionPullRequests.of({
            read: (pr) =>
              Ref.get(pullRequests).pipe(
                Effect.flatMap((all) => {
                  const found = all.find((candidate) => candidate.pr === pr);
                  return found === undefined
                    ? Effect.fail(
                        new CompanionPullRequestError({ message: `no ${pr}`, pr, cause: null }),
                      )
                    : Effect.succeed(found);
                }),
              ),
          }),
        ),
      );
    return yield* body({ sent, shells, pullRequests, message, start });
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
  TestClock.adjust(duration).pipe(Effect.andThen(Effect.yieldNow));

const thread = (id: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  makeShell({ id: ThreadId.make(id), title: id, ...overrides });
const working = (id: string) => thread(id, { activityRunStatus: "running" });

describe("CompanionWaits", () => {
  it.effect("answers in the call when the condition already holds, with the payload", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* waits.ingest("local", thread("thread-a"));
        yield* advance("5 seconds");
        const made = yield* waits.create({
          owner,
          condition: { thread: "thread-a", is: "finished" },
          label: "report",
        });
        assert.equal(made.fired?.result.outcome, "matched");
        assert.equal(made.fired?.result.threads[0]?.lastMessage, "final report\nand its details");
        assert.equal(
          made.fired?.summary,
          'thread "thread-a" (local/thread-a) is idle: final report and its details',
        );

        // The call handed it over, so no wake follows and nothing stays pending.
        yield* advance("10 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);
        assert.lengthOf((yield* waits.list({ owner, collect: true })).pending, 0);
      }),
    ),
  );

  it.effect("fires a thread and a pull request combined once both sides hold", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* Ref.set(fixture.pullRequests, [pullRequest({ pending: ["build"] })]);
        yield* waits.ingest("local", working("thread-a"));
        const made = yield* waits.create({
          owner,
          condition: {
            any: [
              { thread: "thread-a", is: "needs-input" },
              {
                all: [
                  { thread: "thread-a", is: "idle" },
                  { pr: "https://github.com/acme/repo/pull/9", is: "green" },
                ],
              },
            ],
          },
        });
        assert.isNull(made.fired);
        assert.deepEqual(
          made.leaves.map((leaf) => leaf.state),
          ["false", "false", "false"],
        );

        // The thread goes idle, but the checks are still running.
        yield* waits.ingest("local", thread("thread-a"));
        yield* advance("10 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* Ref.set(fixture.pullRequests, [pullRequest()]);
        yield* advance("40 seconds");
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.include(sent[0]?.message ?? "", `- [${made.id}] matched:`);
        assert.include(sent[0]?.message ?? "", "is idle");
        assert.include(sent[0]?.message ?? "", "PR acme/repo#9 all 3 checks pass on aaaaaaa");
      }),
    ),
  );

  it.effect("fires on a new assistant message, which no shell row carries", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* waits.ingest("local", working("thread-a"));
        const made = yield* waits.create({
          owner,
          condition: { thread: "thread-a", is: "message" },
        });
        assert.deepEqual(
          made.leaves.map((leaf) => leaf.state),
          ["false"],
        );
        yield* advance("40 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        // The thread keeps running and says something; its row changes, its message is re-read.
        yield* Ref.set(fixture.message, { id: "message-2", text: "Halfway: the build passes." });
        yield* waits.ingest(
          "local",
          thread("thread-a", { activityRunStatus: "running", updatedAt: DateTime.makeUnsafe(1) }),
        );
        yield* advance("40 seconds");
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.include(sent[0]?.message ?? "", "wrote: Halfway: the build passes.");
      }),
    ),
  );

  it.effect("fires with timeout at the deadline, saying where things stood", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* waits.ingest("local", working("thread-a"));
        const made = yield* waits.create({
          owner,
          condition: { thread: "thread-a", is: "finished" },
          deadline: 60,
          label: "build",
        });
        yield* advance("55 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* advance("15 seconds");
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.include(sent[0]?.message ?? "", `- [${made.id}] "build" timed out:`);
        assert.include(sent[0]?.message ?? "", "is running");
        assert.equal((yield* waits.result({ owner, id: made.id })).result.outcome, "timeout");
      }),
    ),
  );

  it.effect("fires on a change the stream never delivered, from the re-read snapshot", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* waits.ingest("local", working("thread-a"));
        yield* waits.create({ owner, condition: { thread: "thread-a", is: "idle" } });

        // The thread finished, but no update for it ever arrives.
        yield* Ref.set(fixture.shells, [thread("thread-a")]);
        yield* advance("110 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);
        yield* advance("30 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);
      }),
    ),
  );

  it.effect("keeps a pending wait across a restart", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const before = yield* fixture.start();
        yield* before.ingest("local", working("thread-a"));
        const made = yield* before.create({
          owner,
          condition: { thread: "thread-a", is: "idle" },
          wake: "none",
        });

        const after = yield* fixture.start();
        yield* Effect.forkChild(after.run);
        assert.deepEqual(
          (yield* after.list({ owner, collect: false })).pending.map((wait) => wait.id),
          [made.id],
        );
        yield* after.ingest("local", thread("thread-a"));
        yield* advance("10 seconds");
        assert.deepEqual(
          (yield* after.list({ owner, collect: false })).fired.map((wait) => wait.id),
          [made.id],
        );
      }),
    ),
  );

  it.effect("holds a turn-end wake until the owner's turn ends, as one message", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* waits.ingest("local", working("coordinator"));
        yield* waits.ingest("local", working("thread-a"));
        yield* waits.ingest("local", working("thread-b"));
        const first = yield* waits.create({
          owner,
          condition: { thread: "thread-a", is: "idle" },
          label: "a",
        });
        const second = yield* waits.create({
          owner,
          condition: { thread: "thread-b", is: "idle" },
          label: "b",
        });
        yield* waits.ingest("local", thread("thread-a"));
        yield* advance("10 seconds");
        yield* waits.ingest("local", thread("thread-b"));
        yield* advance("10 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* waits.ingest("local", thread("coordinator"));
        yield* advance("5 seconds");
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "auto");
        assert.include(sent[0]?.message ?? "", "2 waits fired");
        assert.include(sent[0]?.message ?? "", `- [${first.id}] "a" matched:`);
        assert.include(sent[0]?.message ?? "", `- [${second.id}] "b" matched:`);
      }),
    ),
  );

  it.effect("steers into the owner's turn, and hands a silent wait over once", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* waits.ingest("local", working("coordinator"));
        yield* waits.ingest("local", working("thread-a"));
        const steering = yield* waits.create({
          owner,
          condition: { thread: "thread-a", is: "idle" },
          wake: "steer",
        });
        const silent = yield* waits.create({
          owner,
          condition: { thread: "thread-a", is: "idle" },
          wake: "none",
        });
        yield* waits.ingest("local", thread("thread-a"));
        yield* advance("10 seconds");

        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "steer");
        assert.include(sent[0]?.message ?? "", `- [${steering.id}] matched:`);
        assert.notInclude(sent[0]?.message ?? "", `- [${silent.id}]`);

        assert.deepEqual(
          (yield* waits.list({ owner, collect: true })).fired.map((wait) => wait.id),
          [silent.id],
        );
        assert.lengthOf((yield* waits.list({ owner, collect: true })).fired, 0);
      }),
    ),
  );

  it.effect("re-arms a repeating wait once its condition has been false", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* waits.ingest("local", working("thread-a"));
        yield* waits.create({
          owner,
          condition: { thread: "thread-a", is: "idle" },
          repeat: true,
        });
        yield* waits.ingest("local", thread("thread-a"));
        yield* advance("10 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);

        // Still idle: it does not fire again until the thread has run.
        yield* advance("60 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);
        yield* waits.ingest("local", working("thread-a"));
        yield* advance("5 seconds");
        yield* waits.ingest("local", thread("thread-a", { latestRunId: RunId.make("run-2") }));
        yield* advance("10 seconds");
        assert.lengthOf(yield* Ref.get(fixture.sent), 2);
        assert.lengthOf((yield* waits.list({ owner, collect: false })).pending, 1);
      }),
    ),
  );

  it.effect("blocks in a turn until the condition holds or the timeout passes", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        yield* Effect.forkChild(waits.run);
        yield* waits.ingest("local", working("thread-a"));
        const call = yield* Effect.forkChild(
          waits.now({ owner, condition: { thread: "thread-a", is: "idle" }, timeout: 120 }),
        );
        yield* advance("5 seconds");
        yield* waits.ingest("local", thread("thread-a"));
        yield* advance("10 seconds");
        assert.equal((yield* Fiber.join(call)).outcome, "matched");

        const late = yield* Effect.forkChild(
          waits.now({ owner, condition: { thread: "thread-a", is: "failed" }, timeout: 30 }),
        );
        yield* advance("40 seconds");
        assert.equal((yield* Fiber.join(late)).outcome, "timeout");
        // A blocking call leaves no wait behind and wakes nobody.
        assert.lengthOf((yield* waits.list({ collect: false })).pending, 0);
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);
      }),
    ),
  );

  it.effect("refuses a condition it cannot read, with the reason", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const waits = yield* fixture.start();
        const refused = (condition: unknown) =>
          waits.create({ owner, condition }).pipe(
            Effect.flip,
            Effect.map((error) => error.message),
          );
        assert.include(yield* refused({ thread: "missing", is: "idle" }), "is not known on local");
        assert.include(yield* refused({ any: [] }), "between 1 and");
        assert.include(yield* refused({ pr: "nope", is: "green" }), "is not a pull request");
        assert.include(yield* refused({ pr: "acme/repo#9", is: "green" }), "no acme/repo#9");
        assert.include(yield* refused({ thread: "thread-a", is: "asleep" }), "is not valid");
      }),
    ),
  );
});
