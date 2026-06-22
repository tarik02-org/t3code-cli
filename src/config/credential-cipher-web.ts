import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  credentialCipherTagByteLength,
  T3CredentialCipher,
  type CredentialCipher,
} from "./credential-cipher-service.ts";
import { CredentialCipherError } from "./error.ts";

const aesGcmAlgorithm = "AES-GCM";

function copyBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function importAesGcmKey(key: Uint8Array) {
  return Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle.importKey("raw", copyBytes(key), { name: aesGcmAlgorithm }, false, [
        "encrypt",
        "decrypt",
      ]),
    catch: (cause) => new CredentialCipherError({ cause }),
  });
}

function makeWebCredentialCipher(): CredentialCipher {
  return {
    encrypt: (input) =>
      Effect.gen(function* () {
        const cryptoKey = yield* importAesGcmKey(input.key);
        const encrypted = yield* Effect.tryPromise({
          try: () =>
            globalThis.crypto.subtle.encrypt(
              {
                name: aesGcmAlgorithm,
                iv: copyBytes(input.nonce),
                additionalData: copyBytes(input.additionalData),
                tagLength: credentialCipherTagByteLength * 8,
              },
              cryptoKey,
              copyBytes(input.plaintext),
            ),
          catch: (cause) => new CredentialCipherError({ cause }),
        });
        const bytes = new Uint8Array(encrypted);
        if (bytes.byteLength < credentialCipherTagByteLength) {
          return yield* Effect.fail(
            new CredentialCipherError({
              cause: new Error("encrypted output shorter than auth tag"),
            }),
          );
        }
        return {
          ciphertext: bytes.slice(0, -credentialCipherTagByteLength),
          tag: bytes.slice(-credentialCipherTagByteLength),
        };
      }),
    decrypt: (input) =>
      Effect.gen(function* () {
        const cryptoKey = yield* importAesGcmKey(input.key);
        const combined = new Uint8Array(input.ciphertext.byteLength + input.tag.byteLength);
        combined.set(input.ciphertext);
        combined.set(input.tag, input.ciphertext.byteLength);
        const plaintext = yield* Effect.tryPromise({
          try: () =>
            globalThis.crypto.subtle.decrypt(
              {
                name: aesGcmAlgorithm,
                iv: copyBytes(input.nonce),
                additionalData: copyBytes(input.additionalData),
                tagLength: credentialCipherTagByteLength * 8,
              },
              cryptoKey,
              combined,
            ),
          catch: (cause) => new CredentialCipherError({ cause }),
        });
        return new Uint8Array(plaintext);
      }),
  };
}

export const T3CredentialCipherWebLive = Layer.succeed(
  T3CredentialCipher,
  makeWebCredentialCipher(),
);
