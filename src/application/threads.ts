import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { Environment } from "../environment/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { ProjectLookupError, ThreadSessionError } from "../domain/error.ts";
import { resolveProjectScope } from "../domain/helpers.ts";
import { type StartThreadInput } from "./service.ts";
import type { CallbackThreadInput, SendThreadInput } from "./service.ts";
import { mergeModelOptions } from "./model-selection.ts";
import { derivePendingApprovals, derivePendingUserInputs } from "../domain/thread-activities.ts";
import { threadStatus, type ThreadLifecycleStatus } from "../domain/thread-lifecycle.ts";
import type { OrchestrationThread } from "#t3tools/contracts";
import type { ProviderApprovalDecision, ProviderUserInputAnswers } from "#t3tools/contracts";
import {
  makeThreadApprovalRespondCommand,
  makeThreadArchiveCommand,
  makeThreadStartCommands,
  makeThreadTurnContinueCommand,
  makeThreadUserInputRespondCommand,
} from "./thread-commands.ts";
import { makeUpdateThread } from "./thread-update.ts";
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
  const listThreads = Effect.fn("T3ApplicationLive.listThreads")(function* (projectRef: string) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const scope = yield* resolveProjectScope(snapshot, {
      ref: projectRef,
    }).pipe(Effect.provideService(Path.Path, path));
    if (scope === undefined) {
      return yield* Effect.fail(
        new ProjectLookupError({ message: `project not found: ${projectRef}`, ref: projectRef }),
      );
    }
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
  const showThread = Effect.fn("T3ApplicationLive.showThread")(function* (threadId: string) {
    const thread = yield* orchestration.getThreadSnapshot(threadId);
    return projectThreadShow(thread);
  });
  const archiveThread = Effect.fn("T3ApplicationLive.archiveThread")(function* (threadId: string) {
    const command = yield* makeThreadArchiveCommand(threadId).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
    );
    return yield* orchestration.dispatch(command);
  });
  const updateThread = makeUpdateThread({ orchestration, crypto });
  const startThread = Effect.fn("T3ApplicationLive.startThread")(function* (
    startInput: StartThreadInput,
    policy?: {
      readonly until: "dispatch" | "visible" | "complete";
    },
  ) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const projectRef = startInput.projectRef;
    if (projectRef === undefined) {
      return yield* Effect.fail(
        new ProjectLookupError({
          message: "project is required",
          ref: environment.cwd,
        }),
      );
    }
    const scope = yield* resolveProjectScope(snapshot, {
      ref: projectRef,
    }).pipe(Effect.provideService(Path.Path, path));
    if (scope === undefined) {
      return yield* Effect.fail(
        new ProjectLookupError({ message: `project not found: ${projectRef}`, ref: projectRef }),
      );
    }
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
  const callbackThread = Effect.fn("T3ApplicationLive.callbackThread")(function* (
    input: CallbackThreadInput,
  ) {
    yield* waitForThreadUntilComplete({
      orchestration,
      threadId: input.fromThreadId,
    });
    const result = yield* sendThread(
      { threadId: input.targetThreadId, message: input.prompt },
      { until: "dispatch" },
    );
    return { dispatch: result.dispatch, targetThreadId: input.targetThreadId };
  });
  const approveThread = Effect.fn("T3ApplicationLive.approveThread")(function* (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly decision: ProviderApprovalDecision;
  }) {
    const command = yield* makeThreadApprovalRespondCommand(input).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
    );
    const dispatch = yield* orchestration.dispatch(command);
    return { threadId: input.threadId, requestId: input.requestId, dispatch };
  });
  const respondToThread = Effect.fn("T3ApplicationLive.respondToThread")(function* (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly answers: ProviderUserInputAnswers;
  }) {
    const command = yield* makeThreadUserInputRespondCommand(input).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
    );
    const dispatch = yield* orchestration.dispatch(command);
    return { threadId: input.threadId, requestId: input.requestId, dispatch };
  });

  return {
    approveThread,
    archiveThread,
    updateThread,
    listThreads,
    getThreadMessages,
    respondToThread,
    sendThread,
    showThread,
    startThread,
    watchThread,
    waitForThread,
    callbackThread,
  };
});

export type ThreadShow = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: ThreadLifecycleStatus;
  readonly session: OrchestrationThread["session"];
  readonly latestTurn: OrchestrationThread["latestTurn"];
  readonly modelSelection: OrchestrationThread["modelSelection"];
  readonly runtimeMode: OrchestrationThread["runtimeMode"];
  readonly interactionMode: OrchestrationThread["interactionMode"];
  readonly branch: OrchestrationThread["branch"];
  readonly worktreePath: OrchestrationThread["worktreePath"];
  readonly archivedAt: OrchestrationThread["archivedAt"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly pendingApprovals: ReturnType<typeof derivePendingApprovals>;
  readonly pendingUserInputs: ReturnType<typeof derivePendingUserInputs>;
};

function projectThreadShow(thread: OrchestrationThread): ThreadShow {
  const pendingApprovals = derivePendingApprovals(thread.activities);
  const pendingUserInputs = derivePendingUserInputs(thread.activities);
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    status: threadStatus(thread),
    session: thread.session,
    latestTurn: thread.latestTurn,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    archivedAt: thread.archivedAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
    hasPendingApprovals: pendingApprovals.length > 0,
    hasPendingUserInput: pendingUserInputs.length > 0,
    hasActionableProposedPlan: thread.proposedPlans.some((plan) => plan.implementedAt === null),
    pendingApprovals,
    pendingUserInputs,
  };
}

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
