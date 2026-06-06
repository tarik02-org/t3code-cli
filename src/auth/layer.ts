import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { T3Config } from "../config/service.ts";
import { AuthConfigError } from "./error.ts";
import { T3LocalAuth } from "./local.ts";
import { T3AuthPairing } from "./pairing.ts";
import { T3Auth } from "./service.ts";
import { makeAuthTransport } from "./transport.ts";

export const makeT3Auth = Effect.fn("makeT3Auth")(function* () {
  const config = yield* T3Config;
  const transport = yield* makeAuthTransport();
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

  const issueWebSocketToken = Effect.fn("T3AuthLive.issueWebSocketToken")(function* () {
    const resolved = yield* config.resolve().pipe(
      Effect.catchTags({
        ConfigError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
        UrlError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
      }),
    );
    return yield* transport.issueWebSocketToken(resolved);
  });

  return {
    pair: pairing.pair,
    local: localAuth.local,
    status,
    issueWebSocketToken,
  };
});

export const T3AuthLive = Layer.effect(T3Auth, makeT3Auth());
