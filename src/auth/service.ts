import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { AuthSessionState, AuthWebSocketTokenResult } from "./schema.ts";
import type { AuthError } from "./error.ts";
import type { LocalAuthInput, LocalAuthResult, PairResult } from "./type.ts";

export class T3Auth extends Context.Service<
  T3Auth,
  {
    readonly pair: (value: string) => Effect.Effect<PairResult, AuthError>;
    readonly local: (input: LocalAuthInput) => Effect.Effect<LocalAuthResult, AuthError>;
    readonly status: () => Effect.Effect<AuthSessionState, AuthError>;
    readonly issueWebSocketToken: () => Effect.Effect<AuthWebSocketTokenResult, AuthError>;
  }
>()("t3cli/T3Auth") {}
