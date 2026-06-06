import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeModelsApplication } from "./models.ts";
import { makeProjectApplication } from "./projects.ts";
import { T3Application } from "./service.ts";
import { makeTerminalApplication } from "./terminals.ts";
import { makeThreadApplication } from "./threads.ts";

export const makeT3Application = Effect.fn("makeT3Application")(function* () {
  const models = yield* makeModelsApplication();
  const projects = yield* makeProjectApplication();
  const terminals = yield* makeTerminalApplication();
  const threads = yield* makeThreadApplication();
  return {
    ...models,
    ...projects,
    ...terminals,
    ...threads,
  };
});

export const T3ApplicationLive = Layer.effect(T3Application, makeT3Application());
