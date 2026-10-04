import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type {
  OrchestrationSearchThreadsInput,
  OrchestrationSearchThreadsResult,
  OrchestrationV2ArchivedShellSnapshot,
  OrchestrationV2Command,
  OrchestrationV2DispatchCommandResult,
  OrchestrationV2DomainEvent,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadBoundedSnapshot,
  OrchestrationV2ThreadDetailSnapshot,
  OrchestrationV2ThreadHistoryPage,
  OrchestrationV2ThreadLaunchInput,
  OrchestrationV2ThreadLaunchResult,
  OrchestrationV2ThreadProjection,
  Project,
  ProjectMutation,
  ServerConfig,
} from "@t3tools/contracts";

import type { ThreadSnapshotRequestError } from "./error.ts";
import type { RpcError } from "../rpc/error.ts";

export type OrchestrationError = RpcError | ThreadSnapshotRequestError;

/** A thread projection as of `sequence`; `event` is the change that produced it. */
export interface ThreadState {
  readonly sequence: number;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly event: OrchestrationV2DomainEvent | null;
}

export type Orchestration = {
  readonly dispatch: (
    command: OrchestrationV2Command,
  ) => Effect.Effect<OrchestrationV2DispatchCommandResult, OrchestrationError>;
  readonly mutateProject: (mutation: ProjectMutation) => Effect.Effect<Project, OrchestrationError>;
  readonly launchThread: (
    input: OrchestrationV2ThreadLaunchInput,
  ) => Effect.Effect<OrchestrationV2ThreadLaunchResult, OrchestrationError>;
  readonly getServerConfig: () => Effect.Effect<ServerConfig, OrchestrationError>;
  readonly getShellSnapshot: () => Effect.Effect<OrchestrationV2ShellSnapshot, OrchestrationError>;
  readonly getArchivedShellSnapshot: () => Effect.Effect<
    OrchestrationV2ArchivedShellSnapshot,
    OrchestrationError
  >;
  readonly searchThreads: (
    input: OrchestrationSearchThreadsInput,
  ) => Effect.Effect<OrchestrationSearchThreadsResult, OrchestrationError>;
  readonly getThreadProjection: (
    threadId: string,
  ) => Effect.Effect<OrchestrationV2ThreadProjection, OrchestrationError>;
  readonly getThreadDetailSnapshot: (
    threadId: string,
  ) => Effect.Effect<OrchestrationV2ThreadDetailSnapshot, OrchestrationError>;
  readonly getThreadBoundedSnapshot: (
    threadId: string,
  ) => Effect.Effect<OrchestrationV2ThreadBoundedSnapshot, OrchestrationError>;
  readonly getThreadHistoryPage: (input: {
    readonly threadId: string;
    readonly cursor: string;
  }) => Effect.Effect<OrchestrationV2ThreadHistoryPage, OrchestrationError>;
  readonly watchShellSequence: () => Stream.Stream<number, OrchestrationError, Scope.Scope>;
  readonly watchThread: (
    threadId: string,
  ) => Stream.Stream<ThreadState, OrchestrationError, Scope.Scope>;
};

export class T3Orchestration extends Context.Service<T3Orchestration, Orchestration>()(
  "t3cli/T3Orchestration",
) {}
