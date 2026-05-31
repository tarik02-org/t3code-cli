import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type { ClientOrchestrationCommand, DispatchResult } from "../domain/command-schema.ts";
import type { ServerConfig, ShellSnapshot, ThreadDetail, ThreadEvent } from "../domain/schema.ts";
import type { RpcError } from "../rpc/error.ts";

export type OrchestrationError = RpcError;

export type OpenThread = {
  readonly snapshot: ThreadDetail;
  readonly events: Stream.Stream<ThreadEvent, OrchestrationError>;
};

export type Orchestration = {
  readonly dispatch: (
    command: ClientOrchestrationCommand,
  ) => Effect.Effect<DispatchResult, OrchestrationError>;
  readonly getServerConfig: () => Effect.Effect<ServerConfig, OrchestrationError>;
  readonly getShellSnapshot: () => Effect.Effect<ShellSnapshot, OrchestrationError>;
  readonly getThreadSnapshot: (threadId: string) => Effect.Effect<ThreadDetail, OrchestrationError>;
  readonly watchShellSequence: () => Stream.Stream<number, OrchestrationError, Scope.Scope>;
  readonly openThread: (
    threadId: string,
  ) => Effect.Effect<OpenThread, OrchestrationError, Scope.Scope>;
};

export class T3Orchestration extends Context.Service<T3Orchestration, Orchestration>()(
  "t3cli/T3Orchestration",
) {}
