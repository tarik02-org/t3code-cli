import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ConfigError, ConfigServiceError } from "./error.ts";

export type StoredConfig = {
  readonly url?: string;
  readonly token?: string;
  readonly local?: boolean;
};

export type ResolvedConfig = {
  readonly url: string;
  readonly token: string;
  readonly source: "env" | "config";
  readonly local: boolean;
};

export class T3Config extends Context.Service<
  T3Config,
  {
    readonly readStored: () => Effect.Effect<StoredConfig, ConfigError>;
    readonly writeStored: (config: StoredConfig) => Effect.Effect<void, ConfigError>;
    readonly resolve: () => Effect.Effect<ResolvedConfig, ConfigServiceError>;
  }
>()("t3cli/T3Config") {}
