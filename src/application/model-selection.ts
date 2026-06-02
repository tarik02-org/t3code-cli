import * as Effect from "effect/Effect";

import { ModelSelectionError } from "../domain/error.ts";
import {
  findSelectableProvider,
  firstSelectableModel,
  firstSelectableProvider,
} from "../domain/model-config.ts";
import { decodeModelSelection, type ProjectShell, type ServerConfig } from "../domain/schema.ts";
import type { StartThreadInput } from "./service.ts";

export function resolveModelSelection(input: {
  readonly start: StartThreadInput;
  readonly project: ProjectShell;
  readonly serverConfig: ServerConfig;
}) {
  return Effect.gen(function* () {
    if (input.start.provider !== undefined && input.start.model !== undefined) {
      return decodeModelSelection({
        instanceId: input.start.provider,
        model: input.start.model,
      });
    }
    if (input.start.provider !== undefined) {
      const provider = yield* findProvider(input.serverConfig, input.start.provider);
      const model = firstSelectableModel(provider);
      if (model === undefined) {
        return yield* failNoAvailableModel();
      }
      return {
        instanceId: input.start.provider,
        model: model.slug,
      };
    }
    if (input.start.model !== undefined) {
      const provider = yield* firstAvailableModel(input.serverConfig);
      return {
        instanceId: provider.instanceId,
        model: input.start.model,
      };
    }
    if (input.project.defaultModelSelection !== null) {
      return input.project.defaultModelSelection;
    }
    const provider = yield* firstAvailableModel(input.serverConfig);
    const model = firstSelectableModel(provider);
    if (model === undefined) {
      return yield* failNoAvailableModel();
    }
    return decodeModelSelection({
      instanceId: provider.instanceId,
      model: model.slug,
    });
  });
}

function firstAvailableModel(serverConfig: ServerConfig) {
  const providers = serverConfig.providers ?? [];
  const provider = firstSelectableProvider(providers);
  if (provider === undefined) {
    return failNoAvailableModel();
  }
  return Effect.succeed(provider);
}

function findProvider(serverConfig: ServerConfig, instanceId: string) {
  const provider = findSelectableProvider(serverConfig.providers ?? [], instanceId);
  if (provider === undefined) {
    return failNoAvailableModel();
  }
  return Effect.succeed(provider);
}

function failNoAvailableModel() {
  return Effect.fail(
    new ModelSelectionError({
      message: "no available provider model found; pass --provider and --model",
    }),
  );
}
