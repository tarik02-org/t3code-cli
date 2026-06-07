import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
} from "#t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http";

import { toHttpEndpointUrl } from "../config/url.ts";
import { AuthTransportError } from "./error.ts";
import {
  type AuthBearerBootstrapResult,
  decodeAuthAccessTokenResult,
  type AuthSessionState,
  decodeAuthSessionState,
  type AuthWebSocketTicketResult,
  decodeAuthWebSocketTicketResult,
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
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

  const bootstrapBearer = Effect.fn("AuthTransport.bootstrapBearer")(function* (input: {
    readonly baseUrl: string;
    readonly credential: string;
  }) {
    const url = yield* makeHttpEndpointUrl(input.baseUrl, "/oauth/token");
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyUrlParams({
        grant_type: AuthTokenExchangeGrantType,
        subject_token: input.credential,
        subject_token_type: AuthEnvironmentBootstrapTokenType,
        requested_token_type: AuthAccessTokenType,
      }),
    );
    const response = yield* client.execute(request).pipe(
      Effect.catchTags({
        HttpClientError: (error) =>
          Effect.fail(
            new AuthTransportError({
              message: "auth request failed",
              cause: HttpClientError.HttpClientErrorSchema.fromHttpClientError(error),
            }),
          ),
      }),
    );
    const result = yield* response.json.pipe(
      Effect.flatMap(decodeAuthAccessTokenResult),
      Effect.catchTags({
        HttpClientError: (error) =>
          Effect.fail(
            new AuthTransportError({
              message: "auth request failed",
              cause: HttpClientError.HttpClientErrorSchema.fromHttpClientError(error),
            }),
          ),
        SchemaError: (error) =>
          Effect.fail(
            new AuthTransportError({ message: "auth response decode failed", cause: error }),
          ),
      }),
    );
    const now = yield* DateTime.now;
    return {
      authenticated: true,
      role: result.scope.split(/\s+/u).includes("access:write") ? "owner" : "client",
      sessionMethod: "bearer-access-token",
      expiresAt: DateTime.formatIso(DateTime.add(now, { seconds: result.expires_in })),
      sessionToken: result.access_token,
    } satisfies AuthBearerBootstrapResult;
  });

  const getSession = Effect.fn("AuthTransport.getSession")(function* (
    connection: AuthTransportConnection,
  ) {
    const url = yield* makeHttpEndpointUrl(connection.url, "/api/auth/session");
    const request = HttpClientRequest.get(url).pipe(authenticatedRequest(connection));
    const response = yield* client.execute(request).pipe(
      Effect.catchTags({
        HttpClientError: (error) =>
          Effect.fail(
            new AuthTransportError({
              message: "auth request failed",
              cause: HttpClientError.HttpClientErrorSchema.fromHttpClientError(error),
            }),
          ),
      }),
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeAuthSessionState),
      Effect.catchTags({
        HttpClientError: (error) =>
          Effect.fail(
            new AuthTransportError({
              message: "auth request failed",
              cause: HttpClientError.HttpClientErrorSchema.fromHttpClientError(error),
            }),
          ),
        SchemaError: (error) =>
          Effect.fail(
            new AuthTransportError({ message: "auth response decode failed", cause: error }),
          ),
      }),
    );
  });

  const issueWebSocketTicket = Effect.fn("AuthTransport.issueWebSocketTicket")(function* (
    connection: AuthTransportConnection,
  ) {
    const url = yield* makeHttpEndpointUrl(connection.url, "/api/auth/websocket-ticket");
    const request = HttpClientRequest.post(url).pipe(authenticatedRequest(connection));
    const response = yield* client.execute(request).pipe(
      Effect.catchTags({
        HttpClientError: (error) =>
          Effect.fail(
            new AuthTransportError({
              message: "auth request failed",
              cause: HttpClientError.HttpClientErrorSchema.fromHttpClientError(error),
            }),
          ),
      }),
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeAuthWebSocketTicketResult),
      Effect.catchTags({
        HttpClientError: (error) =>
          Effect.fail(
            new AuthTransportError({
              message: "auth request failed",
              cause: HttpClientError.HttpClientErrorSchema.fromHttpClientError(error),
            }),
          ),
        SchemaError: (error) =>
          Effect.fail(
            new AuthTransportError({ message: "auth response decode failed", cause: error }),
          ),
      }),
    );
  });

  return {
    bootstrapBearer,
    getSession,
    issueWebSocketTicket,
  };
});

export const T3AuthTransportLive = Layer.effect(T3AuthTransport, makeT3AuthTransport());

const authenticatedRequest =
  (connection: AuthTransportConnection) => (request: HttpClientRequest.HttpClientRequest) =>
    request.pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(connection.token));

function makeHttpEndpointUrl(baseUrl: string, path: string) {
  return toHttpEndpointUrl(baseUrl, path).pipe(
    Effect.catchTags({
      UrlError: (error) =>
        Effect.fail(new AuthTransportError({ message: "auth request failed", cause: error })),
    }),
  );
}
