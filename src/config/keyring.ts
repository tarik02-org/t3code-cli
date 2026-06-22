import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

type KeyringModule = typeof import("@napi-rs/keyring");

export type KeyringStore = {
  readonly readPassword: (service: string, account: string) => string | null;
  readonly writePassword: (service: string, account: string, password: string) => void;
};

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
  catch: (cause) => cause,
}).pipe(Effect.option);

const loadKeyringModuleMemoized = Effect.cached(loadKeyringModuleOnce);

export function getKeyringStore(): Effect.Effect<KeyringStore | undefined> {
  return Effect.gen(function* () {
    const load = yield* loadKeyringModuleMemoized;
    const module = yield* load;
    if (Option.isNone(module)) {
      return undefined;
    }
    return createKeyringStore(module.value);
  });
}
