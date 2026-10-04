import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type {
  ModelSelection,
  OrchestrationProjectShell,
  OrchestrationSearchThreadsInput,
  OrchestrationV2ConversationMessage,
  OrchestrationV2DispatchCommandResult,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  Project,
  ProjectScript,
  ProjectScriptIcon,
  ProviderUserInputAnswers,
  ServerProvider,
  TerminalAttachStreamEvent,
  TerminalMetadataStreamEvent,
  TerminalSessionSnapshot,
  TerminalSummary,
} from "@t3tools/contracts";

import type { ApplicationError } from "./error.ts";
import type { QueuedRun } from "./thread-queue.ts";
import type { ThreadSearchResult, ThreadShow, ThreadTranscript } from "./threads.ts";

export type DispatchResult = OrchestrationV2DispatchCommandResult;

export type StartThreadInput = {
  readonly projectRef?: string;
  readonly message: string;
  readonly title?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly options?: NonNullable<ModelSelection["options"]>;
  readonly worktreePath?: string;
};

export type CreateTerminalInput = {
  readonly threadId: string;
  readonly terminalId?: string;
  readonly command?: string;
  readonly env?: Readonly<Record<string, string>>;
};

export type TerminalRef = {
  readonly threadId: string;
  readonly terminalId: string;
};

export type TerminalAttachTarget = TerminalRef & {
  readonly cwd: string;
  readonly worktreePath: string | null;
};

/**
 * How a message reaches a thread with a run in flight. `auto` lets the server pick from the
 * provider's capabilities; the others queue behind, steer, or restart the active run.
 */
export type SendMode = "auto" | "queue" | "steer" | "restart";

/**
 * Who a message is attributed to. An agent may name the thread it acts for; the id is sent
 * only when that thread exists in the target environment, since remote environments have
 * their own threads.
 */
export type MessageAuthor =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly senderThreadId?: string };

export type SendThreadInput = {
  readonly threadId: string;
  readonly message: string;
  readonly options?: NonNullable<ModelSelection["options"]>;
  readonly mode?: SendMode;
  /** Defaults to the user. */
  readonly author?: MessageAuthor;
};

export type CallbackThreadInput = {
  readonly fromThreadId: string;
  readonly targetThreadId: string;
  readonly prompt: string;
  /** Attributes the message to the user instead of an agent acting for `fromThreadId`. */
  readonly asUser?: boolean;
};

export interface QueuedRunRef {
  readonly threadId: string;
  readonly runId: string;
}

export interface SnoozeThreadInput {
  readonly threadId: string;
  readonly snoozedUntil: string;
}

export type ListThreadsInclude = "active" | "archived" | "all";

export interface GetThreadTranscriptInput {
  readonly threadId: string;
  /** Opaque cursor from a previous page; omitted for the most recent window. */
  readonly beforeCursor?: string;
  readonly all?: boolean;
}

export type UpdateThreadInput = {
  readonly threadId: string;
  readonly title?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly options?: NonNullable<ModelSelection["options"]>;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
};

export interface ThreadDispatchPolicy {
  readonly until: "dispatch" | "visible" | "complete";
}

export interface StartThreadPolicy extends ThreadDispatchPolicy {
  readonly onThreadCreated?: (threadId: string) => Effect.Effect<void>;
}

export type WaitEvent =
  | { readonly type: "thread"; readonly projection: OrchestrationV2ThreadProjection }
  | { readonly type: "message"; readonly message: OrchestrationV2ConversationMessage }
  | {
      readonly type: "status";
      readonly status: string;
      readonly threadId: string;
      readonly projection: OrchestrationV2ThreadProjection;
    }
  | { readonly type: "done"; readonly projection: OrchestrationV2ThreadProjection };

export type ProjectActionSelector =
  | { readonly id: string; readonly name?: never }
  | { readonly id?: never; readonly name: string };

export type AddProjectActionInput = {
  readonly projectRef: string;
  readonly id?: string;
  readonly name: string;
  readonly command: string;
  readonly icon?: ProjectScriptIcon;
  readonly setup?: boolean;
  readonly previewUrl?: string;
  readonly autoOpenPreview?: boolean;
};

export type UpdateProjectActionInput = {
  readonly projectRef: string;
  readonly selector: ProjectActionSelector;
  readonly name?: string;
  readonly command?: string;
  readonly icon?: ProjectScriptIcon;
  readonly setup?: boolean;
  readonly previewUrl?: string | null;
  readonly autoOpenPreview?: boolean | null;
};

export type ProjectActionMutationResult = {
  readonly project: Project;
  readonly action: ProjectScript;
};

export type ProjectActionDeleteResult = {
  readonly project: Project;
  readonly action: ProjectScript;
};

export type ProjectActionRunResult = {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly terminal: TerminalSessionSnapshot;
};

export type T3ActionApplicationService = {
  readonly listActions: (projectRef: string) => Effect.Effect<
    {
      readonly project: OrchestrationProjectShell;
      readonly actions: ReadonlyArray<ProjectScript>;
    },
    ApplicationError
  >;
  readonly addAction: (
    input: AddProjectActionInput,
  ) => Effect.Effect<ProjectActionMutationResult, ApplicationError>;
  readonly updateAction: (
    input: UpdateProjectActionInput,
  ) => Effect.Effect<ProjectActionMutationResult, ApplicationError>;
  readonly deleteAction: (input: {
    readonly projectRef: string;
    readonly selector: ProjectActionSelector;
  }) => Effect.Effect<ProjectActionDeleteResult, ApplicationError>;
  readonly runAction: (input: {
    readonly threadId: string;
    readonly selector: ProjectActionSelector;
    readonly terminalId?: string;
  }) => Effect.Effect<ProjectActionRunResult, ApplicationError>;
};

export class T3ActionApplication extends Context.Service<
  T3ActionApplication,
  T3ActionApplicationService
>()("t3cli/T3ActionApplication") {}

export type T3ModelApplicationService = {
  readonly listModels: (input: {
    readonly all?: boolean;
    readonly provider?: string;
  }) => Effect.Effect<ReadonlyArray<ServerProvider>, ApplicationError>;
};

export class T3ModelApplication extends Context.Service<
  T3ModelApplication,
  T3ModelApplicationService
>()("t3cli/T3ModelApplication") {}

export type T3ProjectApplicationService = {
  readonly loadShell: () => Effect.Effect<OrchestrationV2ShellSnapshot, ApplicationError>;
  readonly addProject: (input: {
    readonly path: string;
    readonly title?: string;
  }) => Effect.Effect<{ readonly project: Project }, ApplicationError>;
  readonly resolveProject: (
    projectRef: string,
  ) => Effect.Effect<OrchestrationProjectShell, ApplicationError>;
  readonly deleteProject: (input: {
    readonly projectId: string;
    readonly force?: boolean;
  }) => Effect.Effect<{ readonly projectId: string }, ApplicationError>;
};

export class T3ProjectApplication extends Context.Service<
  T3ProjectApplication,
  T3ProjectApplicationService
>()("t3cli/T3ProjectApplication") {}

export type T3ThreadApplicationService = {
  readonly awaitShellSequence: (sequence: number) => Effect.Effect<void, ApplicationError>;
  readonly searchThreads: (
    input: OrchestrationSearchThreadsInput,
  ) => Effect.Effect<ReadonlyArray<ThreadSearchResult>, ApplicationError>;
  readonly listThreads: (
    projectRef: string,
    options?: {
      readonly include?: ListThreadsInclude;
    },
  ) => Effect.Effect<
    {
      readonly project: OrchestrationProjectShell;
      readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
    },
    ApplicationError
  >;
  readonly getThreadTranscript: (
    input: GetThreadTranscriptInput,
  ) => Effect.Effect<ThreadTranscript, ApplicationError>;
  readonly getThreadProjection: (
    threadId: string,
  ) => Effect.Effect<OrchestrationV2ThreadProjection, ApplicationError>;
  readonly getThreadSummary: (
    threadId: string,
  ) => Effect.Effect<OrchestrationV2ThreadShell, ApplicationError>;
  readonly showThread: (threadId: string) => Effect.Effect<ThreadShow, ApplicationError>;
  readonly approveThread: (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly decision: "accept" | "decline" | "cancel";
  }) => Effect.Effect<
    { readonly threadId: string; readonly requestId: string; readonly dispatch: DispatchResult },
    ApplicationError
  >;
  readonly respondToThread: (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly answers: ProviderUserInputAnswers;
  }) => Effect.Effect<
    { readonly threadId: string; readonly requestId: string; readonly dispatch: DispatchResult },
    ApplicationError
  >;
  readonly archiveThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  /** Stops the live run; succeeds with `undefined` when nothing is running. */
  readonly interruptThread: (
    threadId: string,
  ) => Effect.Effect<DispatchResult | undefined, ApplicationError>;
  /** Stops `runId` only while it is still live. */
  readonly interruptThreadRun: (
    threadId: string,
    runId: string,
  ) => Effect.Effect<DispatchResult | undefined, ApplicationError>;
  readonly listQueuedRuns: (
    threadId: string,
  ) => Effect.Effect<ReadonlyArray<QueuedRun>, ApplicationError>;
  readonly cancelQueuedRun: (
    input: QueuedRunRef,
  ) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly editQueuedRun: (
    input: QueuedRunRef & { readonly text: string },
  ) => Effect.Effect<DispatchResult, ApplicationError>;
  /** `beforeRunId: null` moves the run to the end of the queue. */
  readonly moveQueuedRun: (
    input: QueuedRunRef & { readonly beforeRunId: string | null },
  ) => Effect.Effect<DispatchResult, ApplicationError>;
  /** Merges a queued message into the running run instead of waiting for it to finish. */
  readonly steerQueuedRun: (input: QueuedRunRef) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly resumeQueue: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly pinThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly settleThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly snoozeThread: (
    input: SnoozeThreadInput,
  ) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly unarchiveThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly unpinThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly unsnoozeThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly unsettleThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly deleteThread: (
    threadId: string,
  ) => Effect.Effect<
    { readonly threadId: string; readonly dispatch: DispatchResult },
    ApplicationError
  >;
  readonly updateThread: (
    input: UpdateThreadInput,
  ) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly startThread: (
    input: StartThreadInput,
    policy?: StartThreadPolicy,
  ) => Effect.Effect<
    {
      readonly messageId: string;
      readonly project: OrchestrationProjectShell;
      readonly threadId: string;
      readonly projection?: OrchestrationV2ThreadProjection;
    },
    ApplicationError
  >;
  readonly sendThread: (
    input: SendThreadInput,
    policy?: ThreadDispatchPolicy,
  ) => Effect.Effect<
    {
      readonly dispatch: DispatchResult;
      readonly messageId: string;
      readonly threadId: string;
      readonly projection?: OrchestrationV2ThreadProjection;
    },
    ApplicationError
  >;
  readonly watchThread: (threadId: string) => Stream.Stream<WaitEvent, ApplicationError>;
  readonly waitForThread: (
    threadId: string,
  ) => Effect.Effect<OrchestrationV2ThreadProjection, ApplicationError>;
  readonly callbackThread: (input: CallbackThreadInput) => Effect.Effect<
    {
      readonly dispatch: DispatchResult;
      readonly targetThreadId: string;
    },
    ApplicationError
  >;
};

export class T3ThreadApplication extends Context.Service<
  T3ThreadApplication,
  T3ThreadApplicationService
>()("t3cli/T3ThreadApplication") {}

export type T3TerminalApplicationService = {
  readonly listTerminals: (
    threadId: string,
  ) => Effect.Effect<ReadonlyArray<TerminalSummary>, ApplicationError>;
  readonly getTerminal: (terminal: TerminalRef) => Effect.Effect<TerminalSummary, ApplicationError>;
  readonly createTerminal: (
    input: CreateTerminalInput,
  ) => Effect.Effect<TerminalSessionSnapshot, ApplicationError>;
  readonly attachTerminal: (input: {
    readonly terminal: TerminalAttachTarget;
    readonly cols?: number;
    readonly rows?: number;
  }) => Stream.Stream<TerminalAttachStreamEvent, ApplicationError>;
  readonly watchTerminalMetadata: () => Stream.Stream<
    TerminalMetadataStreamEvent,
    ApplicationError
  >;
  readonly writeTerminal: (input: {
    readonly terminal: TerminalRef;
    readonly data: string;
  }) => Effect.Effect<void, ApplicationError>;
  readonly resizeTerminal: (input: {
    readonly terminal: TerminalRef;
    readonly cols: number;
    readonly rows: number;
  }) => Effect.Effect<void, ApplicationError>;
  readonly destroyTerminal: (terminal: TerminalRef) => Effect.Effect<void, ApplicationError>;
};

export class T3TerminalApplication extends Context.Service<
  T3TerminalApplication,
  T3TerminalApplicationService
>()("t3cli/T3TerminalApplication") {}

export type T3ApplicationService = T3ModelApplicationService &
  T3ActionApplicationService &
  T3ProjectApplicationService &
  T3ThreadApplicationService &
  T3TerminalApplicationService;

export class T3Application extends Context.Service<T3Application, T3ApplicationService>()(
  "t3cli/T3Application",
) {}
