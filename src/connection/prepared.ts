import { resolveRemoteWebSocketConnectionUrl } from "@t3tools/client-runtime/authorization";
import {
  BearerConnectionTarget,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/unstable/http";

import { toWebSocketEndpointUrl } from "../config/url/url.ts";
import { T3CodeConnectionError } from "./error.ts";
import { T3CodeConnectionProvider } from "./service.ts";
import type { T3CodeConnection } from "./type.ts";

export class T3PreparedConnectionProvider extends Context.Service<
  T3PreparedConnectionProvider,
  {
    readonly get: Effect.Effect<PreparedConnection, T3CodeConnectionError>;
  }
>()("t3cli/T3PreparedConnectionProvider") {}

export const makePreparedConnection = Effect.fn("makePreparedConnection")(function* (
  connection: T3CodeConnection,
) {
  const httpBaseUrl = connection.origin.url;
  const wsBaseUrl = yield* toWebSocketEndpointUrl(httpBaseUrl, "/ws").pipe(
    Effect.mapError(
      (error) =>
        new T3CodeConnectionError({
          message: "failed to resolve websocket endpoint",
          cause: error,
        }),
    ),
  );
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl }).pipe(
    Effect.mapError(
      (error) =>
        new T3CodeConnectionError({
          message: "failed to fetch environment descriptor",
          cause: error,
        }),
    ),
  );
  const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
    httpBaseUrl,
    wsBaseUrl,
    bearerToken: connection.auth.token,
  }).pipe(
    Effect.mapError(
      (error) =>
        new T3CodeConnectionError({
          message: "failed to authorize websocket",
          cause: error,
        }),
    ),
  );

  return {
    environmentId: descriptor.environmentId,
    label: descriptor.label,
    httpBaseUrl,
    socketUrl,
    httpAuthorization: {
      _tag: "Bearer" as const,
      token: connection.auth.token,
    },
    target: new BearerConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      connectionId: descriptor.environmentId,
    }),
  } satisfies PreparedConnection;
});

export const T3PreparedConnectionProviderLive = Layer.effect(
  T3PreparedConnectionProvider,
  Effect.gen(function* () {
    const connectionProvider = yield* T3CodeConnectionProvider;
    const httpClient = yield* HttpClient.HttpClient;
    const get = connectionProvider.get.pipe(
      Effect.flatMap((connection) =>
        makePreparedConnection(connection).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
        ),
      ),
    );
    return T3PreparedConnectionProvider.of({ get });
  }),
);
