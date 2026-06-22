import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";

import { KeystoreUnavailableError } from "./error.ts";
import {
  masterKeyByteLength,
  T3MasterKeyKeystoreFactory,
  type MasterKeyKeystore,
  type MasterKeyReadResult,
} from "./keystore.ts";

type KeyringModule = typeof import("@napi-rs/keyring");

const keyringService = "t3cli";
const keyringAccount = "master-key";

function isModuleNotFound(cause: unknown) {
  return (
    Predicate.hasProperty(cause, "code") &&
    Predicate.isString(cause.code) &&
    (cause.code === "ERR_MODULE_NOT_FOUND" || cause.code === "MODULE_NOT_FOUND")
  );
}

function keyringBackendUnavailable(cause: unknown) {
  return new KeystoreUnavailableError({ reason: "backend-unavailable", cause });
}

const loadKeyringModuleOnce = Effect.tryPromise({
  try: () => import("@napi-rs/keyring") as Promise<KeyringModule>,
  catch: (cause) => cause,
});

const loadKeyringModuleMemoized = Effect.cached(loadKeyringModuleOnce);

const loadKeyringModule = Effect.gen(function* () {
  const load = yield* loadKeyringModuleMemoized;
  return yield* load.pipe(
    Effect.mapError((cause) =>
      isModuleNotFound(cause)
        ? new KeystoreUnavailableError({ reason: "module-not-found", cause })
        : keyringBackendUnavailable(cause),
    ),
  );
});

export function parseKeyringPassword(password: string | null): MasterKeyReadResult {
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

function createKeyringKeystore(keyring: KeyringModule): MasterKeyKeystore {
  const entry = new keyring.Entry(keyringService, keyringAccount);
  return {
    read: () =>
      Effect.sync(() => {
        try {
          return parseKeyringPassword(entry.getPassword());
        } catch {
          return {
            kind: "unavailable" as const,
            message: "failed to read credential key from OS keyring",
          };
        }
      }),
    write: (key) =>
      Effect.try({
        try: () => {
          entry.setPassword(Encoding.encodeBase64(key));
        },
        catch: keyringBackendUnavailable,
      }),
  };
}

const make = (): T3MasterKeyKeystoreFactory["Service"] => ({
  make: () =>
    Effect.gen(function* () {
      const keyring = yield* loadKeyringModule;
      return createKeyringKeystore(keyring);
    }),
});

export const layerNode = Layer.succeed(T3MasterKeyKeystoreFactory, make());
