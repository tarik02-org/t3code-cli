import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
};

type KeyringModule = {
  Entry: new (service: string, account: string) => KeyringEntry;
};

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

let cachedKeyringModule: KeyringModule | null | undefined;

function isKeyringModule(value: unknown): value is KeyringModule {
  return Predicate.hasProperty(value, "Entry") && Predicate.isFunction(value.Entry);
}

function isMissingKeyringModule(cause: unknown): boolean {
  return (
    Predicate.hasProperty(cause, "code") &&
    Predicate.isString(cause.code) &&
    (cause.code === "ERR_MODULE_NOT_FOUND" || cause.code === "MODULE_NOT_FOUND")
  );
}

function classifyKeyringModuleLoadFailure(cause: unknown) {
  return isMissingKeyringModule(cause)
    ? new KeyringModuleNotFoundError({ cause })
    : new KeyringModuleLoadError({ cause });
}

export function keyringErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (Predicate.isString(cause)) {
    return cause;
  }
  return "keyring operation failed";
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

export function loadKeyringModule(): Effect.Effect<
  KeyringModule | null,
  KeyringModuleLoadError | KeyringModuleNotFoundError
> {
  if (cachedKeyringModule !== undefined) {
    return Effect.succeed(cachedKeyringModule);
  }
  return Effect.tryPromise({
    try: () => import("@napi-rs/keyring"),
    catch: classifyKeyringModuleLoadFailure,
  }).pipe(
    Effect.map((module) => (isKeyringModule(module) ? module : null)),
    Effect.tap((module) =>
      Effect.sync(() => {
        cachedKeyringModule = module;
      }),
    ),
    Effect.catchTags({
      KeyringModuleNotFoundError: () =>
        Effect.sync(() => {
          cachedKeyringModule = null;
          return null;
        }),
    }),
  );
}

export function getKeyringStore(): Effect.Effect<
  KeyringStore | null,
  KeyringModuleLoadError | KeyringModuleNotFoundError
> {
  return loadKeyringModule().pipe(
    Effect.map((module) => (module === null ? null : createKeyringStore(module))),
  );
}
