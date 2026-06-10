import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type { ClientOrchestrationCommand, OrchestrationThread } from "#t3tools/contracts";

import { NodeEnvironmentLive } from "../environment/layer.ts";
import { T3Orchestration, type Orchestration } from "../orchestration/service.ts";
import { makeThreadApplication } from "./threads.ts";

function makeOrchestrationLayer(input: {
  readonly snapshot: OrchestrationThread;
  readonly onDispatch?: (command: ClientOrchestrationCommand) => void;
}) {
  return Layer.succeed(
    T3Orchestration,
    fromPartial<Orchestration>({
      getThreadSnapshot: () => Effect.succeed(input.snapshot),
      dispatch: (command: ClientOrchestrationCommand) => {
        input.onDispatch?.(command);
        return Effect.succeed({ sequence: 42 });
      },
    }),
  );
}

const testLayer = (orchestration: Layer.Layer<T3Orchestration>) =>
  Layer.mergeAll(orchestration, NodeServices.layer, NodeEnvironmentLive);

describe("interruptThread", () => {
  it.layer(NodeServices.layer)("interruptThread", (t) => {
    t.effect("dispatches thread.turn.interrupt with activeTurnId from snapshot", () =>
      Effect.gen(function* () {
        let dispatched: ClientOrchestrationCommand | undefined;
        const snapshot = fromPartial<OrchestrationThread>({
          id: "thread-1",
          session: {
            activeTurnId: "turn-1",
          },
        });
        const app = yield* makeThreadApplication().pipe(
          Effect.provide(
            testLayer(
              makeOrchestrationLayer({
                snapshot,
                onDispatch: (command) => {
                  dispatched = command;
                },
              }),
            ),
          ),
        );

        const dispatch = yield* app.interruptThread("thread-1");
        assert.equal(dispatch.sequence, 42);
        assert.equal(dispatched?.type, "thread.turn.interrupt");
        if (dispatched?.type === "thread.turn.interrupt") {
          assert.equal(dispatched.threadId, "thread-1");
          assert.equal(dispatched.turnId, "turn-1");
        }
      }),
    );
  });
});
