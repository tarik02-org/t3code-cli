import {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ServerConfig,
  ServerProviders,
  ServerSettingsError,
  TerminalCwdError,
  TerminalHistoryError,
  TerminalNotRunningError,
  TerminalSessionLookupError,
  WS_METHODS,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsTerminalAttachRpc,
  WsTerminalCloseRpc,
  WsTerminalOpenRpc,
  WsTerminalResizeRpc,
  WsTerminalWriteRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
} from "#t3tools/contracts";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const FallbackServerConfig = Schema.Struct({
  providers: ServerProviders,
});
export type FallbackServerConfig = typeof FallbackServerConfig.Type;

export const CliServerConfig = Schema.Union([ServerConfig, FallbackServerConfig]);
export type CliServerConfig = typeof CliServerConfig.Type;

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: CliServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

export const CliWsRpcGroup = RpcGroup.make(
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsServerGetConfigRpc,
);

export type CliRpcRequestError =
  | EnvironmentAuthorizationError
  | KeybindingsConfigError
  | OrchestrationDispatchCommandError
  | OrchestrationGetSnapshotError
  | TerminalCwdError
  | TerminalHistoryError
  | TerminalNotRunningError
  | TerminalSessionLookupError
  | ServerSettingsError;
