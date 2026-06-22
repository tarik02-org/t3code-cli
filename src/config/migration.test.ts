import "vite-plus/test/config";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { assert, describe, it } from "@effect/vitest";

import { ConfigError } from "./error.ts";
import { T3CredentialCrypto } from "./credential.ts";
import { migrateV1FileToEncrypted } from "./migration.ts";
import { ConfigPlatformLayer } from "../test/platform.ts";
import { makeTempHomeScoped } from "../test/helpers/temp-home.ts";
import { t3CredentialCryptoDepsLayer } from "../test/layers/credential-crypto.ts";

describe("migrateV1FileToEncrypted", () => {
  it.effect("migrates v1 flat config and roundtrips encrypted tokens", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-migration-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const migrated = yield* migrateV1FileToEncrypted({
            url: "https://app.example.com",
            token: "secret-token",
            local: false,
          });
          assert.equal(migrated.default, "app.example.com");
          const crypto = yield* T3CredentialCrypto;
          const token = yield* crypto.decrypt({
            environmentName: "app.example.com",
            url: "https://app.example.com",
            local: false,
            token: migrated.environments["app.example.com"]!.token,
          });
          assert.equal(token, "secret-token");
        }).pipe(Effect.provide(t3CredentialCryptoDepsLayer(homeDir))),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );

  it.effect("maps invalid v1 urls to ConfigError when migrating directly", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-migrate-url-error-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const exit = yield* migrateV1FileToEncrypted({
            url: "not-a-url",
            token: "secret-token",
            local: false,
          }).pipe(Effect.provide(t3CredentialCryptoDepsLayer(homeDir)), Effect.exit);
          assert.isTrue(Exit.isFailure(exit));
          if (!Exit.isFailure(exit)) {
            return;
          }
          const error = Cause.findErrorOption(exit.cause);
          assert.isTrue(Option.isSome(error));
          if (Option.isSome(error)) {
            assert.instanceOf(error.value, ConfigError);
            assert.equal(error.value.message, "invalid url");
          }
        }),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );
});
