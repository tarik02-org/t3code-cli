import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import { assert, describe, it } from "@effect/vitest";

import { T3Config } from "./service.ts";
import { ConfigPlatformLayer } from "../test/platform.ts";
import { makeTempHomeScoped } from "../test/helpers/temp-home.ts";
import { t3ConfigDepsLayer } from "../test/layers/config.ts";

describe("T3ConfigSelectionLive", () => {
  it.effect("resolves T3CLI_ENV through the selection layer", () =>
    Effect.gen(function* () {
      return yield* makeTempHomeScoped("t3cli-selection-");
    }).pipe(
      Effect.flatMap((homeDir) =>
        Effect.gen(function* () {
          const config = yield* T3Config;
          yield* config.upsertEnvironment({
            name: "home",
            url: "https://home.example",
            token: "home-token",
            local: false,
          });
          yield* config.upsertEnvironment({
            name: "work",
            url: "https://work.example",
            token: "work-token",
            local: true,
          });
          const resolved = yield* config.resolve();
          assert.equal(resolved.source, "config");
          if (resolved.source === "config") {
            assert.equal(resolved.environment, "work");
          }
        }).pipe(
          Effect.provide(
            t3ConfigDepsLayer(homeDir, {
              useSelectionLive: true,
              env: { T3CLI_ENV: "work" },
            }),
          ),
        ),
      ),
      Effect.provide(ConfigPlatformLayer),
      Effect.scoped,
    ),
  );
});
