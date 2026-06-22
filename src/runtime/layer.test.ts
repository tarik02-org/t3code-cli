import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Command } from "effect/unstable/cli";

import { cliEnvironmentSetting } from "../cli/env/flag.ts";
import type { ResolvedConfig } from "../config/types.ts";
import { T3Config } from "../config/config.ts";
import { makeTempHomeScoped } from "../config/temp-home.test-utils.ts";
import { cliConfigRoutingLayerTest } from "./layer.test-utils.ts";

describe("CLI config routing", () => {
  it.effect(
    "routes --environment through Command.run to T3Config.resolve ahead of default and T3CLI_ENV",
    () =>
      Effect.gen(function* () {
        return yield* makeTempHomeScoped("t3cli-runtime-");
      }).pipe(
        Effect.flatMap((homeDir) => {
          const testLayer = cliConfigRoutingLayerTest(homeDir);
          return Effect.gen(function* () {
            const resolvedRef = yield* Ref.make<ResolvedConfig | undefined>(undefined);
            const resolveProbeCommand = Command.make("resolve-probe", {}, () =>
              Effect.gen(function* () {
                const config = yield* T3Config;
                const resolved = yield* config.resolve();
                yield* Ref.set(resolvedRef, resolved);
              }),
            ).pipe(Command.withGlobalFlags([cliEnvironmentSetting]));
            const runResolveProbe = Command.runWith(resolveProbeCommand, { version: "0.0.0-test" });

            yield* Effect.gen(function* () {
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
                local: false,
              });
            }).pipe(Effect.provide(testLayer));

            yield* runResolveProbe(["--environment", "work"]).pipe(Effect.provide(testLayer));

            const resolved = yield* Ref.get(resolvedRef);
            assert.isDefined(resolved);
            assert.equal(resolved.source, "config");
            if (resolved.source === "config") {
              assert.equal(resolved.environment, "work");
              assert.equal(resolved.token, "work-token");
            }
          });
        }),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      ),
  );
});
