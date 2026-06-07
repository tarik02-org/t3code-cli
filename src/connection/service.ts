import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { T3CodeConnectionError } from "./error.ts";
import type { T3CodeConnection } from "./type.ts";

export class T3CodeConnectionProvider extends Context.Service<
  T3CodeConnectionProvider,
  {
    readonly get: Effect.Effect<T3CodeConnection, T3CodeConnectionError>;
  }
>()("t3cli/T3CodeConnectionProvider") {}

export function makeT3CodeConnectionProvider(
  get: Effect.Effect<T3CodeConnection, T3CodeConnectionError>,
): T3CodeConnectionProvider["Service"] {
  return { get };
}

export function T3CodeConnectionProviderLive(connection: T3CodeConnection) {
  return Layer.succeed(
    T3CodeConnectionProvider,
    makeT3CodeConnectionProvider(Effect.succeed(connection)),
  );
}
