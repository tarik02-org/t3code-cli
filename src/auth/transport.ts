import * as Effect from "effect/Effect";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http";

import type { ResolvedConfig } from "../config/service.ts";
import { toHttpEndpointUrl } from "../config/url.ts";
import { AuthTransportError } from "./error.ts";
import {
  decodeAuthBearerBootstrapResult,
  decodeAuthSessionState,
  decodeAuthWebSocketTokenResult,
} from "./schema.ts";

export const makeAuthTransport = Effect.fn("makeAuthTransport")(function* () {
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

  const bootstrapBearer = Effect.fn("AuthTransport.bootstrapBearer")(function* (input: {
    readonly baseUrl: string;
    readonly credential: string;
  }) {
    const url = yield* makeHttpEndpointUrl(input.baseUrl, "/api/auth/bootstrap/bearer");
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJsonUnsafe({ credential: input.credential }),
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
    return yield* response.json.pipe(
      Effect.flatMap(decodeAuthBearerBootstrapResult),
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

  const getSession = Effect.fn("AuthTransport.getSession")(function* (config: ResolvedConfig) {
    const request = yield* authenticatedRequest(config, "/api/auth/session", "get");
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

  const issueWebSocketToken = Effect.fn("AuthTransport.issueWebSocketToken")(function* (
    config: ResolvedConfig,
  ) {
    const request = yield* authenticatedRequest(config, "/api/auth/ws-token", "post");
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
      Effect.flatMap(decodeAuthWebSocketTokenResult),
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
    issueWebSocketToken,
  };
});

function authenticatedRequest(config: ResolvedConfig, path: string, method: "get" | "post") {
  return makeHttpEndpointUrl(config.url, path).pipe(
    Effect.map((url) =>
      method === "get" ? HttpClientRequest.get(url) : HttpClientRequest.post(url),
    ),
    Effect.map((request) =>
      request.pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(config.token)),
    ),
  );
}

function makeHttpEndpointUrl(baseUrl: string, path: string) {
  return toHttpEndpointUrl(baseUrl, path).pipe(
    Effect.catchTags({
      UrlError: (error) =>
        Effect.fail(new AuthTransportError({ message: "auth request failed", cause: error })),
    }),
  );
}
