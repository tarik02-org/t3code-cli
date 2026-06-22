import "vite-plus/test/config";

import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";

import { Environment } from "../environment/service.ts";
import {
  makeT3CredentialCrypto,
  parseKeyringPassword,
  shouldFallbackToKeyFile,
} from "./credential.ts";

vi.mock("./keyring.ts", async () => {
  const EffectModule = await import("effect/Effect");
  return {
    getKeyringStore: () => EffectModule.succeed(null),
  };
});

function makeCredentialLayer(homeDir: string) {
  return Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(Environment)({
      cwd: homeDir,
      homeDir,
      env: {},
      stdoutIsTTY: false,
      stderrIsTTY: false,
    }),
  );
}

describe("keyring fallback", () => {
  it("treats invalid stored keyring values as corrupt", () => {
    const result = parseKeyringPassword("not-a-valid-key");
    assert.equal(result.kind, "corrupt");
    expect(shouldFallbackToKeyFile(result)).toBe(false);
  });

  it.effect("falls back to key file when keyring backend is unavailable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cryptoService = yield* Crypto.Crypto;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-credential-test-" });
      return { fs, path, cryptoService, homeDir };
    }).pipe(
      Effect.flatMap(({ fs, path, cryptoService, homeDir }) =>
        Effect.gen(function* () {
          const keyPath = path.join(homeDir, ".config", "t3cli", "key");
          const masterKey = yield* cryptoService.randomBytes(32);
          yield* fs.makeDirectory(path.dirname(keyPath), { recursive: true });
          yield* fs.writeFileString(keyPath, `${Buffer.from(masterKey).toString("base64")}\n`, {
            mode: 0o600,
          });
          const credentialCrypto = yield* makeT3CredentialCrypto().pipe(
            Effect.provide(makeCredentialLayer(homeDir)),
          );
          const encrypted = yield* credentialCrypto.encrypt({
            environmentName: "home",
            url: "https://home.example",
            local: false,
            token: "secret-token",
          });
          const token = yield* credentialCrypto.decrypt({
            environmentName: "home",
            url: "https://home.example",
            local: false,
            token: encrypted,
          });
          assert.equal(token, "secret-token");
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("hardens existing key file permissions to 0600 on use", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cryptoService = yield* Crypto.Crypto;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-credential-test-" });
      return { fs, path, cryptoService, homeDir };
    }).pipe(
      Effect.flatMap(({ fs, path, cryptoService, homeDir }) =>
        Effect.gen(function* () {
          const keyPath = path.join(homeDir, ".config", "t3cli", "key");
          const masterKey = yield* cryptoService.randomBytes(32);
          yield* fs.makeDirectory(path.dirname(keyPath), { recursive: true });
          yield* fs.writeFileString(keyPath, `${Buffer.from(masterKey).toString("base64")}\n`, {
            mode: 0o644,
          });
          const credentialCrypto = yield* makeT3CredentialCrypto().pipe(
            Effect.provide(makeCredentialLayer(homeDir)),
          );
          yield* credentialCrypto.encrypt({
            environmentName: "home",
            url: "https://home.example",
            local: false,
            token: "secret-token",
          });
          const keyStat = yield* fs.stat(keyPath);
          assert.equal(keyStat.mode & 0o777, 0o600);
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );

  it.effect("creates key file with 0600 permissions when keyring is unavailable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-credential-test-" });
      return { fs, path, homeDir };
    }).pipe(
      Effect.flatMap(({ fs, path, homeDir }) =>
        Effect.gen(function* () {
          const keyPath = path.join(homeDir, ".config", "t3cli", "key");
          const credentialCrypto = yield* makeT3CredentialCrypto().pipe(
            Effect.provide(makeCredentialLayer(homeDir)),
          );
          yield* credentialCrypto.encrypt({
            environmentName: "home",
            url: "https://home.example",
            local: false,
            token: "rotate-write",
          });
          const keyStat = yield* fs.stat(keyPath);
          assert.equal(keyStat.mode & 0o777, 0o600);
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.scoped,
    ),
  );
});
