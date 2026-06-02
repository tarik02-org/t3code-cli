import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { ApplicationError } from "./error.ts";
import type { DispatchResult } from "../domain/command-schema.ts";
import type {
  ProjectShell,
  ServerProvider,
  ShellSnapshot,
  ThreadDetail,
  ThreadMessage,
  ThreadShell,
} from "../domain/schema.ts";

export type StartThreadInput = {
  readonly projectRef: string;
  readonly message: string;
  readonly title?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly worktreePath?: string;
};

export type SendThreadInput = {
  readonly threadId: string;
  readonly message: string;
};

export type StartThreadPolicy = {
  readonly until: "dispatch" | "visible" | "complete";
};

export type WaitEvent =
  | { readonly type: "thread"; readonly thread: ThreadDetail }
  | { readonly type: "message"; readonly message: ThreadMessage }
  | { readonly type: "status"; readonly status: string; readonly threadId: string }
  | { readonly type: "done"; readonly thread: ThreadDetail };

export class T3Application extends Context.Service<
  T3Application,
  {
    readonly loadShell: () => Effect.Effect<ShellSnapshot, ApplicationError>;
    readonly listModels: (input: {
      readonly all?: boolean;
      readonly provider?: string;
    }) => Effect.Effect<ReadonlyArray<ServerProvider>, ApplicationError>;
    readonly addProject: (input: {
      readonly path: string;
      readonly title?: string;
    }) => Effect.Effect<
      { readonly dispatch: DispatchResult; readonly project: ProjectShell },
      ApplicationError
    >;
    readonly listThreads: (projectRef: string) => Effect.Effect<
      {
        readonly project: ProjectShell;
        readonly threads: ReadonlyArray<ThreadShell>;
      },
      ApplicationError
    >;
    readonly getThreadMessages: (threadId: string) => Effect.Effect<ThreadDetail, ApplicationError>;
    readonly archiveThread: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
    readonly startThread: (
      input: StartThreadInput,
      policy?: StartThreadPolicy,
    ) => Effect.Effect<
      {
        readonly dispatch: DispatchResult;
        readonly project: ProjectShell;
        readonly threadId: string;
        readonly thread?: ThreadDetail;
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
        readonly thread?: ThreadDetail;
      },
      ApplicationError
    >;
    readonly watchThread: (threadId: string) => Stream.Stream<WaitEvent, ApplicationError>;
    readonly waitForThread: (threadId: string) => Effect.Effect<ThreadDetail, ApplicationError>;
  }
>()("t3cli/T3Application") {}
