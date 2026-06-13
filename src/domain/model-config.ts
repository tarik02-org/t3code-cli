import type { ServerProvider } from "#t3tools/contracts";

export function isSelectableProvider(provider: ServerProvider) {
  return provider.status === "ready" && provider.models.length > 0;
}

export function firstSelectableProvider(providers: ReadonlyArray<ServerProvider>) {
  return providers.find(isSelectableProvider);
}

export function firstSelectableModel(provider: ServerProvider) {
  return provider.models[0];
}

export function findSelectableModel(provider: ServerProvider, slug: string) {
  return provider.models.find((model) => model.slug === slug);
}

export function findSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: string,
) {
  return providers.find(
    (provider) => provider.instanceId === instanceId && isSelectableProvider(provider),
  );
}

export function filterProvidersForModelListing(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly all: boolean;
  readonly provider?: string;
}) {
  return input.providers
    .filter((provider) => input.provider === undefined || provider.instanceId === input.provider)
    .flatMap((provider) => {
      if (input.all) {
        return [provider];
      }
      if (!isSelectableProvider(provider)) {
        return [];
      }
      return [provider];
    });
}
