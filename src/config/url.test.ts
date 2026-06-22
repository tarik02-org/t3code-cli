import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import { assert, describe, it } from "@effect/vitest";

import { normalizeHttpBaseUrl, toWebSocketEndpointUrl } from "./url.ts";
import { expectUrlError } from "../test/helpers/assert-errors.ts";

describe("normalizeHttpBaseUrl", () => {
  it.effect("strips query and trailing slash from urls with paths", () =>
    Effect.gen(function* () {
      const normalized = yield* normalizeHttpBaseUrl("https://app.example.com/api/?q=1");
      assert.equal(normalized, "https://app.example.com/api");
    }),
  );

  it.effect("maps invalid urls to UrlError", () =>
    expectUrlError(normalizeHttpBaseUrl("not-a-url"), "invalid url"),
  );
});

describe("toWebSocketEndpointUrl", () => {
  it.effect("rejects unsupported protocols with UrlError", () =>
    expectUrlError(
      toWebSocketEndpointUrl("ftp://example.com", "/ws"),
      "unsupported server url protocol: ftp:",
    ),
  );
});
