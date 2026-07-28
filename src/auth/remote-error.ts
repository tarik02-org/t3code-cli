import {
  RemoteEnvironmentAuthFetchError,
  type RemoteEnvironmentAuthError,
  RemoteEnvironmentAuthInvalidJsonError,
  RemoteEnvironmentAuthTimeoutError,
  RemoteEnvironmentAuthUndeclaredStatusError,
} from "@t3tools/client-runtime/authorization";
import { EnvironmentHttpCommonError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const RemoteEnvironmentAuthErrorSchema = Schema.Union([
  EnvironmentHttpCommonError,
  Schema.instanceOf(RemoteEnvironmentAuthFetchError),
  Schema.instanceOf(RemoteEnvironmentAuthInvalidJsonError),
  Schema.instanceOf(RemoteEnvironmentAuthTimeoutError),
  Schema.instanceOf(RemoteEnvironmentAuthUndeclaredStatusError),
]) satisfies Schema.Schema<RemoteEnvironmentAuthError>;
