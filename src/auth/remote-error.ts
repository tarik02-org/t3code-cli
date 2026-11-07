import {
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthTimeoutError,
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "@t3tools/client-runtime/rpc";
import { EnvironmentHttpCommonError } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

type RemoteEnvironmentAuthInvalidJsonError = Extract<
  RemoteEnvironmentRequestError,
  { readonly _tag: "RemoteEnvironmentAuthInvalidJsonError" }
>;

// Upstream keeps this error class private, so it is matched by tag.
const RemoteEnvironmentAuthInvalidJsonErrorSchema = Schema.declare(
  (input: unknown): input is RemoteEnvironmentAuthInvalidJsonError =>
    Predicate.isTagged(input, "RemoteEnvironmentAuthInvalidJsonError"),
);

// Annotated because declarations cannot name the private class behind the inferred union.
export const RemoteEnvironmentAuthErrorSchema: Schema.Schema<RemoteEnvironmentRequestError> =
  Schema.Union([
    EnvironmentHttpCommonError,
    Schema.instanceOf(RemoteEnvironmentAuthFetchError),
    RemoteEnvironmentAuthInvalidJsonErrorSchema,
    Schema.instanceOf(RemoteEnvironmentAuthTimeoutError),
    Schema.instanceOf(RemoteEnvironmentAuthUndeclaredStatusError),
  ]);
