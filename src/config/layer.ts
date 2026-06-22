import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";
import { decryptEnvironment, encryptEnvironment } from "./codec.ts";
import { T3CredentialCrypto } from "./credential-service.ts";
import { validateEnvironmentName } from "./environment-name.ts";
import { ConfigError, UrlError } from "./error.ts";
import { resolveConfigFilePath } from "./paths.ts";
import { readEncryptedConfigFile, writeEncryptedConfigFile } from "./persist.ts";
import {
  buildResolvedConfigFromEnv,
  buildResolvedConfigFromStored,
  resolveDefaultForUpsert,
  selectEnvironmentName,
  summarizeEnvironments,
  validateCredentialEnvVars,
} from "./resolve.ts";
import { T3ConfigSelection } from "./selection.ts";
import { T3Config, type UpsertEnvironmentInput } from "./service.ts";
import { normalizeHttpBaseUrl } from "./url.ts";

export const makeT3Config = Effect.fn("makeT3Config")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const credentialCrypto = yield* T3CredentialCrypto;
  const configSelection = yield* T3ConfigSelection;
  const configFilePath = resolveConfigFilePath(path, environment);

  const readEncrypted = Effect.fn("T3ConfigLive.readEncrypted")(function* () {
    return yield* readEncryptedConfigFile(fs, path, configFilePath, credentialCrypto);
  });

  const hasEnvironment = Effect.fn("T3ConfigLive.hasEnvironment")(function* (name: string) {
    const encrypted = yield* readEncrypted();
    return encrypted.environments[name] !== undefined;
  });

  const getDefaultEnvironmentName = Effect.fn("T3ConfigLive.getDefaultEnvironmentName")(
    function* () {
      const encrypted = yield* readEncrypted();
      const defaultName = encrypted.default;
      return defaultName !== undefined && defaultName.length > 0 ? defaultName : undefined;
    },
  );

  const resolveActiveEnvironmentName = Effect.fn("T3ConfigLive.resolveActiveEnvironmentName")(
    function* () {
      const encrypted = yield* readEncrypted();
      const envUrl = environment.env["T3CODE_URL"]?.trim();
      const envToken = environment.env["T3CODE_TOKEN"]?.trim();
      yield* validateCredentialEnvVars({ envUrl, envToken });
      const hasEnvCredentials =
        envUrl !== undefined && envUrl.length > 0 && envToken !== undefined && envToken.length > 0;
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

  const listEnvironments = Effect.fn("T3ConfigLive.listEnvironments")(function* () {
    const encrypted = yield* readEncrypted();
    return summarizeEnvironments(encrypted);
  });

  const upsertEnvironment = Effect.fn("T3ConfigLive.upsertEnvironment")(function* (
    input: UpsertEnvironmentInput,
  ) {
    yield* validateEnvironmentName(input.name);
    const normalizedUrl = yield* normalizeHttpBaseUrl(input.url).pipe(
      Effect.mapError(mapUrlToConfigError),
    );
    const encrypted = yield* readEncrypted();
    const token = yield* encryptEnvironment(credentialCrypto, {
      environmentName: input.name,
      url: normalizedUrl,
      local: input.local,
      token: input.token,
    });
    const defaultName = resolveDefaultForUpsert(encrypted, input.name, input.makeDefault);
    yield* writeEncryptedConfigFile(fs, path, configFilePath, {
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
    });
  });

  const setDefaultEnvironment = Effect.fn("T3ConfigLive.setDefaultEnvironment")(function* (
    name: string,
  ) {
    yield* validateEnvironmentName(name);
    const encrypted = yield* readEncrypted();
    if (encrypted.environments[name] === undefined) {
      return yield* Effect.fail(new ConfigError({ message: `environment not found: ${name}` }));
    }
    yield* writeEncryptedConfigFile(fs, path, configFilePath, {
      ...encrypted,
      default: name,
    });
    return yield* Effect.void;
  });

  const removeEnvironment = Effect.fn("T3ConfigLive.removeEnvironment")(function* (name: string) {
    yield* validateEnvironmentName(name);
    const encrypted = yield* readEncrypted();
    if (encrypted.environments[name] === undefined) {
      return yield* Effect.fail(new ConfigError({ message: `environment not found: ${name}` }));
    }
    const { [name]: _removed, ...environments } = encrypted.environments;
    const defaultName = encrypted.default === name ? undefined : encrypted.default;
    yield* writeEncryptedConfigFile(fs, path, configFilePath, {
      version: 2,
      ...(defaultName !== undefined ? { default: defaultName } : {}),
      environments,
    });
    return yield* Effect.void;
  });

  const resolve = Effect.fn("T3ConfigLive.resolve")(function* () {
    const encrypted = yield* readEncrypted();
    const envUrl = environment.env["T3CODE_URL"]?.trim();
    const envToken = environment.env["T3CODE_TOKEN"]?.trim();
    yield* validateCredentialEnvVars({ envUrl, envToken });
    const hasEnvUrl = envUrl !== undefined && envUrl.length > 0;
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
    const token = yield* decryptEnvironment(credentialCrypto, {
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

export const T3ConfigLive = Layer.effect(T3Config, makeT3Config());

function mapUrlToConfigError(error: UrlError) {
  return new ConfigError({ message: error.message });
}
