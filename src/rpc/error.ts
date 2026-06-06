import * as Schema from "effect/Schema";
import {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ServerSettingsError,
  TerminalCwdError,
  TerminalHistoryError,
  TerminalNotRunningError,
  TerminalSessionLookupError,
} from "#t3tools/contracts";
import { HttpClientError } from "effect/unstable/http";
import { RpcClientError } from "effect/unstable/rpc";

import {
  AuthConfigError,
  AuthLocalError,
  AuthPairingUrlError,
  AuthTransportError,
} from "../auth/error.ts";
import { ConfigError, UrlError } from "../config/error.ts";

const RpcErrorCauseSchema = Schema.Union([
  RpcClientError.RpcClientError,
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ServerSettingsError,
  TerminalCwdError,
  TerminalHistoryError,
  TerminalNotRunningError,
  TerminalSessionLookupError,
  AuthConfigError,
  AuthLocalError,
  AuthPairingUrlError,
  AuthTransportError,
  ConfigError,
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
