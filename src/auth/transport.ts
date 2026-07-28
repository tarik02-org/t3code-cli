import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  issueRemoteWebSocketTicket,
} from "@t3tools/client-runtime/authorization";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/unstable/http";

import { AuthTransportError } from "./error.ts";
import {
  type AuthBearerBootstrapResult,
  type AuthSessionState,
  type AuthWebSocketTicketResult,
} from "./schema.ts";

export type AuthTransportConnection = {
  readonly url: string;
  readonly token: string;
};

export class T3AuthTransport extends Context.Service<
  T3AuthTransport,
  {
    readonly bootstrapBearer: (input: {
      readonly baseUrl: string;
      readonly credential: string;
    }) => Effect.Effect<AuthBearerBootstrapResult, AuthTransportError>;
    readonly getSession: (
      connection: AuthTransportConnection,
    ) => Effect.Effect<AuthSessionState, AuthTransportError>;
    readonly issueWebSocketTicket: (
      connection: AuthTransportConnection,
    ) => Effect.Effect<AuthWebSocketTicketResult, AuthTransportError>;
  }
>()("t3cli/T3AuthTransport") {}

const makeT3AuthTransport = Effect.fn("makeT3AuthTransport")(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const provideHttpClient = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(HttpClient.HttpClient, httpClient));

  const bootstrapBearer = Effect.fn("AuthTransport.bootstrapBearer")(function* (input: {
    readonly baseUrl: string;
    readonly credential: string;
  }) {
    const result = yield* provideHttpClient(
      bootstrapRemoteBearerSession({
        httpBaseUrl: input.baseUrl,
        credential: input.credential,
      }),
    ).pipe(
      Effect.mapError(
        (error) => new AuthTransportError({ message: "auth request failed", cause: error }),
      ),
    );
    const now = yield* DateTime.now;
    return {
      authenticated: true,
      role: inferRole(result.scope),
      sessionMethod: "bearer-access-token",
      expiresAt: DateTime.formatIso(DateTime.add(now, { seconds: result.expires_in })),
      sessionToken: result.access_token,
    } satisfies AuthBearerBootstrapResult;
  });

  const getSession = Effect.fn("AuthTransport.getSession")(function* (
    connection: AuthTransportConnection,
  ) {
    const result = yield* provideHttpClient(
      fetchRemoteSessionState({
        httpBaseUrl: connection.url,
        bearerToken: connection.token,
      }),
    ).pipe(
      Effect.mapError(
        (error) => new AuthTransportError({ message: "auth request failed", cause: error }),
      ),
    );
    return {
      authenticated: result.authenticated,
      ...(result.scopes !== undefined ? { role: inferRole(result.scopes.join(" ")) } : {}),
      ...(result.sessionMethod !== undefined ? { sessionMethod: result.sessionMethod } : {}),
      ...(result.expiresAt !== undefined
        ? { expiresAt: DateTime.formatIso(result.expiresAt) }
        : {}),
    } satisfies AuthSessionState;
  });

  const issueWebSocketTicketForConnection = Effect.fn("AuthTransport.issueWebSocketTicket")(
    function* (connection: AuthTransportConnection) {
      const result = yield* provideHttpClient(
        issueRemoteWebSocketTicket({
          httpBaseUrl: connection.url,
          bearerToken: connection.token,
        }),
      ).pipe(
        Effect.mapError(
          (error) => new AuthTransportError({ message: "auth request failed", cause: error }),
        ),
      );
      return {
        ticket: result.ticket,
        expiresAt: DateTime.formatIso(result.expiresAt),
      } satisfies AuthWebSocketTicketResult;
    },
  );

  return {
    bootstrapBearer,
    getSession,
    issueWebSocketTicket: issueWebSocketTicketForConnection,
  };
});

export const T3AuthTransportLive = Layer.effect(T3AuthTransport, makeT3AuthTransport());

function inferRole(scope: string): AuthBearerBootstrapResult["role"] {
  return scope.split(/\s+/u).includes("access:write") ? "owner" : "client";
}
