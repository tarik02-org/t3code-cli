import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import { QueuedRunError } from "../domain/error.ts";
import { liveRun } from "../domain/thread-lifecycle.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import {
  makeQueueResumeCommand,
  makeQueuedRunCancelCommand,
  makeQueuedRunEditCommand,
  makeQueuedRunReorderCommand,
  makeQueuedRunSteerCommand,
} from "./thread-commands.ts";

export type QueuedRun = {
  readonly runId: string;
  readonly position: number;
  /** Restart recovery holds the queue until `queue resume`. */
  readonly held: boolean;
  readonly messageId: string;
  readonly text: string;
  readonly requestedAt: string;
};

/** Queued runs in the order the server will start them. */
export function queuedRuns(projection: OrchestrationV2ThreadProjection): ReadonlyArray<QueuedRun> {
  const messages = new Map(projection.messages.map((message) => [message.id, message]));
  return projection.runs
    .filter((run) => run.status === "queued")
    .toSorted((left, right) => {
      const byPosition =
        (left.queuePosition ?? Number.MAX_SAFE_INTEGER) -
        (right.queuePosition ?? Number.MAX_SAFE_INTEGER);
      return byPosition !== 0 ? byPosition : left.ordinal - right.ordinal;
    })
    .map((run, index) => ({
      runId: run.id,
      position: index + 1,
      held: run.queueHeld === true,
      messageId: run.userMessageId,
      text: messages.get(run.userMessageId)?.text ?? "",
      requestedAt: DateTime.formatIso(run.requestedAt),
    }));
}

export function makeThreadQueue() {
  const loadQueuedRun = Effect.fn("T3ThreadQueue.loadQueuedRun")(function* (input: {
    readonly threadId: string;
    readonly runId: string;
  }) {
    const orchestration = yield* T3Orchestration;
    const projection = yield* orchestration.getThreadProjection(input.threadId);
    const run = projection.runs.find((candidate) => candidate.id === input.runId);
    if (run?.status !== "queued") {
      return yield* new QueuedRunError({
        message:
          run === undefined
            ? `run not found in thread ${input.threadId}: ${input.runId}`
            : `run is ${run.status}, not queued: ${input.runId}`,
        threadId: input.threadId,
        runId: input.runId,
      });
    }
    return projection;
  });

  const listQueuedRuns = Effect.fn("T3ThreadQueue.listQueuedRuns")(function* (threadId: string) {
    const orchestration = yield* T3Orchestration;
    return queuedRuns(yield* orchestration.getThreadProjection(threadId));
  });

  const cancelQueuedRun = Effect.fn("T3ThreadQueue.cancelQueuedRun")(function* (input: {
    readonly threadId: string;
    readonly runId: string;
  }) {
    const orchestration = yield* T3Orchestration;
    yield* loadQueuedRun(input);
    return yield* orchestration.dispatch(yield* makeQueuedRunCancelCommand(input));
  });

  const editQueuedRun = Effect.fn("T3ThreadQueue.editQueuedRun")(function* (input: {
    readonly threadId: string;
    readonly runId: string;
    readonly text: string;
  }) {
    const orchestration = yield* T3Orchestration;
    yield* loadQueuedRun(input);
    return yield* orchestration.dispatch(yield* makeQueuedRunEditCommand(input));
  });

  const moveQueuedRun = Effect.fn("T3ThreadQueue.moveQueuedRun")(function* (input: {
    readonly threadId: string;
    readonly runId: string;
    /** `null` moves the run to the end of the queue. */
    readonly beforeRunId: string | null;
  }) {
    const orchestration = yield* T3Orchestration;
    yield* loadQueuedRun(input);
    if (input.beforeRunId !== null) {
      yield* loadQueuedRun({ threadId: input.threadId, runId: input.beforeRunId });
    }
    return yield* orchestration.dispatch(yield* makeQueuedRunReorderCommand(input));
  });

  const steerQueuedRun = Effect.fn("T3ThreadQueue.steerQueuedRun")(function* (input: {
    readonly threadId: string;
    readonly runId: string;
  }) {
    const orchestration = yield* T3Orchestration;
    const projection = yield* loadQueuedRun(input);
    const target = liveRun(projection);
    if (target === undefined) {
      return yield* new QueuedRunError({
        message: `thread has no running run to steer: ${input.threadId}`,
        threadId: input.threadId,
        runId: input.runId,
      });
    }
    return yield* orchestration.dispatch(
      yield* makeQueuedRunSteerCommand({
        threadId: input.threadId,
        queuedRunId: input.runId,
        targetRunId: target.id,
      }),
    );
  });

  const resumeQueue = Effect.fn("T3ThreadQueue.resumeQueue")(function* (threadId: string) {
    const orchestration = yield* T3Orchestration;
    return yield* orchestration.dispatch(yield* makeQueueResumeCommand(threadId));
  });

  return {
    listQueuedRuns,
    cancelQueuedRun,
    editQueuedRun,
    moveQueuedRun,
    steerQueuedRun,
    resumeQueue,
  };
}
