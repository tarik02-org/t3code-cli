import * as Schema from "effect/Schema";
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
  AuthConfigError,
  AuthLocalError,
  AuthPairingUrlError,
  AuthTransportError,
  ConfigError,
  UrlError,
]);

export class RpcError extends Schema.TaggedErrorClass<RpcError>()("RpcError", {
  message: Schema.String,
  method: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(RpcErrorCauseSchema),
}) {}

export type OrchestrationError = RpcError;
