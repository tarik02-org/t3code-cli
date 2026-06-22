import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { Environment } from "../environment/service.ts";
import { decryptEnvironment, encryptEnvironment } from "./codec.ts";
import { T3CredentialCryptoLive } from "./credential.ts";
import { T3CredentialCipherWebLive } from "./credential-cipher-web.ts";
import { migrateV1FileToEncrypted } from "./migration.ts";
import { T3ConfigLive } from "./layer.ts";
import { StoredConfigV1FileJson, StoredConfigV2FileJson } from "./schema.ts";
import { T3ConfigSelection } from "./selection.ts";
import { T3ConfigSelectionLive } from "./selection-layer.ts";
import { T3Config } from "./service.ts";

vi.mock("./keyring.ts", async (importOriginal) => {
  const EffectModule = await import("effect/Effect");
  const actual = await importOriginal<typeof import("./keyring.ts")>();
  return {
    ...actual,
    getKeyringStore: () =>
      EffectModule.fail(
        new actual.KeyringModuleNotFoundError({
          cause: new Error("keyring unavailable in test"),
        }),
      ),
  };
});

function makeEnvironmentLayer(homeDir: string, env: Record<string, string> = {}) {
  return Layer.succeed(Environment)({
    cwd: homeDir,
    homeDir,
    env,
    stdoutIsTTY: false,
    stderrIsTTY: false,
  });
}

function makeCredentialCryptoLayer(homeDir: string) {
  return T3CredentialCryptoLive.pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, T3CredentialCipherWebLive, makeEnvironmentLayer(homeDir)),
    ),
  );
}

function makeConfigLayer(
  homeDir: string,
  input: {
    readonly selection?: string;
    readonly env?: Record<string, string>;
    readonly useSelectionLive?: boolean;
  } = {},
) {
  const environmentLayer = makeEnvironmentLayer(homeDir, input.env ?? {});
  const platformLayer = Layer.mergeAll(NodeServices.layer, environmentLayer);
  const selectionLayer =
    input.useSelectionLive === true
      ? T3ConfigSelectionLive.pipe(Layer.provide(environmentLayer))
      : Layer.succeed(T3ConfigSelection)({
          getSelectedEnvironment: () => Effect.succeed(input.selection),
        });
  return T3ConfigLive.pipe(
    Layer.provide(T3CredentialCryptoLive),
    Layer.provide(Layer.mergeAll(platformLayer, selectionLayer, T3CredentialCipherWebLive)),
  );
}

describe("config persistence", () => {
  it.effect("migrates v1 flat config and roundtrips encrypted tokens", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const migrated = yield* migrateV1FileToEncrypted({
            url: "https://app.example.com",
            token: "secret-token",
            local: false,
          });
          assert.equal(migrated.default, "app.example.com");
          const token = yield* decryptEnvironment({
            environmentName: "app.example.com",
            url: "https://app.example.com",
            local: false,
            token: migrated.environments["app.example.com"]!.token,
          });
          assert.equal(token, "secret-token");
        }).pipe(Effect.provide(makeCredentialCryptoLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("persists v1 config as encrypted v2 on first read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
      return { fs, path, homeDir };
    }).pipe(
      Effect.flatMap(({ fs, path, homeDir }) =>
        Effect.gen(function* () {
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
          }).pipe(Effect.provide(makeConfigLayer(homeDir)));
          const raw = yield* fs.readFileString(configPath);
          assert.equal(raw.includes(secretToken), false);
          const persisted = yield* Schema.decodeUnknownEffect(StoredConfigV2FileJson)(raw);
          assert.equal(persisted.version, 2);
          const environment = Object.values(persisted.environments)[0];
          assert.isDefined(environment);
          assert.equal(environment.token.kind, "encrypted");
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect(
    "keeps default unchanged when upserting an existing environment without makeDefault",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
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
          }).pipe(Effect.provide(makeConfigLayer(homeDir))),
        ),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      ),
  );

  it.effect("promotes default when upserting with makeDefault", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
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
        }).pipe(Effect.provide(makeConfigLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("never writes plaintext tokens to config.json", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
      return { fs, path, homeDir };
    }).pipe(
      Effect.flatMap(({ fs, path, homeDir }) =>
        Effect.gen(function* () {
          const secretToken = "super-secret-token-value";
          yield* Effect.gen(function* () {
            const config = yield* T3Config;
            yield* config.upsertEnvironment({
              name: "home",
              url: "https://home.example",
              token: secretToken,
              local: false,
            });
          }).pipe(Effect.provide(makeConfigLayer(homeDir)));
          const configPath = path.join(homeDir, ".config", "t3cli", "config.json");
          const raw = yield* fs.readFileString(configPath);
          assert.equal(raw.includes(secretToken), false);
          const persisted = yield* Schema.decodeUnknownEffect(StoredConfigV2FileJson)(raw);
          assert.equal(persisted.environments.home?.token.kind, "encrypted");
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("clears default when removing the default environment", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
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
        }).pipe(Effect.provide(makeConfigLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("resolves selected environment from config selection service", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
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
        }).pipe(Effect.provide(makeConfigLayer(homeDir, { selection: "work" }))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("resolves T3CLI_ENV through the selection layer", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
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
          }
        }).pipe(
          Effect.provide(
            makeConfigLayer(homeDir, {
              useSelectionLive: true,
              env: { T3CLI_ENV: "work" },
            }),
          ),
        ),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect(
    "resolves env override with local=false even when selected stored environment is local",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
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
              makeConfigLayer(homeDir, {
                selection: "work",
                env: {
                  T3CODE_URL: "https://remote.example",
                  T3CODE_TOKEN: "env-token",
                },
              }),
            ),
          ),
        ),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      ),
  );

  it.effect("reads default environment name without decrypting tokens", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
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
        }).pipe(Effect.provide(makeConfigLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("hardens existing config file permissions to 0600 on write", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
      return { fs, path, homeDir };
    }).pipe(
      Effect.flatMap(({ fs, path, homeDir }) =>
        Effect.gen(function* () {
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
          }).pipe(Effect.provide(makeConfigLayer(homeDir)));
          const configStat = yield* fs.stat(configPath);
          assert.equal(configStat.mode & 0o777, 0o600);
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("fails decrypt when ciphertext AAD does not match", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-config-test-" });
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const token = yield* encryptEnvironment({
            environmentName: "home",
            url: "https://home.example",
            local: false,
            token: "secret",
          });
          const result = yield* decryptEnvironment({
            environmentName: "home",
            url: "https://tampered.example",
            local: false,
            token,
          }).pipe(Effect.exit);
          assert.equal(Exit.isFailure(result), true);
        }).pipe(Effect.provide(makeCredentialCryptoLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );
});
