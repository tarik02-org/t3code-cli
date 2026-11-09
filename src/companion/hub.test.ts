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
import { idleCandidate, immediateEvents } from "./state.ts";
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

const busySubscriber = makeShell({
  id: ThreadId.make("orchestrator"),
  activityRunStatus: "running",
});
const idleSubscriber = makeShell({ id: ThreadId.make("orchestrator") });

const subscribeTo = (
  hub: CompanionHub["Service"],
  threadId: string,
  priorities: Record<string, "urgent" | "normal" | "low">,
) =>
  hub.subscribe({
    subscriber: orchestrator,
    source: { threadId },
    events: ["idle", "failed"],
    wake: true,
    priorities,
  });

const openIds = (hub: CompanionHub["Service"]) =>
  hub
    .listInbox({ subscriber: orchestrator, includeResolved: false, afterId: 0, limit: 10 })
    .pipe(Effect.map((rows) => rows.map((row) => row.id).toSorted((a, b) => a - b)));

/** The inbox ids a digest lists, as `- [id] …` lines. */
const digestIds = (input: SendThreadInput | undefined) =>
  [...(input?.message ?? "").matchAll(/^- \[(\d+)\]/gm)]
    .map((match) => Number(match[1]))
    .toSorted((a, b) => a - b);

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

  it.effect("holds a low item until the subscriber's turn ends", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", { idle: "low" });
        yield* hub.observe("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* hub.observe("local", idleSubscriber);
        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "auto");
      }),
    ),
  );

  it.effect("batches normal items from an active turn into one digest after it ends", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {});
        yield* subscribeTo(hub, "thread-b", {});
        yield* hub.observe("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        yield* hub.publish(idleEvent(makeShell({ id: ThreadId.make("thread-b") })));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* hub.observe("local", idleSubscriber);
        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "auto");
        assert.deepEqual(digestIds(sent[0]), yield* openIds(hub));
        assert.lengthOf(yield* openIds(hub), 2);
      }),
    ),
  );

  it.effect("steers an urgent item into the active turn with everything pending", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {});
        yield* subscribeTo(hub, "thread-b", {});
        yield* hub.observe("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        yield* hub.publish(idleEvent(makeShell({ id: ThreadId.make("thread-b") })));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        const [failed] = immediateEvents(
          "local",
          makeShell({ status: "failed", latestRunId: RunId.make("run-2") }),
        );
        assert.isDefined(failed);
        yield* hub.publish(failed);
        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "steer");
        assert.deepEqual(digestIds(sent[0]), yield* openIds(hub));
        assert.lengthOf(yield* openIds(hub), 3);

        // The turn ending afterwards sends nothing again.
        yield* hub.observe("local", idleSubscriber);
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);
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
