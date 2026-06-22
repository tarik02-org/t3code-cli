import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Command } from "effect/unstable/cli";
import { vi } from "vite-plus/test";

import { T3CliConfigSelectionLive } from "../cli/selection-layer.ts";
import { cliEnvironmentSetting } from "../cli/environment-flag.ts";
import { Environment } from "../environment/service.ts";
import type { ResolvedConfig } from "../config/types.ts";
import { T3Config } from "../config/service.ts";
import { BaseAppLayer } from "./layer.ts";

vi.mock("../config/keyring.ts", async () => {
  const EffectModule = await import("effect/Effect");
  return {
    getKeyringStore: () => EffectModule.succeed(null),
  };
});

function makeCliAppLayer(homeDir: string) {
  const environmentLayer = Layer.succeed(Environment)({
    cwd: homeDir,
    homeDir,
    env: { T3CLI_ENV: "home" },
    stdoutIsTTY: false,
    stderrIsTTY: false,
  });
  return BaseAppLayer.pipe(
    Layer.provideMerge(T3CliConfigSelectionLive),
    Layer.provide(Layer.mergeAll(NodeServices.layer, environmentLayer)),
  );
}

describe("CLI app layer composition", () => {
  it.effect(
    "routes --environment through Command.run to T3Config.resolve ahead of default and T3CLI_ENV",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.makeTempDirectoryScoped({ prefix: "t3cli-runtime-test-" });
      }).pipe(
        Effect.flatMap((homeDir) =>
          Effect.gen(function* () {
            const cliAppLayer = makeCliAppLayer(homeDir);
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
            }).pipe(Effect.provide(cliAppLayer));

            yield* runResolveProbe(["--environment", "work"]).pipe(Effect.provide(cliAppLayer));

            const resolved = yield* Ref.get(resolvedRef);
            assert.isDefined(resolved);
            assert.equal(resolved.source, "config");
            if (resolved.source === "config") {
              assert.equal(resolved.environment, "work");
              assert.equal(resolved.token, "work-token");
            }
          }),
        ),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      ),
  );
});
