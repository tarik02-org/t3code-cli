import "vite-plus/test/config";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { assert, describe, it } from "@effect/vitest";

import type { ThreadEvent } from "./schema.ts";
import { makeCompanionStore } from "./store.ts";

const subscriber = { environment: "local", threadId: "orchestrator" };

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
      const subscription = yield* store.addSubscription({
        subscriber,
        source: { environment: "local", threadId: "thread-a", projectId: null },
        events: ["idle"],
        wake: true,
        priorities: { idle: "low" },
      });
      assert.deepEqual(subscription.priorities, { idle: "low" });
      const row = yield* store.deliver(subscription, event("e1"), "normal");
      assert.isNotNull(row);
      assert.equal(row.event.lastMessage, "done");
      assert.isNull(yield* store.deliver(subscription, event("e1"), "normal"));

      const query = { subscriber, includeResolved: false, afterId: 0, limit: 10 };
      assert.lengthOf(yield* store.listInbox(query), 1);
      assert.equal(
        yield* store.resolve({ subscriber, ids: [row.id], disposition: "marked ready" }),
        1,
      );
      assert.lengthOf(yield* store.listInbox(query), 0);
      const [resolved] = yield* store.listInbox({ ...query, includeResolved: true });
      assert.equal(resolved?.disposition, "marked ready");
      assert.lengthOf(yield* store.pendingWakes(), 0);
    }).pipe(memoryDatabase),
  );

  it.effect("hides a snoozed item until redelivered, then announces it again at low", () =>
    Effect.gen(function* () {
      const store = yield* makeCompanionStore();
      const subscription = yield* store.addSubscription({
        subscriber,
        source: { environment: "local", threadId: "thread-a", projectId: null },
        events: ["idle"],
        wake: true,
        priorities: {},
      });
      const row = yield* store.deliver(subscription, event("e1"), "normal");
      assert.isNotNull(row);
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
      assert.lengthOf(yield* store.listInbox(query), 1);
      assert.deepEqual(
        (yield* store.pendingWakes()).map((pending) => pending.id),
        [row.id],
      );
    }).pipe(memoryDatabase),
  );

  it.effect("migrates version 1 inboxes, turning acks into resolutions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TABLE subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, subscriber_env TEXT NOT NULL,
          subscriber_thread TEXT NOT NULL, source_env TEXT NOT NULL, source_thread TEXT,
          source_project TEXT, events TEXT NOT NULL, wake INTEGER NOT NULL, created_at TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE TABLE inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT, subscription_id INTEGER NOT NULL,
          subscriber_env TEXT NOT NULL, subscriber_thread TEXT NOT NULL, event_id TEXT NOT NULL,
          kind TEXT NOT NULL, source_env TEXT NOT NULL, source_thread TEXT, source_project TEXT,
          title TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL,
          wake INTEGER NOT NULL, delivered_at TEXT NOT NULL, woken_at TEXT, acked_at TEXT,
          UNIQUE (subscriber_env, subscriber_thread, event_id)
        )
      `;
      yield* sql`
        INSERT INTO subscriptions VALUES
          (1, 'local', 'orchestrator', 'local', 'thread-a', NULL, '["idle","failed"]', 1, '2026-01-01T00:00:00.000Z')
      `;
      yield* sql`
        INSERT INTO inbox VALUES
          (7, 1, 'local', 'orchestrator', 'e-old', 'failed', 'local', 'thread-a', 'project-1',
           'Thread A', '2026-01-01T00:00:00.000Z', 'run failed', 1, '2026-01-01T00:00:01.000Z',
           NULL, '2026-01-01T00:00:02.000Z'),
          (8, 1, 'local', 'orchestrator', 'e-new', 'idle', 'local', 'thread-a', 'project-1',
           'Thread A', '2026-01-01T00:00:03.000Z', 'run finished', 1, '2026-01-01T00:00:04.000Z',
           NULL, NULL)
      `;
      yield* sql`PRAGMA user_version = 1`;

      const store = yield* makeCompanionStore();
      const [subscription] = yield* store.listSubscriptions(null);
      assert.deepEqual(subscription?.priorities, {});
      const rows = yield* store.listInbox({
        subscriber,
        includeResolved: true,
        afterId: 0,
        limit: 10,
      });
      assert.deepEqual(
        rows.map((row) => [row.id, row.event.kind, row.priority, row.disposition]),
        [
          [7, "failed", "urgent", "acked"],
          [8, "idle", "normal", null],
        ],
      );
      assert.isFalse(rows[1]?.event.pause);
    }).pipe(memoryDatabase),
  );
});
