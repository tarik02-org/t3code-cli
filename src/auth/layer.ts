import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { T3Config } from "../config/service.ts";
import { AuthConfigError } from "./error.ts";
import { T3LocalAuth } from "./local.ts";
import { T3AuthPairing } from "./pairing.ts";
import { T3Auth } from "./service.ts";
import { T3AuthTransport } from "./transport.ts";
import type { AuthConfigInput } from "./type.ts";

export const makeT3Auth = Effect.fn("makeT3Auth")(function* () {
  const config = yield* T3Config;
  const transport = yield* T3AuthTransport;
  const localAuth = yield* T3LocalAuth;
  const pairing = yield* T3AuthPairing;

  const status = Effect.fn("T3AuthLive.status")(function* () {
    const resolved = yield* config.resolve().pipe(
      Effect.catchTags({
        ConfigError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
        UrlError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
      }),
    );
    return yield* transport.getSession(resolved);
  });

  const issueWebSocketTicket = Effect.fn("T3AuthLive.issueWebSocketTicket")(function* () {
    const resolved = yield* config.resolve().pipe(
      Effect.catchTags({
        ConfigError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
        UrlError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
      }),
    );
    return yield* transport.issueWebSocketTicket(resolved);
  });

  const writeConfig = Effect.fn("T3AuthLive.writeConfig")(function* (input: AuthConfigInput) {
    const existing = yield* config.readStored().pipe(
      Effect.catchTags({
        ConfigError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
      }),
    );
    yield* config
      .writeStored({
        ...existing,
        url: input.url,
        token: input.token,
        ...(input.local !== undefined ? { local: input.local } : {}),
      })
      .pipe(
        Effect.catchTags({
          ConfigError: (error) =>
            Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
        }),
      );
  });

  return {
    pair: pairing.pair,
    local: localAuth.local,
    writeConfig,
    status,
    issueWebSocketTicket,
  };
});

export const T3AuthLive = Layer.effect(T3Auth, makeT3Auth());
