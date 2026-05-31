import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeProjectApplication } from "./projects.ts";
import { T3Application } from "./service.ts";
import { makeThreadApplication } from "./threads.ts";

export const makeT3Application = Effect.fn("makeT3Application")(function* () {
  const projects = yield* makeProjectApplication();
  const threads = yield* makeThreadApplication();
  return {
    ...projects,
    ...threads,
  };
});

export const T3ApplicationLive = Layer.effect(T3Application, makeT3Application());
