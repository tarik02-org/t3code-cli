import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import type {
  OrchestrationSearchThreadsInput,
  OrchestrationThreadSearchMatch,
  OrchestrationV2Command,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "@t3tools/contracts";
import {
  derivePendingThreadRequests,
  type ThreadPendingApproval,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";

import { CliRuntime } from "../cli/runtime/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { ProjectLookupError, ThreadLookupError, ThreadSessionError } from "../domain/error.ts";
import { resolveProjectScope } from "../domain/helpers.ts";
import {
  liveRun,
  threadLastError,
  threadStatus,
  type ThreadLifecycleStatus,
} from "../domain/thread-lifecycle.ts";
import { mergeModelOptions } from "./model-selection.ts";
import type {
  CallbackThreadInput,
  MessageAuthor,
  GetThreadTranscriptInput,
  ListThreadsInclude,
  SendThreadInput,
  SnoozeThreadInput,
  StartThreadInput,
  StartThreadPolicy,
  T3ThreadApplicationService,
  ThreadDispatchPolicy,
} from "./service.ts";
import {
  makeMessageDispatchCommand,
  makeRunInterruptCommand,
  makeRuntimeRequestRespondCommand,
  makeThreadArchiveCommand,
  makeThreadDeleteCommand,
  makeThreadLaunchInput,
  makeThreadPinCommand,
  makeThreadSettleCommand,
  makeThreadSnoozeCommand,
  makeThreadUnarchiveCommand,
  makeThreadUnpinCommand,
  makeThreadUnsettleCommand,
  makeThreadUnsnoozeCommand,
} from "./thread-commands.ts";
import { makeThreadQueue } from "./thread-queue.ts";
import { makeHandoffThread } from "./thread-handoff.ts";
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
  const withCrypto = Effect.provideService(Crypto.Crypto, crypto);
  const awaitShellSequence = (sequence: number) =>
    waitForShellSequence({ sequence }).pipe(Effect.provideService(T3Orchestration, orchestration));
  const awaitThreadCompletion = (threadId: string) =>
    waitForThreadUntilComplete({ threadId }).pipe(
      Effect.provideService(T3Orchestration, orchestration),
    );
  const streamThreadEvents = (threadId: string) =>
    watchThreadEvents({ threadId }).pipe(Stream.provideService(T3Orchestration, orchestration));
  const loadThreads = (include: ListThreadsInclude) =>
    loadThreadsSnapshot(include).pipe(Effect.provideService(T3Orchestration, orchestration));
  const listThreads = Effect.fn("T3ApplicationLive.listThreads")(function* (
    projectRef: string,
    options?: {
      readonly include?: ListThreadsInclude;
    },
  ) {
    const snapshot = yield* loadThreads(options?.include ?? "active");
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
    const snapshot = yield* loadThreads("all");
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
  const getThreadTranscript = Effect.fn("T3ApplicationLive.getThreadTranscript")(function* (
    input: GetThreadTranscriptInput,
  ) {
    if (input.all === true) {
      const snapshot = yield* orchestration.getThreadDetailSnapshot(input.threadId);
      return {
        threadId: input.threadId,
        snapshotSequence: snapshot.snapshotSequence,
        items: snapshot.projection.visibleTurnItems,
        hasMoreHistory: false,
        beforeCursor: null,
        projection: snapshot.projection,
      } satisfies ThreadTranscript;
    }
    if (input.beforeCursor !== undefined) {
      const page = yield* orchestration.getThreadHistoryPage({
        threadId: input.threadId,
        cursor: input.beforeCursor,
      });
      return {
        threadId: input.threadId,
        snapshotSequence: page.snapshotSequence,
        items: page.items,
        hasMoreHistory: page.hasMoreHistory,
        beforeCursor: page.nextCursor,
        projection: null,
      } satisfies ThreadTranscript;
    }
    const snapshot = yield* orchestration.getThreadBoundedSnapshot(input.threadId);
    return {
      threadId: input.threadId,
      snapshotSequence: snapshot.snapshotSequence,
      items: snapshot.projection.visibleTurnItems,
      hasMoreHistory: snapshot.hasMoreHistory,
      beforeCursor: snapshot.historyCursor,
      projection: snapshot.projection,
    } satisfies ThreadTranscript;
  });
  const getThreadProjection = Effect.fn("T3ApplicationLive.getThreadProjection")(function* (
    threadId: string,
  ) {
    return yield* orchestration.getThreadProjection(threadId);
  });
  const getThreadSummary = Effect.fn("T3ApplicationLive.getThreadSummary")(function* (
    threadId: string,
  ) {
    const snapshot = yield* loadThreads("all");
    const thread = snapshot.threads.find((item) => item.id === threadId);
    if (thread === undefined) {
      return yield* Effect.fail(
        new ThreadLookupError({
          message: `thread not found: ${threadId}`,
          threadId,
        }),
      );
    }
    return thread;
  });
  const showThread = Effect.fn("T3ApplicationLive.showThread")(function* (threadId: string) {
    return projectThreadShow(yield* orchestration.getThreadProjection(threadId));
  });
  const dispatchThreadCommand = <A extends OrchestrationV2Command, E>(
    command: Effect.Effect<A, E, Crypto.Crypto>,
  ) => command.pipe(withCrypto, Effect.flatMap(orchestration.dispatch));
  const archiveThread = Effect.fn("T3ApplicationLive.archiveThread")(function* (threadId: string) {
    const dispatch = yield* dispatchThreadCommand(makeThreadArchiveCommand(threadId));
    yield* awaitShellSequence(dispatch.sequence);
    return dispatch;
  });
  const unarchiveThread = (threadId: string) =>
    dispatchThreadCommand(makeThreadUnarchiveCommand(threadId));
  const settleThread = (threadId: string) =>
    dispatchThreadCommand(makeThreadSettleCommand(threadId));
  const unsettleThread = (threadId: string) =>
    dispatchThreadCommand(makeThreadUnsettleCommand(threadId));
  const snoozeThread = (input: SnoozeThreadInput) =>
    dispatchThreadCommand(makeThreadSnoozeCommand(input));
  const unsnoozeThread = (threadId: string) =>
    dispatchThreadCommand(makeThreadUnsnoozeCommand(threadId));
  const pinThread = (threadId: string) => dispatchThreadCommand(makeThreadPinCommand(threadId));
  const unpinThread = (threadId: string) => dispatchThreadCommand(makeThreadUnpinCommand(threadId));
  const interruptThread = Effect.fn("T3ApplicationLive.interruptThread")(function* (
    threadId: string,
  ) {
    const run = liveRun(yield* orchestration.getThreadProjection(threadId));
    if (run === undefined) {
      return undefined;
    }
    return yield* dispatchThreadCommand(makeRunInterruptCommand({ threadId, runId: run.id }));
  });
  const interruptThreadRun = Effect.fn("T3ApplicationLive.interruptThreadRun")(function* (
    threadId: string,
    runId: string,
  ) {
    if (liveRun(yield* orchestration.getThreadProjection(threadId))?.id !== runId) {
      return undefined;
    }
    return yield* dispatchThreadCommand(makeRunInterruptCommand({ threadId, runId }));
  });
  const deleteThread = Effect.fn("T3ApplicationLive.deleteThread")(function* (threadId: string) {
    yield* getThreadSummary(threadId);
    const dispatch = yield* dispatchThreadCommand(makeThreadDeleteCommand(threadId));
    return { threadId, dispatch };
  });
  const updateThread: T3ThreadApplicationService["updateThread"] = (input) =>
    makeUpdateThread()(input).pipe(
      Effect.provideService(T3Orchestration, orchestration),
      withCrypto,
    );
  const startThread = Effect.fn("T3ApplicationLive.startThread")(function* (
    startInput: StartThreadInput,
    policy?: StartThreadPolicy,
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
    const launchInput = yield* makeThreadLaunchInput({
      start: {
        ...startInput,
        ...(worktreePath !== undefined ? { worktreePath } : {}),
      },
      project: scope.project,
      serverConfig: yield* orchestration.getServerConfig(),
    }).pipe(withCrypto);
    const launched = yield* orchestration.launchThread(launchInput);
    const threadId = launched.threadId;
    if (policy?.onThreadCreated !== undefined) {
      yield* policy.onThreadCreated(threadId);
    }
    const messageId = launchInput.initialMessage.messageId;
    const result = { messageId, project: scope.project, threadId };
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") {
      return result;
    }
    if (until === "visible") {
      return { ...result, projection: launched.projection };
    }
    const projection = yield* awaitThreadCompletion(threadId);
    yield* failIfThreadError(projection);
    return { ...result, projection };
  });
  // Thread ids are random UUIDs, so finding the sender here means it shares this environment.
  const resolveAuthor = Effect.fn("T3ApplicationLive.resolveAuthor")(function* (
    author: MessageAuthor | undefined,
  ) {
    if (author === undefined || author.kind === "user") {
      return { kind: "user" } satisfies MessageAuthor;
    }
    const senderThreadId = author.senderThreadId;
    if (senderThreadId === undefined) {
      return { kind: "agent" } satisfies MessageAuthor;
    }
    const snapshot = yield* loadThreads("all");
    return snapshot.threads.some((thread) => thread.id === senderThreadId)
      ? ({ kind: "agent", senderThreadId } satisfies MessageAuthor)
      : ({ kind: "agent" } satisfies MessageAuthor);
  });
  const sendThread = Effect.fn("T3ApplicationLive.sendThread")(function* (
    input: SendThreadInput,
    policy?: ThreadDispatchPolicy,
  ) {
    const modelSelection =
      input.options !== undefined && input.options.length > 0
        ? mergeModelOptions(
            (yield* orchestration.getThreadProjection(input.threadId)).thread.modelSelection,
            input.options,
          )
        : undefined;
    const command = yield* makeMessageDispatchCommand({
      ...input,
      author: yield* resolveAuthor(input.author),
      ...(modelSelection !== undefined ? { modelSelection } : {}),
    }).pipe(withCrypto);
    const dispatch = yield* orchestration.dispatch(command);
    const messageId = command.messageId;
    const until = policy?.until ?? "dispatch";
    if (until === "dispatch") {
      return { dispatch, messageId, threadId: input.threadId };
    }
    yield* awaitShellSequence(dispatch.sequence);
    if (until === "visible") {
      const projection = yield* orchestration.getThreadProjection(input.threadId);
      return { dispatch, messageId, threadId: input.threadId, projection };
    }
    const projection = yield* awaitThreadCompletion(input.threadId);
    yield* failIfThreadError(projection);
    return { dispatch, messageId, threadId: input.threadId, projection };
  });
  const handoffThread: T3ThreadApplicationService["handoffThread"] = (input) =>
    makeHandoffThread((message) => sendThread(message, { until: "dispatch" }))(input).pipe(
      Effect.provideService(T3Orchestration, orchestration),
      withCrypto,
    );
  const queue = yield* makeThreadQueue().pipe(
    Effect.provideService(T3Orchestration, orchestration),
    withCrypto,
  );
  const watchThread = (threadId: string) => streamThreadEvents(threadId);
  const waitForThread = Effect.fn("T3ApplicationLive.waitForThread")(function* (threadId: string) {
    const projection = yield* awaitThreadCompletion(threadId);
    yield* failIfThreadError(projection);
    return projection;
  });
  const callbackThread = Effect.fn("T3ApplicationLive.callbackThread")(function* (
    input: CallbackThreadInput,
  ) {
    yield* awaitThreadCompletion(input.fromThreadId);
    const result = yield* sendThread(
      {
        threadId: input.targetThreadId,
        message: input.prompt,
        author:
          input.asUser === true
            ? { kind: "user" }
            : { kind: "agent", senderThreadId: input.fromThreadId },
      },
      { until: "dispatch" },
    );
    return { dispatch: result.dispatch, targetThreadId: input.targetThreadId };
  });
  const approveThread = Effect.fn("T3ApplicationLive.approveThread")(function* (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly decision: ProviderApprovalDecision;
  }) {
    const dispatch = yield* dispatchThreadCommand(makeRuntimeRequestRespondCommand(input));
    return { threadId: input.threadId, requestId: input.requestId, dispatch };
  });
  const respondToThread = Effect.fn("T3ApplicationLive.respondToThread")(function* (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly answers: ProviderUserInputAnswers;
  }) {
    const dispatch = yield* dispatchThreadCommand(makeRuntimeRequestRespondCommand(input));
    return { threadId: input.threadId, requestId: input.requestId, dispatch };
  });

  return {
    ...queue,
    approveThread,
    archiveThread,
    awaitShellSequence,
    deleteThread,
    interruptThread,
    interruptThreadRun,
    pinThread,
    settleThread,
    snoozeThread,
    updateThread,
    handoffThread,
    unarchiveThread,
    unpinThread,
    unsnoozeThread,
    unsettleThread,
    listThreads,
    searchThreads,
    getThreadTranscript,
    getThreadProjection,
    getThreadSummary,
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

export type ThreadTranscript = {
  readonly threadId: string;
  readonly snapshotSequence: number;
  /** Chronological timeline rows of this window. */
  readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  readonly hasMoreHistory: boolean;
  /** Pass back as `beforeCursor` to read the rows before this window. */
  readonly beforeCursor: string | null;
  /** Absent for older history pages, which carry timeline rows only. */
  readonly projection: OrchestrationV2ThreadProjection | null;
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
    projects: activeSnapshot.projects,
    threads: dedupeThreadsById([...activeSnapshot.threads, ...archivedSnapshot.threads]),
  };
});

function dedupeThreadsById(threads: ReadonlyArray<OrchestrationV2ThreadShell>) {
  const byId = new Map<string, OrchestrationV2ThreadShell>();
  for (const thread of threads) {
    byId.set(thread.id, thread);
  }
  return [...byId.values()];
}

type AppThread = OrchestrationV2ThreadProjection["thread"];

export type ThreadShow = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: ThreadLifecycleStatus;
  readonly lastError: string | null;
  readonly latestRun: OrchestrationV2Run | null;
  readonly queuedRunCount: number;
  readonly modelSelection: AppThread["modelSelection"];
  readonly runtimeMode: AppThread["runtimeMode"];
  readonly interactionMode: AppThread["interactionMode"];
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly archivedAt: string | null;
  readonly settledAt: string | null;
  readonly snoozedUntil: string | null;
  readonly pinnedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly pendingApprovals: ReadonlyArray<ThreadPendingApproval>;
  readonly pendingUserInputs: ReadonlyArray<ThreadPendingUserInput>;
};

function formatOptionalIso(value: DateTime.Utc | null | undefined) {
  return value === null || value === undefined ? null : DateTime.formatIso(value);
}

function projectThreadShow(projection: OrchestrationV2ThreadProjection): ThreadShow {
  const thread = projection.thread;
  const requests = derivePendingThreadRequests(projection);
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    status: threadStatus(projection),
    lastError: threadLastError(projection),
    latestRun: projection.runs.at(-1) ?? null,
    queuedRunCount: projection.runs.filter((run) => run.status === "queued").length,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    archivedAt: formatOptionalIso(thread.archivedAt),
    settledAt: formatOptionalIso(thread.settledAt),
    snoozedUntil: formatOptionalIso(thread.snoozedUntil),
    pinnedAt: formatOptionalIso(thread.pinnedAt),
    createdAt: DateTime.formatIso(thread.createdAt),
    updatedAt: DateTime.formatIso(thread.updatedAt),
    messageCount: projection.messages.length,
    pendingApprovals: requests.approvals,
    pendingUserInputs: requests.userInputs,
  };
}

function failIfThreadError(projection: OrchestrationV2ThreadProjection) {
  if (threadStatus(projection) !== "failed") {
    return Effect.void;
  }
  return Effect.fail(
    new ThreadSessionError({
      threadId: projection.thread.id,
      message: threadLastError(projection) ?? "thread ended with error",
    }),
  );
}
