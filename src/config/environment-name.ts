import * as Effect from "effect/Effect";

import { ConfigError, configErrorFromUrl } from "./error.ts";
import { normalizeHttpBaseUrl } from "./url.ts";

const environmentNamePattern = /^[A-Za-z0-9._-]+$/;

export function slugifyEnvironmentName(value: string) {
  const slug = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "default";
}

export function validateEnvironmentName(name: string) {
  if (name.length === 0 || !environmentNamePattern.test(name)) {
    return Effect.fail(
      new ConfigError({
        message: `invalid environment name '${name}': use non-empty [A-Za-z0-9._-]`,
      }),
    );
  }
  return Effect.void;
}

export function defaultEnvironmentNameFromUrl(url: string) {
  return normalizeHttpBaseUrl(url).pipe(
    Effect.mapError(configErrorFromUrl),
    Effect.flatMap((normalized) => {
      const hostname = slugifyEnvironmentName(new URL(normalized).hostname.trim());
      return validateEnvironmentName(hostname).pipe(Effect.as(hostname));
    }),
  );
}

export function defaultEnvironmentNameForLocal() {
  return "local" as const;
}

export function migrateV1EnvironmentName(input: {
  readonly url?: string;
  readonly local?: boolean;
}) {
  if (input.local === true) {
    return Effect.succeed(defaultEnvironmentNameForLocal());
  }
  if (input.url !== undefined && input.url.length > 0) {
    return defaultEnvironmentNameFromUrl(input.url);
  }
  return Effect.succeed("default");
}
