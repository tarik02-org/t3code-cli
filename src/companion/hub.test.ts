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
import { wakeCoalesceWindow } from "./digest.ts";
import { type CompanionEnvironment, CompanionEnvironments } from "./environments.ts";
import { CompanionAgentSendError } from "./error.ts";
import { CompanionHub, makeCompanionHub } from "./hub.ts";
import type { CompanionEventKind, ThreadEvent } from "./schema.ts";
import { idleCandidate, immediateEvents } from "./state.ts";
import { makePullRequest, makeShell, monitorTask } from "./state.test-utils.ts";
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
  return candidate;
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
        yield* hub.ingest("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* hub.ingest("local", idleSubscriber);
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
        yield* hub.ingest("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        yield* hub.publish(idleEvent(makeShell({ id: ThreadId.make("thread-b") })));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* hub.ingest("local", idleSubscriber);
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
        yield* hub.ingest("local", busySubscriber);
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
        yield* hub.ingest("local", idleSubscriber);
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
        yield* hub.ingest("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        const threadB = makeShell({
          id: ThreadId.make("thread-b"),
          pullRequests: [makePullRequest({ number: 7, isDraft: true, checksState: "pending" })],
        });
        yield* hub.publish(idleEvent(threadB));

        // Thread A starts its next run; thread B's PR checks finish.
        yield* hub.ingest(
          "local",
          makeShell({ latestRunId: RunId.make("run-2"), activityRunStatus: "running" }),
        );
        yield* hub.ingest(
          "local",
          makeShell({
            id: ThreadId.make("thread-b"),
            pullRequests: [makePullRequest({ number: 7, isDraft: true, checksState: "passing" })],
          }),
        );
        yield* hub.ingest("local", idleSubscriber);
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
        // The dropped idle never woke anyone, so its subscription is armed again.
        assert.deepEqual(
          (yield* hub.listSubscriptions({ subscriber: orchestrator })).map(
            (subscription) => subscription.armed,
          ),
          [true, false],
        );
      }),
    ),
  );

  it.effect("reports a linked PR's checks finishing on its head, once per head", () =>
    withHub((hub) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {}, ["pr-checks"]);
        yield* hub.ingest("local", withChecks("pending", "aaaaaaaaaaaa"));
        yield* hub.ingest("local", withChecks("passing", "aaaaaaaaaaaa"));
        yield* hub.ingest("local", withChecks("passing", "aaaaaaaaaaaa"));
        yield* hub.ingest("local", withChecks("failing", "bbbbbbbbbbbb"));
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
        yield* hub.ingest("local", makeShell({ id: ThreadId.make("mine"), ...created }));
        yield* hub.ingest("local", makeShell({ id: ThreadId.make("theirs"), ...created }));

        const all = yield* hub.listSubscriptions({ subscriber: orchestrator });
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

  it.effect("wakes a subscriber between turns even while its own delegates run", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {});
        yield* hub.ingest("local", busySubscriber);
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        // The turn ends with a delegated subagent still running in the subscriber.
        yield* hub.ingest(
          "local",
          makeShell({
            id: ThreadId.make("orchestrator"),
            pendingBackgroundTasks: [{ kind: "subagent", taskId: "delegate-1" }],
          }),
        );
        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 1);
        assert.equal(sent[0]?.mode, "auto");
      }),
    ),
  );

  it.effect("never wakes for a pause; the run's finished idle wakes and closes it", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* subscribeTo(hub, "thread-a", {});
        const waiting = makeShell({ pendingBackgroundTasks: [monitorTask] });
        yield* hub.publish(idleEvent(waiting));
        const second = makeShell({
          latestRunId: RunId.make("run-2"),
          pendingBackgroundTasks: [monitorTask],
          completedAtMs: 2000,
        });
        yield* hub.publish(idleEvent(second));
        const open = yield* hub.listInbox(openQuery);
        assert.deepEqual(
          open.map((row) => [row.event.pause, row.priority]),
          [
            [true, "low"],
            [true, "low"],
          ],
        );
        // Neither pause wakes or spends the arm, even when the subscriber's turn ends.
        yield* hub.ingest("local", busySubscriber);
        yield* hub.ingest("local", idleSubscriber);
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);
        const [subscription] = yield* hub.listSubscriptions({ subscriber: orchestrator });
        assert.isTrue(subscription?.armed);

        // Run 2's background work ends without a new run.
        yield* hub.publish(
          idleEvent(makeShell({ latestRunId: RunId.make("run-2"), completedAtMs: 2000 })),
        );
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);

        // A pause that reports something wakes like a finished idle, and spends the arm.
        yield* hub.arm({ subscriber: orchestrator, ids: [subscription?.id ?? 0] });
        yield* Ref.set(fixture.turnItems, {
          "thread-a": [
            { type: "assistant_message", text: "Draft PR is up: #12. Tests still run." },
          ],
        });
        yield* hub.publish(
          idleEvent(
            makeShell({
              latestRunId: RunId.make("run-3"),
              pendingBackgroundTasks: [monitorTask],
              completedAtMs: 3000,
            }),
          ),
        );
        yield* afterWindow;
        const reported = yield* Ref.get(fixture.sent);
        assert.lengthOf(reported, 2);
        assert.include(reported[1]?.message ?? "", "its last message names a pull request");
        const [spent] = yield* hub.listSubscriptions({ subscriber: orchestrator });
        assert.isFalse(spent?.armed);
        yield* hub.resolve({
          subscriber: orchestrator,
          ids: (yield* hub.listInbox(openQuery))
            .filter((row) => row.event.runId === "run-3")
            .map((row) => row.id),
          disposition: null,
        });
        const after = yield* hub.listInbox(openQuery);
        assert.deepEqual(
          after.map((row) => [row.event.runId, row.event.pause]),
          [
            ["run-1", true],
            ["run-2", false],
          ],
        );
      }),
    ),
  );

  it.effect("reports a wait that is overdue, and one that ends without a new run", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        yield* Effect.forkChild(hub.runChecks);
        yield* subscribeTo(hub, "thread-a", {}, ["idle", "stalled"]);
        const awaited = { kind: "command" as const, taskId: "task-9", awaited: true as const };
        yield* hub.ingest("local", makeShell({ pendingBackgroundTasks: [awaited] }));
        yield* TestClock.adjust("29 minutes");
        assert.lengthOf(yield* hub.listInbox(openQuery), 0);

        // Nothing came from the thread for half an hour: the wait is overdue.
        yield* TestClock.adjust("2 minutes");
        const [overdue] = yield* hub.listInbox(openQuery);
        assert.deepEqual(
          [overdue?.event.kind, overdue?.priority, overdue?.event.pause],
          ["stalled", "normal", true],
        );
        assert.include(overdue?.event.summary ?? "", "still waiting");

        // The work ends and T3 Code starts no run: after the grace this is urgent.
        yield* hub.ingest("local", makeShell());
        yield* TestClock.adjust("20 seconds");
        assert.lengthOf(yield* hub.listInbox(openQuery), 1);
        yield* TestClock.adjust("30 seconds");
        const stalled = (yield* hub.listInbox(openQuery))[1];
        assert.deepEqual([stalled?.event.kind, stalled?.priority], ["stalled", "urgent"]);
        assert.include(stalled?.event.summary ?? "", "started no new run");
        const sent = yield* Ref.get(fixture.sent);
        assert.equal(sent.at(-1)?.mode, "steer");
        // Neither spent the arm.
        const [subscription] = yield* hub.listSubscriptions({ subscriber: orchestrator });
        assert.isTrue(subscription?.armed);
      }),
    ),
  );

  it.effect("wakes once per arm; later events wait passively for the next digest", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        const { subscription } = yield* subscribeTo(hub, "thread-a", {});
        assert.isTrue(subscription.armed);
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);
        const [listed] = yield* hub.listSubscriptions({ subscriber: orchestrator });
        assert.isFalse(listed?.armed);

        // Disarmed: the next run's idle lands in the inbox without a wake, even at turn end.
        yield* hub.publish(idleEvent(makeShell({ latestRunId: RunId.make("run-2") })));
        yield* hub.ingest("local", busySubscriber);
        yield* hub.ingest("local", idleSubscriber);
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);
        assert.lengthOf(yield* hub.listInbox(openQuery), 2);

        // Another armed source's event carries the passive item along.
        yield* hub.ingest("local", makeShell({ latestRunId: RunId.make("run-2") }));
        yield* subscribeTo(hub, "thread-b", {});
        yield* hub.publish(
          idleEvent(makeShell({ id: ThreadId.make("thread-b"), completedAtMs: 60_000 })),
        );
        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 2);
        assert.include(sent[1]?.message ?? "", "thread-a");
        assert.include(sent[1]?.message ?? "", "thread-b");
        // The digest says what it disarmed, what was disarmed before, and how to re-arm both.
        const actions = (sent[1]?.message ?? "").split("Actions:")[1] ?? "";
        assert.include(actions, "This wake disarmed 1 subscription");
        assert.include(actions, '2 "thread-b" (local/thread-b)');
        assert.include(actions, '1 "Thread A" (local/thread-a), 1 passive item waiting');
        assert.include(
          actions,
          'arm {"callerThreadId":"orchestrator","callerEnvironment":"local","ids":[2,1]}',
        );
        assert.include(actions, "1 passive item:");
        assert.include(actions, '] idle "Thread A": run finished');
      }),
    ),
  );

  it.effect("re-arms by subscribing again or by id, without dropping or repeating items", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        const { subscription } = yield* subscribeTo(hub, "thread-a", {});
        yield* hub.publish(idleEvent(makeShell()));
        yield* afterWindow;
        yield* hub.publish(idleEvent(makeShell({ latestRunId: RunId.make("run-2") })));
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);

        const again = yield* subscribeTo(hub, "thread-a", {});
        assert.equal(again.subscription.id, subscription.id);
        assert.isTrue(again.subscription.armed);
        assert.lengthOf(yield* hub.listSubscriptions({ subscriber: orchestrator }), 1);
        assert.lengthOf(yield* hub.listInbox(openQuery), 2);

        yield* hub.publish(idleEvent(makeShell({ latestRunId: RunId.make("run-3") })));
        yield* afterWindow;
        const sent = yield* Ref.get(fixture.sent);
        assert.lengthOf(sent, 2);
        // The passive run-2 item rides along once; run-1 was already announced.
        assert.deepEqual(digestIds(sent[1]).length, 2);

        assert.equal(yield* hub.arm({ subscriber: orchestrator, ids: [subscription.id] }), 1);
        const [listed] = yield* hub.listSubscriptions({ subscriber: orchestrator });
        assert.isTrue(listed?.armed);
      }),
    ),
  );

  it.effect("always wakes for failures without spending the arm, never for environment drops", () =>
    withHub((hub, fixture) =>
      Effect.gen(function* () {
        const { subscription } = yield* subscribeTo(hub, "thread-a", {});
        yield* hub.publish({
          eventId: "local/env-down/0",
          kind: "env-down",
          environment: "local",
          threadId: null,
          projectId: null,
          title: "local",
          occurredAt: "9999-01-01T00:00:00.000Z",
          summary: "environment local unreachable",
          pause: false,
          pendingTasks: [],
          lastMessage: null,
          pullRequests: [],
        });
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 0);

        yield* hub.arm({ subscriber: orchestrator, ids: [subscription.id] });
        const [failed] = immediateEvents(
          "local",
          makeShell({ status: "failed", latestRunId: RunId.make("run-2") }),
        );
        assert.isDefined(failed);
        yield* hub.publish(failed);
        yield* afterWindow;
        assert.lengthOf(yield* Ref.get(fixture.sent), 1);
        const [listed] = yield* hub.listSubscriptions({ subscriber: orchestrator });
        assert.isTrue(listed?.armed);
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
        yield* hub.ingest("local", makeShell({ activityRunStatus: "running" }));
        yield* TestClock.adjust("61 seconds");
        assert.lengthOf(yield* hub.listInbox(open), 0);

        yield* hub.ingest("local", makeShell({ latestRunId: RunId.make("run-2") }));
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
        yield* hub.ingest(
          "local",
          makeShell({
            pullRequests: [
              makePullRequest({ number: 1424, isDraft: true, checksState: "passing" }),
              makePullRequest({ number: 1426, isDraft: true, checksState: "pending" }),
            ],
          }),
        );
        const [work] = yield* hub.openWork({ subscriber: orchestrator });
        assert.equal(work?.threadId, "thread-a");
        assert.deepEqual(
          work?.readyToMark.map((pr) => pr.number),
          [1424],
        );
      }),
    ),
  );
});
