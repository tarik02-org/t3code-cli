import type { ServerProvider } from "#t3tools/contracts";

import { formatTable } from "./human.ts";

export function formatModelsHuman(providers: ReadonlyArray<ServerProvider>) {
  if (providers.length === 0) {
    return "no models found\n";
  }
  return providers
    .map((provider) => {
      const models = provider.models;
      const displayName = provider.displayName ?? provider.instanceId;
      const header = `${displayName} (${provider.instanceId}) - ${provider.status}`;
      if (models.length === 0) {
        return `${header}\n  no models`;
      }
      return `${header}\n${formatTable(
        [
          { header: "slug", value: (model) => model.slug, maxWidth: 40 },
          { header: "name", value: (model) => model.name, maxWidth: 48 },
          { header: "custom", value: (model) => (model.isCustom ? "yes" : "no"), maxWidth: 6 },
          { header: "sub-provider", value: (model) => model.subProvider ?? "-", maxWidth: 24 },
        ],
        models,
      )}`;
    })
    .join("\n\n")
    .concat("\n");
}
