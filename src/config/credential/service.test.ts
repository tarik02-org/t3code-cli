import "vite-plus/test/config";

import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { assert, describe, it } from "@effect/vitest";

import { ConfigPlatformLayer } from "../platform.test-utils.ts";
import { makeTempHomeScoped } from "../temp-home.test-utils.ts";
import { T3CredentialCrypto } from "./service.ts";
import { t3CredentialCryptoDepsLayer } from "./service.test-utils.ts";

describe("T3CredentialCrypto", () => {
  it.effect("falls back to key file when keyring backend is unavailable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cryptoService = yield* Crypto.Crypto;
      const homeDir = yield* makeTempHomeScoped("t3cli-credential-");
      yield* Effect.gen(function* () {
        const keyPath = path.join(homeDir, ".config", "t3cli", "key");
        const masterKey = yield* cryptoService.randomBytes(32);
        yield* fs.makeDirectory(path.dirname(keyPath), { recursive: true });
        yield* fs.writeFileString(keyPath, `${Buffer.from(masterKey).toString("base64")}\n`, {
          mode: 0o600,
        });
        const credentialCrypto = yield* T3CredentialCrypto;
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
      }).pipe(Effect.provide(t3CredentialCryptoDepsLayer(homeDir)));
    }).pipe(Effect.provide(ConfigPlatformLayer), Effect.scoped),
  );

  it.effect("hardens existing key file permissions to 0600 on use", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cryptoService = yield* Crypto.Crypto;
      const homeDir = yield* makeTempHomeScoped("t3cli-credential-");
      yield* Effect.gen(function* () {
        const keyPath = path.join(homeDir, ".config", "t3cli", "key");
        const masterKey = yield* cryptoService.randomBytes(32);
        yield* fs.makeDirectory(path.dirname(keyPath), { recursive: true });
        yield* fs.writeFileString(keyPath, `${Buffer.from(masterKey).toString("base64")}\n`, {
          mode: 0o644,
        });
        const credentialCrypto = yield* T3CredentialCrypto;
        yield* credentialCrypto.encrypt({
          environmentName: "home",
          url: "https://home.example",
          local: false,
          token: "secret-token",
        });
        const keyStat = yield* fs.stat(keyPath);
        assert.equal(keyStat.mode & 0o777, 0o600);
      }).pipe(Effect.provide(t3CredentialCryptoDepsLayer(homeDir)));
    }).pipe(Effect.provide(ConfigPlatformLayer), Effect.scoped),
  );

  it.effect("creates key file with 0600 permissions when keyring is unavailable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* makeTempHomeScoped("t3cli-credential-");
      yield* Effect.gen(function* () {
        const keyPath = path.join(homeDir, ".config", "t3cli", "key");
        const credentialCrypto = yield* T3CredentialCrypto;
        yield* credentialCrypto.encrypt({
          environmentName: "home",
          url: "https://home.example",
          local: false,
          token: "rotate-write",
        });
        const keyStat = yield* fs.stat(keyPath);
        assert.equal(keyStat.mode & 0o777, 0o600);
      }).pipe(Effect.provide(t3CredentialCryptoDepsLayer(homeDir)));
    }).pipe(Effect.provide(ConfigPlatformLayer), Effect.scoped),
  );

  it.effect("fails decrypt when ciphertext AAD does not match", () =>
    Effect.gen(function* () {
      const homeDir = yield* makeTempHomeScoped("t3cli-credential-");
      yield* Effect.gen(function* () {
        const crypto = yield* T3CredentialCrypto;
        const token = yield* crypto.encrypt({
          environmentName: "home",
          url: "https://home.example",
          local: false,
          token: "secret",
        });
        const result = yield* crypto
          .decrypt({
            environmentName: "home",
            url: "https://tampered.example",
            local: false,
            token,
          })
          .pipe(Effect.exit);
        assert.equal(Exit.isFailure(result), true);
      }).pipe(Effect.provide(t3CredentialCryptoDepsLayer(homeDir)));
    }).pipe(Effect.provide(ConfigPlatformLayer), Effect.scoped),
  );
});
