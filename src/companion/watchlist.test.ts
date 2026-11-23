import "vite-plus/test/config";

import {
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
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
import {
  CompanionAgentSendError,
  CompanionPullRequestError,
  type CompanionStoreError,
} from "./error.ts";
import { CompanionPullRequests } from "./github.ts";
import type { ScannedItem } from "./scan.ts";
import type { PullRequestView } from "./schema.ts";
import { makeShell } from "./state.test-utils.ts";
import { CompanionStore, makeCompanionStore } from "./store.ts";
import { type CompanionWatchlist, makeCompanionWatchlist } from "./watchlist.ts";

const caller = { threadId: "coordinator" };

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
  rateLimitRemaining: null,
  ...overrides,
});

interface Fixture {
  /** Every message the companion sent, by either path. */
  readonly sent: Ref.Ref<ReadonlyArray<SendThreadInput & { readonly requestId?: string }>>;
  /** What the environment's shell snapshot returns: the state the stream may not have sent. */
  readonly shells: Ref.Ref<ReadonlyArray<OrchestrationV2ThreadShell>>;
  readonly pullRequests: Ref.Ref<ReadonlyArray<PullRequestView>>;
  /** The coordinator's transcript: the tool calls the companion reads its sends from. */
  readonly transcript: Ref.Ref<ReadonlyArray<ScannedItem>>;
  /** How the agent-marked send ends: `lost` fails after the message arrived. */
  readonly agentSend: Ref.Ref<"none" | "works" | "lost" | "refused">;
  /** Starts a daemon's watchlist over the same store; calling it again is a restart. */
  readonly start: () => Effect.Effect<
    CompanionWatchlist["Service"],
    CompanionStoreError,
    Scope.Scope
  >;
}

/** One environment, `local`, whose threads, pull requests and sent messages the test controls. */
const withCompanion = <A, E>(body: (fixture: Fixture) => Effect.Effect<A, E, Scope.Scope>) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<SendThreadInput & { readonly requestId?: string }>>(
      [],
    );
    const shells = yield* Ref.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
    const pullRequests = yield* Ref.make<ReadonlyArray<PullRequestView>>([]);
    const transcript = yield* Ref.make<ReadonlyArray<ScannedItem>>([]);
    const agentSend = yield* Ref.make<"none" | "works" | "lost" | "refused">("none");
    const record = (input: SendThreadInput & { readonly requestId?: string }) =>
      Ref.update(sent, (all) => [...all, input]);
    const sender: AgentSender = {
      send: (input) =>
        Ref.get(agentSend).pipe(
          Effect.flatMap((mode) =>
            mode === "refused"
              ? Effect.fail(
                  new CompanionAgentSendError({
                    message: "refused",
                    operation: "send",
                    refused: true,
                    cause: null,
                  }),
                )
              : record(input).pipe(
                  Effect.andThen(
                    mode === "lost"
                      ? Effect.fail(
                          new CompanionAgentSendError({
                            message: "connection dropped",
                            operation: "send",
                            refused: false,
                            cause: null,
                          }),
                        )
                      : Effect.void,
                  ),
                ),
          ),
        ),
    };
    const environment = (agentSender: Option.Option<AgentSender>) =>
      fromPartial<CompanionEnvironment>({
        name: "local",
        aliases: [],
        url: "http://127.0.0.1:3774",
        agentSender,
        orchestration: fromPartial<Orchestration>({
          getServerConfig: () =>
            Effect.succeed(fromPartial({ environment: { environmentId: "env-1" } })),
          getShellSnapshot: () =>
            Ref.get(shells).pipe(Effect.map((threads) => fromPartial({ threads }))),
          getThreadBoundedSnapshot: (threadId: string) =>
            Effect.all([Ref.get(transcript), Ref.get(sent)]).pipe(
              Effect.map(([items, messages]) =>
                fromPartial({
                  projection:
                    threadId === caller.threadId
                      ? {
                          turnItems: items,
                          messages: messages.map((message) => ({
                            role: "user",
                            text: message.message,
                            createdAt: DateTime.makeUnsafe(Date.now()),
                          })),
                        }
                      : {
                          turnItems: [{ type: "assistant_message", text: `report of ${threadId}` }],
                          messages: [],
                        },
                }),
              ),
            ),
        }),
        application: fromPartial<T3Application["Service"]>({
          sendThread: (input: SendThreadInput) =>
            record(input).pipe(Effect.as(fromPartial({ threadId: input.threadId }))),
        }),
      });
    const store = yield* makeCompanionStore();
    const start = () =>
      makeCompanionWatchlist().pipe(
        Effect.provideService(CompanionStore, store),
        Effect.provideService(
          CompanionEnvironments,
          CompanionEnvironments.of({
            all: Effect.succeed([]),
            changes: Stream.empty,
            resolve: () =>
              Ref.get(agentSend).pipe(
                Effect.map((mode) =>
                  environment(mode === "none" ? Option.none() : Option.some(sender)),
                ),
              ),
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
    return yield* body({ sent, shells, pullRequests, transcript, agentSend, start });
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
  TestClock.adjust(duration).pipe(Effect.andThen(Effect.yieldNow));

const thread = (id: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  makeShell({ id: ThreadId.make(id), title: id, ...overrides });
const working = (id: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  thread(id, { activityRunStatus: "running", ...overrides });
/** A thread whose run ended at `seconds` on the test clock. */
const finished = (id: string, seconds: number, run = "run-1") =>
  makeShell({
    id: ThreadId.make(id),
    title: id,
    latestRunId: RunId.make(run),
    completedAtMs: seconds * 1000,
  });

const sendTo = (ordinal: number, threadId: string, seconds: number): ScannedItem => ({
  type: "dynamic_tool",
  ordinal,
  status: "completed",
  startedAt: DateTime.makeUnsafe(seconds * 1000),
  toolName: "mcp__agx-t3__t3_thread_send",
  input: { threadId },
});

/**
 * A running watchlist whose coordinator has written to `worker` at second 1, and whose
 * transcript has been read: the worker is watched.
 */
const coordinating = (fixture: Fixture, coordinator = thread("coordinator")) =>
  Effect.gen(function* () {
    const watchlist = yield* fixture.start();
    const running = yield* Effect.forkScoped(watchlist.run);
    yield* watchlist.ingest("local", coordinator);
    yield* watchlist.ingest("local", working("worker"));
    yield* watchlist.watch({ caller });
    yield* Ref.set(fixture.transcript, [sendTo(1, "worker", 1)]);
    yield* watchlist.ingest("local", { ...coordinator, itemCount: 1 });
    yield* advance("3 seconds");
    return Object.assign(watchlist, { stop: Fiber.interrupt(running) });
  });

const texts = (fixture: Fixture) =>
  Ref.get(fixture.sent).pipe(Effect.map((all) => all.map((message) => message.message)));

describe("CompanionWatchlist", () => {
  it.effect("watches what the caller wrote to and reports its turn end once", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const watchlist = yield* coordinating(fixture);
        const [mine] = yield* watchlist.watching({ caller });
        assert.deepEqual(
          mine?.threads.map((watch) => `${watch.subject} ${watch.origin}`),
          ["thread:local/worker sent"],
        );
        assert.deepEqual(yield* texts(fixture), []);

        yield* watchlist.ingest("local", finished("worker", 10));
        yield* advance("12 seconds");
        const sent = yield* Ref.get(fixture.sent);
        assert.equal(sent.length, 1);
        assert.equal(sent[0]?.threadId, "coordinator");
        assert.equal(sent[0]?.mode, "auto");
        assert.include(sent[0]?.message, "t3 companion digest 1: 1 event on 1 object.");
        assert.include(sent[0]?.message, 'Thread "worker" <t3-thread://v2/env-1/worker>');
        assert.include(sent[0]?.message, "- DONE [1]: its turn ended (completed)");
        assert.include(sent[0]?.message, "> report of worker");

        // The same row again, a snapshot re-read and a restart report nothing more.
        yield* Ref.set(fixture.shells, [thread("coordinator"), finished("worker", 10)]);
        yield* watchlist.ingest("local", finished("worker", 10));
        yield* advance("5 minutes");
        yield* watchlist.stop;
        const restarted = yield* fixture.start();
        yield* Effect.forkScoped(restarted.run);
        yield* restarted.ingest("local", thread("coordinator"));
        yield* restarted.ingest("local", finished("worker", 10));
        yield* advance("1 minute");
        assert.equal((yield* Ref.get(fixture.sent)).length, 1);

        // Its next run is a new transition.
        yield* restarted.ingest("local", finished("worker", 400, "run-2"));
        yield* advance("20 seconds");
        assert.equal((yield* Ref.get(fixture.sent)).length, 2);
      }),
    ),
  );

  it.effect("does not report what happened before the caller wrote", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const watchlist = yield* fixture.start();
        yield* Effect.forkScoped(watchlist.run);
        yield* watchlist.ingest("local", thread("coordinator"));
        // Its run ended at second 0; the caller writes at second 1 and nothing starts.
        yield* watchlist.ingest("local", finished("worker", 0));
        yield* watchlist.watch({ caller });
        yield* Ref.set(fixture.transcript, [sendTo(1, "worker", 1)]);
        yield* watchlist.ingest("local", thread("coordinator", { itemCount: 1 }));
        yield* advance("1 minute");
        assert.deepEqual(yield* texts(fixture), []);
      }),
    ),
  );

  it.effect("drops an event that stopped being true before it was sent", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const busy = working("coordinator");
        const watchlist = yield* coordinating(fixture, busy);
        yield* watchlist.ingest("local", finished("worker", 10));
        yield* advance("12 seconds");
        // Held: the coordinator is in a turn. Meanwhile the worker starts another run.
        assert.deepEqual(yield* texts(fixture), []);
        assert.equal((yield* watchlist.watching({ caller }))[0]?.pending.length, 1);
        yield* watchlist.ingest("local", working("worker", { latestRunId: RunId.make("run-2") }));
        yield* watchlist.ingest("local", thread("coordinator", { itemCount: 1 }));
        yield* advance("1 minute");
        assert.deepEqual(yield* texts(fixture), []);
        assert.equal((yield* watchlist.watching({ caller }))[0]?.pending.length, 0);
      }),
    ),
  );

  it.effect("releases a held digest when only a snapshot re-read shows the turn ended", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const busy = working("coordinator", { itemCount: 1 });
        const watchlist = yield* coordinating(fixture, busy);
        yield* watchlist.ingest("local", finished("worker", 10));
        yield* advance("1 minute");
        assert.deepEqual(yield* texts(fixture), []);
        // The stream never says the coordinator's turn ended; the snapshot does.
        yield* Ref.set(fixture.shells, [
          thread("coordinator", { itemCount: 1 }),
          finished("worker", 10),
        ]);
        yield* advance("2 minutes");
        assert.equal((yield* Ref.get(fixture.sent)).length, 1);
      }),
    ),
  );

  it.effect("releases a held digest when a queued message's grace runs out", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        // A message was sent to the coordinator at second 0 and no run ever picked it up.
        const queued = thread("coordinator", {
          itemCount: 1,
          latestRunId: null,
          status: "idle",
          latestUserMessageAt: DateTime.makeUnsafe(0),
        });
        const watchlist = yield* coordinating(fixture, queued);
        yield* watchlist.ingest("local", finished("worker", 10));
        yield* advance("1 minute");
        assert.deepEqual(yield* texts(fixture), []);
        yield* advance("90 seconds");
        assert.equal((yield* Ref.get(fixture.sent)).length, 1);
      }),
    ),
  );

  it.effect("steers a thread that asks into the caller's running turn", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const watchlist = yield* coordinating(fixture, working("coordinator"));
        yield* watchlist.ingest(
          "local",
          working("worker", {
            pendingRuntimeRequest: fromPartial({
              id: RuntimeRequestId.make("request-1"),
              kind: "user_input",
              createdAt: DateTime.makeUnsafe(5_000),
            }),
          }),
        );
        yield* advance("25 seconds");
        const sent = yield* Ref.get(fixture.sent);
        assert.equal(sent.length, 1);
        assert.equal(sent[0]?.mode, "steer");
        assert.include(sent[0]?.message, "- ASKS [1]: asks a question");
      }),
    ),
  );

  it.effect("does not send a digest twice when the send's outcome is unknown", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        yield* Ref.set(fixture.agentSend, "lost");
        const watchlist = yield* coordinating(fixture);
        yield* watchlist.ingest("local", finished("worker", 10));
        yield* advance("5 minutes");
        // It arrived although the send failed: the read-back finds it, and nothing is resent.
        assert.equal((yield* Ref.get(fixture.sent)).length, 1);
        assert.equal((yield* watchlist.watching({ caller }))[0]?.pending.length, 0);
      }),
    ),
  );

  it.effect("falls back to a plain send when T3 Code refuses the agent-marked one", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        yield* Ref.set(fixture.agentSend, "refused");
        const watchlist = yield* coordinating(fixture);
        yield* watchlist.ingest("local", finished("worker", 10));
        yield* advance("1 minute");
        const sent = yield* Ref.get(fixture.sent);
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0]?.author, { kind: "agent" });
      }),
    ),
  );

  it.effect("watches a linked pull request: red once per head, merged ends it", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const watchlist = yield* coordinating(fixture);
        const failing = [{ name: "tests", url: "https://github.com/acme/repo/runs/1" }];
        yield* Ref.set(fixture.pullRequests, [pullRequest({ failing })]);
        yield* watchlist.ingest(
          "local",
          working("worker", {
            pullRequests: [
              fromPartial({
                url: "https://github.com/acme/repo/pull/9",
                source: "agent",
                linkedAt: "2026-01-01T00:00:00.000Z",
                snapshot: null,
              }),
            ],
          }),
        );
        yield* advance("20 seconds");
        const first = yield* texts(fixture);
        assert.equal(first.length, 1);
        assert.include(first[0], 'PR acme/repo#9 "A change" https://github.com/acme/repo/pull/9');
        assert.include(first[0], "- RED [1]: failing tests on aaaaaaa");

        // Many reads of the same head later, nothing more.
        yield* advance("10 minutes");
        assert.equal((yield* texts(fixture)).length, 1);

        yield* Ref.set(fixture.pullRequests, [pullRequest({ state: "merged", failing })]);
        yield* advance("3 minutes");
        const second = yield* texts(fixture);
        assert.equal(second.length, 2);
        assert.include(second[1], "- MERGED [2]: was merged");
        assert.deepEqual((yield* watchlist.watching({ caller }))[0]?.pullRequests, []);
        yield* advance("10 minutes");
        assert.equal((yield* texts(fixture)).length, 2);
      }),
    ),
  );

  it.effect("an explicit watch answers with the present and reports only what follows", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const watchlist = yield* fixture.start();
        yield* Effect.forkScoped(watchlist.run);
        yield* watchlist.ingest("local", thread("coordinator"));
        const failing = [{ name: "tests", url: null }];
        yield* Ref.set(fixture.pullRequests, [pullRequest({ failing })]);
        const made = yield* watchlist.watch({ caller, pr: "https://github.com/acme/repo/pull/9" });
        assert.equal(made.watch?.state, "open at aaaaaaa: failing tests; mergeable");
        yield* advance("5 minutes");
        assert.deepEqual(yield* texts(fixture), []);

        yield* Ref.set(fixture.pullRequests, [pullRequest({ failing, head: "bbbbbbbbbbbb" })]);
        yield* advance("3 minutes");
        assert.equal((yield* texts(fixture)).length, 1);

        assert.equal(yield* watchlist.unwatch({ caller, pr: "acme/repo#9" }), 1);
        yield* Ref.set(fixture.pullRequests, [pullRequest({ failing, head: "cccccccccccc" })]);
        yield* advance("5 minutes");
        assert.equal((yield* texts(fixture)).length, 1);
      }),
    ),
  );

  it.effect("sends a reminder when it is due, and hands events over on request", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const watchlist = yield* fixture.start();
        yield* Effect.forkScoped(watchlist.run);
        yield* watchlist.ingest("local", thread("coordinator"));
        yield* watchlist.remind({ caller, in: 60, text: "look at the nightly" });
        const taken = yield* watchlist.remind({ caller, in: 30, text: "taken by hand" });
        yield* advance("31 seconds");
        const handed = yield* watchlist.events({ caller });
        assert.deepEqual(
          handed.map((event) => event.payload.title),
          ["taken by hand"],
        );
        assert.equal(handed[0]?.subject, `reminder:${taken.id}`);
        yield* advance("1 minute");
        const sent = yield* texts(fixture);
        assert.equal(sent.length, 1);
        assert.include(sent[0], 'Reminder "look at the nightly"');
        assert.notInclude(sent[0], "taken by hand");
      }),
    ),
  );

  it.effect("ends a watch when its thread is archived, and forgets an archived caller", () =>
    withCompanion((fixture) =>
      Effect.gen(function* () {
        const watchlist = yield* coordinating(fixture);
        yield* watchlist.ingest(
          "local",
          thread("worker", { archivedAt: DateTime.makeUnsafe(20_000) }),
        );
        assert.deepEqual((yield* watchlist.watching({}))[0]?.threads, []);
        yield* watchlist.ingest(
          "local",
          thread("coordinator", { archivedAt: DateTime.makeUnsafe(20_000) }),
        );
        assert.deepEqual(yield* watchlist.watching({}), []);
        yield* advance("1 minute");
        assert.deepEqual(yield* texts(fixture), []);
      }),
    ),
  );
});
