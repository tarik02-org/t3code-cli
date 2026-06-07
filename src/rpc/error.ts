import * as Schema from "effect/Schema";
import {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ServerSettingsError,
} from "#t3tools/contracts";
import { HttpClientError } from "effect/unstable/http";
import { RpcClientError } from "effect/unstable/rpc";

import { AuthTransportError } from "../auth/error.ts";
import { T3CodeConnectionError } from "../connection/error.ts";
import { UrlError } from "../config/error.ts";

const RpcErrorCauseSchema = Schema.Union([
  RpcClientError.RpcClientError,
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ServerSettingsError,
  AuthTransportError,
  T3CodeConnectionError,
  HttpClientError.HttpClientErrorSchema,
  UrlError,
  Schema.instanceOf(Schema.SchemaError),
]);

export class RpcError extends Schema.TaggedErrorClass<RpcError>()("RpcError", {
  message: Schema.String,
  method: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(RpcErrorCauseSchema),
}) {}

export type OrchestrationError = RpcError;
