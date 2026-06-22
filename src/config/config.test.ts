// @effect-diagnostics nodeBuiltinImport:off - Integration tests use real temp directories.
import "vite-plus/test/config";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import { Environment } from "../environment/service.ts";
import { decryptEnvironment } from "./codec.ts";
import type { CredentialCrypto } from "./credential-service.ts";
import { T3CredentialCrypto } from "./credential-service.ts";
import { migrateV1FileToEncrypted } from "./migration.ts";
import { T3ConfigLive } from "./layer.ts";
import { T3ConfigSelection } from "./selection.ts";
import { T3ConfigSelectionLive } from "./selection-layer.ts";
import { T3Config } from "./service.ts";

const testMasterKey = Buffer.alloc(32, 7);

const testCredentialCrypto: CredentialCrypto = {
  encrypt: (input) =>
    Effect.sync(() => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", testMasterKey, nonce, { authTagLength: 16 });
      cipher.setAAD(
        Buffer.from(`2\0${input.environmentName}\0${input.url}\0${input.local}`, "utf8"),
      );
      const ciphertext = Buffer.concat([cipher.update(input.token, "utf8"), cipher.final()]);
      return {
        kind: "encrypted" as const,
        alg: "aes-256-gcm" as const,
        key: "default" as const,
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      };
    }),
  decrypt: (input) =>
    Effect.sync(() => {
      const nonce = Buffer.from(input.token.nonce, "base64");
      const ciphertext = Buffer.from(input.token.ciphertext, "base64");
      const tag = Buffer.from(input.token.tag, "base64");
      const decipher = createDecipheriv("aes-256-gcm", testMasterKey, nonce, {
        authTagLength: 16,
      });
      decipher.setAAD(
        Buffer.from(`2\0${input.environmentName}\0${input.url}\0${input.local}`, "utf8"),
      );
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    }),
};

function makeEnvironmentLayer(homeDir: string, env: Record<string, string> = {}) {
  return Layer.succeed(Environment)({
    cwd: homeDir,
    homeDir,
    env,
    stdoutIsTTY: false,
    stderrIsTTY: false,
  });
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
  const selectionLayer =
    input.useSelectionLive === true
      ? T3ConfigSelectionLive.pipe(Layer.provide(environmentLayer))
      : Layer.succeed(T3ConfigSelection)({
          getSelectedEnvironment: () => Effect.succeed(input.selection),
        });
  return T3ConfigLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(T3CredentialCrypto, testCredentialCrypto),
        environmentLayer,
        selectionLayer,
      ),
    ),
  );
}

describe("config persistence", () => {
  it.effect("migrates v1 flat config and roundtrips encrypted tokens", () =>
    Effect.gen(function* () {
      const migrated = yield* migrateV1FileToEncrypted(testCredentialCrypto, {
        url: "https://app.example.com",
        token: "secret-token",
        local: false,
      });
      assert.equal(migrated.default, "app.example.com");
      const token = yield* decryptEnvironment(testCredentialCrypto, {
        environmentName: "app.example.com",
        url: "https://app.example.com",
        local: false,
        token: migrated.environments["app.example.com"]!.token,
      });
      assert.equal(token, "secret-token");
    }),
  );

  it("persists v1 config as encrypted v2 on first read", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    const secretToken = "legacy-plaintext-token";
    const configPath = join(homeDir, ".config", "t3cli", "config.json");
    try {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify({
          url: "https://home.example",
          token: secretToken,
          local: false,
        })}\n`,
        { mode: 0o600 },
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.listEnvironments();
        }).pipe(Effect.provide(makeConfigLayer(homeDir))),
      );
      const raw = await readFile(configPath, "utf8");
      assert.equal(raw.includes(secretToken), false);
      assert.equal(raw.includes('"version": 2'), true);
      assert.equal(raw.includes('"kind": "encrypted"'), true);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("keeps default unchanged when upserting an existing environment without makeDefault", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("promotes default when upserting with makeDefault", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("never writes plaintext tokens to config.json", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    const secretToken = "super-secret-token-value";
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.upsertEnvironment({
            name: "home",
            url: "https://home.example",
            token: secretToken,
            local: false,
          });
        }).pipe(Effect.provide(makeConfigLayer(homeDir))),
      );
      const configPath = join(homeDir, ".config", "t3cli", "config.json");
      const raw = await readFile(configPath, "utf8");
      assert.equal(raw.includes(secretToken), false);
      assert.equal(raw.includes('"kind": "encrypted"'), true);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("clears default when removing the default environment", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("resolves selected environment from config selection service", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("resolves T3CLI_ENV through the selection layer", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("resolves env override with local=false even when selected stored environment is local", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reads default environment name without decrypting tokens", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("hardens existing config file permissions to 0600 on write", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-config-test-"));
    const configPath = join(homeDir, ".config", "t3cli", "config.json");
    try {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, `${JSON.stringify({ version: 2, environments: {} })}\n`, {
        mode: 0o644,
      });
      await Effect.runPromise(
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.upsertEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
          });
        }).pipe(Effect.provide(makeConfigLayer(homeDir))),
      );
      const configStat = await stat(configPath);
      assert.equal(configStat.mode & 0o777, 0o600);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it.effect("fails decrypt when ciphertext AAD does not match", () =>
    Effect.gen(function* () {
      const token = yield* testCredentialCrypto.encrypt({
        environmentName: "home",
        url: "https://home.example",
        local: false,
        token: "secret",
      });
      const result = yield* decryptEnvironment(testCredentialCrypto, {
        environmentName: "home",
        url: "https://tampered.example",
        local: false,
        token,
      }).pipe(Effect.exit);
      assert.equal(Exit.isFailure(result), true);
    }),
  );
});
