import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ConfigError, ConfigServiceError } from "./error.ts";
import type {
  EncryptedConfig,
  EncryptedToken,
  EnvironmentSummary,
  ResolvedConfig,
  UpsertEnvironmentInput,
} from "./types.ts";

export class T3Config extends Context.Service<
  T3Config,
  {
    readonly resolve: () => Effect.Effect<ResolvedConfig, ConfigServiceError>;
    readonly resolveActiveEnvironmentName: () => Effect.Effect<string | undefined, ConfigError>;
    readonly listEnvironments: () => Effect.Effect<readonly EnvironmentSummary[], ConfigError>;
    readonly upsertEnvironment: (input: UpsertEnvironmentInput) => Effect.Effect<void, ConfigError>;
    readonly setDefaultEnvironment: (name: string) => Effect.Effect<void, ConfigError>;
    readonly removeEnvironment: (name: string) => Effect.Effect<void, ConfigError>;
    readonly hasEnvironment: (name: string) => Effect.Effect<boolean, ConfigError>;
    readonly getDefaultEnvironmentName: () => Effect.Effect<string | undefined, ConfigError>;
  }
>()("t3cli/T3Config") {}

export type {
  EncryptedConfig,
  EncryptedToken,
  EnvironmentSummary,
  ResolvedConfig,
  UpsertEnvironmentInput,
};
