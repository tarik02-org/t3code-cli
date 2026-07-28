import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ServerSettingsError,
  TerminalError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { HttpClientError } from "effect/unstable/http";
import { RpcClientError } from "effect/unstable/rpc";

import { AuthTransportError } from "../auth/error.ts";
import { T3CodeConnectionError } from "../connection/error.ts";
import { UrlError } from "../config/url/error.ts";

const RpcErrorCauseSchema = Schema.Union([
  RpcClientError.RpcClientError,
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ServerSettingsError,
  TerminalError,
  ConnectionBlockedError,
  ConnectionTransientError,
  AuthTransportError,
  T3CodeConnectionError,
  HttpClientError.HttpClientErrorSchema,
  UrlError,
  Schema.instanceOf(Schema.SchemaError),
]);

export type RpcKnownCause = Schema.Schema.Type<typeof RpcErrorCauseSchema>;

export class RpcError extends Schema.TaggedErrorClass<RpcError>()("RpcError", {
  message: Schema.String,
  method: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(RpcErrorCauseSchema),
}) {}

export type OrchestrationError = RpcError;
