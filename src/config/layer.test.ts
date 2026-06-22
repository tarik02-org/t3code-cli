import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import { assert, describe, it } from "@effect/vitest";

import { T3Config } from "./config.ts";
import { ConfigPlatformLayer } from "./platform.test-utils.ts";
import { makeTempHomeScoped } from "./temp-home.test-utils.ts";
import { t3ConfigDepsLayer } from "./layer.test-utils.ts";

describe("T3Config", () => {
  it.effect(
    "keeps default unchanged when upserting an existing environment without makeDefault",
    () =>
      Effect.gen(function* () {
        return yield* makeTempHomeScoped("t3cli-config-");
      }).pipe(
        Effect.flatMap((homeDir) =>
          Effect.gen(function* () {
            const config = yield* T3Config;
            yield* config.upsertEnvironment({
              name: "home",
              url: "https://home.example",
              token: "home-token",
              local: false,
            });
            yield* config.upsertEnvironment({
              name: "work",
              url: "https://work.example",
              token: "work-token",
              local: false,
            });
            yield* config.upsertEnvironment({
              name: "work",
              url: "https://work.example",
              token: "work-token-2",
              local: false,
            });
            const listed = yield* config.listEnvironments();
            assert.equal(listed.find((environment) => environment.name === "home")?.default, true);
            assert.equal(listed.find((environment) => environment.name === "work")?.default, false);
          }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir))),
        ),
        Effect.provide(ConfigPlatformLayer),
        Effect.scoped,
      ),
  );

  it.effect("promotes default when upserting with makeDefault", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-config-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.upsertEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
          });
          yield* config.upsertEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token",
            local: false,
          });
          yield* config.upsertEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token-2",
            local: false,
            makeDefault: true,
          });
          const listed = yield* config.listEnvironments();
          assert.equal(listed.find((environment) => environment.name === "home")?.default, false);
          assert.equal(listed.find((environment) => environment.name === "work")?.default, true);
        }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("clears default when removing the default environment", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-config-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.upsertEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
          });
          yield* config.upsertEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token",
            local: false,
          });
          yield* config.removeEnvironment("home");
          const defaultName = yield* config.getDefaultEnvironmentName();
          assert.equal(defaultName, undefined);
          const listed = yield* config.listEnvironments();
          assert.equal(
            listed.every((environment) => !environment.default),
            true,
          );
        }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("resolves selected environment from config selection service", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-config-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.upsertEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
          });
          yield* config.upsertEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token",
            local: true,
          });
          const resolved = yield* config.resolve();
          assert.equal(resolved.source, "config");
          if (resolved.source === "config") {
            assert.equal(resolved.environment, "work");
            assert.equal(resolved.token, "work-token");
          }
        }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir, { selection: "work" }))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect(
    "resolves env override with local=false even when selected stored environment is local",
    () =>
      Effect.gen(function* () {
        return yield* makeTempHomeScoped("t3cli-config-");
      }).pipe(
        Effect.flatMap((homeDir) =>
          Effect.gen(function* () {
            const config = yield* T3Config;
            yield* config.upsertEnvironment({
              name: "work",
              url: "http://localhost:8787",
              token: "work-token",
              local: true,
            });
            const resolved = yield* config.resolve();
            assert.equal(resolved.source, "env");
            assert.equal(resolved.local, false);
            assert.equal(resolved.url, "https://remote.example");
            assert.equal(resolved.token, "env-token");
          }).pipe(
            Effect.provide(
              t3ConfigDepsLayer(homeDir, {
                selection: "work",
                env: {
                  T3CODE_URL: "https://remote.example",
                  T3CODE_TOKEN: "env-token",
                },
              }),
            ),
          ),
        ),
        Effect.provide(ConfigPlatformLayer),
        Effect.scoped,
      ),
  );

  it.effect("reads default environment name without decrypting tokens", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-config-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.upsertEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
          });
          const defaultName = yield* config.getDefaultEnvironmentName();
          assert.equal(defaultName, "home");
        }).pipe(Effect.provide(t3ConfigDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );
});
