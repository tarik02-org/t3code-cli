import { closeSync, openSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CredentialCipherNode from "../config/credential/cipher-node.ts";
import * as KeystoreKeyringNode from "../config/keystore/keyring-node.ts";
import { T3ConfigSelection } from "../config/selection/service.ts";
import { BaseAppLayer } from "../runtime/layer.ts";
import { NodeSqlClientFactoryLive } from "../sql/node-sqlite-client.ts";
import { CompanionClientError } from "./error.ts";
import type { ConnectEnvironment } from "./environments.ts";

/** The CLI's own service stack, pinned to one stored environment instead of the CLI selection. */
export const connectStoredEnvironment = (environmentName: string) =>
  BaseAppLayer.pipe(
    Layer.provideMerge(
      Layer.succeed(T3ConfigSelection, {
        getSelectedEnvironment: () => Effect.succeed(environmentName),
      }),
    ),
    Layer.provide(CredentialCipherNode.layerNode),
    Layer.provide(KeystoreKeyringNode.layerNode),
    Layer.provide(NodeCrypto.layer),
  ) satisfies ReturnType<ConnectEnvironment<unknown, unknown>>;

export const companionDaemonPlatformLayer = (port: number) =>
  Layer.mergeAll(
    NodeSqlClientFactoryLive,
    NodeHttpServer.layer(createServer, { port, host: "127.0.0.1" }),
  );

export const companionProcessId = () => process.pid;

/** Re-runs this CLI as `companion run` in the background, logging to `logFile`. */
export const spawnDetachedCompanion = (input: {
  readonly args: ReadonlyArray<string>;
  readonly logFile: string;
}) =>
  Effect.try({
    try: () => {
      const entry = process.argv[1];
      if (entry === undefined) {
        throw new Error("cannot locate the t3cli entry script");
      }
      const log = openSync(input.logFile, "a");
      try {
        const child = spawn(process.execPath, [entry, ...input.args], {
          detached: true,
          stdio: ["ignore", log, log],
          windowsHide: true,
          env: process.env,
        });
        child.unref();
        return child.pid ?? null;
      } finally {
        closeSync(log);
      }
    },
    catch: (cause) =>
      new CompanionClientError({
        message: "failed to start the companion process",
        operation: "spawn",
        cause,
      }),
  });
