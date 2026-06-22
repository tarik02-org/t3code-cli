import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { PlatformError } from "effect/PlatformError";

const ConfigErrorCauseSchema = Schema.Union([
  Schema.instanceOf(PlatformError),
  Schema.instanceOf(Schema.SchemaError),
  Schema.Defect(),
]);

export class UrlError extends Schema.TaggedErrorClass<UrlError>()("UrlError", {
  message: Schema.String,
  protocol: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.instanceOf(Cause.IllegalArgumentError)),
}) {}

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()("ConfigError", {
  message: Schema.String,
  cause: Schema.optionalKey(ConfigErrorCauseSchema),
}) {}

export class CredentialCipherError extends Schema.TaggedErrorClass<CredentialCipherError>()(
  "CredentialCipherError",
  {
    operation: Schema.Literals(["encrypt", "decrypt"]),
    cause: Schema.Defect(),
  },
) {}

export class KeystoreUnavailableError extends Schema.TaggedErrorClass<KeystoreUnavailableError>()(
  "KeystoreUnavailableError",
  {
    reason: Schema.Literals(["module-not-found"]),
    cause: Schema.Defect(),
  },
) {}

export type ConfigServiceError = ConfigError | UrlError;

export function configErrorFromUrl(error: UrlError) {
  return new ConfigError({
    message:
      error.protocol !== undefined
        ? `unsupported server url protocol: ${error.protocol}`
        : "invalid url",
    cause: error.cause,
  });
}

export function isPlatformNotFoundError(error: PlatformError) {
  return error.reason["_tag"] === "NotFound";
}
