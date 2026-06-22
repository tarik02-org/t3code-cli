import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import { Environment } from "../environment/service.ts";
import { T3CredentialCipher, credentialCipherNonceByteLength } from "./credential-cipher.ts";
import type { EncryptedToken } from "./schema.ts";
import {
  ConfigError,
  KeyringOperationError,
  describeCredentialCipherError,
  describeKeyringModuleLoadError,
  describeKeyringOperationError,
  isPlatformNotFoundError,
} from "./error.ts";
import { hardenPrivateFileMode } from "./file-mode.ts";
import { getKeyringStore } from "./keyring.ts";
import { resolveKeyFilePath } from "./paths.ts";

export type CredentialEncryptInput = {
  readonly environmentName: string;
  readonly url: string;
  readonly local: boolean;
  readonly token: string;
};

export type CredentialDecryptInput = {
  readonly environmentName: string;
  readonly url: string;
  readonly local: boolean;
  readonly token: EncryptedToken;
};

export class T3CredentialCrypto extends Context.Service<
  T3CredentialCrypto,
  {
    readonly encrypt: (input: CredentialEncryptInput) => Effect.Effect<EncryptedToken, ConfigError>;
    readonly decrypt: (input: CredentialDecryptInput) => Effect.Effect<string, ConfigError>;
  }
>()("t3cli/T3CredentialCrypto") {}

const configSchemaVersion = 2;
const masterKeyByteLength = 32;
const keyringService = "t3cli";
const keyringAccount = "master-key";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type KeyringReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "present"; readonly key: Uint8Array }
  | { readonly kind: "corrupt"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string };

type KeyringWriteResult =
  | { readonly kind: "stored" }
  | { readonly kind: "unavailable"; readonly message: string };

export function shouldFallbackToKeyFile(result: KeyringReadResult) {
  return result.kind === "missing" || result.kind === "unavailable";
}

export const make = Effect.fn("makeT3CredentialCrypto")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const cryptoService = yield* Crypto.Crypto;
  const cipher = yield* T3CredentialCipher;
  const services = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
    Layer.succeed(Environment, environment),
    Layer.succeed(Crypto.Crypto, cryptoService),
  );
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(effect, services);
  const keyFilePath = yield* run(resolveKeyFilePath());

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
    const key = yield* decodeBase64Bytes(raw.trim()).pipe(
      Effect.catchTags({
        EncodingError: (error) =>
          Effect.fail(
            new ConfigError({
              message: "invalid credential key file: invalid base64",
              cause: error,
            }),
          ),
      }),
    );
    if (key.byteLength !== masterKeyByteLength) {
      return yield* Effect.fail(
        new ConfigError({ message: "invalid credential key file: unexpected key length" }),
      );
    }
    return key;
  });

  const writeKeyFileMasterKey = Effect.fn("writeKeyFileMasterKey")(function* (
    filePath: string,
    key: Uint8Array,
  ) {
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true, mode: 0o700 }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            new ConfigError({ message: "failed to write credential key file", cause: error }),
          ),
      }),
    );
    yield* fs.writeFileString(filePath, `${Encoding.encodeBase64(key)}\n`, { mode: 0o600 }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            new ConfigError({ message: "failed to write credential key file", cause: error }),
          ),
      }),
    );
    yield* run(hardenPrivateFileMode(filePath, "credential key"));
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
        yield* run(hardenPrivateFileMode(keyFilePath, "credential key"));
        return fileKey;
      }
    }
    const generated = yield* run(secureRandomBytes(masterKeyByteLength));
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
    const nonce = yield* run(secureRandomBytes(credentialCipherNonceByteLength));
    const encrypted = yield* cipher
      .encrypt({
        key: masterKey,
        nonce,
        plaintext: encodeUtf8(input.token),
        additionalData: buildCredentialAad(input),
      })
      .pipe(
        Effect.catchTags({
          CredentialCipherError: (error) =>
            Effect.fail(
              new ConfigError({
                message: describeCredentialCipherError(error),
                cause: error,
              }),
            ),
        }),
      );
    return {
      kind: "encrypted" as const,
      alg: "aes-256-gcm" as const,
      key: "default" as const,
      nonce: Encoding.encodeBase64(nonce),
      ciphertext: Encoding.encodeBase64(encrypted.ciphertext),
      tag: Encoding.encodeBase64(encrypted.tag),
    };
  });

  const decrypt = Effect.fn("T3CredentialCryptoLive.decrypt")(function* (
    input: CredentialDecryptInput,
  ) {
    const masterKey = yield* getMasterKey();
    const nonce = yield* decodeBase64Field(input.token.nonce, "token nonce");
    const ciphertext = yield* decodeBase64Field(input.token.ciphertext, "token ciphertext");
    const tag = yield* decodeBase64Field(input.token.tag, "token tag");
    const plaintext = yield* cipher
      .decrypt({
        key: masterKey,
        nonce,
        ciphertext,
        tag,
        additionalData: buildCredentialAad(input),
      })
      .pipe(
        Effect.catchTags({
          CredentialCipherError: (error) =>
            Effect.fail(
              new ConfigError({
                message: describeCredentialCipherError(error),
                cause: error,
              }),
            ),
        }),
      );
    return decodeUtf8(plaintext);
  });

  return { encrypt, decrypt };
});

export const layer = Layer.effect(T3CredentialCrypto, make());

function buildCredentialAad(input: {
  readonly environmentName: string;
  readonly url: string;
  readonly local: boolean;
}) {
  return encodeUtf8(
    `${configSchemaVersion}\0${input.environmentName}\0${input.url}\0${input.local}`,
  );
}

function encodeUtf8(value: string) {
  return textEncoder.encode(value);
}

function decodeUtf8(value: Uint8Array) {
  return textDecoder.decode(value);
}

const secureRandomBytes = Effect.fn("secureRandomBytes")(function* (size: number) {
  const cryptoService = yield* Crypto.Crypto;
  return yield* cryptoService.randomBytes(size).pipe(
    Effect.mapError(
      (error) =>
        new ConfigError({
          message: "failed to generate secure random bytes",
          cause: error,
        }),
    ),
  );
});

function decodeBase64Bytes(value: string) {
  return Effect.fromResult(Encoding.decodeBase64(value));
}

function decodeBase64Field(value: string, field: string) {
  return decodeBase64Bytes(value).pipe(
    Effect.catchTags({
      EncodingError: (error) =>
        Effect.fail(
          new ConfigError({
            message: `invalid encrypted token ${field}`,
            cause: error,
          }),
        ),
    }),
  );
}

function readKeyringMasterKey(): Effect.Effect<KeyringReadResult> {
  return Effect.gen(function* () {
    const store = yield* getKeyringStore();
    return yield* Effect.try({
      try: () => parseKeyringPassword(store.readPassword(keyringService, keyringAccount)),
      catch: (cause) => new KeyringOperationError({ operation: "read-password", cause }),
    }).pipe(
      Effect.catchTags({
        KeyringOperationError: (error) =>
          Effect.succeed({
            kind: "unavailable",
            message: describeKeyringOperationError(error),
          } satisfies KeyringReadResult),
      }),
    );
  }).pipe(
    Effect.catchTags({
      KeyringModuleLoadError: (error) =>
        Effect.succeed({
          kind: "unavailable",
          message: describeKeyringModuleLoadError(error),
        } satisfies KeyringReadResult),
    }),
  );
}

export function parseKeyringPassword(password: string | null): KeyringReadResult {
  if (password === null || password.length === 0) {
    return { kind: "missing" };
  }
  return Result.match(Encoding.decodeBase64(password.trim()), {
    onFailure: () => ({
      kind: "corrupt" as const,
      message: "invalid base64 key",
    }),
    onSuccess: (key) => {
      if (key.byteLength !== masterKeyByteLength) {
        return {
          kind: "corrupt" as const,
          message: "unexpected key length",
        };
      }
      return { kind: "present" as const, key };
    },
  });
}

function writeKeyringMasterKey(key: Uint8Array): Effect.Effect<KeyringWriteResult> {
  return Effect.gen(function* () {
    const store = yield* getKeyringStore();
    return yield* Effect.try({
      try: () => {
        store.writePassword(keyringService, keyringAccount, Encoding.encodeBase64(key));
        return { kind: "stored" } as const;
      },
      catch: (cause) => new KeyringOperationError({ operation: "write-password", cause }),
    }).pipe(
      Effect.catchTags({
        KeyringOperationError: (error) =>
          Effect.succeed({
            kind: "unavailable",
            message: describeKeyringOperationError(error),
          } satisfies KeyringWriteResult),
      }),
    );
  }).pipe(
    Effect.catchTags({
      KeyringModuleLoadError: (error) =>
        Effect.succeed({
          kind: "unavailable",
          message: describeKeyringModuleLoadError(error),
        } satisfies KeyringWriteResult),
    }),
  );
}
