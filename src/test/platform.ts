import * as Layer from "effect/Layer";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeStdio from "@effect/platform-node/NodeStdio";
import * as NodeTerminal from "@effect/platform-node/NodeTerminal";

export const ConfigPlatformLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeCrypto.layer,
);

export const CliCommandPlatformLayer = Layer.mergeAll(
  ConfigPlatformLayer,
  NodeStdio.layer,
  NodeTerminal.layer,
  NodeChildProcessSpawner.layer,
);
