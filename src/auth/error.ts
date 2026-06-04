import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { PlatformError } from "effect/PlatformError";
import { HttpClientError } from "effect/unstable/http";

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
    cause: Schema.optionalKey(
      Schema.Union([
        HttpClientError.HttpClientErrorSchema,
        Schema.instanceOf(Schema.SchemaError),
        UrlError,
      ]),
    ),
  },
) {}

const AuthLocalErrorCauseSchema = Schema.Union([
  Schema.instanceOf(PlatformError),
  Schema.instanceOf(Schema.SchemaError),
  UrlError,
]);

export class AuthLocalError extends Schema.TaggedErrorClass<AuthLocalError>()("AuthLocalError", {
  message: Schema.String,
  cause: Schema.optionalKey(AuthLocalErrorCauseSchema),
}) {}

export type AuthError = AuthPairingUrlError | AuthConfigError | AuthTransportError | AuthLocalError;
