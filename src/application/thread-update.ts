import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type { ModelSelection } from "#t3tools/contracts";

import { ThreadEventError } from "../domain/error.ts";
import type { Orchestration } from "../orchestration/service.ts";
import { mergeModelOptions, resolveUpdateModelSelection } from "./model-selection.ts";
import type { UpdateThreadInput } from "./service.ts";
import { makeThreadMetaUpdateCommand } from "./thread-commands.ts";

export function makeUpdateThread(deps: {
  readonly orchestration: Orchestration;
  readonly crypto: Crypto.Crypto;
}) {
  return Effect.fn("T3ApplicationLive.updateThread")(function* (input: UpdateThreadInput) {
    const hasProvider = input.provider !== undefined && input.provider.length > 0;
    const hasModel = input.model !== undefined && input.model.length > 0;
    const options = input.options;
    const hasOptions = options !== undefined && options.length > 0;
    const thread = yield* deps.orchestration.getThreadSnapshot(input.threadId);
    let modelSelection: ModelSelection | undefined;
    if (hasProvider || hasModel) {
      const snapshot = yield* deps.orchestration.getShellSnapshot();
      const project = snapshot.projects.find((entry) => entry.id === thread.projectId);
      if (project === undefined) {
        return yield* Effect.fail(
          new ThreadEventError({
            message: `project not found for thread: ${input.threadId}`,
          }),
        );
      }
      const serverConfig = yield* deps.orchestration.getServerConfig();
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
    }).pipe(Effect.provideService(Crypto.Crypto, deps.crypto));
    return yield* deps.orchestration.dispatch(command);
  });
}
