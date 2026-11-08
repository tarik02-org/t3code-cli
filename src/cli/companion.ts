import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { Command, Flag } from "effect/cli";

import { loadT3CliEnv } from "../config/env/env.ts";
import {
  readCompanionRuntime,
  withCompanionClient,
  withRunningCompanion,
} from "../companion/client.ts";
import { runCompanionDaemon } from "../companion/daemon.ts";
import { CompanionNotRunningError } from "../companion/error.ts";
import { defaultCompanionPort, resolveCompanionPaths } from "../companion/paths.ts";
import {
  companionDaemonPlatformLayer,
  companionProcessId,
  connectStoredEnvironment,
  spawnDetachedCompanion,
} from "../companion/runtime.ts";
import {
  type CompanionHealth,
  type InboxEvent,
  allCompanionEventKinds,
} from "../companion/schema.ts";
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
  ({ port, env, logFile }) =>
    Effect.gen(function* () {
      const version = yield* T3Version;
      const daemon = runCompanionDaemon(
        {
          port,
          pid: companionProcessId(),
          version: version.version,
          environments: env,
        },
        connectStoredEnvironment,
      ).pipe(Effect.provide(companionDaemonPlatformLayer(port)));
      if (Option.isNone(logFile)) {
        return yield* daemon;
      }
      return yield* daemon.pipe(
        Effect.provide(
          Logger.layer([Logger.toFile(Logger.formatLogFmt, logFile.value, { flag: "a" })]),
        ),
      );
    }),
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
    yield* withCompanionClient(runtime.url, (client) => client.shutdown());
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
    yield* output.printInfo(`companion stopped (pid ${runtime.pid})`);
  }).pipe(withHttp),
).pipe(Command.withDescription("stop the companion"));

export function createCompanionCommand() {
  return Command.make("companion").pipe(
    Command.withDescription(
      "long-lived daemon that watches threads and serves an inbox over MCP (http://127.0.0.1:<port>/mcp)",
    ),
    Command.withSubcommands([startCommand, statusCommand, stopCommand, runCommand]),
  );
}

function formatInboxEvent(row: InboxEvent): string {
  const acked = row.ackedAt === null ? "" : " (acked)";
  return `[${row.id}] ${row.event.occurredAt} ${row.event.kind} ${row.event.environment}${row.event.threadId === null ? "" : `/${row.event.threadId}`} "${row.event.title}"${acked}\n    ${row.event.summary}`;
}

export const inboxCommand = Command.make(
  "inbox",
  {
    thread: threadFlag,
    callerEnv: callerEnvFlag,
    wait: Flag.Boolean("wait").pipe(
      Flag.withDescription("Block until an event arrives or --timeout passes"),
      Flag.withDefault(false),
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Seconds to wait with --wait (default 60, max 600)"),
      Flag.withDefault(60),
    ),
    event: eventsFlag,
    ack: Flag.Boolean("ack").pipe(
      Flag.withDescription("Acknowledge the listed events"),
      Flag.withDefault(false),
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Include acknowledged events"),
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
                includeAcked: input.all,
                afterId: 0,
                limit: 100,
              });
          const acked =
            input.ack && events.length > 0
              ? yield* client.ack({ subscriber, ids: events.map((row) => row.id) })
              : 0;
          return { events, acked };
        }),
      );
      const { events, acked } = result;
      if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson({
          events,
          acked,
          timedOut: input.wait && events.length === 0,
        });
      }
      if (events.length === 0) {
        return yield* output.printInfo(input.wait ? "no events (timed out)" : "inbox empty");
      }
      const lines = events.map(formatInboxEvent);
      return yield* output.printInfo(
        (acked > 0 ? [...lines, `acknowledged ${acked}`] : lines).join("\n"),
      );
    }).pipe(withHttp),
).pipe(Command.withDescription("list or wait for companion inbox events of a thread"));

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
      Flag.withDescription("Also send one coalesced digest message to the subscriber thread"),
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
      const subscription = yield* withRunningCompanion((client) =>
        client.subscribe({
          subscriber,
          source: {
            environment: Option.getOrUndefined(input.sourceEnv),
            threadId: Option.getOrUndefined(input.to),
            projectId: Option.getOrUndefined(input.project),
          },
          events: input.event.length === 0 ? allCompanionEventKinds : input.event,
          wake: input.wake,
        }),
      );
      if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson(subscription);
      }
      const source =
        subscription.source.threadId === null
          ? `project ${subscription.source.projectId}`
          : `thread ${subscription.source.threadId}`;
      return yield* output.printInfo(
        `subscription ${subscription.id}: ${subscription.subscriber.environment}/${subscription.subscriber.threadId} <- ${subscription.source.environment} ${source} [${subscription.events.join(", ")}]${subscription.wake ? " +wake" : ""}`,
      );
    }).pipe(withHttp),
).pipe(Command.withDescription("subscribe a thread to another thread's events via the companion"));
