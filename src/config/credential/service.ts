import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { T3CredentialCipher, credentialCipherNonceByteLength } from "./cipher.ts";
import type { EncryptedToken } from "../persist/schema.ts";
import { ConfigError } from "../error.ts";
import { CredentialCipherError } from "./error.ts";
import { makeFileKeystore } from "../keystore/file.ts";
import { T3MasterKeyKeystoreFactory, masterKeyByteLength } from "../keystore/service.ts";

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
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const make = Effect.fn("makeT3CredentialCrypto")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configProvider = yield* ConfigProvider.ConfigProvider;
  const cryptoService = yield* Crypto.Crypto;
  const cipher = yield* T3CredentialCipher;
  const keystoreFactory = yield* T3MasterKeyKeystoreFactory;
  const services = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
    Layer.succeed(Crypto.Crypto, cryptoService),
    Layer.succeed(ConfigProvider.ConfigProvider, configProvider),
  );

  const fileKeystore = yield* Effect.provide(makeFileKeystore(), services);
  const primaryKeystore = yield* keystoreFactory.make().pipe(
    Effect.catchTags({
      KeystoreUnavailableError: () => Effect.succeed(undefined),
    }),
  );

  const readMasterKey = Effect.fn("readMasterKey")(function* () {
    if (primaryKeystore !== undefined) {
      const primaryResult = yield* primaryKeystore.read();
      if (primaryResult.kind === "present") {
        return primaryResult.key;
      }
      if (primaryResult.kind === "corrupt") {
        return yield* Effect.fail(
          new ConfigError({
            message: `corrupt credential key in OS keyring: ${primaryResult.message}`,
          }),
        );
      }
    }

    const fileResult = yield* fileKeystore.read();
    if (fileResult.kind === "present") {
      return fileResult.key;
    }
    return undefined;
  });

  const writeMasterKey = Effect.fn("writeMasterKey")(function* (key: Uint8Array) {
    if (primaryKeystore !== undefined) {
      yield* primaryKeystore.write(key).pipe(
        Effect.catchTags({
          KeystoreUnavailableError: () => fileKeystore.write(key),
        }),
      );
      return;
    }
    yield* fileKeystore.write(key);
  });

  const getMasterKey = Effect.fn("getMasterKey")(function* () {
    const existing = yield* readMasterKey();
    if (existing !== undefined) {
      return existing;
    }
    const generated = yield* cryptoService.randomBytes(masterKeyByteLength).pipe(
      Effect.mapError(
        (error) =>
          new ConfigError({
            message: "failed to generate secure random bytes",
            cause: error,
          }),
      ),
    );
    yield* writeMasterKey(generated);
    return generated;
  });

  const encrypt: (input: CredentialEncryptInput) => Effect.Effect<EncryptedToken, ConfigError> =
    Effect.fn("encrypt")(function* (input) {
      const masterKey = yield* getMasterKey();
      const nonce = yield* cryptoService.randomBytes(credentialCipherNonceByteLength).pipe(
        Effect.mapError(
          (error) =>
            new ConfigError({
              message: "failed to generate secure random bytes",
              cause: error,
            }),
        ),
      );
      const encrypted = yield* cipher
        .encrypt({
          key: masterKey,
          nonce,
          plaintext: encodeUtf8(input.token),
          additionalData: buildCredentialAad(input),
        })
        .pipe(Effect.mapError(mapCredentialCipherError));
      return {
        kind: "encrypted" as const,
        alg: "aes-256-gcm" as const,
        key: "default" as const,
        nonce: Encoding.encodeBase64(nonce),
        ciphertext: Encoding.encodeBase64(encrypted.ciphertext),
        tag: Encoding.encodeBase64(encrypted.tag),
      };
    });

  const decrypt: (input: CredentialDecryptInput) => Effect.Effect<string, ConfigError> = Effect.fn(
    "decrypt",
  )(function* (input) {
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
      .pipe(Effect.mapError(mapCredentialCipherError));
    return decodeUtf8(plaintext);
  });

  return { encrypt, decrypt } satisfies T3CredentialCrypto["Service"];
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

function decodeBase64Field(value: string, field: string) {
  return Effect.fromResult(Encoding.decodeBase64(value)).pipe(
    Effect.catchTags({
      EncodingError: (error) =>
        Effect.fail(new ConfigError({ message: `invalid encrypted token ${field}`, cause: error })),
    }),
  );
}

function mapCredentialCipherError(error: CredentialCipherError) {
  return new ConfigError({
    message:
      error.operation === "encrypt"
        ? "failed to encrypt credential cipher payload"
        : "failed to decrypt credential cipher payload",
    cause: error,
  });
}
