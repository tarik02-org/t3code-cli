import { createCipheriv, createDecipheriv } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  credentialCipherTagByteLength,
  T3CredentialCipher,
  type CredentialCipher,
} from "./credential-cipher-service.ts";
import { CredentialCipherError } from "./error.ts";

function makeNodeCredentialCipher(): CredentialCipher {
  return {
    encrypt: (input) =>
      Effect.try({
        try: () => {
          const cipher = createCipheriv("aes-256-gcm", input.key, input.nonce, {
            authTagLength: credentialCipherTagByteLength,
          });
          cipher.setAAD(input.additionalData);
          const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
          return {
            ciphertext: new Uint8Array(ciphertext),
            tag: new Uint8Array(cipher.getAuthTag()),
          };
        },
        catch: (cause) => new CredentialCipherError({ cause }),
      }),
    decrypt: (input) =>
      Effect.try({
        try: () => {
          const decipher = createDecipheriv("aes-256-gcm", input.key, input.nonce, {
            authTagLength: credentialCipherTagByteLength,
          });
          decipher.setAAD(input.additionalData);
          decipher.setAuthTag(input.tag);
          const plaintext = Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
          return new Uint8Array(plaintext);
        },
        catch: (cause) => new CredentialCipherError({ cause }),
      }),
  };
}

export const T3CredentialCipherNodeLive = Layer.succeed(
  T3CredentialCipher,
  makeNodeCredentialCipher(),
);
