import "vite-plus/test/config";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type {
  OrchestrationV2Command,
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";

import { QueuedRunError } from "../domain/error.ts";
import { T3Orchestration, type Orchestration } from "../orchestration/service.ts";
import { makeThreadQueue, queuedRuns } from "./thread-queue.ts";

const requestedAt = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

function makeProjection(
  runs: ReadonlyArray<{
    readonly id: string;
    readonly status: OrchestrationV2RunStatus;
    readonly ordinal: number;
    readonly queuePosition?: number | null;
  }>,
): OrchestrationV2ThreadProjection {
  return fromPartial({
    runs: runs.map((run) => ({ ...run, userMessageId: `msg-${run.id}`, requestedAt })),
    messages: runs.map((run) => ({ id: `msg-${run.id}`, text: `text ${run.id}` })),
  });
}

function makeLayer(
  projection: OrchestrationV2ThreadProjection,
  onDispatch: (command: OrchestrationV2Command) => void,
) {
  return Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(
      T3Orchestration,
      fromPartial<Orchestration>({
        getThreadProjection: () => Effect.succeed(projection),
        dispatch: (command: OrchestrationV2Command) => {
          onDispatch(command);
          return Effect.succeed({ sequence: 7 });
        },
      }),
    ),
  );
}

describe("queuedRuns", () => {
  it("lists queued runs in start order with their message text", () => {
    const runs = queuedRuns(
      makeProjection([
        { id: "done", status: "completed", ordinal: 1 },
        { id: "late", status: "queued", ordinal: 3, queuePosition: 2 },
        { id: "next", status: "queued", ordinal: 4, queuePosition: 1 },
        { id: "unranked", status: "queued", ordinal: 2, queuePosition: null },
      ]),
    );
    assert.deepEqual(
      runs.map((run) => [run.position, run.runId, run.text]),
      [
        [1, "next", "text next"],
        [2, "late", "text late"],
        [3, "unranked", "text unranked"],
      ],
    );
  });
});

describe("makeThreadQueue", () => {
  it.effect("steers a queued run into the running run", () =>
    Effect.gen(function* () {
      let dispatched: OrchestrationV2Command | undefined;
      const projection = makeProjection([
        { id: "active", status: "running", ordinal: 1 },
        { id: "queued", status: "queued", ordinal: 2, queuePosition: 1 },
      ]);
      yield* makeThreadQueue()
        .pipe(
          Effect.flatMap((queue) =>
            queue.steerQueuedRun({ threadId: "thread-1", runId: "queued" }),
          ),
        )
        .pipe(
          Effect.provide(
            makeLayer(projection, (command) => {
              dispatched = command;
            }),
          ),
        );
      assert.equal(dispatched?.type, "queued-message.promote-to-steer");
      if (dispatched?.type === "queued-message.promote-to-steer") {
        assert.equal(dispatched.queuedRunId, "queued");
        assert.equal(dispatched.targetRunId, "active");
      }
    }),
  );

  it.effect("refuses to steer when nothing is running", () =>
    Effect.gen(function* () {
      const projection = makeProjection([
        { id: "queued", status: "queued", ordinal: 1, queuePosition: 1 },
      ]);
      const error = yield* makeThreadQueue()
        .pipe(
          Effect.flatMap((queue) =>
            queue.steerQueuedRun({ threadId: "thread-1", runId: "queued" }),
          ),
        )
        .pipe(Effect.provide(makeLayer(projection, () => {})), Effect.flip);
      assert.instanceOf(error, QueuedRunError);
    }),
  );

  it.effect("refuses to cancel a run that is no longer queued", () =>
    Effect.gen(function* () {
      let dispatched = false;
      const projection = makeProjection([{ id: "started", status: "running", ordinal: 1 }]);
      const error = yield* makeThreadQueue()
        .pipe(
          Effect.flatMap((queue) =>
            queue.cancelQueuedRun({ threadId: "thread-1", runId: "started" }),
          ),
        )
        .pipe(
          Effect.provide(
            makeLayer(projection, () => {
              dispatched = true;
            }),
          ),
          Effect.flip,
        );
      assert.instanceOf(error, QueuedRunError);
      assert.isFalse(dispatched);
    }),
  );
});
