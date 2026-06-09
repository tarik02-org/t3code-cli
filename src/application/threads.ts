import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { ThreadSessionError } from "../domain/error.ts";
import { resolveProjectScope } from "../domain/helpers.ts";
import { type StartThreadInput } from "./service.ts";
import type { SendThreadInput } from "./service.ts";
import { mergeModelOptions } from "./model-selection.ts";
import {
  makeThreadArchiveCommand,
  makeThreadStartCommands,
  makeThreadTurnContinueCommand,
} from "./thread-commands.ts";
import {
  waitForThread as waitForThreadUntilComplete,
  watchThread as watchThreadEvents,
} from "./thread-wait.ts";
import { waitForShellSequence } from "./shell-sequence.ts";

export const makeThreadApplication = Effect.fn("makeThreadApplication")(function* () {
  const orchestration = yield* T3Orchestration;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const listThreads = Effect.fn("T3ApplicationLive.listThreads")(function* (projectRef?: string) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const scope = resolveProjectScope(snapshot, {
      ref: projectRef,
      path,
      cwd: environment.cwd,
    });
    return {
      project: scope.project,
      threads: snapshot.threads.filter((thread) => thread.projectId === scope.project.id),
    };
  });
  const getThreadMessages = Effect.fn("T3ApplicationLive.getThreadMessages")(function* (
    threadId: string,
  ) {
    return yield* orchestration.getThreadSnapshot(threadId);
  });
  const archiveThread = Effect.fn("T3ApplicationLive.archiveThread")(function* (threadId: string) {
    const command = yield* makeThreadArchiveCommand(threadId).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
    );
    return yield* orchestration.dispatch(command);
  });
  const startThread = Effect.fn("T3ApplicationLive.startThread")(function* (
    startInput: StartThreadInput,
    policy?: {
      readonly until: "dispatch" | "visible" | "complete";
    },
  ) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const scope = resolveProjectScope(snapshot, {
      ref: startInput.projectRef,
      path,
      cwd: environment.cwd,
    });
    const worktreePath = startInput.worktreePath ?? scope.inferredWorktreePath;
    const serverConfig = yield* orchestration.getServerConfig();
    const commands = yield* makeThreadStartCommands({
      start: {
        ...startInput,
        ...(worktreePath !== undefined ? { worktreePath } : {}),
      },
      project: scope.project,
      serverConfig,
    }).pipe(Effect.provideService(Crypto.Crypto, crypto));
    const createDispatch = yield* orchestration.dispatch(commands.createCommand);
    yield* waitForShellSequence({
      orchestration,
      sequence: createDispatch.sequence,
    });
    const dispatch = yield* orchestration.dispatch(commands.turnCommand);
    const threadId = commands.threadId;
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") {
      return { dispatch, project: scope.project, threadId };
    }
    yield* waitForShellSequence({
      orchestration,
      sequence: dispatch.sequence,
    });
    if (until === "visible") {
      const thread = yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* orchestration.openThread(threadId);
          return opened.snapshot;
        }),
      );
      return { dispatch, project: scope.project, threadId, thread };
    }
    const thread = yield* waitForThreadUntilComplete({
      orchestration,
      threadId,
    });
    yield* failIfThreadError(thread);
    return { dispatch, project: scope.project, threadId, thread };
  });
  const sendThread = Effect.fn("T3ApplicationLive.sendThread")(function* (
    input: SendThreadInput,
    policy?: {
      readonly until: "dispatch" | "visible" | "complete";
    },
  ) {
    const modelSelection =
      input.options !== undefined && input.options.length > 0
        ? mergeModelOptions(
            (yield* orchestration.getThreadSnapshot(input.threadId)).modelSelection,
            input.options,
          )
        : undefined;
    const command = yield* makeThreadTurnContinueCommand({
      ...input,
      ...(modelSelection !== undefined ? { modelSelection } : {}),
    }).pipe(Effect.provideService(Crypto.Crypto, crypto));
    const dispatch = yield* orchestration.dispatch(command);
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") {
      return { dispatch, threadId: input.threadId };
    }
    yield* waitForShellSequence({
      orchestration,
      sequence: dispatch.sequence,
    });
    if (until === "visible") {
      const thread = yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* orchestration.openThread(input.threadId);
          return opened.snapshot;
        }),
      );
      return { dispatch, threadId: input.threadId, thread };
    }
    const thread = yield* waitForThreadUntilComplete({
      orchestration,
      threadId: input.threadId,
    });
    yield* failIfThreadError(thread);
    return { dispatch, threadId: input.threadId, thread };
  });
  const watchThread = (threadId: string) =>
    watchThreadEvents({
      orchestration,
      threadId,
    });
  const waitForThread = Effect.fn("T3ApplicationLive.waitForThread")(function* (threadId: string) {
    const thread = yield* waitForThreadUntilComplete({
      orchestration,
      threadId,
    });
    yield* failIfThreadError(thread);
    return thread;
  });

  return {
    archiveThread,
    listThreads,
    getThreadMessages,
    sendThread,
    startThread,
    watchThread,
    waitForThread,
  };
});

function failIfThreadError(thread: {
  readonly id: string;
  readonly session: { readonly status: string; readonly lastError: string | null } | null;
}) {
  if (thread.session?.status !== "error") {
    return Effect.void;
  }
  return Effect.fail(
    new ThreadSessionError({
      threadId: thread.id,
      message: thread.session.lastError ?? "thread ended with error",
    }),
  );
}
