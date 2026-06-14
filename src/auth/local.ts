import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthLocalError } from "./error.ts";
import { T3LocalAuthOrigin } from "./local-origin.ts";
import { T3LocalAuthToken } from "./local-token.ts";
import type { LocalAuthInput, LocalAuthResult } from "./type.ts";

export class T3LocalAuth extends Context.Service<
  T3LocalAuth,
  {
    readonly local: (input: LocalAuthInput) => Effect.Effect<LocalAuthResult, AuthLocalError>;
  }
>()("t3cli/T3LocalAuth") {}

export const makeT3LocalAuth = Effect.fn("makeT3LocalAuth")(function* () {
  const origin = yield* T3LocalAuthOrigin;
  const token = yield* T3LocalAuthToken;

  const local = Effect.fn("T3LocalAuthLive.local")(function* (input: LocalAuthInput) {
    const created = yield* token.create(input);
    const url = yield* origin.resolve({
      baseDir: created.baseDir,
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
    });
    return {
      url,
      token: created.token,
      role: created.role,
      expiresAt: created.expiresAt,
      source: "local" as const,
      baseDir: created.baseDir,
    };
  });

  return { local };
});

export const T3LocalAuthLive = Layer.effect(T3LocalAuth, makeT3LocalAuth());
