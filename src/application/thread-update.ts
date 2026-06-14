import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type { ModelSelection } from "#t3tools/contracts";

import { ModelSelectionError, ThreadEventError } from "../domain/error.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { mergeModelOptions, resolveUpdateModelSelection } from "./model-selection.ts";
import type { UpdateThreadInput } from "./service.ts";
import { makeThreadMetaUpdateCommand } from "./thread-commands.ts";

export function makeUpdateThread() {
  return Effect.fn("T3ApplicationLive.updateThread")(function* (input: UpdateThreadInput) {
    const orchestration = yield* T3Orchestration;
    const crypto = yield* Crypto.Crypto;
    const hasProvider = input.provider !== undefined && input.provider.length > 0;
    const hasModel = input.model !== undefined && input.model.length > 0;
    const options = input.options;
    const hasOptions = options !== undefined && options.length > 0;
    const thread = yield* orchestration.getThreadSnapshot(input.threadId);
    let modelSelection: ModelSelection | undefined;
    if (hasProvider || hasModel) {
      const snapshot = yield* orchestration.getShellSnapshot();
      const project = snapshot.projects.find((entry) => entry.id === thread.projectId);
      if (project === undefined) {
        return yield* Effect.fail(
          new ThreadEventError({
            message: `project not found for thread: ${input.threadId}`,
          }),
        );
      }
      const serverConfig = yield* orchestration.getServerConfig();
      if (hasProvider && thread.session !== null && thread.session.status !== "stopped") {
        const sessionProviderId =
          thread.session.providerInstanceId ?? thread.modelSelection.instanceId;
        const sessionProvider = serverConfig.providers.find(
          (provider) => provider.instanceId === sessionProviderId,
        );
        const targetProvider = serverConfig.providers.find(
          (provider) => provider.instanceId === input.provider,
        );
        if (
          sessionProvider !== undefined &&
          targetProvider !== undefined &&
          targetProvider.driver !== sessionProvider.driver
        ) {
          return yield* Effect.fail(
            new ModelSelectionError({
              message: `thread ${input.threadId} is bound to ${sessionProvider.driver} provider ${sessionProviderId}; cannot update provider to ${targetProvider.driver} provider ${input.provider}`,
            }),
          );
        }
      }
      modelSelection = yield* resolveUpdateModelSelection({
        current: thread.modelSelection,
        ...(hasProvider ? { provider: input.provider } : {}),
        ...(hasModel ? { model: input.model } : {}),
        ...(hasOptions ? { options } : {}),
        project,
        serverConfig,
      });
    } else if (hasOptions) {
      modelSelection = mergeModelOptions(thread.modelSelection, options);
    }
    const command = yield* makeThreadMetaUpdateCommand(input.threadId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(modelSelection !== undefined ? { modelSelection } : {}),
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
    }).pipe(Effect.provideService(Crypto.Crypto, crypto));
    return yield* orchestration.dispatch(command);
  });
}
