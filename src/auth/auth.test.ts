import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { assert, describe, it } from "@effect/vitest";

import { T3Auth } from "./service.ts";
import { StoredConfigV2FileJson } from "../config/schema.ts";
import { ConfigPlatformLayer } from "../test/platform.ts";
import { makeTempHomeScoped } from "../test/helpers/temp-home.ts";
import { t3AuthDepsLayer } from "../test/layers/auth.ts";

describe("T3Auth persistence", () => {
  it.effect("fails to persist a duplicate environment without allowReplace", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-auth-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const auth = yield* T3Auth;
          yield* auth.persistEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token",
            local: false,
            allowReplace: true,
          });
          const result = yield* auth
            .persistEnvironment({
              name: "work",
              url: "https://work.example",
              token: "work-token-2",
              local: false,
              allowReplace: false,
            })
            .pipe(Effect.exit);
          assert.equal(Exit.isFailure(result), true);
        }).pipe(Effect.provide(t3AuthDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("does not change default when replace is used for a new environment", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-auth-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const auth = yield* T3Auth;
          yield* auth.persistEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
            allowReplace: true,
          });
          yield* auth.persistEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token",
            local: false,
            replace: true,
            allowReplace: true,
          });
          const listed = yield* auth.listEnvironments();
          assert.equal(listed.find((environment) => environment.name === "home")?.default, true);
          assert.equal(listed.find((environment) => environment.name === "work")?.default, false);
        }).pipe(Effect.provide(t3AuthDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("promotes default when replacing an existing environment with replace", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-auth-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const auth = yield* T3Auth;
          yield* auth.persistEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
            allowReplace: true,
          });
          yield* auth.persistEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token",
            local: false,
            allowReplace: true,
          });
          yield* auth.persistEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token-2",
            local: false,
            replace: true,
            allowReplace: true,
          });
          const listed = yield* auth.listEnvironments();
          assert.equal(listed.find((environment) => environment.name === "work")?.default, true);
        }).pipe(Effect.provide(t3AuthDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("lists environments without decrypting tokens", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-auth-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const configPath = path.join(homeDir, ".config", "t3cli", "config.json");

          yield* Effect.gen(function* () {
            const auth = yield* T3Auth;
            yield* auth.persistEnvironment({
              name: "home",
              url: "https://home.example",
              token: "home-token",
              local: false,
              allowReplace: true,
            });
            yield* auth.persistEnvironment({
              name: "work",
              url: "https://work.example",
              token: "work-token",
              local: false,
              allowReplace: true,
            });
          }).pipe(Effect.provide(t3AuthDepsLayer(homeDir)));

          const raw = yield* fs.readFileString(configPath);
          const parsed = yield* Schema.decodeUnknownEffect(StoredConfigV2FileJson)(raw);
          const homeEnvironment = parsed.environments.home;
          assert.isDefined(homeEnvironment);
          const corrupted = yield* Schema.encodeEffect(StoredConfigV2FileJson)({
            ...parsed,
            environments: {
              ...parsed.environments,
              home: {
                ...homeEnvironment,
                token: {
                  ...homeEnvironment.token,
                  tag: "AAAAAAAAAAAAAAAAAAAAAA==",
                },
              },
            },
          });
          yield* fs.writeFileString(configPath, `${corrupted}\n`, { mode: 0o600 });

          yield* Effect.gen(function* () {
            const auth = yield* T3Auth;
            const listed = yield* auth.listEnvironments();
            assert.equal(listed.length, 2);
            assert.equal(listed.find((environment) => environment.name === "home")?.active, true);
          }).pipe(Effect.provide(t3AuthDepsLayer(homeDir)));
        }),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("resolves unpair target from encrypted default metadata", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-auth-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const auth = yield* T3Auth;
          yield* auth.persistEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
            allowReplace: true,
          });
          const target = yield* auth.resolveUnpairTarget({});
          assert.equal(target, "home");
        }).pipe(Effect.provide(t3AuthDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );
});
