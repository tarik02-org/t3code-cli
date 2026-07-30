import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  ServerSettingsError,
  TerminalError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { RpcClientError } from "effect/unstable/rpc";

import { T3CodeConnectionError } from "../connection/error.ts";

const RpcErrorCauseSchema = Schema.Union([
  RpcClientError.RpcClientError,
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  ServerSettingsError,
  TerminalError,
  ConnectionBlockedError,
  ConnectionTransientError,
  T3CodeConnectionError,
]);

export type RpcKnownCause = Schema.Schema.Type<typeof RpcErrorCauseSchema>;

export class RpcError extends Schema.TaggedErrorClass<RpcError>()("RpcError", {
  message: Schema.String,
  method: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(RpcErrorCauseSchema),
}) {}

export type OrchestrationError = RpcError;
