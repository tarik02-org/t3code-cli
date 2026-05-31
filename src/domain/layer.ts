import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";
import { ProjectCreateVisibilityError, ThreadSessionError } from "./error.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import {
  makeProjectCreateCommand,
  makeThreadArchiveCommand,
  makeThreadTurnContinueCommand,
  makeThreadTurnStartCommand,
} from "./commands.ts";
import { findProjectById, resolveProject } from "./helpers.ts";
import { type StartThreadInput, T3Domain, type WaitEvent } from "./service.ts";
import { waitForThread as waitForThreadUntilComplete } from "./thread-wait.ts";

export const makeT3Domain = Effect.fn("makeT3Domain")(function* () {
  const orchestration = yield* T3Orchestration;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const loadShell = Effect.fn("T3DomainLive.loadShell")(function* () {
    return yield* orchestration.getShellSnapshot();
  });
  const startThread = Effect.fn("T3DomainLive.startThread")(function* <E = never, R = never>(
    startInput: StartThreadInput,
    policy?: {
      readonly until: "dispatch" | "visible" | "complete";
      readonly onEvent?: (event: WaitEvent) => Effect.Effect<void, E, R>;
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
    if (until === "dispatch") return { dispatch, project, threadId };
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
      ...(policy?.onEvent ? { onEvent: policy.onEvent } : {}),
    });
    yield* failIfThreadError(thread);
    return { dispatch, project, threadId, thread };
  });
  const addProject = Effect.fn("T3DomainLive.addProject")(function* (projectInput: {
    readonly path: string;
    readonly title?: string;
  }) {
    const command = makeProjectCreateCommand(projectInput, path, environment.cwd);
    const dispatch = yield* orchestration.dispatch(command);
    const snapshot = yield* loadShell();
    const project = findProjectById(snapshot, command.projectId);
    if (!project) {
      return yield* Effect.fail(
        new ProjectCreateVisibilityError({
          message: `project created but not visible in shell snapshot: ${command.projectId}`,
          projectId: command.projectId,
        }),
      );
    }
    return { dispatch, project };
  });
  const listThreads = Effect.fn("T3DomainLive.listThreads")(function* (projectRef: string) {
    const snapshot = yield* loadShell();
    const project = resolveProject(snapshot, projectRef, path, environment.cwd);
    return {
      project,
      threads: snapshot.threads.filter((thread) => thread.projectId === project.id),
    };
  });
  const getThreadMessages = Effect.fn("T3DomainLive.getThreadMessages")(function* (
    threadId: string,
  ) {
    return yield* orchestration.getThreadSnapshot(threadId);
  });
  const archiveThread = Effect.fn("T3DomainLive.archiveThread")(function* (threadId: string) {
    return yield* orchestration.dispatch(makeThreadArchiveCommand(threadId));
  });
  const sendThread = Effect.fn("T3DomainLive.sendThread")(function* <E = never, R = never>(
    input: {
      readonly threadId: string;
      readonly message: string;
    },
    policy?: {
      readonly until: "dispatch" | "visible" | "complete";
      readonly onEvent?: (event: WaitEvent) => Effect.Effect<void, E, R>;
    },
  ) {
    const command = makeThreadTurnContinueCommand(input);
    const dispatch = yield* orchestration.dispatch(command);
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") return { dispatch, threadId: input.threadId };
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
      ...(policy?.onEvent ? { onEvent: policy.onEvent } : {}),
    });
    yield* failIfThreadError(thread);
    return { dispatch, threadId: input.threadId, thread };
  });
  const waitForThread = Effect.fn("T3DomainLive.waitForThread")(function* <E = never, R = never>(
    threadId: string,
    onEvent?: (event: WaitEvent) => Effect.Effect<void, E, R>,
  ) {
    const thread = yield* waitForThreadUntilComplete({
      orchestration,
      threadId,
      ...(onEvent ? { onEvent } : {}),
    });
    yield* failIfThreadError(thread);
    return thread;
  });

  return {
    loadShell,
    addProject,
    archiveThread,
    listThreads,
    getThreadMessages,
    sendThread,
    startThread,
    waitForThread,
  };
});

export const T3DomainLive = Layer.effect(T3Domain, makeT3Domain());

function failIfThreadError(thread: {
  readonly id: string;
  readonly session: { readonly status: string; readonly lastError: string | null } | null;
}) {
  if (thread.session?.status !== "error") return Effect.void;
  return Effect.fail(
    new ThreadSessionError({
      threadId: thread.id,
      message: thread.session.lastError ?? "thread ended with error",
    }),
  );
}
