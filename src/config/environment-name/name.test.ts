import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { assert, describe, it } from "@effect/vitest";

import { expectFailWithMessage } from "../../effect.test-utils.ts";
import { ConfigError } from "../error.ts";
import {
  defaultEnvironmentNameForLocal,
  defaultEnvironmentNameFromUrl,
  migrateV1EnvironmentName,
  slugifyEnvironmentName,
  validateEnvironmentName,
} from "./name.ts";

describe("slugifyEnvironmentName", () => {
  it("slugifies invalid characters", () => {
    assert.equal(slugifyEnvironmentName("app.example.com"), "app.example.com");
    assert.equal(slugifyEnvironmentName("---"), "default");
  });
});

describe("validateEnvironmentName", () => {
  it.effect("rejects empty and invalid names", () =>
    Effect.gen(function* () {
      const empty = yield* validateEnvironmentName("").pipe(Effect.exit);
      assert.equal(Exit.isFailure(empty), true);
      const invalid = yield* validateEnvironmentName("bad name").pipe(Effect.exit);
      assert.equal(Exit.isFailure(invalid), true);
      yield* validateEnvironmentName("valid.name-1");
    }),
  );
});

describe("defaultEnvironmentNameFromUrl", () => {
  it.effect("derives hostname from normalized url", () =>
    Effect.gen(function* () {
      const name = yield* defaultEnvironmentNameFromUrl("https://app.example.com/path");
      assert.equal(name, "app.example.com");
    }),
  );

  it.effect("maps invalid urls to ConfigError", () =>
    expectFailWithMessage(defaultEnvironmentNameFromUrl("not-a-url"), ConfigError, "invalid url"),
  );
});

describe("migrateV1EnvironmentName", () => {
  it.effect("uses local name for local configs", () =>
    Effect.gen(function* () {
      const name = yield* migrateV1EnvironmentName({ local: true });
      assert.equal(name, defaultEnvironmentNameForLocal());
    }),
  );

  it.effect("derives name from url when present", () =>
    Effect.gen(function* () {
      const name = yield* migrateV1EnvironmentName({
        url: "https://work.example",
        local: false,
      });
      assert.equal(name, "work.example");
    }),
  );
});
