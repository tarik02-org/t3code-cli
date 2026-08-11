import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type {
  ClientOrchestrationCommand,
  DispatchResult,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  OrchestrationSearchThreadsInput,
  OrchestrationSearchThreadsResult,
  OrchestrationThread,
  OrchestrationThreadStreamItem,
  ServerProviders,
} from "@t3tools/contracts";

import type { RpcError } from "../rpc/error.ts";

export type OrchestrationError = RpcError;

export type OpenThread = {
  readonly snapshot: OrchestrationThread;
  readonly events: Stream.Stream<OrchestrationEvent, OrchestrationError>;
};

export type ServerConfigForCli = {
  readonly providers: ServerProviders;
};

export type Orchestration = {
  readonly dispatch: (
    command: ClientOrchestrationCommand,
  ) => Effect.Effect<DispatchResult, OrchestrationError>;
  readonly getServerConfig: () => Effect.Effect<ServerConfigForCli, OrchestrationError>;
  readonly getShellSnapshot: () => Effect.Effect<OrchestrationShellSnapshot, OrchestrationError>;
  readonly getArchivedShellSnapshot: () => Effect.Effect<
    OrchestrationShellSnapshot,
    OrchestrationError
  >;
  readonly searchThreads: (
    input: OrchestrationSearchThreadsInput,
  ) => Effect.Effect<OrchestrationSearchThreadsResult, OrchestrationError>;
  readonly getThreadSnapshot: (
    threadId: string,
  ) => Effect.Effect<OrchestrationThread, OrchestrationError>;
  readonly watchShellSnapshots: () => Stream.Stream<
    OrchestrationShellSnapshot,
    OrchestrationError,
    Scope.Scope
  >;
  readonly watchShellSequence: () => Stream.Stream<number, OrchestrationError, Scope.Scope>;
  readonly watchThreadItems: (
    threadId: string,
  ) => Stream.Stream<OrchestrationThreadStreamItem, OrchestrationError, Scope.Scope>;
  readonly openThread: (
    threadId: string,
  ) => Effect.Effect<OpenThread, OrchestrationError, Scope.Scope>;
};

export class T3Orchestration extends Context.Service<T3Orchestration, Orchestration>()(
  "t3cli/T3Orchestration",
) {}
