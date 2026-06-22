import "vite-plus/test/config";

import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";

import { Environment } from "../environment/service.ts";
import {
  makeT3CredentialCrypto,
  parseKeyringPassword,
  shouldFallbackToKeyFile,
} from "./credential.ts";

vi.mock("./keyring.ts", () => ({
  getKeyringStore: () => null,
}));

describe("keyring fallback", () => {
  it("treats invalid stored keyring values as corrupt", () => {
    const result = parseKeyringPassword("not-a-valid-key");
    assert.equal(result.kind, "corrupt");
    expect(shouldFallbackToKeyFile(result)).toBe(false);
  });

  it("falls back to key file when keyring backend is unavailable", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-credential-test-"));
    const keyPath = join(homeDir, ".config", "t3cli", "key");
    const masterKey = randomBytes(32);
    try {
      await mkdir(dirname(keyPath), { recursive: true });
      await writeFile(keyPath, `${masterKey.toString("base64")}\n`, { mode: 0o600 });
      const crypto = await Effect.runPromise(
        makeT3CredentialCrypto().pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(Environment)({
                cwd: homeDir,
                homeDir,
                env: {},
                stdoutIsTTY: false,
                stderrIsTTY: false,
              }),
            ),
          ),
        ),
      );
      const encrypted = await Effect.runPromise(
        crypto.encrypt({
          environmentName: "home",
          url: "https://home.example",
          local: false,
          token: "secret-token",
        }),
      );
      const token = await Effect.runPromise(
        crypto.decrypt({
          environmentName: "home",
          url: "https://home.example",
          local: false,
          token: encrypted,
        }),
      );
      assert.equal(token, "secret-token");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("hardens existing key file permissions to 0600 on use", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-credential-test-"));
    const keyPath = join(homeDir, ".config", "t3cli", "key");
    const masterKey = randomBytes(32);
    try {
      await mkdir(dirname(keyPath), { recursive: true });
      await writeFile(keyPath, `${masterKey.toString("base64")}\n`, { mode: 0o644 });
      const crypto = await Effect.runPromise(
        makeT3CredentialCrypto().pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(Environment)({
                cwd: homeDir,
                homeDir,
                env: {},
                stdoutIsTTY: false,
                stderrIsTTY: false,
              }),
            ),
          ),
        ),
      );
      await Effect.runPromise(
        crypto.encrypt({
          environmentName: "home",
          url: "https://home.example",
          local: false,
          token: "secret-token",
        }),
      );
      const keyStat = await stat(keyPath);
      assert.equal(keyStat.mode & 0o777, 0o600);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("creates key file with 0600 permissions when keyring is unavailable", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "t3cli-credential-test-"));
    const keyPath = join(homeDir, ".config", "t3cli", "key");
    try {
      const crypto = await Effect.runPromise(
        makeT3CredentialCrypto().pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(Environment)({
                cwd: homeDir,
                homeDir,
                env: {},
                stdoutIsTTY: false,
                stderrIsTTY: false,
              }),
            ),
          ),
        ),
      );
      await Effect.runPromise(
        crypto.encrypt({
          environmentName: "home",
          url: "https://home.example",
          local: false,
          token: "rotate-write",
        }),
      );
      const keyStat = await stat(keyPath);
      assert.equal(keyStat.mode & 0o777, 0o600);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
