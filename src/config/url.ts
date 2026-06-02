import * as Effect from "effect/Effect";
import { Url } from "effect/unstable/http";

import { UrlError } from "./error.ts";

export function normalizeHttpBaseUrl(value: string) {
  return parseUrl(value).pipe(Effect.flatMap((url) => Effect.succeed(normalizeBaseUrl(url))));
}

export function toWebSocketBaseUrl(httpBaseUrl: string) {
  return parseUrl(httpBaseUrl).pipe(
    Effect.flatMap((url) => {
      if (url.protocol === "http:") {
        return Effect.succeed(makeWebSocketUrl(url, "ws:"));
      }
      if (url.protocol === "https:") {
        return Effect.succeed(makeWebSocketUrl(url, "wss:"));
      }
      return Effect.fail(
        new UrlError({
          message: `unsupported server url protocol: ${url.protocol}`,
          protocol: url.protocol,
        }),
      );
    }),
  );
}

function parseUrl(value: string): Effect.Effect<URL, UrlError> {
  return Effect.fromResult(Url.fromString(value)).pipe(
    Effect.catchTags({
      IllegalArgumentError: (error) =>
        Effect.fail(new UrlError({ message: "invalid url", cause: error })),
    }),
  );
}

function normalizeBaseUrl(url: URL) {
  return Url.mutate(url, (current) => {
    current.hash = "";
    current.search = "";
    current.pathname = "";
  })
    .toString()
    .replace(/\/$/, "");
}

function makeWebSocketUrl(url: URL, protocol: "ws:" | "wss:") {
  return Url.mutate(url, (current) => {
    current.protocol = protocol;
    current.pathname = "/ws";
    current.search = "";
    current.hash = "";
  }).toString();
}
