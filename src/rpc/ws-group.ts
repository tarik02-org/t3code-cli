import {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  ServerProviders,
  ServerSettingsError,
  WS_METHODS,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSearchThreadsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationFocusHostRpc,
  WsPreviewAutomationRespondRpc,
  WsServerProbeRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsTerminalAttachRpc,
  WsTerminalCloseRpc,
  WsTerminalOpenRpc,
  WsTerminalResizeRpc,
  WsTerminalWriteRpc,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const CliServerConfig = Schema.Struct({
  environment: Schema.Struct({
    capabilities: Schema.Struct({
      connectionProbe: Schema.Boolean,
    }),
  }),
  providers: ServerProviders,
});
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
  WsOrchestrationSearchThreadsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationRespondRpc,
  WsPreviewAutomationFocusHostRpc,
  WsServerProbeRpc,
  WsServerGetConfigRpc,
);
