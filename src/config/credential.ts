import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";
import {
  T3CredentialCrypto,
  type CredentialDecryptInput,
  type CredentialEncryptInput,
} from "./credential-service.ts";
import { ConfigError, CredentialDecryptError, isPlatformNotFoundError } from "./error.ts";
import { hardenPrivateFileMode } from "./file-mode.ts";
import { getKeyringStore, KeyringOperationError, keyringErrorMessage } from "./keyring.ts";
import { resolveKeyFilePath } from "./paths.ts";

const configSchemaVersion = 2;
const masterKeyByteLength = 32;
const gcmNonceByteLength = 12;
const keyringService = "t3cli";
const keyringAccount = "master-key";

export type KeyringReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "present"; readonly key: Buffer }
  | { readonly kind: "corrupt"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string };

type KeyringWriteResult =
  | { readonly kind: "stored" }
  | { readonly kind: "unavailable"; readonly message: string };

export function shouldFallbackToKeyFile(result: KeyringReadResult) {
  return result.kind === "missing" || result.kind === "unavailable";
}

export const makeT3CredentialCrypto = Effect.fn("makeT3CredentialCrypto")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const keyFilePath = resolveKeyFilePath(path, environment);

  const readKeyFileMasterKey = Effect.fn("readKeyFileMasterKey")(function* (filePath: string) {
    const raw = yield* fs.readFileString(filePath).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          isPlatformNotFoundError(error)
            ? Effect.succeed(undefined)
            : Effect.fail(
                new ConfigError({
                  message: "failed to read credential key file",
                  cause: error,
                }),
              ),
      }),
    );
    if (raw === undefined) {
      return undefined;
    }
    const key = Buffer.from(raw.trim(), "base64");
    if (key.byteLength !== masterKeyByteLength) {
      return yield* Effect.fail(
        new ConfigError({ message: "invalid credential key file: unexpected key length" }),
      );
    }
    return key;
  });

  const writeKeyFileMasterKey = Effect.fn("writeKeyFileMasterKey")(function* (
    filePath: string,
    key: Buffer,
  ) {
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true, mode: 0o700 }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            new ConfigError({ message: "failed to write credential key file", cause: error }),
          ),
      }),
    );
    yield* fs.writeFileString(filePath, `${key.toString("base64")}\n`, { mode: 0o600 }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            new ConfigError({ message: "failed to write credential key file", cause: error }),
          ),
      }),
    );
    yield* hardenPrivateFileMode(fs, filePath, "credential key");
  });

  const getMasterKey = Effect.fn("T3CredentialCryptoLive.getMasterKey")(function* () {
    const keyringResult = yield* readKeyringMasterKey();
    if (keyringResult.kind === "present") {
      return keyringResult.key;
    }
    if (keyringResult.kind === "corrupt") {
      return yield* Effect.fail(
        new ConfigError({
          message: `corrupt credential key in OS keyring: ${keyringResult.message}`,
        }),
      );
    }
    if (shouldFallbackToKeyFile(keyringResult)) {
      const fileKey = yield* readKeyFileMasterKey(keyFilePath);
      if (fileKey !== undefined) {
        yield* hardenPrivateFileMode(fs, keyFilePath, "credential key");
        return fileKey;
      }
    }
    const generated = randomBytes(masterKeyByteLength);
    const writeResult = yield* writeKeyringMasterKey(generated);
    if (writeResult.kind === "stored") {
      return generated;
    }
    yield* writeKeyFileMasterKey(keyFilePath, generated);
    return generated;
  });

  const encrypt = Effect.fn("T3CredentialCryptoLive.encrypt")(function* (
    input: CredentialEncryptInput,
  ) {
    const masterKey = yield* getMasterKey();
    const nonce = randomBytes(gcmNonceByteLength);
    const cipher = createCipheriv("aes-256-gcm", masterKey, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(buildAad(input));
    const ciphertext = Buffer.concat([cipher.update(input.token, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      kind: "encrypted" as const,
      alg: "aes-256-gcm" as const,
      key: "default" as const,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
    };
  });

  const decrypt = Effect.fn("T3CredentialCryptoLive.decrypt")(function* (
    input: CredentialDecryptInput,
  ) {
    const masterKey = yield* getMasterKey();
    return yield* Effect.try({
      try: () => decryptToken(masterKey, input),
      catch: (cause) => new CredentialDecryptError({ cause }),
    }).pipe(
      Effect.catchTags({
        CredentialDecryptError: (error) =>
          Effect.fail(
            new ConfigError({
              message: "failed to decrypt credential token",
              cause: error.cause,
            }),
          ),
      }),
    );
  });

  return { encrypt, decrypt };
});

export const T3CredentialCryptoLive = Layer.effect(T3CredentialCrypto, makeT3CredentialCrypto());

function buildAad(input: {
  readonly environmentName: string;
  readonly url: string;
  readonly local: boolean;
}) {
  return Buffer.from(
    `${configSchemaVersion}\0${input.environmentName}\0${input.url}\0${input.local}`,
    "utf8",
  );
}

function decryptToken(masterKey: Buffer, input: CredentialDecryptInput) {
  const nonce = Buffer.from(input.token.nonce, "base64");
  const ciphertext = Buffer.from(input.token.ciphertext, "base64");
  const tag = Buffer.from(input.token.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce, {
    authTagLength: 16,
  });
  decipher.setAAD(buildAad(input));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function readKeyringMasterKey(): Effect.Effect<KeyringReadResult> {
  return Effect.gen(function* () {
    const store = yield* getKeyringStore();
    if (store === null) {
      return {
        kind: "unavailable",
        message: "OS keyring backend is not available",
      } satisfies KeyringReadResult;
    }
    return yield* Effect.try({
      try: () => parseKeyringPassword(store.readPassword(keyringService, keyringAccount)),
      catch: (cause) => new KeyringOperationError({ cause }),
    }).pipe(
      Effect.catchTags({
        KeyringOperationError: (error) =>
          Effect.succeed({
            kind: "unavailable",
            message: keyringErrorMessage(error.cause),
          } satisfies KeyringReadResult),
      }),
    );
  }).pipe(
    Effect.catchTags({
      KeyringModuleLoadError: (error) =>
        Effect.succeed({
          kind: "unavailable",
          message: keyringErrorMessage(error.cause),
        } satisfies KeyringReadResult),
      KeyringModuleNotFoundError: (error) =>
        Effect.succeed({
          kind: "unavailable",
          message: keyringErrorMessage(error.cause),
        } satisfies KeyringReadResult),
    }),
  );
}

export function parseKeyringPassword(password: string | null): KeyringReadResult {
  if (password === null || password.length === 0) {
    return { kind: "missing" };
  }
  const key = Buffer.from(password, "base64");
  if (key.byteLength !== masterKeyByteLength) {
    return {
      kind: "corrupt",
      message: "unexpected key length",
    };
  }
  return { kind: "present", key };
}

function writeKeyringMasterKey(key: Buffer): Effect.Effect<KeyringWriteResult> {
  return Effect.gen(function* () {
    const store = yield* getKeyringStore();
    if (store === null) {
      return {
        kind: "unavailable",
        message: "OS keyring backend is not available",
      } satisfies KeyringWriteResult;
    }
    return yield* Effect.try({
      try: () => {
        store.writePassword(keyringService, keyringAccount, key.toString("base64"));
        return { kind: "stored" } as const;
      },
      catch: (cause) => new KeyringOperationError({ cause }),
    }).pipe(
      Effect.catchTags({
        KeyringOperationError: (error) =>
          Effect.succeed({
            kind: "unavailable",
            message: keyringErrorMessage(error.cause),
          } satisfies KeyringWriteResult),
      }),
    );
  }).pipe(
    Effect.catchTags({
      KeyringModuleLoadError: (error) =>
        Effect.succeed({
          kind: "unavailable",
          message: keyringErrorMessage(error.cause),
        } satisfies KeyringWriteResult),
      KeyringModuleNotFoundError: (error) =>
        Effect.succeed({
          kind: "unavailable",
          message: keyringErrorMessage(error.cause),
        } satisfies KeyringWriteResult),
    }),
  );
}
