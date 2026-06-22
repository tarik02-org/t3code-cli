import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ConfigError, UrlError } from "../config/error.ts";
import {
  defaultEnvironmentNameForLocal,
  defaultEnvironmentNameFromUrl,
} from "../config/environment-name.ts";
import type { EnvironmentSummary, ResolvedConfig } from "../config/types.ts";
import { T3Config } from "../config/service.ts";
import { AuthConfigError } from "./error.ts";
import { T3LocalAuth } from "./local.ts";
import { T3AuthPairing } from "./pairing.ts";
import { T3Auth } from "./service.ts";
import { T3AuthTransport } from "./transport.ts";
import type { AuthConfigInput, AuthEnvironmentListItem, AuthResolvedConfig } from "./type.ts";

export const makeT3Auth = Effect.fn("makeT3Auth")(function* () {
  const config = yield* T3Config;
  const transport = yield* T3AuthTransport;
  const localAuth = yield* T3LocalAuth;
  const pairing = yield* T3AuthPairing;

  const status = Effect.fn("T3AuthLive.status")(function* () {
    const resolved = yield* config.resolve().pipe(Effect.mapError(mapConfigError));
    const session = yield* transport.getSession(resolved);
    return { config: toAuthResolvedConfig(resolved), session } as const;
  });

  const issueWebSocketTicket = Effect.fn("T3AuthLive.issueWebSocketTicket")(function* () {
    const resolved = yield* config.resolve().pipe(Effect.mapError(mapConfigError));
    return yield* transport.issueWebSocketTicket(resolved);
  });

  const persistEnvironment = Effect.fn("T3AuthLive.persistEnvironment")(function* (input: {
    readonly name: string;
    readonly url: string;
    readonly token: string;
    readonly local: boolean;
    readonly replace?: boolean;
    readonly allowReplace: boolean;
  }) {
    const exists = yield* config.hasEnvironment(input.name).pipe(Effect.mapError(mapConfigError));
    if (exists && !input.allowReplace) {
      return yield* Effect.fail(
        new AuthConfigError({
          message: `environment '${input.name}' already exists: pass --replace`,
        }),
      );
    }
    const makeDefault = exists && input.replace === true;
    yield* config
      .upsertEnvironment({
        name: input.name,
        url: input.url,
        token: input.token,
        local: input.local,
        ...(makeDefault ? { makeDefault: true } : {}),
      })
      .pipe(Effect.mapError(mapConfigError));
    return input.name;
  });

  const listEnvironments = Effect.fn("T3AuthLive.listEnvironments")(function* () {
    const [environments, activeName] = yield* Effect.all(
      [config.listEnvironments(), config.resolveActiveEnvironmentName()],
      { concurrency: "unbounded" },
    ).pipe(Effect.mapError(mapConfigError));
    return environments.map((environment) => toAuthEnvironmentListItem(environment, activeName));
  });

  const resolveUnpairTarget = Effect.fn("T3AuthLive.resolveUnpairTarget")(function* (input: {
    readonly name?: string;
  }) {
    if (input.name !== undefined && input.name.length > 0) {
      return input.name;
    }
    const defaultName = yield* config
      .getDefaultEnvironmentName()
      .pipe(Effect.mapError(mapConfigError));
    if (defaultName === undefined) {
      return yield* Effect.fail(
        new AuthConfigError({
          message: "no environment selected: pass --name or run: t3cli auth use <name>",
        }),
      );
    }
    return defaultName;
  });

  return {
    pair: pairing.pair,
    local: localAuth.local,
    writeConfig: (input: AuthConfigInput) =>
      config
        .upsertEnvironment({
          name: input.name,
          url: input.url,
          token: input.token,
          local: input.local,
          ...(input.makeDefault === true ? { makeDefault: true } : {}),
        })
        .pipe(Effect.mapError(mapConfigError)),
    persistEnvironment,
    environmentExists: (name: string) =>
      config.hasEnvironment(name).pipe(Effect.mapError(mapConfigError)),
    defaultNameFromUrl: (url: string) =>
      defaultEnvironmentNameFromUrl(url).pipe(Effect.mapError(mapConfigError)),
    defaultNameForLocal: () => Effect.succeed(defaultEnvironmentNameForLocal()),
    listEnvironments,
    useEnvironment: (name: string) =>
      config
        .setDefaultEnvironment(name)
        .pipe(Effect.mapError(mapConfigError), Effect.as({ name, default: true as const })),
    resolveUnpairTarget,
    unpairEnvironment: (input: { readonly name: string }) =>
      config
        .removeEnvironment(input.name)
        .pipe(
          Effect.mapError(mapConfigError),
          Effect.as({ name: input.name, removed: true as const }),
        ),
    status,
    issueWebSocketTicket,
  };
});

export const T3AuthLive = Layer.effect(T3Auth, makeT3Auth());

function mapConfigError(error: ConfigError | UrlError) {
  return new AuthConfigError({ message: "auth config failed", cause: error });
}

function toAuthResolvedConfig(config: ResolvedConfig): AuthResolvedConfig {
  return {
    url: config.url,
    token: config.token,
    source: config.source,
    local: config.local,
    ...(config.environment !== undefined ? { environment: config.environment } : {}),
  };
}

function toAuthEnvironmentListItem(
  environment: EnvironmentSummary,
  activeName: string | undefined,
): AuthEnvironmentListItem {
  return {
    name: environment.name,
    url: environment.url,
    local: environment.local,
    default: environment.default,
    active: environment.name === activeName,
  };
}
