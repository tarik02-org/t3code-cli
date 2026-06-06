import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Url } from "effect/unstable/http";

import { AuthPairingUrlError, AuthTransportError } from "./error.ts";
import { T3AuthTransport } from "./transport.ts";
import type { PairingUrl, PairResult } from "./type.ts";

export class T3AuthPairing extends Context.Service<
  T3AuthPairing,
  {
    readonly pair: (
      pairingUrl: string,
    ) => Effect.Effect<PairResult, AuthPairingUrlError | AuthTransportError>;
  }
>()("t3cli/T3AuthPairing") {}

export const makeT3AuthPairing = Effect.fn("makeT3AuthPairing")(function* () {
  const transport = yield* T3AuthTransport;

  const pair = Effect.fn("T3AuthPairingLive.pair")(function* (pairingUrl: string) {
    const parsed = yield* parsePairingUrl(pairingUrl);
    const result = yield* transport.bootstrapBearer(parsed);
    return {
      url: parsed.baseUrl,
      token: result.sessionToken,
      role: result.role,
      expiresAt: result.expiresAt,
    };
  });

  return { pair };
});

export const T3AuthPairingLive = Layer.effect(T3AuthPairing, makeT3AuthPairing());

export function parsePairingUrl(value: string): Effect.Effect<PairingUrl, AuthPairingUrlError> {
  return Effect.gen(function* () {
    const url = yield* parseUrl(value);
    const token = yield* readPairingToken(url);
    if (token.length === 0) {
      return yield* Effect.fail(new AuthPairingUrlError({ message: "pairing url missing token" }));
    }

    const hostedHost = url.searchParams.get("host")?.trim();
    const baseUrl = normalizeBaseUrl(
      yield* parseUrl(
        hostedHost !== undefined && hostedHost.length > 0
          ? hostedHost
          : new URL(".", url).toString(),
      ),
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
    current.pathname = current.pathname === "/" ? "" : current.pathname.replace(/\/+$/u, "");
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
