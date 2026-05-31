import * as Effect from "effect/Effect";

import { ModelSelectionError } from "../domain/error.ts";
import { decodeModelSelection, type ProjectShell, type ServerConfig } from "../domain/schema.ts";
import type { StartThreadInput } from "./service.ts";

export function resolveModelSelection(input: {
  readonly start: StartThreadInput;
  readonly project: ProjectShell;
  readonly serverConfig: ServerConfig;
}) {
  return Effect.gen(function* () {
    if (input.start.provider !== undefined || input.start.model !== undefined) {
      const base =
        input.project.defaultModelSelection ?? (yield* firstAvailableModel(input.serverConfig));
      return {
        instanceId: input.start.provider ?? base.instanceId,
        model: input.start.model ?? base.model,
        ...(base.options !== undefined ? { options: base.options } : {}),
      };
    }
    if (input.project.defaultModelSelection !== null) {
      return input.project.defaultModelSelection;
    }
    return yield* firstAvailableModel(input.serverConfig);
  });
}

function firstAvailableModel(serverConfig: ServerConfig) {
  const providers = serverConfig.providers ?? [];
  const provider = providers.find(
    (entry) =>
      entry.enabled !== false &&
      entry.installed !== false &&
      entry.availability !== "unavailable" &&
      entry.models !== undefined &&
      entry.models.length > 0,
  );
  const model = provider?.models?.[0];
  const modelId = typeof model === "string" ? model : (model?.id ?? model?.name);
  if (
    provider?.instanceId === undefined ||
    provider.instanceId.length === 0 ||
    modelId === undefined ||
    modelId.length === 0
  ) {
    return Effect.fail(
      new ModelSelectionError({
        message: "no available provider model found; pass --provider and --model",
      }),
    );
  }
  return Effect.succeed(
    decodeModelSelection({
      instanceId: provider.instanceId,
      model: modelId,
    }),
  );
}
