import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type {
  DispatchResult,
  ModelSelection,
  OrchestrationMessage,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadShell,
  ProviderUserInputAnswers,
  ServerProvider,
  TerminalAttachStreamEvent,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalSessionSnapshot,
  TerminalSummary,
} from "#t3tools/contracts";

import type { ApplicationError } from "./error.ts";
import type { ThreadShow } from "./threads.ts";

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
};

export type TerminalRef = {
  readonly threadId: string;
  readonly terminalId: string;
};

export type TerminalAttachTarget = TerminalRef & {
  readonly cwd: string;
  readonly worktreePath: string | null;
};

export type SendThreadInput = {
  readonly threadId: string;
  readonly message: string;
  readonly options?: NonNullable<ModelSelection["options"]>;
};

export type CallbackThreadInput = {
  readonly fromThreadId: string;
  readonly targetThreadId: string;
  readonly prompt: string;
};

export type ListThreadsInclude = "active" | "archived" | "all";

export type UpdateThreadInput = {
  readonly threadId: string;
  readonly title?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly options?: NonNullable<ModelSelection["options"]>;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
};

export type StartThreadPolicy = {
  readonly until: "dispatch" | "visible" | "complete";
};

export type WaitEvent =
  | { readonly type: "thread"; readonly thread: OrchestrationThread }
  | { readonly type: "message"; readonly message: OrchestrationMessage }
  | { readonly type: "status"; readonly status: string; readonly threadId: string }
  | { readonly type: "done"; readonly thread: OrchestrationThread };

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
  readonly loadShell: () => Effect.Effect<OrchestrationShellSnapshot, ApplicationError>;
  readonly addProject: (input: {
    readonly path: string;
    readonly title?: string;
  }) => Effect.Effect<
    { readonly dispatch: DispatchResult; readonly project: OrchestrationProjectShell },
    ApplicationError
  >;
  readonly resolveProject: (
    projectRef: string,
  ) => Effect.Effect<OrchestrationProjectShell, ApplicationError>;
  readonly deleteProject: (input: {
    readonly projectId: string;
    readonly force?: boolean;
  }) => Effect.Effect<
    { readonly projectId: string; readonly dispatch: DispatchResult },
    ApplicationError
  >;
};

export class T3ProjectApplication extends Context.Service<
  T3ProjectApplication,
  T3ProjectApplicationService
>()("t3cli/T3ProjectApplication") {}

export type T3ThreadApplicationService = {
  readonly listThreads: (
    projectRef: string,
    options?: {
      readonly include?: ListThreadsInclude;
    },
  ) => Effect.Effect<
    {
      readonly project: OrchestrationProjectShell;
      readonly threads: ReadonlyArray<OrchestrationThreadShell>;
    },
    ApplicationError
  >;
  readonly getThreadMessages: (
    threadId: string,
  ) => Effect.Effect<OrchestrationThread, ApplicationError>;
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
  readonly interruptThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
  readonly unarchiveThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
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
      readonly dispatch: DispatchResult;
      readonly project: OrchestrationProjectShell;
      readonly threadId: string;
      readonly thread?: OrchestrationThread;
    },
    ApplicationError
  >;
  readonly sendThread: (
    input: SendThreadInput,
    policy?: StartThreadPolicy,
  ) => Effect.Effect<
    {
      readonly dispatch: DispatchResult;
      readonly threadId: string;
      readonly thread?: OrchestrationThread;
    },
    ApplicationError
  >;
  readonly watchThread: (threadId: string) => Stream.Stream<WaitEvent, ApplicationError>;
  readonly waitForThread: (
    threadId: string,
  ) => Effect.Effect<OrchestrationThread, ApplicationError>;
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
  readonly watchTerminalEvents: (
    terminal: TerminalRef,
  ) => Stream.Stream<TerminalEvent, ApplicationError>;
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
  T3ProjectApplicationService &
  T3ThreadApplicationService &
  T3TerminalApplicationService;

export class T3Application extends Context.Service<T3Application, T3ApplicationService>()(
  "t3cli/T3Application",
) {}
