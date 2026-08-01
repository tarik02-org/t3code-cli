import { EnvironmentAuthorizationError } from "../../upstream-t3code/packages/contracts/src/auth.ts";
import { KeybindingsConfigError } from "../../upstream-t3code/packages/contracts/src/keybindings.ts";
import {
  WS_METHODS,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
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
} from "../../upstream-t3code/packages/contracts/src/rpc.ts";
import { ServerProviders } from "../../upstream-t3code/packages/contracts/src/server.ts";
import { ServerSettingsError } from "../../upstream-t3code/packages/contracts/src/settings.ts";
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
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationRespondRpc,
  WsPreviewAutomationFocusHostRpc,
  WsServerProbeRpc,
  WsServerGetConfigRpc,
);
