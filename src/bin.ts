#!/usr/bin/env node
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Command } from "effect/unstable/cli";

import { createCliCommand } from "./cli/app.ts";
import { NodeEnvironmentLive } from "./environment/layer.ts";
import { T3InputLive } from "./input/layer.ts";
import { T3OutputLive } from "./output/layer.ts";
import { T3Output } from "./output/service.ts";
import { AppLayer } from "./runtime.ts";
import { T3VersionBundledLive, T3VersionPackageJsonLive } from "./version/layer.ts";
import { T3Version } from "./version/service.ts";

declare const T3CLI_VERSION: string | undefined;

const VersionLive =
  typeof T3CLI_VERSION === "string" ? T3VersionBundledLive : T3VersionPackageJsonLive;

const PlatformLayer = Layer.mergeAll(NodeServices.layer, NodeEnvironmentLive);

const CliLayer = Layer.mergeAll(
  AppLayer.pipe(Layer.provide(PlatformLayer)),
  NodeServices.layer,
  NodeEnvironmentLive,
  T3InputLive.pipe(Layer.provide(NodeServices.layer)),
  T3OutputLive.pipe(Layer.provide(NodeServices.layer)),
  VersionLive,
);

const program = Effect.gen(function* () {
  const version = yield* T3Version;
  return yield* Command.run(createCliCommand(), { version: version.version });
}).pipe(
  Effect.tapError((error) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      yield* output.writeStderr(`${error.message}\n`);
    }),
  ),
  Effect.scoped,
  Effect.provide(CliLayer),
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
