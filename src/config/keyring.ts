import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";

type KeyringModule = typeof import("@napi-rs/keyring");

export class KeyringModuleLoadError extends Schema.TaggedErrorClass<KeyringModuleLoadError>()(
  "KeyringModuleLoadError",
  {
    cause: Schema.Defect(),
  },
) {}

export class KeyringModuleNotFoundError extends Schema.TaggedErrorClass<KeyringModuleNotFoundError>()(
  "KeyringModuleNotFoundError",
  {
    cause: Schema.Defect(),
  },
) {}

export class KeyringOperationError extends Schema.TaggedErrorClass<KeyringOperationError>()(
  "KeyringOperationError",
  {
    cause: Schema.Defect(),
  },
) {}

export type KeyringStore = {
  readonly readPassword: (service: string, account: string) => string | null;
  readonly writePassword: (service: string, account: string, password: string) => void;
};

export function keyringErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (Predicate.isString(cause)) {
    return cause;
  }
  return "keyring operation failed";
}

function classifyKeyringModuleLoadFailure(cause: unknown) {
  return Predicate.hasProperty(cause, "code") &&
    Predicate.isString(cause.code) &&
    (cause.code === "ERR_MODULE_NOT_FOUND" || cause.code === "MODULE_NOT_FOUND")
    ? new KeyringModuleNotFoundError({ cause })
    : new KeyringModuleLoadError({ cause });
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

export function getKeyringStore(): Effect.Effect<
  KeyringStore,
  KeyringModuleLoadError | KeyringModuleNotFoundError
> {
  return Effect.gen(function* () {
    const load = yield* loadKeyringModuleMemoized;
    const module = yield* load;
    return createKeyringStore(module);
  });
}
