import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { KeystoreUnavailableError } from "./error.ts";
import { T3MasterKeyKeystoreFactory } from "./keystore.ts";

export const unavailableKeystoreFactoryLayer = Layer.succeed(T3MasterKeyKeystoreFactory)({
  make: () =>
    Effect.fail(
      new KeystoreUnavailableError({
        reason: "module-not-found",
        cause: new Error("keyring unavailable in test"),
      }),
    ),
});
