import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Actions from "./actions.ts";
import { makeModelsApplication } from "./models.ts";
import { makeProjectApplication } from "./projects.ts";
import {
  T3Application,
  T3ModelApplication,
  T3ProjectApplication,
  T3TerminalApplication,
  T3ThreadApplication,
} from "./service.ts";
import { makeTerminalApplication } from "./terminals.ts";
import { makeThreadApplication } from "./threads.ts";

export const makeT3Application = Effect.fn("makeT3Application")(function* () {
  const models = yield* T3ModelApplication;
  const actions = yield* Actions.T3ActionApplication;
  const projects = yield* T3ProjectApplication;
  const terminals = yield* T3TerminalApplication;
  const threads = yield* T3ThreadApplication;
  return {
    ...actions,
    ...models,
    ...projects,
    ...terminals,
    ...threads,
  };
});

export const T3ModelApplicationLive = Layer.effect(T3ModelApplication, makeModelsApplication());
export const T3ProjectApplicationLive = Layer.effect(
  T3ProjectApplication,
  makeProjectApplication(),
);
export const T3TerminalApplicationLive = Layer.effect(
  T3TerminalApplication,
  makeTerminalApplication(),
);
export const T3ActionApplicationLive = Actions.layer.pipe(Layer.provide(T3TerminalApplicationLive));
export const T3ThreadApplicationLive = Layer.effect(T3ThreadApplication, makeThreadApplication());

export const T3ApplicationSlicesLive = Layer.mergeAll(
  T3ActionApplicationLive,
  T3ModelApplicationLive,
  T3ProjectApplicationLive,
  T3TerminalApplicationLive,
  T3ThreadApplicationLive,
);

export const T3ApplicationLive = Layer.effect(T3Application, makeT3Application()).pipe(
  Layer.provide(T3ApplicationSlicesLive),
);
