import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { CredentialCipherError } from "./error.ts";

export const credentialCipherNonceByteLength = 12;
export const credentialCipherTagByteLength = 16;

export type AesGcmEncryptInput = {
  readonly key: Uint8Array;
  readonly nonce: Uint8Array;
  readonly plaintext: Uint8Array;
  readonly additionalData: Uint8Array;
};

export type AesGcmDecryptInput = {
  readonly key: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly tag: Uint8Array;
  readonly additionalData: Uint8Array;
};

export type AesGcmEncryptResult = {
  readonly ciphertext: Uint8Array;
  readonly tag: Uint8Array;
};

export class T3CredentialCipher extends Context.Service<T3CredentialCipher, CredentialCipher>()(
  "t3cli/T3CredentialCipher",
) {}

export type CredentialCipher = {
  readonly encrypt: (
    input: AesGcmEncryptInput,
  ) => Effect.Effect<AesGcmEncryptResult, CredentialCipherError>;
  readonly decrypt: (input: AesGcmDecryptInput) => Effect.Effect<Uint8Array, CredentialCipherError>;
};
