// @effect-diagnostics nodeBuiltinImport:off - Integration tests use real temp directories.
import "vite-plus/test/config";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Command } from "effect/unstable/cli";

import { T3CliConfigSelectionLive } from "../cli/selection-layer.ts";
import { cliEnvironmentSetting } from "../cli/environment-flag.ts";
import { Environment } from "../environment/service.ts";
import type { CredentialCrypto } from "../config/credential-service.ts";
import { T3CredentialCrypto } from "../config/credential-service.ts";
import type { ResolvedConfig } from "../config/types.ts";
import { T3Config } from "../config/service.ts";
import { BaseAppLayer } from "./layer.ts";

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

function makeCliAppLayer(homeDir: string) {
  const environmentLayer = Layer.succeed(Environment)({
    cwd: homeDir,
    homeDir,
    env: { T3CLI_ENV: "home" },
    stdoutIsTTY: false,
    stderrIsTTY: false,
  });
  return BaseAppLayer.pipe(
    Layer.provideMerge(T3CliConfigSelectionLive),
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        environmentLayer,
        Layer.succeed(T3CredentialCrypto, testCredentialCrypto),
      ),
    ),
  );
}

describe("CLI app layer composition", () => {
  it("routes --environment through Command.run to T3Config.resolve ahead of default and T3CLI_ENV", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-runtime-test-"));
    const cliAppLayer = makeCliAppLayer(homeDir);
    const resolvedRef = await Effect.runPromise(Ref.make<ResolvedConfig | undefined>(undefined));
    const resolveProbeCommand = Command.make("resolve-probe", {}, () =>
      Effect.gen(function* () {
        const config = yield* T3Config;
        const resolved = yield* config.resolve();
        yield* Ref.set(resolvedRef, resolved);
      }),
    ).pipe(Command.withGlobalFlags([cliEnvironmentSetting]));
    const runResolveProbe = Command.runWith(resolveProbeCommand, { version: "0.0.0-test" });
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
        }).pipe(Effect.provide(cliAppLayer)),
      );

      await Effect.runPromise(
        runResolveProbe(["--environment", "work"]).pipe(
          Effect.provide(cliAppLayer),
          Effect.provide(NodeServices.layer),
        ),
      );

      const resolved = await Effect.runPromise(Ref.get(resolvedRef));
      assert.isDefined(resolved);
      assert.equal(resolved.source, "config");
      if (resolved.source === "config") {
        assert.equal(resolved.environment, "work");
        assert.equal(resolved.token, "work-token");
      }
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
