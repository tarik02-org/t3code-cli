import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { CliRuntime } from "../cli/runtime/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { ProjectLookupError, ThreadLookupError, ThreadSessionError } from "../domain/error.ts";
import { resolveProjectScope } from "../domain/helpers.ts";
import { type ListThreadsInclude, type StartThreadInput } from "./service.ts";
import type { CallbackThreadInput, SendThreadInput } from "./service.ts";
import type { T3ThreadApplicationService } from "./service.ts";
import type {
  OrchestrationSearchThreadsInput,
  OrchestrationThreadSearchMatch,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { mergeModelOptions } from "./model-selection.ts";
import { derivePendingApprovals, derivePendingUserInputs } from "../domain/thread-activities.ts";
import {
  sessionNeedsStopBeforeDelete,
  threadStatus,
  type ThreadLifecycleStatus,
} from "../domain/thread-lifecycle.ts";
import type { OrchestrationThread } from "@t3tools/contracts";
import type { ProviderApprovalDecision, ProviderUserInputAnswers } from "@t3tools/contracts";
import {
  makeThreadApprovalRespondCommand,
  makeThreadArchiveCommand,
  makeThreadDeleteCommand,
  makeThreadInterruptCommand,
  makeThreadSessionStopCommand,
  makeThreadStartCommands,
  makeThreadTurnContinueCommand,
  makeThreadUnarchiveCommand,
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
  const cliRuntime = yield* CliRuntime;
  const awaitShellSequence = (sequence: number) =>
    waitForShellSequence({ sequence }).pipe(Effect.provideService(T3Orchestration, orchestration));
  const awaitThreadCompletion = (threadId: string) =>
    waitForThreadUntilComplete({ threadId }).pipe(
      Effect.provideService(T3Orchestration, orchestration),
    );
  const streamThreadEvents = (threadId: string) =>
    watchThreadEvents({ threadId }).pipe(Stream.provideService(T3Orchestration, orchestration));
  const listThreads = Effect.fn("T3ApplicationLive.listThreads")(function* (
    projectRef: string,
    options?: {
      readonly include?: ListThreadsInclude;
    },
  ) {
    const include = options?.include ?? "active";
    const snapshot = yield* loadThreadsSnapshot(include).pipe(
      Effect.provideService(T3Orchestration, orchestration),
    );
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
  const searchThreads = Effect.fn("T3ApplicationLive.searchThreads")(function* (
    input: OrchestrationSearchThreadsInput,
  ) {
    const result = yield* orchestration.searchThreads(input);
    const snapshot = yield* orchestration.getShellSnapshot();
    const threadsById = new Map(snapshot.threads.map((thread) => [thread.id, thread]));
    const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]));
    return result.matches.map((match) => {
      const thread = threadsById.get(match.threadId);
      const project = projectsById.get(match.projectId);
      return {
        threadId: match.threadId,
        threadTitle: thread?.title ?? null,
        projectId: match.projectId,
        projectTitle: project?.title ?? null,
        workspaceRoot: project?.workspaceRoot ?? null,
        branch: thread?.branch ?? null,
        worktreePath: thread?.worktreePath ?? null,
        source: match.source,
        snippet: match.snippet,
        messageCreatedAt: match.messageCreatedAt,
      } satisfies ThreadSearchResult;
    });
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
  const unarchiveThread = Effect.fn("T3ApplicationLive.unarchiveThread")(function* (
    threadId: string,
  ) {
    const command = yield* makeThreadUnarchiveCommand(threadId).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
    );
    return yield* orchestration.dispatch(command);
  });
  const interruptThread = Effect.fn("T3ApplicationLive.interruptThread")(function* (
    threadId: string,
  ) {
    const snapshot = yield* orchestration.getThreadSnapshot(threadId);
    const activeTurnId = snapshot.session?.activeTurnId ?? undefined;
    const command = yield* makeThreadInterruptCommand({
      threadId,
      ...(activeTurnId !== undefined ? { turnId: activeTurnId } : {}),
    }).pipe(Effect.provideService(Crypto.Crypto, crypto));
    return yield* orchestration.dispatch(command);
  });
  const deleteThread = Effect.fn("T3ApplicationLive.deleteThread")(function* (threadId: string) {
    const snapshot = yield* loadThreadsSnapshot("all").pipe(
      Effect.provideService(T3Orchestration, orchestration),
    );
    const thread = snapshot.threads.find((item) => item.id === threadId);
    if (thread === undefined) {
      return yield* Effect.fail(
        new ThreadLookupError({
          message: `thread not found: ${threadId}`,
          threadId,
        }),
      );
    }
    if (sessionNeedsStopBeforeDelete(thread.session)) {
      const stopCommand = yield* makeThreadSessionStopCommand(threadId).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
      );
      yield* orchestration.dispatch(stopCommand);
    }
    const command = yield* makeThreadDeleteCommand(threadId).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
    );
    const dispatch = yield* orchestration.dispatch(command);
    return { threadId, dispatch };
  });
  const updateThread: T3ThreadApplicationService["updateThread"] = (input) =>
    makeUpdateThread()(input).pipe(
      Effect.provideService(T3Orchestration, orchestration),
      Effect.provideService(Crypto.Crypto, crypto),
    );
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
          ref: cliRuntime.cwd,
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
    yield* awaitShellSequence(createDispatch.sequence);
    const dispatch = yield* orchestration.dispatch(commands.turnCommand);
    const threadId = commands.threadId;
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") {
      return { dispatch, project: scope.project, threadId };
    }
    yield* awaitShellSequence(dispatch.sequence);
    if (until === "visible") {
      const thread = yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* orchestration.openThread(threadId);
          return opened.snapshot;
        }),
      );
      return { dispatch, project: scope.project, threadId, thread };
    }
    const thread = yield* awaitThreadCompletion(threadId);
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
    yield* awaitShellSequence(dispatch.sequence);
    if (until === "visible") {
      const thread = yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* orchestration.openThread(input.threadId);
          return opened.snapshot;
        }),
      );
      return { dispatch, threadId: input.threadId, thread };
    }
    const thread = yield* awaitThreadCompletion(input.threadId);
    yield* failIfThreadError(thread);
    return { dispatch, threadId: input.threadId, thread };
  });
  const watchThread = (threadId: string) => streamThreadEvents(threadId);
  const waitForThread = Effect.fn("T3ApplicationLive.waitForThread")(function* (threadId: string) {
    const thread = yield* awaitThreadCompletion(threadId);
    yield* failIfThreadError(thread);
    return thread;
  });
  const callbackThread = Effect.fn("T3ApplicationLive.callbackThread")(function* (
    input: CallbackThreadInput,
  ) {
    yield* awaitThreadCompletion(input.fromThreadId);
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
    deleteThread,
    interruptThread,
    updateThread,
    unarchiveThread,
    listThreads,
    searchThreads,
    getThreadMessages,
    respondToThread,
    sendThread,
    showThread,
    startThread,
    watchThread,
    waitForThread,
    callbackThread,
  } satisfies T3ThreadApplicationService;
});

export type ThreadSearchResult = {
  readonly threadId: OrchestrationThreadSearchMatch["threadId"];
  readonly threadTitle: string | null;
  readonly projectId: OrchestrationThreadSearchMatch["projectId"];
  readonly projectTitle: string | null;
  readonly workspaceRoot: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly source: OrchestrationThreadSearchMatch["source"];
  readonly snippet: OrchestrationThreadSearchMatch["snippet"];
  readonly messageCreatedAt: OrchestrationThreadSearchMatch["messageCreatedAt"];
};

const loadThreadsSnapshot = Effect.fn("loadThreadsSnapshot")(function* (
  include: ListThreadsInclude,
) {
  const orchestration = yield* T3Orchestration;
  if (include === "active") {
    return yield* orchestration.getShellSnapshot();
  }
  if (include === "archived") {
    return yield* orchestration.getArchivedShellSnapshot();
  }
  const [activeSnapshot, archivedSnapshot] = yield* Effect.all([
    orchestration.getShellSnapshot(),
    orchestration.getArchivedShellSnapshot(),
  ]);
  return {
    ...activeSnapshot,
    threads: dedupeThreadsById([...activeSnapshot.threads, ...archivedSnapshot.threads]),
  };
});

function dedupeThreadsById(threads: ReadonlyArray<OrchestrationThreadShell>) {
  const byId = new Map<string, OrchestrationThreadShell>();
  for (const thread of threads) {
    byId.set(thread.id, thread);
  }
  return [...byId.values()];
}

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
