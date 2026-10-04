import {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationSearchThreadsError,
  OrchestrationSearchThreadsInput,
  OrchestrationSearchThreadsResult,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2GetThreadProjectionError,
  OrchestrationV2RpcSchemas,
  OrchestrationV2ThreadLaunchError,
  PreviewAutomationError,
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationResponse,
  PreviewAutomationStreamEvent,
  Project,
  ProjectMutation,
  ProjectMutationError,
  ServerProviders,
  ServerSettingsError,
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

// The CLI declares only the methods it calls, mirroring upstream `WsRpcGroup`, so a
// server config field it does not read cannot fail decoding.
export const CliServerConfig = Schema.Struct({
  environment: Schema.Struct({
    capabilities: Schema.Struct({
      connectionProbe: Schema.Boolean,
    }),
  }),
  providers: ServerProviders,
});
export type CliServerConfig = typeof CliServerConfig.Type;

const terminalErrors = Schema.Union([TerminalError, EnvironmentAuthorizationError]);
const previewAutomationErrors = Schema.Union([
  PreviewAutomationError,
  EnvironmentAuthorizationError,
]);

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: CliServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

const WsProjectsMutateRpc = Rpc.make(WS_METHODS.projectsMutate, {
  payload: ProjectMutation,
  success: Project,
  error: Schema.Union([ProjectMutationError, EnvironmentAuthorizationError]),
});

const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: terminalErrors,
});

const WsTerminalAttachRpc = Rpc.make(WS_METHODS.terminalAttach, {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: terminalErrors,
  stream: true,
});

const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: terminalErrors,
});

const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: terminalErrors,
});

const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: terminalErrors,
});

const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsPreviewAutomationConnectRpc = Rpc.make(WS_METHODS.previewAutomationConnect, {
  payload: PreviewAutomationHost,
  success: PreviewAutomationStreamEvent,
  error: previewAutomationErrors,
  stream: true,
});

const WsPreviewAutomationRespondRpc = Rpc.make(WS_METHODS.previewAutomationRespond, {
  payload: PreviewAutomationResponse,
  error: previewAutomationErrors,
});

const WsPreviewAutomationFocusHostRpc = Rpc.make(WS_METHODS.previewAutomationFocusHost, {
  payload: PreviewAutomationHostFocus,
  error: EnvironmentAuthorizationError,
});

const WsOrchestrationDispatchCommandRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
  payload: OrchestrationV2RpcSchemas.dispatchCommand.input,
  success: OrchestrationV2RpcSchemas.dispatchCommand.output,
  error: Schema.Union([OrchestrationV2DispatchCommandError, EnvironmentAuthorizationError]),
});

const WsOrchestrationSearchThreadsRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThreads, {
  payload: OrchestrationSearchThreadsInput,
  success: OrchestrationSearchThreadsResult,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationGetThreadProjectionRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
  {
    payload: OrchestrationV2RpcSchemas.getThreadProjection.input,
    success: OrchestrationV2RpcSchemas.getThreadProjection.output,
    error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationLaunchThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.launchThread, {
  payload: OrchestrationV2RpcSchemas.launchThread.input,
  success: OrchestrationV2RpcSchemas.launchThread.output,
  error: Schema.Union([OrchestrationV2ThreadLaunchError, EnvironmentAuthorizationError]),
});

const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {
  payload: OrchestrationV2RpcSchemas.subscribeShell.input,
  success: OrchestrationV2RpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationSubscribeThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
  payload: OrchestrationV2RpcSchemas.subscribeThread.input,
  success: OrchestrationV2RpcSchemas.subscribeThread.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  stream: true,
});

// Annotated so declaration emit references the RPCs instead of inlining their schemas.
type CliWsRpcs =
  | typeof WsTerminalOpenRpc
  | typeof WsTerminalAttachRpc
  | typeof WsTerminalWriteRpc
  | typeof WsTerminalResizeRpc
  | typeof WsTerminalCloseRpc
  | typeof WsSubscribeTerminalEventsRpc
  | typeof WsSubscribeTerminalMetadataRpc
  | typeof WsProjectsMutateRpc
  | typeof WsOrchestrationDispatchCommandRpc
  | typeof WsOrchestrationGetArchivedShellSnapshotRpc
  | typeof WsOrchestrationGetThreadProjectionRpc
  | typeof WsOrchestrationLaunchThreadRpc
  | typeof WsOrchestrationSearchThreadsRpc
  | typeof WsOrchestrationSubscribeShellRpc
  | typeof WsOrchestrationSubscribeThreadRpc
  | typeof WsPreviewAutomationConnectRpc
  | typeof WsPreviewAutomationRespondRpc
  | typeof WsPreviewAutomationFocusHostRpc
  | typeof WsServerProbeRpc
  | typeof WsServerGetConfigRpc;

export const CliWsRpcGroup: RpcGroup.RpcGroup<CliWsRpcs> = RpcGroup.make(
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsProjectsMutateRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationGetThreadProjectionRpc,
  WsOrchestrationLaunchThreadRpc,
  WsOrchestrationSearchThreadsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationRespondRpc,
  WsPreviewAutomationFocusHostRpc,
  WsServerProbeRpc,
  WsServerGetConfigRpc,
);
