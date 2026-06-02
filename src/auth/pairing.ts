import * as Effect from "effect/Effect";
import { Url } from "effect/unstable/http";

import { AuthPairingUrlError } from "./error.ts";
import type { PairingUrl } from "./type.ts";

export function parsePairingUrl(value: string): Effect.Effect<PairingUrl, AuthPairingUrlError> {
  return Effect.gen(function* () {
    const url = yield* parseUrl(value);
    const token = yield* readPairingToken(url);
    if (token.length === 0) {
      return yield* Effect.fail(new AuthPairingUrlError({ message: "pairing url missing token" }));
    }

    const hostedHost = url.searchParams.get("host")?.trim();
    const baseUrl = normalizeBaseUrl(
      yield* parseUrl(hostedHost !== undefined && hostedHost.length > 0 ? hostedHost : url.origin),
    );
    return { baseUrl, credential: token };
  });
}

function parseUrl(value: string): Effect.Effect<URL, AuthPairingUrlError> {
  return Effect.fromResult(Url.fromString(value)).pipe(
    Effect.catchTags({
      IllegalArgumentError: (error) =>
        Effect.fail(new AuthPairingUrlError({ message: "invalid pairing url", cause: error })),
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

function readPairingToken(url: URL): Effect.Effect<string, AuthPairingUrlError> {
  return Effect.gen(function* () {
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const hashUrl = yield* parseUrl(`http://t3.local/?${hash}`);
    const hashToken = hashUrl.searchParams.get("token")?.trim();
    const token = url.searchParams.get("token")?.trim();
    return hashToken !== undefined && hashToken.length > 0
      ? hashToken
      : token !== undefined && token.length > 0
        ? token
        : "";
  });
}
