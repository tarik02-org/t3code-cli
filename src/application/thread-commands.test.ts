import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import {
  makeThreadInterruptCommand,
  makeThreadUnarchiveCommand,
} from "./thread-commands.ts";

describe("thread command builders", () => {
  it.layer(NodeServices.layer)("thread command builders", (t) => {
    t.effect("makeThreadInterruptCommand includes turnId when provided", () =>
      Effect.gen(function* () {
        const command = yield* makeThreadInterruptCommand({
          threadId: "thread-1",
          turnId: "turn-1",
        });
        assert.equal(command.type, "thread.turn.interrupt");
        assert.equal(command.threadId, "thread-1");
        assert.equal(command.turnId, "turn-1");
        assert.equal(typeof command.createdAt, "string");
      }),
    );

    t.effect("makeThreadInterruptCommand omits turnId when not provided", () =>
      Effect.gen(function* () {
        const command = yield* makeThreadInterruptCommand({
          threadId: "thread-1",
        });
        assert.equal(command.type, "thread.turn.interrupt");
        assert.equal(command.threadId, "thread-1");
        assert.equal("turnId" in command, false);
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
