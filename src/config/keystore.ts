import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ConfigError, KeystoreUnavailableError } from "./error.ts";

export const masterKeyByteLength = 32;

export type MasterKeyReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "present"; readonly key: Uint8Array }
  | { readonly kind: "corrupt"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string };

export type MasterKeyKeystore = {
  readonly read: () => Effect.Effect<MasterKeyReadResult, ConfigError>;
  readonly write: (key: Uint8Array) => Effect.Effect<void, ConfigError | KeystoreUnavailableError>;
};

export class T3MasterKeyKeystoreFactory extends Context.Service<
  T3MasterKeyKeystoreFactory,
  {
    readonly make: () => Effect.Effect<MasterKeyKeystore, KeystoreUnavailableError>;
  }
>()("t3cli/T3MasterKeyKeystoreFactory") {}

export function shouldUseFileKeystoreForRead(result: MasterKeyReadResult) {
  return result.kind === "missing" || result.kind === "unavailable";
}
