import * as Context from "effect/Context";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { credentialTokenFromEnv } from "./credential/env.ts";
import { T3CredentialCrypto } from "./credential/service.ts";
import { loadT3CliEnv } from "./env/env.ts";
import { validateEnvironmentName } from "./environment-name/name.ts";
import { ConfigError } from "./error.ts";
import { readEncryptedConfigFile, writeEncryptedConfigFile } from "./persist/persist.ts";
import {
  buildResolvedConfigFromEnv,
  buildResolvedConfigFromStored,
  resolveDefaultForUpsert,
  selectEnvironmentName,
  summarizeEnvironments,
  validateCredentialEnvVars,
} from "./resolve/resolve.ts";
import { T3ConfigSelection } from "./selection/service.ts";
import type { EnvironmentSummary, ResolvedConfig, UpsertEnvironmentInput } from "./types.ts";
import { normalizeHttpBaseUrl } from "./url/url.ts";

export class T3Config extends Context.Service<
  T3Config,
  {
    readonly resolve: () => Effect.Effect<ResolvedConfig, ConfigError>;
    readonly resolveActiveEnvironmentName: () => Effect.Effect<string | undefined, ConfigError>;
    readonly listEnvironments: () => Effect.Effect<readonly EnvironmentSummary[], ConfigError>;
    readonly upsertEnvironment: (input: UpsertEnvironmentInput) => Effect.Effect<void, ConfigError>;
    readonly setDefaultEnvironment: (name: string) => Effect.Effect<void, ConfigError>;
    readonly removeEnvironment: (name: string) => Effect.Effect<void, ConfigError>;
    readonly hasEnvironment: (name: string) => Effect.Effect<boolean, ConfigError>;
    readonly getDefaultEnvironmentName: () => Effect.Effect<string | undefined, ConfigError>;
  }
>()("t3cli/T3Config") {}

export const make = Effect.fn("makeT3Config")(function* () {
  const configSelection = yield* T3ConfigSelection;
  const credentialCrypto = yield* T3CredentialCrypto;
  const t3CliEnv = yield* loadT3CliEnv;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configProvider = yield* ConfigProvider.ConfigProvider;
  const services = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
    Layer.succeed(T3CredentialCrypto, credentialCrypto),
    Layer.succeed(ConfigProvider.ConfigProvider, configProvider),
  );

  const hasEnvironment = Effect.fn("T3Config.hasEnvironment")(function* (name: string) {
    const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
    return encrypted.environments[name] !== undefined;
  });

  const getDefaultEnvironmentName = Effect.fn("T3Config.getDefaultEnvironmentName")(function* () {
    const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
    const defaultName = encrypted.default;
    return defaultName !== undefined && defaultName.length > 0 ? defaultName : undefined;
  });

  const resolveActiveEnvironmentName = Effect.fn("T3Config.resolveActiveEnvironmentName")(
    function* () {
      const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
      const envUrl = Option.getOrUndefined(t3CliEnv.t3codeUrl);
      const envToken = Option.getOrUndefined(credentialTokenFromEnv(t3CliEnv));
      yield* validateCredentialEnvVars({ envUrl, envToken });
      const hasEnvCredentials = envUrl !== undefined && envToken !== undefined;
      if (hasEnvCredentials) {
        return undefined;
      }
      const configuredEnvironment = yield* configSelection.getSelectedEnvironment();
      const selectedName = selectEnvironmentName({
        selectedEnvironment: configuredEnvironment,
        defaultEnvironment: encrypted.default,
      });
      if (selectedName === undefined || selectedName.length === 0) {
        return undefined;
      }
      if (encrypted.environments[selectedName] === undefined) {
        return undefined;
      }
      return selectedName;
    },
  );

  const listEnvironments = Effect.fn("T3Config.listEnvironments")(function* () {
    const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
    return summarizeEnvironments(encrypted);
  });

  const upsertEnvironment = Effect.fn("T3Config.upsertEnvironment")(function* (
    input: UpsertEnvironmentInput,
  ) {
    yield* validateEnvironmentName(input.name);
    const normalizedUrl = yield* normalizeHttpBaseUrl(input.url).pipe(
      Effect.mapError((error) => new ConfigError({ message: error.message, cause: error.cause })),
    );
    const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
    const token = yield* credentialCrypto.encrypt({
      environmentName: input.name,
      url: normalizedUrl,
      local: input.local,
      token: input.token,
    });
    const defaultName = resolveDefaultForUpsert(encrypted, input.name, input.makeDefault);
    yield* Effect.provide(
      writeEncryptedConfigFile({
        version: 2,
        ...(defaultName !== undefined ? { default: defaultName } : {}),
        environments: {
          ...encrypted.environments,
          [input.name]: {
            url: normalizedUrl,
            local: input.local,
            token,
          },
        },
      }),
      services,
    );
  });

  const setDefaultEnvironment = Effect.fn("T3Config.setDefaultEnvironment")(function* (
    name: string,
  ) {
    yield* validateEnvironmentName(name);
    const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
    if (encrypted.environments[name] === undefined) {
      return yield* Effect.fail(new ConfigError({ message: `environment not found: ${name}` }));
    }
    yield* Effect.provide(
      writeEncryptedConfigFile({
        ...encrypted,
        default: name,
      }),
      services,
    );
    return yield* Effect.void;
  });

  const removeEnvironment = Effect.fn("T3Config.removeEnvironment")(function* (name: string) {
    yield* validateEnvironmentName(name);
    const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
    if (encrypted.environments[name] === undefined) {
      return yield* Effect.fail(new ConfigError({ message: `environment not found: ${name}` }));
    }
    const { [name]: _removed, ...environments } = encrypted.environments;
    const defaultName = encrypted.default === name ? undefined : encrypted.default;
    yield* Effect.provide(
      writeEncryptedConfigFile({
        version: 2,
        ...(defaultName !== undefined ? { default: defaultName } : {}),
        environments,
      }),
      services,
    );
    return yield* Effect.void;
  });

  const resolve = Effect.fn("T3Config.resolve")(function* () {
    const encrypted = yield* Effect.provide(readEncryptedConfigFile(), services);
    const envUrl = Option.getOrUndefined(t3CliEnv.t3codeUrl);
    const envToken = Option.getOrUndefined(credentialTokenFromEnv(t3CliEnv));
    yield* validateCredentialEnvVars({ envUrl, envToken });
    const hasEnvUrl = envUrl !== undefined;
    const configuredEnvironment = yield* configSelection.getSelectedEnvironment();
    const selectedName = selectEnvironmentName({
      selectedEnvironment: configuredEnvironment,
      defaultEnvironment: encrypted.default,
    });

    if (hasEnvUrl && envToken !== undefined) {
      if (selectedName !== undefined && selectedName.length > 0) {
        yield* validateEnvironmentName(selectedName);
        if (encrypted.environments[selectedName] === undefined) {
          return yield* Effect.fail(
            new ConfigError({ message: `environment not found: ${selectedName}` }),
          );
        }
      }
      return yield* buildResolvedConfigFromEnv({
        envUrl,
        envToken,
      });
    }

    if (selectedName === undefined || selectedName.length === 0) {
      return yield* Effect.fail(
        new ConfigError({
          message: "not authenticated. run: t3cli auth pair --url <pairing-url>",
        }),
      );
    }
    yield* validateEnvironmentName(selectedName);
    if (encrypted.environments[selectedName] === undefined) {
      return yield* Effect.fail(
        new ConfigError({ message: `environment not found: ${selectedName}` }),
      );
    }

    const selectedEnvironment = encrypted.environments[selectedName];
    const token = yield* credentialCrypto.decrypt({
      environmentName: selectedName,
      url: selectedEnvironment.url,
      local: selectedEnvironment.local,
      token: selectedEnvironment.token,
    });
    return yield* buildResolvedConfigFromStored({
      selectedName,
      token,
      encrypted,
    });
  });

  return {
    resolve,
    resolveActiveEnvironmentName,
    listEnvironments,
    upsertEnvironment,
    setDefaultEnvironment,
    removeEnvironment,
    hasEnvironment,
    getDefaultEnvironmentName,
  } as const;
});

export const layer = Layer.effect(T3Config, make());
