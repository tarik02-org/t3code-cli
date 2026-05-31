import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Filter from "effect/Filter";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { Environment, type EnvironmentShape } from "../environment/service.ts";
import { ConfigError } from "./error.ts";
import { T3Config, type StoredConfig } from "./service.ts";
import { normalizeHttpBaseUrl } from "./url.ts";

export const makeT3Config = Effect.fn("makeT3Config")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const configFilePath = resolveConfigPath(path, environment);
  const readStored = Effect.fn("T3ConfigLive.readStored")(function* () {
    const raw = yield* fs.readFileString(configFilePath).pipe(
      Effect.catchFilter(Filter.reason("PlatformError", "NotFound"), () =>
        Effect.succeed(undefined),
      ),
      Effect.mapError(
        (error) => new ConfigError({ message: "failed to read config", cause: error }),
      ),
    );
    if (raw === undefined) return {};
    return yield* parseStoredConfig(raw);
  });
  const writeStored = Effect.fn("T3ConfigLive.writeStored")(function* (config: StoredConfig) {
    yield* fs
      .makeDirectory(path.dirname(configFilePath), { recursive: true, mode: 0o700 })
      .pipe(
        Effect.mapError(
          (error) => new ConfigError({ message: "failed to write config", cause: error }),
        ),
      );
    yield* fs
      .writeFileString(configFilePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
      .pipe(
        Effect.mapError(
          (error) => new ConfigError({ message: "failed to write config", cause: error }),
        ),
      );
  });
  const resolve = Effect.fn("T3ConfigLive.resolve")(function* () {
    const stored = yield* readStored();
    const envUrl = environment.env.T3CODE_URL;
    const envToken = environment.env.T3CODE_TOKEN;
    const url = envUrl?.trim() || stored.url;
    const token = envToken?.trim() || stored.token;
    if (!url || !token) {
      return yield* Effect.fail(
        new ConfigError({ message: "not authenticated. run: t3cli auth pair <pairing-url>" }),
      );
    }
    const source: "env" | "config" = envUrl || envToken ? "env" : "config";
    const normalizedUrl = yield* normalizeHttpBaseUrl(url);
    return {
      url: normalizedUrl,
      token,
      source,
    };
  });

  return {
    readStored,
    writeStored,
    resolve,
  };
});

export const T3ConfigLive = Layer.effect(T3Config, makeT3Config());

const StoredConfigSchema = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  token: Schema.optionalKey(Schema.String),
});

function parseStoredConfig(raw: string) {
  return Schema.decodeUnknownEffect(Schema.fromJsonString(StoredConfigSchema))(raw).pipe(
    Effect.mapError((error) => new ConfigError({ message: "failed to read config", cause: error })),
  );
}

function resolveConfigPath(path: Path.Path, environment: EnvironmentShape) {
  const xdgConfigHome = environment.env.XDG_CONFIG_HOME;
  const root = xdgConfigHome?.trim() || path.join(environment.homeDir, ".config");
  return path.join(root, "t3cli", "config.json");
}
