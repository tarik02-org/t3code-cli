import { resolveRemoteWebSocketConnectionUrl } from "@t3tools/client-runtime/authorization";
import {
  BearerConnectionTarget,
  type ConnectionAttemptError,
  mapRemoteEnvironmentError,
  orchestrationProtocolCompatibilityError,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/unstable/http";

import { toWebSocketEndpointUrl } from "../config/url/url.ts";
import { T3CodeConnectionError } from "./error.ts";
import { T3CodeConnectionProvider } from "./service.ts";
import type { T3CodeConnection } from "./type.ts";

export interface T3PreparedConnection extends PreparedConnection {
  readonly httpAuthorization: {
    readonly _tag: "Bearer";
    readonly token: string;
  };
}

export class T3PreparedConnectionProvider extends Context.Service<
  T3PreparedConnectionProvider,
  {
    readonly get: Effect.Effect<
      T3PreparedConnection,
      ConnectionAttemptError | T3CodeConnectionError
    >;
  }
>()("t3cli/T3PreparedConnectionProvider") {}

const makePreparedConnection = Effect.fn("makePreparedConnection")(function* (
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
    Effect.mapError(mapRemoteEnvironmentError),
  );
  const compatibilityError = orchestrationProtocolCompatibilityError(descriptor);
  if (compatibilityError !== null) {
    return yield* compatibilityError;
  }
  const authorizedSocketUrl = yield* resolveRemoteWebSocketConnectionUrl({
    httpBaseUrl,
    wsBaseUrl,
    bearerToken: connection.auth.token,
  }).pipe(Effect.mapError(mapRemoteEnvironmentError));
  // The server refuses websocket upgrades that do not name its orchestration protocol.
  const socketUrl = new URL(authorizedSocketUrl);
  socketUrl.searchParams.set(
    ORCHESTRATION_PROTOCOL_QUERY_PARAM,
    String(ORCHESTRATION_PROTOCOL_VERSION),
  );

  return {
    environmentId: descriptor.environmentId,
    label: descriptor.label,
    httpBaseUrl,
    socketUrl: socketUrl.toString(),
    httpAuthorization: {
      _tag: "Bearer",
      token: connection.auth.token,
    },
    target: new BearerConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      connectionId: descriptor.environmentId,
    }),
  } satisfies T3PreparedConnection;
});

const makeT3PreparedConnectionProvider = Effect.fn("makeT3PreparedConnectionProvider")(
  function* () {
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
  },
);

export const T3PreparedConnectionProviderLive = Layer.effect(
  T3PreparedConnectionProvider,
  makeT3PreparedConnectionProvider(),
);
