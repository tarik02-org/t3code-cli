import "vite-plus/test/config";

import { RunId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import type { SendThreadInput, T3Application } from "../application/service.ts";
import type { Orchestration } from "../orchestration/service.ts";
import type { AgentSender } from "./agent-sender.ts";
import { type CompanionEnvironment, CompanionEnvironments } from "./environments.ts";
import { CompanionAgentSendError } from "./error.ts";
import { CompanionHub, makeCompanionHub, wakeCoalesceWindow } from "./hub.ts";
import type { CompanionEventKind, ThreadEvent } from "./schema.ts";
import { idleCandidate, immediateEvents } from "./state.ts";
import { makePullRequest, makeShell } from "./state.test-utils.ts";
import { CompanionStore, makeCompanionStore } from "./store.ts";

const orchestrator = { environment: "local", threadId: "orchestrator" };

interface Fixture {
  readonly sent: Ref.Ref<ReadonlyArray<SendThreadInput>>;
  /** What the environment's shell snapshot returns, for subscribe's state read. */
  readonly shells: Ref.Ref<ReadonlyArray<OrchestrationV2ThreadShell>>;
  /** Turn items of each thread's bounded snapshot; others get two assistant messages. */
  readonly turnItems: Ref.Ref<Readonly<Record<string, ReadonlyArray<unknown>>>>;
  /** Digests sent agent-marked through the environment's MCP sender. */
  readonly agentSent: Ref.Ref<ReadonlyArray<{ readonly message: string; readonly mode: string }>>;
}

const defaultTurnItems = [
  { type: "assistant_message", text: "older message" },
  { type: "assistant_message", text: "final report" },
];

const makeFixture = (agent: "none" | "working" | "failing" = "none") =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<SendThreadInput>>([]);
    const shells = yield* Ref.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
    const turnItems = yield* Ref.make<Readonly<Record<string, ReadonlyArray<unknown>>>>({});
    const agentSent = yield* Ref.make<
      ReadonlyArray<{ readonly message: string; readonly mode: string }>
    >([]);
    const agentSender: AgentSender = {
      send: (input) =>
        agent === "failing"
          ? Effect.fail(
              new CompanionAgentSendError({ message: "refused", operation: "send", cause: null }),
            )
          : Ref.update(agentSent, (all) => [...all, { message: input.message, mode: input.mode }]),
    };
    const environment = fromPartial<CompanionEnvironment>({
      name: "local",
      aliases: [],
      url: "http://127.0.0.1:3774",
      agentSender:
        agent === "none" ? Option.none<AgentSender>() : Option.some<AgentSender>(agentSender),
      orchestration: fromPartial<Orchestration>({
        getShellSnapshot: () =>
          Ref.get(shells).pipe(Effect.map((threads) => fromPartial({ threads }))),
        getThreadBoundedSnapshot: (threadId: string) =>
          Ref.get(turnItems).pipe(
            Effect.map((all) =>
              fromPartial({ projection: { turnItems: all[threadId] ?? defaultTurnItems } }),
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
    const environments = CompanionEnvironments.of({
      all: Effect.succeed([environment]),
      changes: Stream.make([environment]),
      resolve: () => Effect.succeed(environment),
      statuses: Effect.succeed([]),
      reload: Effect.void,
    });
    return { sent, shells, turnItems, agentSent, environments } satisfies Fixture & {
      environments: unknown;
    };
  });

/** Builds the hub over an in-memory store and the fixture environment. */
const withHub = <A, E>(
  body: (hub: CompanionHub["Service"], fixture: Fixture) => Effect.Effect<A, E, CompanionStore>,
  agent: "none" | "working" | "failing" = "none",
) =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture(agent);
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
  events: ReadonlyArray<CompanionEventKind> = ["idle", "failed"],
) =>
  hub.subscribe({
    subscriber: orchestrator,
    source: { threadId },
    events,
    wake: true,
    priorities,
  });

const openQuery = { subscriber: orchestrator, includeResolved: false, afterId: 0, limit: 10 };

const openIds = (hub: CompanionHub["Service"]) =>
  hub
    .listInbox({ subscriber: orchestrator, includeResolved: false, afterId: 0, limit: 10 })
    .pipe(Effect.map((rows) => rows.map((row) => row.id).toSorted((a, b) => a - b)));

/** The inbox ids a digest lists, as `- [id] …` lines. */
const digestIds = (input: SendThreadInput | undefined) =>
  [...(input?.message ?? "").matchAll(/^- \[(\d+)\]/gm)]
    .map((match) => Number(match[1]))
    .toSorted((a, b) => a - b);

const withChecks = (checksState: "pending" | "passing" | "failing", headSha: string) =>
  makeShell({
    pullRequests: [
      makePullRequest({
        number: 9,
        isDraft: false,
        checksState,
        headSha,
        failedChecks: checksState === "failing" ? ["lint"] : [],
      }),
    ],
  });

const launched = (fixture: Fixture, threadId: string, sender: string) =>
  Ref.update(fixture.turnItems, (all) => ({
    ...all,
    [threadId]: [{ type: "user_message", senderThreadId: sender }],
  }));

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

  it.effect("carries the whole last message, up to the long cap", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        const report = `${"line of the final report\n".repeat(300)}end`;
        yield* Ref.set(fixture.turnItems, {
          "thread-a": [{ type: "assistant_message", text: report }],
        });
        yield* subscribeTo(hub, "thread-a", {});
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        const [item] = yield* hub.listInbox(openQuery);
        assert.equal(item?.event.lastMessage, report);
        assert.include((yield* Ref.get(fixture.sent))[0]?.message ?? "", "      end");
      }),
    ),
  );

  it.effect("drops an idle the source moved past, and refreshes PR states before sending", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {});
        yield* subscribeTo(hub, "thread-b", {});
        yield* hub.observe("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        const threadB = makeShell({
          id: ThreadId.make("thread-b"),
          pullRequests: [makePullRequest({ number: 7, isDraft: true, checksState: "pending" })],
        });
        yield* hub.publish(idleEvent(threadB));

        // Thread A starts its next run; thread B's PR checks finish.
        yield* hub.observe(
          "local",
          makeShell({ latestRunId: RunId.make("run-2"), activityRunStatus: "running" }),
        );
        yield* hub.observe(
          "local",
          makeShell({
            id: ThreadId.make("thread-b"),
            pullRequests: [makePullRequest({ number: 7, isDraft: true, checksState: "passing" })],
          }),
        );
        yield* hub.observe("local", idleSubscriber);
        yield* afterWindow;

        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.notInclude(sent[0]?.message ?? "", "thread-a");
        assert.include(sent[0]?.message ?? "", "checks pass");
        const all = yield* hub.listInbox({ ...openQuery, includeResolved: true });
        assert.deepEqual(
          all.map((row) => [
            row.event.threadId,
            row.disposition?.startsWith("auto: superseded") ?? false,
          ]),
          [
            ["thread-a", true],
            ["thread-b", false],
          ],
        );
        assert.equal(all[1]?.event.pullRequests[0]?.checks, "pass");
      }),
    ),
  );

  it.effect("reports a linked PR's checks finishing on its head, once per head", () =>
    withHub((hub) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {}, ["pr-checks"]);
        yield* hub.trackChecks("local", withChecks("pending", "aaaaaaaaaaaa"));
        yield* hub.trackChecks("local", withChecks("passing", "aaaaaaaaaaaa"));
        yield* hub.trackChecks("local", withChecks("passing", "aaaaaaaaaaaa"));
        yield* hub.trackChecks("local", withChecks("failing", "bbbbbbbbbbbb"));
        const rows = yield* hub.listInbox(openQuery);
        assert.deepEqual(
          rows.map((row) => row.event.summary),
          [
            "PR #9 checks finished on aaaaaaaaaa: pass",
            "PR #9 checks finished on bbbbbbbbbb: fail (failed jobs: lint)",
          ],
        );
      }),
    ),
  );

  it.effect("follows the subscriber's own new threads in a project", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        const { subscription } = yield* hub.subscribe({
          subscriber: orchestrator,
          source: { projectId: "project-1" },
          events: ["idle", "failed"],
          wake: true,
          priorities: { idle: "low" },
          follow: true,
        });
        yield* TestClock.adjust("1 second");
        yield* launched(fixture, "mine", "orchestrator");
        yield* launched(fixture, "theirs", "someone-else");
        const created = { completedAtMs: 1000 };
        yield* hub.discover("local", makeShell({ id: ThreadId.make("mine"), ...created }));
        yield* hub.discover("local", makeShell({ id: ThreadId.make("theirs"), ...created }));

        const all = yield* hub.listSubscriptions(orchestrator);
        const followed = all.filter((candidate) => candidate.id !== subscription.id);
        assert.deepEqual(
          followed.map((candidate) => [
            candidate.source.threadId,
            candidate.wake,
            candidate.priorities,
          ]),
          [["mine", true, { idle: "low" }]],
        );
        // The follow subscription itself takes no thread events.
        yield* hub.publish(idleEvent(makeShell({ id: ThreadId.make("theirs"), ...created })));
        assert.lengthOf(yield* hub.listInbox(openQuery), 0);
        yield* hub.publish(idleEvent(makeShell({ id: ThreadId.make("mine"), ...created })));
        assert.lengthOf(yield* hub.listInbox(openQuery), 1);
      }),
    ),
  );

  it.effect("resolves a settled with nothing new by itself", () =>
    withHub((hub) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {}, ["idle", "settled"]);
        const merged = [
          makePullRequest({ number: 3, isDraft: false, checksState: "passing", state: "merged" }),
        ];
        yield* hub.publish(idleEvent(makeShell({ pullRequests: merged })));
        const [settled] = immediateEvents(
          "local",
          makeShell({
            pullRequests: merged,
            settledOverride: "settled",
            settledAt: DateTime.makeUnsafe(0),
          }),
        );
        assert.isDefined(settled);
        yield* hub.publish(settled);
        const open = yield* hub.listInbox(openQuery);
        assert.deepEqual(
          open.map((row) => row.event.kind),
          ["idle"],
        );
        const all = yield* hub.listInbox({ ...openQuery, includeResolved: true });
        assert.include(all[1]?.disposition ?? "", "auto: nothing new");
      }),
    ),
  );

  it.effect("sends digests agent-marked through the MCP sender when the environment has one", () =>
    withHub(
      (hub, fixture) =>
        Effect.gen(function* () {
          yield* subscribeTo(hub, "thread-a", {});
          yield* hub.publish(idleEvent(makeShell()));
          yield* afterWindow;
          const agentSent = yield* Ref.get(fixture.agentSent);
          assert.lengthOf(agentSent, 1);
          assert.equal(agentSent[0]?.mode, "auto");
          assert.lengthOf(yield* Ref.get(fixture.sent), 0);
        }),
      "working",
    ),
  );

  it.effect("falls back to a plain send when the agent-marked send fails", () =>
    withHub(
      (hub, fixture) =>
        Effect.gen(function* () {
          yield* subscribeTo(hub, "thread-a", {});
          yield* hub.publish(idleEvent(makeShell()));
          yield* afterWindow;
          assert.lengthOf(yield* Ref.get(fixture.sent), 1);
        }),
      "failing",
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
