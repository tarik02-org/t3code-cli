import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { T3Config } from "../config/service.ts";
import { Environment } from "../environment/service.ts";
import { AuthConfigError } from "./error.ts";
import { issueLocalSession, resolveLocalOrigin } from "./local.ts";
import { parsePairingUrl } from "./pairing.ts";
import { T3Auth } from "./service.ts";
import { makeAuthTransport } from "./transport.ts";
import type { LocalAuthInput } from "./type.ts";

export const makeT3Auth = Effect.fn("makeT3Auth")(function* () {
  const config = yield* T3Config;
  const transport = yield* makeAuthTransport();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Environment;

  const pair = Effect.fn("T3AuthLive.pair")(function* (pairingUrl: string) {
    const parsed = yield* parsePairingUrl(pairingUrl);
    const result = yield* transport.bootstrapBearer(parsed);
    const existing = yield* config.readStored().pipe(
      Effect.catchTags({
        ConfigError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
      }),
    );
    yield* config
      .writeStored({ ...existing, url: parsed.baseUrl, token: result.sessionToken })
      .pipe(
        Effect.catchTags({
          ConfigError: (error) =>
            Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
        }),
      );
    return { url: parsed.baseUrl, role: result.role, expiresAt: result.expiresAt };
  });

  const local = Effect.fn("T3AuthLive.local")(function* (input: LocalAuthInput) {
    const issued = yield* issueLocalSession(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(Environment, environment),
    );
    const url = yield* resolveLocalOrigin({
      baseDir: issued.baseDir,
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
    const existing = yield* config.readStored().pipe(
      Effect.catchTags({
        ConfigError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
      }),
    );
    yield* config.writeStored({ ...existing, url, token: issued.session.token }).pipe(
      Effect.catchTags({
        ConfigError: (error) =>
          Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
      }),
    );
    return {
      url,
      role: issued.session.role,
      expiresAt: issued.session.expiresAt,
      source: "local" as const,
      baseDir: issued.baseDir,
    };
  });

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
    pair,
    local,
    status,
    issueWebSocketToken,
  };
});

export const T3AuthLive = Layer.effect(T3Auth, makeT3Auth());
