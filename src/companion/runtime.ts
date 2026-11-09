import { createServer } from "node:http";
import { homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import * as CredentialCipherNode from "../config/credential/cipher-node.ts";
import * as KeystoreKeyringNode from "../config/keystore/keyring-node.ts";
import { T3ConfigSelection } from "../config/selection/service.ts";
import { BaseAppLayer, T3LocalAuthOriginLayer, T3LocalAuthTokenLayer } from "../runtime/layer.ts";
import { NodeSqlClientFactoryLive } from "../sql/node-sqlite-client.ts";
import { CompanionClientError } from "./error.ts";
import type { AutostartPlatform, AutostartTarget } from "./autostart.ts";
import { type AgentSender, makeLocalAgentSender } from "./agent-sender.ts";
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
    T3LocalAuthTokenLayer.pipe(Layer.provide(NodeCrypto.layer)),
    T3LocalAuthOriginLayer,
    NodeHttpClient.layerUndici,
  );

/**
 * Agent-marked digests need an MCP client session, which the companion can mint only for an
 * environment whose T3 home is on this machine; remote ones fall back to plain sends.
 */
export const makeCompanionAgentSender = (environment: {
  readonly name: string;
  readonly url: string;
  readonly local: boolean;
}) =>
  environment.local
    ? makeLocalAgentSender(environment).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `could not set up agent-marked digests for ${environment.name}`,
            cause,
          ).pipe(Effect.as(Option.none<AgentSender>())),
        ),
      )
    : Effect.succeed(Option.none<AgentSender>());

export const companionProcessId = () => process.pid;

// CommandLineToArgvW quoting: backslashes double only before a quote or the closing quote.
const quoteWindowsArg = (arg: string) =>
  `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;

const quotePowerShell = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Re-runs this CLI as `companion run` in the background; the daemon writes its own log file.
 * On Windows a spawned child inherits every inheritable handle, including the caller's stdout
 * pipe, which would keep `t3cli companion start | ...` from ever seeing EOF. Start-Process goes
 * through ShellExecute, which inherits none.
 */
export const spawnDetachedCompanion = (args: ReadonlyArray<string>) =>
  Effect.try({
    try: () => {
      const entry = process.argv[1];
      if (entry === undefined) {
        throw new Error("cannot locate the t3cli entry script");
      }
      if (process.platform === "win32") {
        const argumentList = [entry, ...args].map(quoteWindowsArg).join(" ");
        const result = spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Start-Process -WindowStyle Hidden -FilePath ${quotePowerShell(process.execPath)} -ArgumentList ${quotePowerShell(argumentList)}`,
          ],
          { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, encoding: "utf8" },
        );
        if (result.error !== undefined) {
          throw result.error;
        }
        if (result.status !== 0) {
          throw new Error(`Start-Process exited with ${result.status}: ${result.stderr.trim()}`);
        }
        return;
      }
      spawn(process.execPath, [entry, ...args], { detached: true, stdio: "ignore" }).unref();
    },
    catch: (cause) =>
      new CompanionClientError({
        message: "failed to start the companion process",
        operation: "spawn",
        cause,
      }),
  });

/** The login launcher for this machine, re-running this exact node and entry script. */
export const companionAutostartTarget = (args: ReadonlyArray<string>) =>
  Effect.try({
    try: (): AutostartTarget => {
      const entry = process.argv[1];
      if (entry === undefined) {
        throw new Error("cannot locate the t3cli entry script");
      }
      const platform: AutostartPlatform | undefined =
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "launchd"
            : process.platform === "linux"
              ? "systemd"
              : undefined;
      if (platform === undefined) {
        throw new Error(`autostart is not supported on ${process.platform}`);
      }
      return {
        platform,
        homeDir: homedir(),
        uid: process.getuid?.() ?? 0,
        command: [process.execPath, entry, ...args],
      };
    },
    catch: (cause) =>
      new CompanionClientError({
        message: "failed to describe the autostart entry",
        operation: "autostart",
        cause,
      }),
  });

/** Signal 0 checks that the pid exists without touching the process. */
export const isProcessAlive = (pid: number) =>
  Effect.sync(() => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the pid exists but belongs to someone else.
      return Predicate.hasProperty(error, "code") && error.code === "EPERM";
    }
  });
