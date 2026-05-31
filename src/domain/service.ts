import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  ProjectShell,
  ShellSnapshot,
  ThreadDetail,
  ThreadMessage,
  ThreadShell,
} from "./schema.ts";
import type { DispatchResult } from "./command-schema.ts";
import type { DomainError } from "./error.ts";

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

export class T3Domain extends Context.Service<
  T3Domain,
  {
    readonly loadShell: () => Effect.Effect<ShellSnapshot, DomainError>;
    readonly addProject: (input: {
      readonly path: string;
      readonly title?: string;
    }) => Effect.Effect<
      { readonly dispatch: DispatchResult; readonly project: ProjectShell },
      DomainError
    >;
    readonly listThreads: (projectRef: string) => Effect.Effect<
      {
        readonly project: ProjectShell;
        readonly threads: ReadonlyArray<ThreadShell>;
      },
      DomainError
    >;
    readonly getThreadMessages: (threadId: string) => Effect.Effect<ThreadDetail, DomainError>;
    readonly archiveThread: (threadId: string) => Effect.Effect<DispatchResult, DomainError>;
    readonly startThread: <E = never, R = never>(
      input: StartThreadInput,
      policy?: StartThreadPolicy & {
        readonly onEvent?: (event: WaitEvent) => Effect.Effect<void, E, R>;
      },
    ) => Effect.Effect<
      {
        readonly dispatch: DispatchResult;
        readonly project: ProjectShell;
        readonly threadId: string;
        readonly thread?: ThreadDetail;
      },
      DomainError | E,
      R
    >;
    readonly sendThread: <E = never, R = never>(
      input: SendThreadInput,
      policy?: StartThreadPolicy & {
        readonly onEvent?: (event: WaitEvent) => Effect.Effect<void, E, R>;
      },
    ) => Effect.Effect<
      {
        readonly dispatch: DispatchResult;
        readonly threadId: string;
        readonly thread?: ThreadDetail;
      },
      DomainError | E,
      R
    >;
    readonly waitForThread: <E = never, R = never>(
      threadId: string,
      onEvent?: (event: WaitEvent) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<ThreadDetail, DomainError | E, R>;
  }
>()("t3cli/T3Domain") {}
