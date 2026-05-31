import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { ThreadSessionError } from "../domain/error.ts";
import { resolveProject } from "../domain/helpers.ts";
import { type StartThreadInput } from "./service.ts";
import {
  makeThreadArchiveCommand,
  makeThreadTurnContinueCommand,
  makeThreadTurnStartCommand,
} from "./thread-commands.ts";
import {
  waitForThread as waitForThreadUntilComplete,
  watchThread as watchThreadEvents,
} from "./thread-wait.ts";

export const makeThreadApplication = Effect.fn("makeThreadApplication")(function* () {
  const orchestration = yield* T3Orchestration;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const listThreads = Effect.fn("T3ApplicationLive.listThreads")(function* (projectRef: string) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const project = resolveProject(snapshot, projectRef, path, environment.cwd);
    return {
      project,
      threads: snapshot.threads.filter((thread) => thread.projectId === project.id),
    };
  });
  const getThreadMessages = Effect.fn("T3ApplicationLive.getThreadMessages")(function* (
    threadId: string,
  ) {
    return yield* orchestration.getThreadSnapshot(threadId);
  });
  const archiveThread = Effect.fn("T3ApplicationLive.archiveThread")(function* (threadId: string) {
    return yield* orchestration.dispatch(makeThreadArchiveCommand(threadId));
  });
  const startThread = Effect.fn("T3ApplicationLive.startThread")(function* (
    startInput: StartThreadInput,
    policy?: {
      readonly until: "dispatch" | "visible" | "complete";
    },
  ) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const project = resolveProject(snapshot, startInput.projectRef, path, environment.cwd);
    const serverConfig = yield* orchestration.getServerConfig();
    const command = yield* makeThreadTurnStartCommand({
      start: startInput,
      project,
      serverConfig,
    });
    const dispatch = yield* orchestration.dispatch(command);
    const threadId = command.threadId;
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") {
      return { dispatch, project, threadId };
    }
    if (until === "visible") {
      const thread = yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* orchestration.openThread(threadId);
          return opened.snapshot;
        }),
      );
      return { dispatch, project, threadId, thread };
    }
    const thread = yield* waitForThreadUntilComplete({
      orchestration,
      threadId,
    });
    yield* failIfThreadError(thread);
    return { dispatch, project, threadId, thread };
  });
  const sendThread = Effect.fn("T3ApplicationLive.sendThread")(function* (
    input: {
      readonly threadId: string;
      readonly message: string;
    },
    policy?: {
      readonly until: "dispatch" | "visible" | "complete";
    },
  ) {
    const command = makeThreadTurnContinueCommand(input);
    const dispatch = yield* orchestration.dispatch(command);
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") {
      return { dispatch, threadId: input.threadId };
    }
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
