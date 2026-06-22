import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { assert, describe, it } from "@effect/vitest";

import { T3Config } from "./service.ts";
import { StoredConfigV1FileJson, StoredConfigV2FileJson } from "./schema.ts";
import { ConfigPlatformLayer } from "../test/platform.ts";
import { makeTempHomeScoped } from "../test/helpers/temp-home.ts";
import { t3ConfigDepsLayer } from "../test/layers/config.ts";

describe("config file persistence", () => {
  it.effect("persists v1 config as encrypted v2 on first read", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-persist-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const secretToken = "legacy-plaintext-token";
          const configPath = path.join(homeDir, ".config", "t3cli", "config.json");
          yield* fs.makeDirectory(path.dirname(configPath), { recursive: true });
          const legacyConfig = yield* Schema.encodeEffect(StoredConfigV1FileJson)({
            url: "https://home.example",
            token: secretToken,
            local: false,
          });
          yield* fs.writeFileString(configPath, `${legacyConfig}\n`, { mode: 0o600 });
          yield* Effect.gen(function* () {
            const config = yield* T3Config;
            yield* config.listEnvironments();
          }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir)));
          const raw = yield* fs.readFileString(configPath);
          assert.equal(raw.includes(secretToken), false);
          const persisted = yield* Schema.decodeUnknownEffect(StoredConfigV2FileJson)(raw);
          assert.equal(persisted.version, 2);
          const environment = Object.values(persisted.environments)[0];
          assert.isDefined(environment);
          assert.equal(environment.token.kind, "encrypted");
        }),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("never writes plaintext tokens to config.json", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-persist-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const secretToken = "super-secret-token-value";
          yield* Effect.gen(function* () {
            const config = yield* T3Config;
            yield* config.upsertEnvironment({
              name: "home",
              url: "https://home.example",
              token: secretToken,
              local: false,
            });
          }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir)));
          const configPath = path.join(homeDir, ".config", "t3cli", "config.json");
          const raw = yield* fs.readFileString(configPath);
          assert.equal(raw.includes(secretToken), false);
          const persisted = yield* Schema.decodeUnknownEffect(StoredConfigV2FileJson)(raw);
          assert.equal(persisted.environments.home?.token.kind, "encrypted");
        }),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("hardens existing config file permissions to 0600 on write", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-persist-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const configPath = path.join(homeDir, ".config", "t3cli", "config.json");
          yield* fs.makeDirectory(path.dirname(configPath), { recursive: true });
          const emptyConfig = yield* Schema.encodeEffect(StoredConfigV2FileJson)({
            version: 2,
            environments: {},
          });
          yield* fs.writeFileString(configPath, `${emptyConfig}\n`, { mode: 0o644 });
          yield* Effect.gen(function* () {
            const config = yield* T3Config;
            yield* config.upsertEnvironment({
              name: "home",
              url: "https://home.example",
              token: "home-token",
              local: false,
            });
          }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir)));
          const configStat = yield* fs.stat(configPath);
          assert.equal(configStat.mode & 0o777, 0o600);
        }),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );
});
