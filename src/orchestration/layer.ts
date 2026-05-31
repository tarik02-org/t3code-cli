import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { T3Rpc } from "../rpc/service.ts";
import {
  dispatchCommand,
  getServerConfig,
  getShellSnapshot,
  getThreadSnapshot,
  openThread,
} from "./rpc-adapter.ts";
import { T3Orchestration } from "./service.ts";

export const makeT3Orchestration = Effect.fn("makeT3Orchestration")(function* () {
  const rpc = yield* T3Rpc;

  return {
    dispatch: Effect.fn("T3OrchestrationLive.dispatch")((command) => dispatchCommand(rpc, command)),
    getServerConfig: Effect.fn("T3OrchestrationLive.getServerConfig")(function* () {
      return yield* getServerConfig(rpc);
    }),
    getShellSnapshot: Effect.fn("T3OrchestrationLive.getShellSnapshot")(function* () {
      return yield* getShellSnapshot(rpc);
    }),
    getThreadSnapshot: Effect.fn("T3OrchestrationLive.getThreadSnapshot")(function* (
      threadId: string,
    ) {
      return yield* getThreadSnapshot(rpc, threadId);
    }),
    openThread: Effect.fn("T3OrchestrationLive.openThread")(function* (threadId: string) {
      return yield* openThread(rpc, threadId);
    }),
  };
});

export const T3OrchestrationLive = Layer.effect(T3Orchestration, makeT3Orchestration());
