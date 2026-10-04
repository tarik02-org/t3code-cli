import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import { makeMessageDispatchCommand, makeThreadUnarchiveCommand } from "./thread-commands.ts";

describe("thread command builders", () => {
  it.layer(NodeServices.layer)("thread command builders", (t) => {
    t.effect("makeMessageDispatchCommand lets the server pick delivery by default", () =>
      Effect.gen(function* () {
        const command = yield* makeMessageDispatchCommand({
          threadId: "thread-1",
          message: "hi",
          author: { kind: "user" },
        });
        assert.equal(command.type, "message.dispatch");
        assert.equal(command.threadId, "thread-1");
        assert.equal(command.deliveryIntent, "auto");
        assert.deepEqual(command.dispatchMode, { type: "start_immediately" });
      }),
    );

    t.effect("makeMessageDispatchCommand queues behind the active run", () =>
      Effect.gen(function* () {
        const command = yield* makeMessageDispatchCommand({
          threadId: "thread-1",
          message: "hi",
          mode: "queue",
          author: { kind: "user" },
        });
        assert.equal("deliveryIntent" in command, false);
        assert.deepEqual(command.dispatchMode, { type: "queue_after_active" });
      }),
    );

    t.effect("makeMessageDispatchCommand asks the server to steer the active run", () =>
      Effect.gen(function* () {
        const command = yield* makeMessageDispatchCommand({
          threadId: "thread-1",
          message: "hi",
          mode: "steer",
          author: { kind: "user" },
        });
        assert.equal(command.deliveryIntent, "steer");
        assert.deepEqual(command.dispatchMode, { type: "start_immediately" });
      }),
    );

    t.effect("makeMessageDispatchCommand attributes agent messages to their thread", () =>
      Effect.gen(function* () {
        const command = yield* makeMessageDispatchCommand({
          threadId: "thread-1",
          message: "hi",
          author: { kind: "agent", senderThreadId: "thread-0" },
        });
        assert.equal(command.createdBy, "agent");
        assert.equal(command.senderThreadId, "thread-0");
      }),
    );

    t.effect("makeThreadUnarchiveCommand builds thread.unarchive command", () =>
      Effect.gen(function* () {
        const command = yield* makeThreadUnarchiveCommand("thread-1");
        assert.equal(command.type, "thread.unarchive");
        assert.equal(command.threadId, "thread-1");
      }),
    );
  });
});
