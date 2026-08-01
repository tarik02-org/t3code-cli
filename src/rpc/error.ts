import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "../../upstream-t3code/packages/client-runtime/src/connection/model.ts";
import { EnvironmentAuthorizationError } from "../../upstream-t3code/packages/contracts/src/auth.ts";
import { KeybindingsConfigError } from "../../upstream-t3code/packages/contracts/src/keybindings.ts";
import {
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
} from "../../upstream-t3code/packages/contracts/src/orchestration.ts";
import { PreviewAutomationError } from "../../upstream-t3code/packages/contracts/src/previewAutomation.ts";
import { ServerSettingsError } from "../../upstream-t3code/packages/contracts/src/settings.ts";
import { TerminalError } from "../../upstream-t3code/packages/contracts/src/terminal.ts";
import * as Schema from "effect/Schema";
import { RpcClientError } from "effect/unstable/rpc";

import { T3CodeConnectionError } from "../connection/error.ts";

const RpcErrorCauseSchema = Schema.Union([
  RpcClientError.RpcClientError,
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  PreviewAutomationError,
  ServerSettingsError,
  TerminalError,
  ConnectionBlockedError,
  ConnectionTransientError,
  T3CodeConnectionError,
]);

export type RpcKnownCause = Schema.Schema.Type<typeof RpcErrorCauseSchema>;

export class RpcError extends Schema.TaggedErrorClass<RpcError>()("RpcError", {
  message: Schema.String,
  method: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(RpcErrorCauseSchema),
}) {}

export type OrchestrationError = RpcError;
