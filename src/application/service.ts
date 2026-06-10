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
  ServerProvider,
} from "#t3tools/contracts";

import type { ApplicationError } from "./error.ts";

export type StartThreadInput = {
  readonly projectRef?: string;
  readonly message: string;
  readonly title?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly options?: NonNullable<ModelSelection["options"]>;
  readonly worktreePath?: string;
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

export type UpdateThreadInput = {
  readonly threadId: string;
  readonly title?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly options?: NonNullable<ModelSelection["options"]>;
  readonly branch?: string;
  readonly clearBranch?: boolean;
  readonly worktreePath?: string;
  readonly clearWorktree?: boolean;
};

export type StartThreadPolicy = {
  readonly until: "dispatch" | "visible" | "complete";
};

export type WaitEvent =
  | { readonly type: "thread"; readonly thread: OrchestrationThread }
  | { readonly type: "message"; readonly message: OrchestrationMessage }
  | { readonly type: "status"; readonly status: string; readonly threadId: string }
  | { readonly type: "done"; readonly thread: OrchestrationThread };

export class T3Application extends Context.Service<
  T3Application,
  {
    readonly loadShell: () => Effect.Effect<OrchestrationShellSnapshot, ApplicationError>;
    readonly listModels: (input: {
      readonly all?: boolean;
      readonly provider?: string;
    }) => Effect.Effect<ReadonlyArray<ServerProvider>, ApplicationError>;
    readonly addProject: (input: {
      readonly path: string;
      readonly title?: string;
    }) => Effect.Effect<
      { readonly dispatch: DispatchResult; readonly project: OrchestrationProjectShell },
      ApplicationError
    >;
    readonly listThreads: (projectRef: string) => Effect.Effect<
      {
        readonly project: OrchestrationProjectShell;
        readonly threads: ReadonlyArray<OrchestrationThreadShell>;
      },
      ApplicationError
    >;
    readonly getThreadMessages: (
      threadId: string,
    ) => Effect.Effect<OrchestrationThread, ApplicationError>;
    readonly archiveThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
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
  }
>()("t3cli/T3Application") {}
