import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import {
  buildResolvedConfigFromEnv,
  resolveDefaultForUpsert,
  selectEnvironmentName,
  validateCredentialEnvVars,
} from "./resolve.ts";
import { resolveConfiguredEnvironment } from "./selection-resolve.ts";
import type { EncryptedConfig } from "./types.ts";

const sampleEncrypted = (input: {
  readonly default?: string;
  readonly environments?: EncryptedConfig["environments"];
}): EncryptedConfig => ({
  version: 2,
  ...(input.default !== undefined ? { default: input.default } : {}),
  environments: input.environments ?? {},
});

describe("resolveConfiguredEnvironment", () => {
  it("prefers cli flag over T3CLI_ENV", () => {
    assert.equal(
      resolveConfiguredEnvironment({
        cliFlag: "cli",
        t3cliEnv: "env",
      }),
      "cli",
    );
  });

  it("falls back to T3CLI_ENV when cli flag is absent", () => {
    assert.equal(
      resolveConfiguredEnvironment({
        t3cliEnv: "env",
      }),
      "env",
    );
  });
});

describe("selectEnvironmentName", () => {
  it("prefers selected environment over config default", () => {
    const selected = selectEnvironmentName({
      selectedEnvironment: "cli",
      defaultEnvironment: "default",
    });
    assert.equal(selected, "cli");
  });

  it("falls back to config default", () => {
    assert.equal(
      selectEnvironmentName({
        defaultEnvironment: "default",
      }),
      "default",
    );
  });
});

describe("validateCredentialEnvVars", () => {
  it.effect("requires both T3CODE_URL and T3CODE_TOKEN together", () =>
    Effect.gen(function* () {
      const onlyUrl = yield* validateCredentialEnvVars({ envUrl: "https://example.com" }).pipe(
        Effect.exit,
      );
      assert.equal(Exit.isFailure(onlyUrl), true);

      const onlyToken = yield* validateCredentialEnvVars({ envToken: "token" }).pipe(Effect.exit);
      assert.equal(Exit.isFailure(onlyToken), true);

      yield* validateCredentialEnvVars({
        envUrl: "https://example.com",
        envToken: "token",
      });
    }),
  );
});

describe("buildResolvedConfigFromEnv", () => {
  it.effect(
    "does not inherit local=true from selected stored environment when env vars override",
    () =>
      Effect.gen(function* () {
        const resolved = yield* buildResolvedConfigFromEnv({
          envUrl: "https://remote.example",
          envToken: "env-token",
        });
        assert.equal(resolved.source, "env");
        assert.equal(resolved.local, false);
        assert.equal(resolved.url, "https://remote.example");
        assert.equal(resolved.token, "env-token");
      }),
  );
});

describe("resolveDefaultForUpsert", () => {
  it("sets default only for the first environment", () => {
    assert.equal(resolveDefaultForUpsert(sampleEncrypted({}), "first"), "first");
    assert.equal(
      resolveDefaultForUpsert(
        sampleEncrypted({
          default: "home",
          environments: {
            home: {
              url: "https://home.example",
              local: false,
              token: {
                kind: "encrypted",
                alg: "aes-256-gcm",
                key: "default",
                nonce: "n",
                ciphertext: "c",
                tag: "t",
              },
            },
          },
        }),
        "work",
      ),
      "home",
    );
  });

  it("promotes default when makeDefault is true", () => {
    assert.equal(
      resolveDefaultForUpsert(
        sampleEncrypted({
          default: "home",
          environments: {
            home: {
              url: "https://home.example",
              local: false,
              token: {
                kind: "encrypted",
                alg: "aes-256-gcm",
                key: "default",
                nonce: "n",
                ciphertext: "c",
                tag: "t",
              },
            },
            work: {
              url: "https://work.example",
              local: false,
              token: {
                kind: "encrypted",
                alg: "aes-256-gcm",
                key: "default",
                nonce: "n2",
                ciphertext: "c2",
                tag: "t2",
              },
            },
          },
        }),
        "work",
        true,
      ),
      "work",
    );
  });
});
