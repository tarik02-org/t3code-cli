import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { AuthWebSocketTicketResult } from "./schema.ts";
import type { AuthError } from "./error.ts";
import type {
  AuthConfigInput,
  AuthEnvironmentListItem,
  AuthStatusResult,
  AuthUnpairResult,
  AuthUseResult,
  LocalAuthInput,
  LocalAuthResult,
  AuthPairInput,
  PairResult,
  PersistEnvironmentInput,
} from "./type.ts";

export class T3Auth extends Context.Service<
  T3Auth,
  {
    readonly pair: (input: AuthPairInput) => Effect.Effect<PairResult, AuthError>;
    readonly local: (input: LocalAuthInput) => Effect.Effect<LocalAuthResult, AuthError>;
    readonly writeConfig: (input: AuthConfigInput) => Effect.Effect<void, AuthError>;
    readonly persistEnvironment: (
      input: PersistEnvironmentInput,
    ) => Effect.Effect<string, AuthError>;
    readonly environmentExists: (name: string) => Effect.Effect<boolean, AuthError>;
    readonly defaultNameFromUrl: (url: string) => Effect.Effect<string, AuthError>;
    readonly defaultNameForLocal: () => Effect.Effect<string, AuthError>;
    readonly listEnvironments: () => Effect.Effect<readonly AuthEnvironmentListItem[], AuthError>;
    readonly useEnvironment: (name: string) => Effect.Effect<AuthUseResult, AuthError>;
    readonly unpairEnvironment: (input: {
      readonly name: string;
    }) => Effect.Effect<AuthUnpairResult, AuthError>;
    readonly resolveUnpairTarget: (input: {
      readonly name?: string;
    }) => Effect.Effect<string, AuthError>;
    readonly status: () => Effect.Effect<AuthStatusResult, AuthError>;
    readonly issueWebSocketTicket: () => Effect.Effect<AuthWebSocketTicketResult, AuthError>;
  }
>()("t3cli/T3Auth") {}
