import * as Effect from "effect/Effect";
import { ModelSelection, ProviderInstanceId } from "#t3tools/contracts";
import type { OrchestrationProjectShell } from "#t3tools/contracts";
import * as Schema from "effect/Schema";

import { ModelSelectionError } from "../domain/error.ts";
import {
  findSelectableProvider,
  firstSelectableModel,
  firstSelectableProvider,
} from "../domain/model-config.ts";
import type { ServerConfigForCli } from "../orchestration/service.ts";
import type { StartThreadInput } from "./service.ts";

export function resolveModelSelection(input: {
  readonly start: StartThreadInput;
  readonly project: OrchestrationProjectShell;
  readonly serverConfig: ServerConfigForCli;
}) {
  return Effect.gen(function* () {
    if (input.start.provider !== undefined && input.start.model !== undefined) {
      return withModelOptions(input.start, {
        instanceId: ProviderInstanceId.make(input.start.provider),
        model: input.start.model,
      });
    }
    if (input.start.provider !== undefined) {
      const provider = yield* findProvider(input.serverConfig, input.start.provider);
      const model = firstSelectableModel(provider);
      if (model === undefined) {
        return yield* failNoAvailableModel();
      }
      return withModelOptions(input.start, {
        instanceId: ProviderInstanceId.make(input.start.provider),
        model: model.slug,
      });
    }
    if (input.start.model !== undefined) {
      const provider = yield* firstAvailableModel(input.serverConfig);
      return withModelOptions(input.start, {
        instanceId: provider.instanceId,
        model: input.start.model,
      });
    }
    if (input.project.defaultModelSelection !== null) {
      return withModelOptions(input.start, input.project.defaultModelSelection);
    }
    const provider = yield* firstAvailableModel(input.serverConfig);
    const model = firstSelectableModel(provider);
    if (model === undefined) {
      return yield* failNoAvailableModel();
    }
    return withModelOptions(input.start, {
      instanceId: provider.instanceId,
      model: model.slug,
    });
  });
}

export function mergeModelOptions(
  selection: ModelSelection,
  options: NonNullable<ModelSelection["options"]>,
): ModelSelection {
  if (options.length === 0) {
    return selection;
  }
  const optionsById = new Map((selection.options ?? []).map((option) => [option.id, option]));
  for (const option of options) {
    optionsById.set(option.id, option);
  }
  return Schema.decodeUnknownSync(ModelSelection)({
    ...selection,
    options: [...optionsById.values()],
  });
}

function withModelOptions(input: StartThreadInput, selection: ModelSelection): ModelSelection {
  if (input.options === undefined || input.options.length === 0) {
    return selection;
  }
  return mergeModelOptions(selection, input.options);
}

function firstAvailableModel(serverConfig: ServerConfigForCli) {
  const providers = serverConfig.providers;
  const provider = firstSelectableProvider(providers);
  if (provider === undefined) {
    return failNoAvailableModel();
  }
  return Effect.succeed(provider);
}

function findProvider(serverConfig: ServerConfigForCli, instanceId: string) {
  const provider = findSelectableProvider(serverConfig.providers, instanceId);
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
