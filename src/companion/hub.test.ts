import "vite-plus/test/config";

import { RunId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import type { SendThreadInput, T3Application } from "../application/service.ts";
import type { Orchestration } from "../orchestration/service.ts";
import { type CompanionEnvironment, CompanionEnvironments } from "./environments.ts";
import { CompanionHub, makeCompanionHub, wakeCoalesceWindow } from "./hub.ts";
import type { ThreadEvent } from "./schema.ts";
import { idleCandidate } from "./state.ts";
import { makePullRequest, makeShell } from "./state.test-utils.ts";
import { CompanionStore, makeCompanionStore } from "./store.ts";

const orchestrator = { environment: "local", threadId: "orchestrator" };

interface Fixture {
  readonly sent: Ref.Ref<ReadonlyArray<SendThreadInput>>;
  /** What the environment's shell snapshot returns, for subscribe's state read. */
  readonly shells: Ref.Ref<ReadonlyArray<OrchestrationV2ThreadShell>>;
}

const makeFixture = Effect.gen(function* () {
  const sent = yield* Ref.make<ReadonlyArray<SendThreadInput>>([]);
  const shells = yield* Ref.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
  const environment = fromPartial<CompanionEnvironment>({
    name: "local",
    aliases: [],
    url: "http://127.0.0.1:3774",
    orchestration: fromPartial<Orchestration>({
      getShellSnapshot: () =>
        Ref.get(shells).pipe(Effect.map((threads) => fromPartial({ threads }))),
      getThreadBoundedSnapshot: () =>
        Effect.succeed(
          fromPartial({
            projection: {
              turnItems: [
                { type: "assistant_message", text: "older message" },
                { type: "assistant_message", text: "final report" },
              ],
            },
          }),
        ),
    }),
    application: fromPartial<T3Application["Service"]>({
      sendThread: (input: SendThreadInput) =>
        Ref.update(sent, (all) => [...all, input]).pipe(
          Effect.as(fromPartial({ threadId: input.threadId })),
        ),
    }),
  });
  const environments = CompanionEnvironments.of({
    all: Effect.succeed([environment]),
    changes: Stream.make([environment]),
    resolve: () => Effect.succeed(environment),
    statuses: Effect.succeed([]),
    reload: Effect.void,
  });
  return { sent, shells, environments } satisfies Fixture & { environments: unknown };
});

/** Builds the hub over an in-memory store and the fixture environment. */
const withHub = <A, E>(
  body: (hub: CompanionHub["Service"], fixture: Fixture) => Effect.Effect<A, E, CompanionStore>,
) =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture;
    const store = yield* makeCompanionStore();
    const hub = yield* makeCompanionHub().pipe(
      Effect.provideService(CompanionStore, store),
      Effect.provideService(CompanionEnvironments, fixture.environments),
    );
    return yield* body(hub, fixture).pipe(Effect.provideService(CompanionStore, store));
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

const afterWindow = TestClock.adjust(wakeCoalesceWindow).pipe(Effect.andThen(Effect.yieldNow));

const idleEvent = (shell: OrchestrationV2ThreadShell): ThreadEvent => {
  const candidate = idleCandidate("local", shell, 0);
  if (candidate === null) {
    throw new Error("fixture shell is not idle");
  }
  return candidate.event;
};

describe("CompanionHub", () => {
  it.effect("reports a source that failed before the subscription, and steers it in", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* Ref.set(fixture.shells, [makeShell({ status: "failed", lastError: "boom" })]);
        const result = yield* hub.subscribe({
          subscriber: orchestrator,
          source: { threadId: "thread-a" },
          events: ["idle", "failed"],
          wake: true,
          priorities: {},
        });
        assert.equal(result.source?.state, "failed");
        const [item] = yield* hub.listInbox({
          subscriber: orchestrator,
          includeResolved: false,
          afterId: 0,
          limit: 10,
        });
        assert.equal(item?.event.kind, "failed");
        assert.equal(item?.event.lastMessage, "final report");

        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "steer");
        assert.include(sent[0]?.message ?? "", "boom");
      }),
    ),
  );

  it.effect("queues a finished idle, and holds a low one until the subscriber's turn ends", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* hub.subscribe({
          subscriber: orchestrator,
          source: { threadId: "thread-a" },
          events: ["idle"],
          wake: true,
          priorities: { idle: "low" },
        });
        yield* hub.observe(
          "local",
          makeShell({ id: ThreadId.make("orchestrator"), activityRunStatus: "running" }),
        );
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* hub.observe("local", makeShell({ id: ThreadId.make("orchestrator") }));
        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "queue");
      }),
    ),
  );

  it.effect("brings a snoozed item back only once its source is idle", () =>
    withHub((hub) =>
      Effect.gen(function* () {
        yield* hub.subscribe({
          subscriber: orchestrator,
          source: { threadId: "thread-a" },
          events: ["idle"],
          wake: false,
          priorities: {},
        });
        yield* hub.publish(idleEvent(makeShell()));
        const open = { subscriber: orchestrator, includeResolved: false, afterId: 0, limit: 10 };
        const [item] = yield* hub.listInbox(open);
        assert.isDefined(item);
        yield* hub.snooze({ subscriber: orchestrator, ids: [item.id], minSeconds: 60 });
        assert.lengthOf(yield* hub.listInbox(open), 0);

        // The source works through the snooze and is still busy when the time is up.
        yield* hub.observe("local", makeShell({ activityRunStatus: "running" }));
        yield* TestClock.adjust("61 seconds");
        assert.lengthOf(yield* hub.listInbox(open), 0);

        yield* hub.observe("local", makeShell({ latestRunId: RunId.make("run-2") }));
        const [back] = yield* hub.listInbox(open);
        assert.equal(back?.id, item.id);
        assert.equal(back?.redelivered, 1);
        assert.equal(back?.priority, "low");

        assert.equal(
          yield* hub.resolve({ subscriber: orchestrator, ids: [item.id], disposition: "merged" }),
          1,
        );
        assert.lengthOf(yield* hub.listInbox(open), 0);
      }),
    ),
  );

  it.effect("lists subscribed threads with draft pull requests whose checks pass", () =>
    withHub((hub) =>
      Effect.gen(function* () {
        yield* hub.subscribe({
          subscriber: orchestrator,
          source: { threadId: "thread-a" },
          events: ["idle"],
          wake: false,
          priorities: {},
        });
        yield* hub.observe(
          "local",
          makeShell({
            pullRequests: [
              makePullRequest({ number: 1424, isDraft: true, checksState: "passing" }),
              makePullRequest({ number: 1426, isDraft: true, checksState: "pending" }),
            ],
          }),
        );
        const [work] = yield* hub.openWork(orchestrator);
        assert.equal(work?.threadId, "thread-a");
        assert.deepEqual(
          work?.readyToMark.map((pr) => pr.number),
          [1424],
        );
      }),
    ),
  );
});
