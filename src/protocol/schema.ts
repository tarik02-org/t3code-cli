import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  ClientOrchestrationCommandSchema,
  DispatchResultSchema,
} from "../domain/command-schema.ts";
import {
  ProjectShellSchema,
  ServerConfigSchema,
  ShellSnapshotSchema,
  ThreadDetailSchema,
  ThreadEventSchema,
  ThreadShellSchema,
} from "../domain/schema.ts";
import { RpcError } from "../rpc/error.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const WS_METHODS = {
  serverGetConfig: "server.getConfig",
} as const;

export const ThreadStreamItemSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: Schema.Struct({ thread: ThreadDetailSchema }),
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: ThreadEventSchema,
  }),
]);
export type ThreadStreamItem = typeof ThreadStreamItemSchema.Type;

export const ShellStreamItemSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: ShellSnapshotSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: Schema.Number,
    project: ProjectShellSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: Schema.Number,
    projectId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: Schema.Number,
    thread: ThreadShellSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: Schema.Number,
    threadId: Schema.String,
  }),
]);
export type ShellStreamItem = typeof ShellStreamItemSchema.Type;

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommandSchema,
    success: DispatchResultSchema,
    error: RpcError,
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: Schema.Struct({}),
  success: ShellStreamItemSchema,
  error: RpcError,
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: Schema.Struct({ threadId: Schema.String }),
    success: ThreadStreamItemSchema,
    error: RpcError,
    stream: true,
  },
);

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigSchema,
  error: RpcError,
});

export const WsRpcGroup = RpcGroup.make(
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsServerGetConfigRpc,
);
