import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type { ModelSelection } from "@t3tools/contracts";

import { ThreadEventError } from "../domain/error.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { mergeModelOptions, resolveUpdateModelSelection } from "./model-selection.ts";
import type { DispatchResult, UpdateThreadInput } from "./service.ts";
import {
  makeThreadMetadataUpdateCommand,
  makeThreadModelSelectionCommand,
} from "./thread-commands.ts";

export function makeUpdateThread() {
  return Effect.fn("T3ApplicationLive.updateThread")(function* (input: UpdateThreadInput) {
    const orchestration = yield* T3Orchestration;
    const crypto = yield* Crypto.Crypto;
    const hasProvider = input.provider !== undefined && input.provider.length > 0;
    const hasModel = input.model !== undefined && input.model.length > 0;
    const options = input.options;
    const hasOptions = options !== undefined && options.length > 0;
    let modelSelection: ModelSelection | undefined;
    if (hasProvider || hasModel || hasOptions) {
      const thread = (yield* orchestration.getThreadProjection(input.threadId)).thread;
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
        // A provider change on a thread with history becomes a server-side context handoff.
        modelSelection = yield* resolveUpdateModelSelection({
          current: thread.modelSelection,
          ...(hasProvider ? { provider: input.provider } : {}),
          ...(hasModel ? { model: input.model } : {}),
          ...(hasOptions ? { options } : {}),
          project,
          serverConfig: yield* orchestration.getServerConfig(),
        });
      } else if (hasOptions) {
        modelSelection = mergeModelOptions(thread.modelSelection, options);
      }
    }

    let result: DispatchResult | undefined;
    if (
      input.title !== undefined ||
      input.branch !== undefined ||
      input.worktreePath !== undefined
    ) {
      const command = yield* makeThreadMetadataUpdateCommand(input.threadId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.branch !== undefined ? { branch: input.branch } : {}),
        ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
      }).pipe(Effect.provideService(Crypto.Crypto, crypto));
      result = yield* orchestration.dispatch(command);
    }
    if (modelSelection !== undefined) {
      const command = yield* makeThreadModelSelectionCommand(input.threadId, modelSelection).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
      );
      result = yield* orchestration.dispatch(command);
    }
    return result ?? { sequence: 0 };
  });
}
