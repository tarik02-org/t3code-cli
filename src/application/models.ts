import * as Effect from "effect/Effect";

import { filterProvidersForModelListing } from "../domain/model-config.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { T3ModelApplication, type T3ModelApplicationService } from "./service.ts";

export const makeModelsApplication = Effect.fn("makeModelsApplication")(function* () {
  const orchestration = yield* T3Orchestration;

  const listModels: T3ModelApplicationService["listModels"] = Effect.fn("T3Application.listModels")(
    function* (input: { readonly all?: boolean; readonly provider?: string }) {
      const config = yield* orchestration.getServerConfig();
      return filterProvidersForModelListing({
        providers: config.providers,
        all: input.all === true,
        ...(input.provider !== undefined && input.provider.length > 0
          ? { provider: input.provider }
          : {}),
      });
    },
  );

  return T3ModelApplication.of({
    listModels,
  });
});
