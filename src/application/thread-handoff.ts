import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ThreadWorktreeError } from "../domain/error.ts";
import { isRunTerminal, liveRun } from "../domain/thread-lifecycle.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import type { ApplicationError } from "./error.ts";
import type {
  HandoffTargetInput,
  HandoffThreadInput,
  HandoffThreadResult,
  SendThreadInput,
} from "./service.ts";
import {
  makeQueueResumeCommand,
  makeRunInterruptCommand,
  makeThreadMetadataUpdateCommand,
} from "./thread-commands.ts";

// A Stop is acknowledged by the provider within seconds; minutes means it is wedged.
const RUN_STOP_TIMEOUT = "2 minutes";

type SendMessage = (
  input: SendThreadInput,
) => Effect.Effect<{ readonly messageId: string }, ApplicationError>;

/** Resolves where a handoff lands; the project's main checkout is recorded as no worktree. */
export const resolveHandoffTarget = Effect.fn("T3ApplicationLive.resolveHandoffTarget")(function* (
  input: HandoffTargetInput,
) {
  const orchestration = yield* T3Orchestration;
  const projection = yield* orchestration.getThreadProjection(input.threadId);
  const project = (yield* orchestration.getShellSnapshot()).projects.find(
    (entry) => entry.id === projection.thread.projectId,
  );
  const worktreePath =
    input.worktreePath !== null && input.worktreePath === project?.workspaceRoot
      ? null
      : input.worktreePath;
  return {
    projection,
    worktreePath,
    alreadyThere: worktreePath === projection.thread.worktreePath,
  };
});

/**
 * Moves a thread into another worktree and continues there. The server detaches the provider
 * session when the workspace changes, which under a live run ends the run as a provider error
 * and holds the queue. So the live run is stopped first, the binding changes once the run is
 * terminal, and the continuation is sent to the idle thread, which starts a fresh turn in the
 * new worktree with the conversation preserved.
 */
export function makeHandoffThread(sendMessage: SendMessage) {
  return Effect.fn("T3ApplicationLive.handoffThread")(function* (input: HandoffThreadInput) {
    const orchestration = yield* T3Orchestration;
    const crypto = yield* Crypto.Crypto;
    const withCrypto = Effect.provideService(Crypto.Crypto, crypto);
    const step = input.onStep ?? (() => Effect.void);
    const threadId = input.threadId;
    const fail = (message: string) => new ThreadWorktreeError({ message, threadId });

    const { projection, worktreePath, alreadyThere } = yield* resolveHandoffTarget(input);
    const thread = projection.thread;
    if (thread.archivedAt !== null) {
      return yield* fail(`thread ${threadId} is archived`);
    }
    // Switching to the current worktree is a no-op, so the run keeps going.
    if (alreadyThere) {
      return {
        threadId,
        worktreePath,
        moved: false,
        stoppedRunId: null,
        dispatch: null,
        resumedQueue: false,
        messageId: null,
      } satisfies HandoffThreadResult;
    }
    // Without a hold, a queued run starts the moment the stopped run ends and the switch kills
    // it as a provider error. Resume afterwards only when the queue was not already held, so a
    // hold the user chose stays in place.
    const queueHeldBefore = projection.runs.some(
      (run) => run.status === "queued" && run.queueHeld === true,
    );

    const run = liveRun(projection);
    if (run !== undefined) {
      yield* step(`stopping run ${run.id}`);
      yield* orchestration.dispatch(
        yield* makeRunInterruptCommand({ threadId, runId: run.id, holdQueue: true }).pipe(
          withCrypto,
        ),
      );
      const stopped = yield* orchestration.watchThread(threadId).pipe(
        Stream.map((state) => state.projection.runs.find((candidate) => candidate.id === run.id)),
        Stream.filter((current) => current === undefined || isRunTerminal(current)),
        Stream.runHead,
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: RUN_STOP_TIMEOUT,
          orElse: () => Effect.fail(fail(`run ${run.id} did not stop within ${RUN_STOP_TIMEOUT}`)),
        }),
      );
      yield* step(
        `run ${run.id} ended: ${Option.match(stopped, {
          onNone: () => "stream closed",
          onSome: (current) => current?.status ?? "gone",
        })}`,
      );
    }

    let switched = false;
    const switchAndContinue = Effect.gen(function* () {
      yield* step(`switching worktree to ${worktreePath ?? "the project root"}`);
      const dispatch = yield* orchestration.dispatch(
        yield* makeThreadMetadataUpdateCommand(threadId, {
          worktreePath,
          ...(input.branch !== undefined ? { branch: input.branch } : {}),
          expectedWorktreePath: thread.worktreePath,
        }).pipe(withCrypto),
      );
      switched = true;

      let resumedQueue = false;
      if (run !== undefined && !queueHeldBefore) {
        const current = yield* orchestration.getThreadProjection(threadId);
        if (current.runs.some((candidate) => candidate.status === "queued")) {
          yield* step("resuming the queue held for the switch");
          yield* orchestration.dispatch(yield* makeQueueResumeCommand(threadId).pipe(withCrypto));
          resumedQueue = true;
        }
      }

      let messageId: string | null = null;
      if (input.prompt !== undefined) {
        yield* step("sending the continuation");
        // Queued, never steered: a run resumed from the queue may still be starting, and a
        // steer needs a live provider turn.
        messageId = (yield* sendMessage({
          threadId,
          message: input.prompt,
          mode: "queue",
          ...(input.author !== undefined ? { author: input.author } : {}),
        })).messageId;
      }
      return {
        threadId,
        worktreePath,
        moved: true,
        stoppedRunId: run?.id ?? null,
        dispatch,
        resumedQueue,
        messageId,
      } satisfies HandoffThreadResult;
    });

    if (run === undefined) {
      return yield* switchAndContinue;
    }
    // The run is already stopped, so without a message the agent would sit idle with no
    // word of what happened.
    return yield* switchAndContinue.pipe(
      Effect.tapError((error) =>
        sendMessage({
          threadId,
          message: [
            switched
              ? `The thread moved to ${worktreePath ?? "the project root"}, but the handoff did not finish: ${error.message}`
              : `Worktree handoff to ${worktreePath ?? "the project root"} failed: ${error.message}\nThe thread is still in ${thread.worktreePath ?? "the project root"}.`,
            ...(input.prompt !== undefined ? ["", "Planned continuation:", input.prompt] : []),
          ].join("\n"),
          mode: "queue",
          ...(input.author !== undefined ? { author: input.author } : {}),
        }).pipe(Effect.ignore),
      ),
    );
  });
}
