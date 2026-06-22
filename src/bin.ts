#!/usr/bin/env node
import { homedir } from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Command } from "effect/unstable/cli";

import { createCliCommand } from "./cli/app.ts";
import * as CliSelection from "./cli/env/selection-layer.ts";
import * as CliRuntime from "./cli/runtime/service.ts";
import * as CredentialCipherNode from "./config/credential/cipher-node.ts";
import * as KeystoreKeyringNode from "./config/keystore/keyring-node.ts";
import { T3InputLive } from "./cli/input/layer.ts";
import { T3OutputLive } from "./cli/output/layer.ts";
import { NodeTerminalIoLive } from "./cli/terminal/io-node-layer.ts";
import { T3Output } from "./cli/output/service.ts";
import { BaseAppLayer } from "./runtime/layer.ts";
import { T3VersionBundledLive, T3VersionPackageJsonLive } from "./version/layer.ts";
import { T3Version } from "./version/service.ts";

declare const T3CLI_VERSION: string | undefined;

if (process.env.HOME === undefined || process.env.HOME.trim().length === 0) {
  process.env.HOME = homedir();
}

const VersionLive =
  typeof T3CLI_VERSION === "string" ? T3VersionBundledLive : T3VersionPackageJsonLive;

const PlatformLayer = Layer.mergeAll(NodeServices.layer, CliRuntime.layer);

const CliAppLayer = BaseAppLayer.pipe(
  Layer.provideMerge(CliSelection.layer),
  Layer.provide(CredentialCipherNode.layerNode),
  Layer.provide(KeystoreKeyringNode.layerNode),
);

const CliLayer = Layer.mergeAll(
  CliAppLayer.pipe(Layer.provide(PlatformLayer)),
  NodeServices.layer,
  CliRuntime.layer,
  T3InputLive.pipe(Layer.provide(NodeServices.layer)),
  T3OutputLive.pipe(Layer.provide(NodeServices.layer)),
  NodeTerminalIoLive,
  VersionLive.pipe(Layer.provide(NodeServices.layer)),
);

const program = Effect.gen(function* () {
  const version = yield* T3Version;
  return yield* Command.run(createCliCommand(), { version: version.version });
}).pipe(
  Effect.tapError((error) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      yield* output.writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    }),
  ),
  Effect.scoped,
  Effect.provide(CliLayer),
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
