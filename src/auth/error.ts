import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { PlatformError } from "effect/PlatformError";

import { ConfigError, UrlError } from "../config/error.ts";

export class AuthPairingUrlError extends Schema.TaggedErrorClass<AuthPairingUrlError>()(
  "AuthPairingUrlError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.instanceOf(Cause.IllegalArgumentError)),
  },
) {}

export class AuthConfigError extends Schema.TaggedErrorClass<AuthConfigError>()("AuthConfigError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Union([ConfigError, UrlError])),
}) {}

export class AuthTransportError extends Schema.TaggedErrorClass<AuthTransportError>()(
  "AuthTransportError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

const AuthLocalErrorCauseSchema = Schema.Union([
  Schema.instanceOf(PlatformError),
  Schema.instanceOf(Schema.SchemaError),
  UrlError,
]);

export class AuthLocalSecretError extends Schema.TaggedErrorClass<AuthLocalSecretError>()(
  "AuthLocalSecretError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.instanceOf(PlatformError)),
  },
) {}

export class AuthLocalDatabaseError extends Schema.TaggedErrorClass<AuthLocalDatabaseError>()(
  "AuthLocalDatabaseError",
  {
    operation: Schema.Literals(["connect", "query", "schema"]),
    message: Schema.String,
  },
) {}

export class AuthLocalSigningError extends Schema.TaggedErrorClass<AuthLocalSigningError>()(
  "AuthLocalSigningError",
  {
    operation: Schema.Literals(["sign"]),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.instanceOf(PlatformError)),
  },
) {}

export class AuthLocalError extends Schema.TaggedErrorClass<AuthLocalError>()("AuthLocalError", {
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
