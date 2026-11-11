import "vite-plus/test/config";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { assert, describe, it } from "@effect/vitest";

import type { ThreadEvent } from "./schema.ts";
import { makeCompanionStore } from "./store.ts";

const subscriber = { environment: "local", threadId: "orchestrator" };
const source = { environment: "local", threadId: "thread-a", projectId: null };

const event = (eventId: string): ThreadEvent => ({
  eventId,
  kind: "idle",
  environment: "local",
  threadId: "thread-a",
  projectId: "project-1",
  title: "Thread A",
  occurredAt: "2026-01-01T00:00:00.000Z",
  summary: "run finished",
  pause: false,
  pendingTasks: [],
  lastMessage: "done",
  pullRequests: [],
});

const memoryDatabase = Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }));

describe("CompanionStore", () => {
  it.effect("keeps items open until resolved, with the disposition", () =>
    Effect.gen(function* () {
      const store = yield* makeCompanionStore();
      const subscription = yield* store.upsertSubscription({
        subscriber,
        source,
        events: ["idle"],
        wake: true,
        priorities: { idle: "low" },
        follow: false,
      });
      assert.deepEqual(subscription.priorities, { idle: "low" });
      const row = yield* store.deliver(subscription, event("e1"), "normal", false);
      assert.isNotNull(row);
      assert.equal(row.event.lastMessage, "done");
      assert.isNull(yield* store.deliver(subscription, event("e1"), "normal", false));

      const query = { subscriber, includeResolved: false, afterId: 0, limit: 10 };
      assert.lengthOf(yield* store.listInbox(query), 1);
      assert.equal(
        yield* store.resolve({ subscriber, ids: [row.id], disposition: "marked ready" }),
        1,
      );
      assert.lengthOf(yield* store.listInbox(query), 0);
      const [resolved] = yield* store.listInbox({ ...query, includeResolved: true });
      assert.equal(resolved?.disposition, "marked ready");
      assert.lengthOf(yield* store.pendingDigest(subscriber), 0);
    }).pipe(memoryDatabase),
  );

  it.effect("hides a snoozed item until redelivered, then announces it again at low", () =>
    Effect.gen(function* () {
      const store = yield* makeCompanionStore();
      const subscription = yield* store.upsertSubscription({
        subscriber,
        source,
        events: ["idle"],
        wake: true,
        priorities: {},
        follow: false,
      });
      const row = yield* store.deliver(subscription, event("e1"), "normal", true);
      assert.isNotNull(row);
      assert.lengthOf(yield* store.subscribersToWake(), 0);
      yield* store.markWoken([row.id]);
      yield* store.snooze({ subscriber, ids: [row.id], until: "2026-01-01T00:10:00.000Z" });

      const query = { subscriber, includeResolved: false, afterId: 0, limit: 10 };
      assert.lengthOf(yield* store.listInbox(query), 0);
      assert.lengthOf(yield* store.dueSnoozes("2026-01-01T00:05:00.000Z"), 0);
      assert.lengthOf(yield* store.dueSnoozes("2026-01-01T00:10:00.000Z"), 1);

      const back = yield* store.redeliver(row.id);
      assert.isNotNull(back);
      assert.equal(back.redelivered, 1);
      assert.equal(back.priority, "low");
      assert.isFalse(back.passive);
      assert.lengthOf(yield* store.listInbox(query), 1);
      assert.deepEqual(
        (yield* store.pendingDigest(subscriber)).map((pending) => pending.id),
        [row.id],
      );
      assert.deepEqual(yield* store.subscribersToWake(), [subscriber]);
    }).pipe(memoryDatabase),
  );

  it.effect("upgrades a version 4 inbox: wakes become passive, approvals keep arriving", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TABLE subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, subscriber_env TEXT NOT NULL,
          subscriber_thread TEXT NOT NULL, source_env TEXT NOT NULL, source_thread TEXT,
          source_project TEXT, events TEXT NOT NULL, wake INTEGER NOT NULL,
          priorities TEXT NOT NULL DEFAULT '{}', follow INTEGER NOT NULL DEFAULT 0,
          armed INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE TABLE inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT, subscription_id INTEGER NOT NULL,
          subscriber_env TEXT NOT NULL, subscriber_thread TEXT NOT NULL, event_id TEXT NOT NULL,
          kind TEXT NOT NULL, source_env TEXT NOT NULL, source_thread TEXT, event TEXT NOT NULL,
          priority TEXT NOT NULL, wake INTEGER NOT NULL, wakes INTEGER NOT NULL DEFAULT 1,
          delivered_at TEXT NOT NULL, woken_at TEXT, snoozed_until TEXT,
          redelivered INTEGER NOT NULL DEFAULT 0, resolved_at TEXT, disposition TEXT,
          UNIQUE (subscriber_env, subscriber_thread, event_id)
        )
      `;
      yield* sql`
        INSERT INTO subscriptions VALUES
          (1, 'local', 'orchestrator', 'local', 'thread-a', NULL, '["idle","needs-input"]', 1, '{}', 0, 0,
           '2026-01-01T00:00:00.000Z')
      `;
      const stored = JSON.stringify(event("e"));
      yield* sql`
        INSERT INTO inbox
          (id, subscription_id, subscriber_env, subscriber_thread, event_id, kind, source_env,
           source_thread, event, priority, wake, wakes, delivered_at)
        VALUES
          (7, 1, 'local', 'orchestrator', 'e-woke', 'idle', 'local', 'thread-a', ${stored},
           'normal', 1, 1, '2026-01-01T00:00:01.000Z'),
          (8, 1, 'local', 'orchestrator', 'e-rode', 'idle', 'local', 'thread-a', ${stored},
           'normal', 1, 0, '2026-01-01T00:00:02.000Z')
      `;
      yield* sql`PRAGMA user_version = 4`;

      const store = yield* makeCompanionStore();
      const [subscription] = yield* store.subscriptions;
      assert.isFalse(subscription?.armed);
      assert.deepEqual(subscription?.events, ["idle", "needs-input", "needs-approval"]);
      const rows = yield* store.pendingDigest(subscriber);
      assert.deepEqual(
        rows.map((row) => [row.id, row.passive]),
        [
          [7, false],
          [8, true],
        ],
      );
      // Opening it again finds it current.
      yield* makeCompanionStore();
      assert.lengthOf(yield* store.pendingDigest(subscriber), 2);
    }).pipe(memoryDatabase),
  );
});
