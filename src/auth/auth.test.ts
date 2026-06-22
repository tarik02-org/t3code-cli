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

import { T3LocalAuth } from "./local.ts";
import { T3AuthPairing } from "./pairing.ts";
import { T3AuthLive } from "./layer.ts";
import { T3Auth } from "./service.ts";
import { T3AuthTransport } from "./transport.ts";
import * as Config from "../config/layer.ts";
import * as CredentialCrypto from "../config/credential.ts";
import { layerWeb } from "../config/credential-cipher-web.ts";
import { StoredConfigV2FileJson } from "../config/schema.ts";
import { Environment } from "../environment/service.ts";
import { T3ConfigSelection } from "../config/selection.ts";

vi.mock("../config/keyring.ts", async (importOriginal) => {
  const EffectModule = await import("effect/Effect");
  const { KeyringModuleLoadError } = await import("../config/error.ts");
  const actual = await importOriginal<typeof import("../config/keyring.ts")>();
  return {
    ...actual,
    getKeyringStore: () =>
      EffectModule.fail(
        new KeyringModuleLoadError({
          reason: "module-not-found",
          cause: new Error("keyring unavailable in test"),
        }),
      ),
  };
});

function makeAuthLayer(homeDir: string) {
  const environmentLayer = Layer.succeed(Environment)({
    cwd: homeDir,
    homeDir,
    env: {},
    stdoutIsTTY: false,
    stderrIsTTY: false,
  });
  const platformLayer = Layer.mergeAll(NodeServices.layer, environmentLayer);
  const configLayer = Config.layer.pipe(
    Layer.provide(CredentialCrypto.layer),
    Layer.provide(
      Layer.mergeAll(
        platformLayer,
        layerWeb,
        Layer.succeed(T3ConfigSelection)({
          getSelectedEnvironment: () => Effect.succeed(undefined),
        }),
      ),
    ),
  );
  return T3AuthLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        configLayer,
        Layer.succeed(T3AuthTransport)({
          bootstrapBearer: () => Effect.die("unused in test"),
          getSession: () => Effect.succeed({ authenticated: false }),
          issueWebSocketTicket: () => Effect.die("unused in test"),
        }),
        Layer.succeed(T3LocalAuth)({
          local: () => Effect.die("unused in test"),
        }),
        Layer.succeed(T3AuthPairing)({
          pair: () => Effect.die("unused in test"),
        }),
      ),
    ),
  );
}

describe("T3Auth persistence", () => {
  it.effect("fails to persist a duplicate environment without allowReplace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-auth-test-" });
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
        }).pipe(Effect.provide(makeAuthLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("does not change default when replace is used for a new environment", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-auth-test-" });
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
        }).pipe(Effect.provide(makeAuthLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("promotes default when replacing an existing environment with replace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-auth-test-" });
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
        }).pipe(Effect.provide(makeAuthLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("lists environments without decrypting tokens", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-auth-test-" });
      return { fs, path, homeDir };
    }).pipe(
      Effect.flatMap(({ fs, path, homeDir }) =>
        Effect.gen(function* () {
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
          }).pipe(Effect.provide(makeAuthLayer(homeDir)));

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
          yield* fs.writeFileString(configPath, `${corrupted}\n`, {
            mode: 0o600,
          });

          yield* Effect.gen(function* () {
            const auth = yield* T3Auth;
            const listed = yield* auth.listEnvironments();
            assert.equal(listed.length, 2);
            assert.equal(listed.find((environment) => environment.name === "home")?.active, true);
          }).pipe(Effect.provide(makeAuthLayer(homeDir)));
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("resolves unpair target from encrypted default metadata", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-auth-test-" });
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
        }).pipe(Effect.provide(makeAuthLayer(homeDir))),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );
});
