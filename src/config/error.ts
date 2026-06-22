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

export class CredentialDecryptError extends Schema.TaggedErrorClass<CredentialDecryptError>()(
  "CredentialDecryptError",
  {
    cause: Schema.Defect(),
  },
) {}

export type ConfigServiceError = ConfigError | UrlError;

export function isPlatformNotFoundError(error: PlatformError) {
  return error.reason["_tag"] === "NotFound";
}
