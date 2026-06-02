import type { ServerProvider } from "../domain/schema.ts";

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
      return [header, ...models.map((model) => `  ${model.slug} - ${model.name}`)].join("\n");
    })
    .join("\n\n");
}
