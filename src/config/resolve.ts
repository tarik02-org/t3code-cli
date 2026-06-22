import * as Effect from "effect/Effect";

import { validateEnvironmentName } from "./environment-name.ts";
import { ConfigError, configErrorFromUrl } from "./error.ts";
import type { EncryptedConfig, ResolvedConfig } from "./types.ts";
import { normalizeHttpBaseUrl } from "./url.ts";

export type ResolveSelectionInput = {
  readonly selectedEnvironment?: string | undefined;
  readonly defaultEnvironment?: string | undefined;
};

export function selectEnvironmentName(input: ResolveSelectionInput) {
  if (input.selectedEnvironment !== undefined && input.selectedEnvironment.length > 0) {
    return input.selectedEnvironment;
  }
  return input.defaultEnvironment;
}

export type ResolveCredentialInput = {
  readonly envUrl?: string | undefined;
  readonly envToken?: string | undefined;
};

export function validateCredentialEnvVars(input: ResolveCredentialInput) {
  const hasEnvUrl = input.envUrl !== undefined && input.envUrl.length > 0;
  const hasEnvToken = input.envToken !== undefined && input.envToken.length > 0;
  if (hasEnvUrl !== hasEnvToken) {
    return Effect.fail(
      new ConfigError({
        message: "T3CODE_URL and T3CODE_TOKEN must both be set together",
      }),
    );
  }
  return Effect.void;
}

export function resolveDefaultForUpsert(
  encrypted: EncryptedConfig,
  environmentName: string,
  makeDefault?: boolean,
): string | undefined {
  if (makeDefault === true) {
    return environmentName;
  }
  if (Object.keys(encrypted.environments).length === 0) {
    return environmentName;
  }
  return encrypted.default;
}

export function summarizeEnvironments(encrypted: EncryptedConfig) {
  return Object.entries(encrypted.environments)
    .map(([name, environmentConfig]) => ({
      name,
      url: environmentConfig.url,
      local: environmentConfig.local,
      default: encrypted.default === name,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export function buildResolvedConfigFromEnv(input: {
  readonly envUrl: string;
  readonly envToken: string;
}) {
  return normalizeHttpBaseUrl(input.envUrl).pipe(
    Effect.mapError(configErrorFromUrl),
    Effect.map((normalizedUrl) => {
      return {
        url: normalizedUrl,
        token: input.envToken,
        source: "env" as const,
        local: false,
      } satisfies ResolvedConfig;
    }),
  );
}

export function buildResolvedConfigFromStored(input: {
  readonly selectedName: string;
  readonly token: string;
  readonly encrypted: EncryptedConfig;
}) {
  return Effect.gen(function* () {
    yield* validateEnvironmentName(input.selectedName);
    const selectedEnvironment = input.encrypted.environments[input.selectedName];
    if (selectedEnvironment === undefined) {
      return yield* Effect.fail(
        new ConfigError({ message: `environment not found: ${input.selectedName}` }),
      );
    }
    const normalizedUrl = yield* normalizeHttpBaseUrl(selectedEnvironment.url).pipe(
      Effect.mapError(configErrorFromUrl),
    );
    return {
      url: normalizedUrl,
      token: input.token,
      source: "config" as const,
      local: selectedEnvironment.local,
      environment: input.selectedName,
    } satisfies ResolvedConfig;
  });
}
