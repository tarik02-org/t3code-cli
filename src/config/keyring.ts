import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import { KeyringModuleLoadError } from "./error.ts";

type KeyringModule = typeof import("@napi-rs/keyring");

export type KeyringStore = {
  readonly readPassword: (service: string, account: string) => string | null;
  readonly writePassword: (service: string, account: string, password: string) => void;
};

function isModuleNotFound(cause: unknown) {
  return (
    Predicate.hasProperty(cause, "code") &&
    Predicate.isString(cause.code) &&
    (cause.code === "ERR_MODULE_NOT_FOUND" || cause.code === "MODULE_NOT_FOUND")
  );
}

function classifyKeyringModuleLoadFailure(cause: unknown) {
  return new KeyringModuleLoadError({
    reason: isModuleNotFound(cause) ? "module-not-found" : "load-failed",
    cause,
  });
}

function createKeyringStore(keyring: KeyringModule): KeyringStore {
  return {
    readPassword(service, account) {
      return new keyring.Entry(service, account).getPassword();
    },
    writePassword(service, account, password) {
      new keyring.Entry(service, account).setPassword(password);
    },
  };
}

const loadKeyringModuleOnce = Effect.tryPromise({
  try: () => import("@napi-rs/keyring") as Promise<KeyringModule>,
  catch: classifyKeyringModuleLoadFailure,
});

const loadKeyringModuleMemoized = Effect.cached(loadKeyringModuleOnce);

export function getKeyringStore(): Effect.Effect<KeyringStore, KeyringModuleLoadError> {
  return Effect.gen(function* () {
    const load = yield* loadKeyringModuleMemoized;
    const module = yield* load;
    return createKeyringStore(module);
  });
}
