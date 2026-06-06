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
type TaggedLike = object & { readonly _tag?: string };

export function isRpcClientError(error: TaggedLike): error is RpcClientError.RpcClientError {
  return hasTag(error, "RpcClientError");
}

export function isRpcError(error: TaggedLike): error is RpcError {
  return hasTag(error, "RpcError");
}

function hasTag(error: TaggedLike, tag: string): error is { readonly _tag: string } {
  return error?.["_tag"] === tag;
}
