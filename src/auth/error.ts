import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { PlatformError } from "effect/PlatformError";

import { ConfigError } from "../config/error.ts";
import { UrlError } from "../config/url/error.ts";
import { RemoteEnvironmentAuthErrorSchema } from "./remote-error.ts";

export class AuthPairingUrlError extends Schema.TaggedError<AuthPairingUrlError>()(
  "AuthPairingUrlError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.instanceOf(Cause.IllegalArgumentError)),
  },
) {}

export class AuthConfigError extends Schema.TaggedError<AuthConfigError>()("AuthConfigError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Union([ConfigError, UrlError])),
}) {}

export class AuthTransportError extends Schema.TaggedError<AuthTransportError>()(
  "AuthTransportError",
  {
    message: Schema.String,
    cause: RemoteEnvironmentAuthErrorSchema,
  },
) {}

const AuthLocalErrorCauseSchema = Schema.Union([
  Schema.instanceOf(PlatformError),
  Schema.instanceOf(Schema.SchemaError),
  UrlError,
]);

export class AuthLocalSecretError extends Schema.TaggedError<AuthLocalSecretError>()(
  "AuthLocalSecretError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.instanceOf(PlatformError)),
  },
) {}

export class AuthLocalDatabaseError extends Schema.TaggedError<AuthLocalDatabaseError>()(
  "AuthLocalDatabaseError",
  {
    operation: Schema.Literals(["connect", "query", "schema"]),
    message: Schema.String,
  },
) {}

export class AuthLocalSigningError extends Schema.TaggedError<AuthLocalSigningError>()(
  "AuthLocalSigningError",
  {
    operation: Schema.Literals(["sign"]),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.instanceOf(PlatformError)),
  },
) {}

export class AuthLocalError extends Schema.TaggedError<AuthLocalError>()("AuthLocalError", {
  message: Schema.String,
  cause: Schema.optionalKey(
    Schema.Union([
      AuthLocalErrorCauseSchema,
      AuthLocalSecretError,
      AuthLocalDatabaseError,
      AuthLocalSigningError,
    ]),
  ),
}) {}

export type AuthError = AuthPairingUrlError | AuthConfigError | AuthTransportError | AuthLocalError;
