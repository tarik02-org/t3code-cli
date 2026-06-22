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

export class KeyringModuleLoadError extends Schema.TaggedErrorClass<KeyringModuleLoadError>()(
  "KeyringModuleLoadError",
  {
    reason: Schema.Literals(["module-not-found", "load-failed"]),
    cause: Schema.Defect(),
  },
) {}

export class KeyringOperationError extends Schema.TaggedErrorClass<KeyringOperationError>()(
  "KeyringOperationError",
  {
    operation: Schema.Literals(["read-password", "write-password"]),
    cause: Schema.Defect(),
  },
) {}

export type ConfigServiceError = ConfigError | UrlError;

export function describeCredentialCipherError(error: CredentialCipherError) {
  return error.operation === "encrypt"
    ? "failed to encrypt credential cipher payload"
    : "failed to decrypt credential cipher payload";
}

export function describeKeyringModuleLoadError(error: KeyringModuleLoadError) {
  return error.reason === "module-not-found"
    ? "OS keyring backend is not available"
    : "failed to load OS keyring backend";
}

export function describeKeyringOperationError(error: KeyringOperationError) {
  return error.operation === "read-password"
    ? "failed to read credential key from OS keyring"
    : "failed to write credential key to OS keyring";
}

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
