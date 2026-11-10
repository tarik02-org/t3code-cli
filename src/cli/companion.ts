import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { Command, Flag } from "effect/cli";

import { loadT3CliEnv } from "../config/env/env.ts";
import {
  readCompanionRuntime,
  withCompanionClient,
  withRunningCompanion,
} from "../companion/client.ts";
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
import {
  type CompanionHealth,
  DeliveryPriority,
  type InboxEvent,
  allCompanionEventKinds,
} from "../companion/schema.ts";

const decodePriorities = Schema.decodeUnknownEffect(Schema.Record(Schema.String, DeliveryPriority));
import { T3Version } from "../version/service.ts";
import { MissingThreadError } from "./error.ts";
import { extraArgsConfig } from "./extra-args.ts";
import { formatFlag, threadFlag } from "./flags.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";
import { CliRuntime } from "./runtime/service.ts";
import { resolveThreadId } from "./scope/index.ts";

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

const callerEnvFlag = Flag.String("caller-env").pipe(
  Flag.withDescription("Environment of the subscriber thread (default: the default environment)"),
  Flag.optional,
);

const eventsFlag = Flag.Literals("event", allCompanionEventKinds).pipe(
  Flag.withDescription("Event kind to deliver; repeat for several (default: all)"),
  Flag.atLeast(0),
);

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

const resolveSubscriber = Effect.fn("resolveCompanionSubscriber")(function* (input: {
  readonly thread: Option.Option<string>;
  readonly callerEnv: Option.Option<string>;
}) {
  const t3CliEnv = yield* loadT3CliEnv;
  const threadId = resolveThreadId({
    value: Option.getOrUndefined(input.thread),
    scope: t3CliEnv.scope,
  });
  if (threadId === undefined) {
    return yield* new MissingThreadError({
      message: "subscriber thread id is required: pass --thread or set T3CODE_THREAD_ID",
    });
  }
  return { threadId, environment: Option.getOrUndefined(input.callerEnv) };
});

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
      yield* spawnDetachedCompanion([
        "companion",
        "run",
        "--port",
        String(port),
        "--log-file",
        paths.logFile,
        ...env.flatMap((name) => ["--env", name]),
      ]);
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
      const target = yield* companionAutostartTarget([
        "companion",
        "run",
        "--port",
        String(port),
        "--log-file",
        paths.logFile,
        ...env.flatMap((name) => ["--env", name]),
      ]);
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

function formatInboxEvent(row: InboxEvent): string {
  const event = row.event;
  const state =
    row.resolvedAt !== null
      ? ` (resolved${row.disposition === null ? "" : `: ${row.disposition}`})`
      : row.snoozedUntil !== null
        ? ` (snoozed until ${row.snoozedUntil})`
        : "";
  const lines = [
    `[${row.id}] ${event.occurredAt} ${row.priority} ${event.kind}${event.pause ? " (pause)" : ""} ${event.environment}${event.threadId === null ? "" : `/${event.threadId}`} "${event.title}"${state}`,
    `    ${event.summary}`,
    ...event.pullRequests.map(
      (pr) =>
        `    PR #${pr.number} ${pr.state}${pr.draft ? " draft" : ""}, checks ${pr.checks ?? "unknown"}, ${pr.mergeable ?? "mergeability unknown"}`,
    ),
  ];
  if (event.lastMessage !== null) {
    lines.push(`    last message: ${event.lastMessage.slice(0, 300).replace(/\s+/g, " ")}`);
  }
  return lines.join("\n");
}

export const inboxCommand = Command.make(
  "inbox",
  {
    thread: threadFlag,
    callerEnv: callerEnvFlag,
    wait: Flag.Boolean("wait").pipe(
      Flag.withDescription("Block until an item arrives or --timeout passes"),
      Flag.withDefault(false),
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Seconds to wait with --wait (default 60, max 600)"),
      Flag.withDefault(60),
    ),
    event: eventsFlag,
    id: Flag.Int("id").pipe(
      Flag.withDescription(
        "Item to resolve or snooze; repeat for several (default: the listed ones)",
      ),
      Flag.atLeast(0),
    ),
    resolve: Flag.Boolean("resolve").pipe(
      Flag.withDescription("Resolve the items for good"),
      Flag.withDefault(false),
    ),
    disposition: Flag.String("disposition").pipe(
      Flag.withDescription('What was done with resolved items, e.g. "marked ready"'),
      Flag.optional,
    ),
    snooze: Flag.Int("snooze").pipe(
      Flag.withDescription(
        "Hide the items for at least this many seconds, until their source is idle",
      ),
      Flag.optional,
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Include resolved and snoozed items"),
      Flag.withDefault(false),
    ),
    format: formatFlag,
    ...extraArgsConfig,
  },
  (input) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const subscriber = yield* resolveSubscriber(input);
      const result = yield* withRunningCompanion((client) =>
        Effect.gen(function* () {
          const events = input.wait
            ? yield* client.wait({
                subscriber,
                afterId: 0,
                events: input.event,
                timeoutSeconds: input.timeout,
              })
            : yield* client.inbox({
                subscriber,
                includeResolved: input.all,
                afterId: 0,
                limit: 100,
              });
          const ids = input.id.length > 0 ? input.id : events.map((row) => row.id);
          const resolved =
            input.resolve && ids.length > 0
              ? yield* client.resolve({
                  subscriber,
                  ids,
                  disposition: Option.getOrNull(input.disposition),
                })
              : 0;
          const snoozed =
            Option.isSome(input.snooze) && ids.length > 0
              ? yield* client.snooze({ subscriber, ids, minSeconds: input.snooze.value })
              : 0;
          return { events, resolved, snoozed };
        }),
      );
      const { events, resolved, snoozed } = result;
      if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson({
          events,
          resolved,
          snoozed,
          timedOut: input.wait && events.length === 0,
        });
      }
      const lines =
        events.length === 0
          ? [input.wait ? "no items (timed out)" : "inbox empty"]
          : events.map(formatInboxEvent);
      return yield* output.printInfo(
        [
          ...lines,
          ...(resolved > 0 ? [`resolved ${resolved}`] : []),
          ...(snoozed > 0 ? [`snoozed ${snoozed}`] : []),
        ].join("\n"),
      );
    }).pipe(withHttp),
).pipe(Command.withDescription("list, wait for, resolve, or snooze companion inbox items"));

const priorityFlag = Flag.KeyValuePair("priority").pipe(
  Flag.withDescription("Per-kind digest priority, e.g. idle=low (urgent, normal, low)"),
  Flag.optional,
);

export const subscribeCommand = Command.make(
  "subscribe",
  {
    thread: threadFlag,
    callerEnv: callerEnvFlag,
    to: Flag.String("to").pipe(Flag.withDescription("Source thread id"), Flag.optional),
    project: Flag.String("project").pipe(
      Flag.withDescription("Source project id (every thread in it)"),
      Flag.optional,
    ),
    sourceEnv: Flag.String("source-env").pipe(
      Flag.withDescription("Environment of the source (default: the default environment)"),
      Flag.optional,
    ),
    event: eventsFlag,
    wake: Flag.Boolean("wake").pipe(
      Flag.withDescription("Also send digest messages to the subscriber thread"),
      Flag.withDefault(false),
    ),
    priority: priorityFlag,
    follow: Flag.Boolean("follow").pipe(
      Flag.withDescription("With --project: follow the subscriber's own new threads in it"),
      Flag.withDefault(false),
    ),
    format: formatFlag,
    ...extraArgsConfig,
  },
  (input) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const subscriber = yield* resolveSubscriber(input);
      const priorities = yield* decodePriorities(Option.getOrElse(input.priority, () => ({})));
      const result = yield* withRunningCompanion((client) =>
        client.subscribe({
          subscriber,
          source: {
            environment: Option.getOrUndefined(input.sourceEnv),
            threadId: Option.getOrUndefined(input.to),
            projectId: Option.getOrUndefined(input.project),
          },
          events: input.event.length === 0 ? allCompanionEventKinds : input.event,
          wake: input.wake,
          priorities,
          follow: input.follow,
        }),
      );
      if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson(result);
      }
      const { subscription, source: status } = result;
      const source =
        subscription.source.threadId === null
          ? `project ${subscription.source.projectId}`
          : `thread ${subscription.source.threadId}`;
      return yield* output.printInfo(
        [
          `subscription ${subscription.id}: ${subscription.subscriber.environment}/${subscription.subscriber.threadId} <- ${subscription.source.environment} ${source} [${subscription.events.join(", ")}]${subscription.wake ? (subscription.armed ? " +wake (armed)" : " +wake (disarmed)") : ""}`,
          ...(status === null
            ? []
            : [
                `source is ${status.state} (run ${status.latestRunStatus})${status.pendingTasks.length > 0 ? `, waiting on: ${status.pendingTasks.join(", ")}` : ""}`,
              ]),
        ].join("\n"),
      );
    }).pipe(withHttp),
).pipe(Command.withDescription("subscribe a thread to another thread's events via the companion"));
