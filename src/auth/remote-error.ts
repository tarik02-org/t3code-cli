import {
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthInvalidJsonError,
  RemoteEnvironmentAuthTimeoutError,
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "@t3tools/client-runtime/rpc";
import { EnvironmentHttpCommonError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const RemoteEnvironmentAuthErrorSchema = Schema.Union([
  EnvironmentHttpCommonError,
  Schema.instanceOf(RemoteEnvironmentAuthFetchError),
  Schema.instanceOf(RemoteEnvironmentAuthInvalidJsonError),
  Schema.instanceOf(RemoteEnvironmentAuthTimeoutError),
  Schema.instanceOf(RemoteEnvironmentAuthUndeclaredStatusError),
]) satisfies Schema.Schema<RemoteEnvironmentRequestError>;
