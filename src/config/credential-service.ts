import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ConfigError } from "./error.ts";
import type { EncryptedToken } from "./schema.ts";

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

export class T3CredentialCrypto extends Context.Service<T3CredentialCrypto, CredentialCrypto>()(
  "t3cli/T3CredentialCrypto",
) {}

export type CredentialCrypto = {
  readonly encrypt: (input: CredentialEncryptInput) => Effect.Effect<EncryptedToken, ConfigError>;
  readonly decrypt: (input: CredentialDecryptInput) => Effect.Effect<string, ConfigError>;
};
