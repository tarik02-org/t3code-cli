import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import { assert, describe, it } from "@effect/vitest";

import { expectFailWithMessage } from "../../effect.test-utils.ts";
import { UrlError } from "./error.ts";
import { normalizeHttpBaseUrl, toWebSocketEndpointUrl } from "./url.ts";

describe("normalizeHttpBaseUrl", () => {
  it.effect("strips query and trailing slash from urls with paths", () =>
    Effect.gen(function* () {
      const normalized = yield* normalizeHttpBaseUrl("https://app.example.com/api/?q=1");
      assert.equal(normalized, "https://app.example.com/api");
    }),
  );

  it.effect("maps invalid urls to UrlError", () =>
    expectFailWithMessage(normalizeHttpBaseUrl("not-a-url"), UrlError, "invalid url"),
  );
});

describe("toWebSocketEndpointUrl", () => {
  it.effect("rejects unsupported protocols with UrlError", () =>
    expectFailWithMessage(
      toWebSocketEndpointUrl("ftp://example.com", "/ws"),
      UrlError,
      "unsupported server url protocol: ftp:",
    ),
  );
});
