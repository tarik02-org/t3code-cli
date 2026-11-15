import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { Command, Flag } from "effect/cli";

import { loadT3CliEnv } from "../config/env/env.ts";
import { readCompanionRuntime, withCompanionClient } from "../companion/client.ts";
import { installAutostart, uninstallAutostart } from "../companion/autostart.ts";
import { runCompanionDaemon } from "../companion/daemon.ts";
import { CompanionNotRunningError } from "../companion/error.ts";
import { defaultCompanionPort, resolveCompanionPaths } from "../companion/paths.ts";
import {
  companionAutostartTarget,
  companionDaemonPlatformLayer,
  companionProcessId,
  connectStoredEnvironment,
  isProcessAlive,
  makeCompanionAgentSender,
  spawnDetachedCompanion,
} from "../companion/runtime.ts";
import type { CompanionHealth } from "../companion/schema.ts";
import { T3Version } from "../version/service.ts";
import { extraArgsConfig } from "./extra-args.ts";
import { formatFlag } from "./flags.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";
import { CliRuntime } from "./runtime/service.ts";

const portFlag = Flag.Int("port").pipe(
  Flag.withDescription(
    `Local port for the MCP and RPC endpoints (default ${defaultCompanionPort})`,
  ),
  Flag.withDefault(defaultCompanionPort),
);

const envsFlag = Flag.String("env").pipe(
  Flag.withDescription("Stored environment to watch; repeat for several (default: all)"),
  Flag.atLeast(0),
);

const runArguments = (port: number, env: ReadonlyArray<string>, logFile: string) => [
  "companion",
  "run",
  "--port",
  String(port),
  "--log-file",
  logFile,
  ...env.flatMap((name) => ["--env", name]),
];

const startupRetry = { schedule: Schedule.spaced(Duration.millis(250)), times: 60 };

const withHttp = Effect.provide(FetchHttpClient.layer);

function formatHealth(health: CompanionHealth): string {
  const environments = health.environments.map((env) => {
    const aliases = env.aliases.length === 0 ? "" : ` (aliases: ${env.aliases.join(", ")})`;
    const error = env.lastError === null ? "" : ` - ${env.lastError}`;
    return `  ${env.name}${aliases}: ${env.state} ${env.url}${error}`;
  });
  return [
    `companion running (pid ${health.pid}, since ${health.startedAt})`,
    `mcp: ${health.mcpUrl}`,
    `database: ${health.database}`,
    "environments:",
    ...environments,
  ].join("\n");
}

const runningHealth = readCompanionRuntime().pipe(
  Effect.flatMap((runtime) =>
    withCompanionClient(runtime.url, (client) => client.health()).pipe(
      Effect.mapError(
        (cause) =>
          new CompanionNotRunningError({
            message: `companion at ${runtime.url} (pid ${runtime.pid}) does not answer`,
            cause,
          }),
      ),
    ),
  ),
);

const runCommand = Command.make(
  "run",
  {
    port: portFlag,
    env: envsFlag,
    logFile: Flag.String("log-file").pipe(
      Flag.withDescription("Append logs to this file instead of stderr"),
      Flag.optional,
    ),
    ...extraArgsConfig,
  },
  ({ port, env, logFile }) => {
    const program = Effect.gen(function* () {
      const version = yield* T3Version;
      // Autostart and a manual start can race; the second one leaves the running daemon alone.
      const existing = yield* Effect.option(runningHealth);
      if (Option.isSome(existing) && existing.value.pid !== companionProcessId()) {
        return yield* Effect.logInfo(
          `companion already running (pid ${existing.value.pid}, ${existing.value.mcpUrl}); exiting`,
        );
      }
      return yield* runCompanionDaemon(
        {
          port,
          pid: companionProcessId(),
          version: version.version,
          environments: env,
        },
        connectStoredEnvironment,
        makeCompanionAgentSender,
      ).pipe(
        Effect.provide(companionDaemonPlatformLayer(port)),
        // A daemon that is still shutting down, or a stale socket, holds the port for a moment.
        Effect.tapErrorTag("ServeError", () => Effect.logWarning(`port ${port} is busy; retrying`)),
        Effect.retry({
          schedule: Schedule.spaced(Duration.seconds(1)),
          times: 30,
          while: (error) => Predicate.isTagged(error, "ServeError"),
        }),
      );
    }).pipe(withHttp);
    return Option.isNone(logFile)
      ? program
      : program.pipe(
          Effect.provide(
            Logger.layer([Logger.toFile(Logger.formatLogFmt, logFile.value, { flag: "a" })]),
          ),
        );
  },
).pipe(Command.withDescription("run the companion in the foreground"));

const startCommand = Command.make(
  "start",
  { port: portFlag, env: envsFlag, format: formatFlag, ...extraArgsConfig },
  ({ port, env, format }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const existing = yield* Effect.option(runningHealth);
      if (Option.isSome(existing)) {
        return yield* resolvedFormat === "json"
          ? output.printJson(existing.value)
          : output.printInfo(`already running\n${formatHealth(existing.value)}`);
      }
      const paths = yield* resolveCompanionPaths();
      yield* (yield* FileSystem.FileSystem).makeDirectory(paths.stateDir, { recursive: true });
      yield* spawnDetachedCompanion(runArguments(port, env, paths.logFile));
      const health = yield* runningHealth.pipe(
        Effect.retry(startupRetry),
        Effect.mapError(
          (cause) =>
            new CompanionNotRunningError({
              message: `companion did not come up; see ${paths.logFile}`,
              cause,
            }),
        ),
      );
      return yield* resolvedFormat === "json"
        ? output.printJson(health)
        : output.printInfo(`${formatHealth(health)}\nlog: ${paths.logFile}`);
    }).pipe(withHttp),
).pipe(Command.withDescription("start the companion in the background"));

const statusCommand = Command.make(
  "status",
  { format: formatFlag, ...extraArgsConfig },
  ({ format }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const health = yield* runningHealth;
      return yield* resolveOutputFormat(format, cliRuntime, t3CliEnv, "json") === "json"
        ? output.printJson(health)
        : output.printInfo(formatHealth(health));
    }).pipe(withHttp),
).pipe(Command.withDescription("show companion status"));

const stopCommand = Command.make("stop", { ...extraArgsConfig }, () =>
  Effect.gen(function* () {
    const output = yield* T3Output;
    const runtime = yield* readCompanionRuntime();
    const requested = yield* Effect.exit(
      withCompanionClient(runtime.url, (client) => client.shutdown()),
    );
    if (Exit.isFailure(requested)) {
      if (yield* isProcessAlive(runtime.pid)) {
        return yield* new CompanionNotRunningError({
          message: `companion (pid ${runtime.pid}) is running but does not answer at ${runtime.url}`,
          cause: requested.cause,
        });
      }
      const paths = yield* resolveCompanionPaths();
      yield* (yield* FileSystem.FileSystem).remove(paths.runtimeFile, { force: true });
      return yield* output.printInfo(
        `companion was not running (pid ${runtime.pid} is gone); removed its stale runtime file`,
      );
    }
    // The daemon removes its runtime file on the way out.
    yield* readCompanionRuntime().pipe(
      Effect.flip,
      Effect.retry(startupRetry),
      Effect.mapError(
        () =>
          new CompanionNotRunningError({
            message: `companion (pid ${runtime.pid}) accepted shutdown but is still running`,
          }),
      ),
    );
    return yield* output.printInfo(`companion stopped (pid ${runtime.pid})`);
  }).pipe(withHttp),
).pipe(Command.withDescription("stop the companion"));

const installCommand = Command.make(
  "install",
  { port: portFlag, env: envsFlag, format: formatFlag, ...extraArgsConfig },
  ({ port, env, format }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const paths = yield* resolveCompanionPaths();
      yield* (yield* FileSystem.FileSystem).makeDirectory(paths.stateDir, { recursive: true });
      const target = yield* companionAutostartTarget(runArguments(port, env, paths.logFile));
      const result = yield* installAutostart(target);
      if (resolveOutputFormat(format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson({ ...result, command: target.command });
      }
      return yield* output.printInfo(
        [
          `companion autostart installed (${result.platform}: ${result.location})`,
          `runs at login: ${target.command.join(" ")}`,
          "re-run after upgrading node or t3cli, since the entry pins both paths",
        ].join("\n"),
      );
    }),
).pipe(Command.withDescription("start the companion at login (and now)"));

const uninstallCommand = Command.make(
  "uninstall",
  { format: formatFlag, ...extraArgsConfig },
  ({ format }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const result = yield* uninstallAutostart(yield* companionAutostartTarget([]));
      if (resolveOutputFormat(format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson(result);
      }
      return yield* output.printInfo(
        `companion autostart removed (${result.platform}: ${result.location}); a running daemon keeps running until "t3cli companion stop"`,
      );
    }),
).pipe(Command.withDescription("stop starting the companion at login"));

export function createCompanionCommand() {
  return Command.make("companion").pipe(
    Command.withDescription(
      "long-lived daemon that watches threads and serves an inbox over MCP (http://127.0.0.1:<port>/mcp)",
    ),
    Command.withSubcommands([
      startCommand,
      statusCommand,
      stopCommand,
      installCommand,
      uninstallCommand,
      runCommand,
    ]),
  );
}
