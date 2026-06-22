import "vite-plus/test/config";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import { T3LocalAuth } from "./local.ts";
import { T3AuthPairing } from "./pairing.ts";
import { T3AuthLive } from "./layer.ts";
import { T3Auth } from "./service.ts";
import { T3AuthTransport } from "./transport.ts";
import { T3ConfigLive } from "../config/layer.ts";
import type { CredentialCrypto } from "../config/credential-service.ts";
import { T3CredentialCrypto } from "../config/credential-service.ts";
import { Environment } from "../environment/service.ts";
import { T3ConfigSelection } from "../config/selection.ts";

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

function makeAuthLayer(homeDir: string) {
  const environmentLayer = Layer.succeed(Environment)({
    cwd: homeDir,
    homeDir,
    env: {},
    stdoutIsTTY: false,
    stderrIsTTY: false,
  });
  const configLayer = T3ConfigLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(T3CredentialCrypto, testCredentialCrypto),
        environmentLayer,
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
  it("fails to persist a duplicate environment without allowReplace", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-auth-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("does not change default when replace is used for a new environment", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-auth-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("promotes default when replacing an existing environment with replace", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-auth-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("lists environments without decrypting tokens", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-auth-test-"));
    const configPath = join(homeDir, ".config", "t3cli", "config.json");
    try {
      await Effect.runPromise(
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
        }).pipe(Effect.provide(makeAuthLayer(homeDir))),
      );
      const raw = await readFile(configPath, "utf8");
      const parsed: {
        environments: Record<string, { token: { tag: string } }>;
      } = JSON.parse(raw);
      parsed.environments.home!.token.tag = "AAAAAAAAAAAAAAAAAAAAAA==";
      await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
      await Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* T3Auth;
          const listed = yield* auth.listEnvironments();
          assert.equal(listed.length, 2);
          assert.equal(listed.find((environment) => environment.name === "home")?.active, true);
        }).pipe(Effect.provide(makeAuthLayer(homeDir))),
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("resolves unpair target from encrypted default metadata", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-auth-test-"));
    try {
      await Effect.runPromise(
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
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
