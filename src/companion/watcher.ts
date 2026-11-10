import type {
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  type CompanionEnvironment,
  CompanionEnvironments,
  environmentKey,
} from "./environments.ts";
import { type ConnectionReport, type ConnectionSignal, stepConnection } from "./connection.ts";
import { CompanionHub } from "./hub.ts";
import type { ThreadEvent } from "./schema.ts";

/** How long a thread must stay idle before the idle event fires. */
export const idleDebounce = Duration.seconds(3);
/** How long an environment may stay unreachable before subscribers hear about it. */
export const environmentDownGrace = Duration.minutes(1);
const reconnectDelay = Duration.seconds(5);

const environmentEvent = (
  environment: CompanionEnvironment,
  kind: "env-down" | "env-up",
  downSinceMs: number,
  nowMs: number,
  summary: string,
): ThreadEvent => {
  const downSince = DateTime.formatIso(DateTime.makeUnsafe(downSinceMs));
  return {
    // Both events of one outage share its start, so each fires once per outage.
    eventId: `${environment.name}/${kind}/${downSince}`,
    kind,
    environment: environment.name,
    threadId: null,
    projectId: null,
    title: environment.name,
    occurredAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
    summary,
    pause: false,
    pendingTasks: [],
    lastMessage: null,
    pullRequests: [],
  };
};

/**
 * Follows every environment's shell stream until interrupted. A (re)connect starts with a full
 * snapshot, which reconciles every watched thread; store-side dedupe drops repeats.
 */
export const runCompanionWatcher = Effect.fn("runCompanionWatcher")(function* () {
  const environments = yield* CompanionEnvironments;
  const hub = yield* CompanionHub;
  const idleTimers = yield* FiberMap.make<string>();
  const downTimers = yield* FiberMap.make<string>();

  const processThread = Effect.fn("CompanionWatcher.processThread")(function* (
    environment: CompanionEnvironment,
    shell: OrchestrationV2ThreadShell,
  ) {
    const key = `${environment.name}/${shell.id}`;
    const idle = yield* hub.ingest(environment.name, shell);
    if (idle === null) {
      yield* FiberMap.remove(idleTimers, key);
      return;
    }
    // Each update restarts the window, so the event fires only after the thread stays quiet.
    yield* FiberMap.run(
      idleTimers,
      key,
      Effect.sleep(idleDebounce).pipe(
        Effect.andThen(hub.publish(idle)),
        Effect.catchCause((cause) => Effect.logWarning(`failed to publish ${idle.eventId}`, cause)),
      ),
    );
  });

  const watchEnvironment = Effect.fn("CompanionWatcher.watchEnvironment")(function* (
    environment: CompanionEnvironment,
  ) {
    const transition = (signal: ConnectionSignal) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((nowMs) =>
          Ref.modify(environment.connection, (state) => stepConnection(state, signal, nowMs)),
        ),
      );

    const announce = Effect.fn("CompanionWatcher.announce")(function* (
      report: ConnectionReport | null,
    ) {
      if (report === null) {
        return;
      }
      const nowMs = yield* Clock.currentTimeMillis;
      const seconds = Math.round((nowMs - report.sinceMs) / 1000);
      const down = report.kind === "env-down";
      yield* down
        ? Effect.logWarning(`environment ${environment.name} is down`)
        : Effect.logInfo(`environment ${environment.name} is back after ${seconds}s`);
      yield* hub.publish(
        environmentEvent(
          environment,
          report.kind,
          report.sinceMs,
          nowMs,
          down
            ? `environment ${environment.name} unreachable${report.lastError === null ? "" : `: ${report.lastError}`}`
            : `environment ${environment.name} reachable again after ${seconds}s`,
        ),
      );
    });

    const startGrace = FiberMap.run(
      downTimers,
      environment.name,
      Effect.sleep(environmentDownGrace).pipe(
        Effect.andThen(transition({ kind: "grace-elapsed" })),
        Effect.flatMap(announce),
      ),
      { onlyIfMissing: true },
    );

    const connected = FiberMap.remove(downTimers, environment.name).pipe(
      Effect.andThen(transition({ kind: "connected" })),
      Effect.flatMap(announce),
    );

    const handleItem = (item: OrchestrationV2ShellStreamItem) => {
      switch (item.kind) {
        case "snapshot":
          return connected.pipe(
            Effect.andThen(
              Effect.forEach(item.snapshot.threads, (shell) => processThread(environment, shell), {
                discard: true,
              }),
            ),
          );
        case "thread.updated":
          return processThread(environment, item.thread);
        case "thread.removed":
          return FiberMap.remove(idleTimers, `${environment.name}/${item.threadId}`).pipe(
            Effect.andThen(hub.forget(environment.name, item.threadId)),
          );
        case "synchronized":
        case "project.updated":
        case "project.removed":
          return Effect.void;
      }
      return Effect.void;
    };

    yield* startGrace;
    return yield* environment.orchestration.watchShell().pipe(
      Stream.runForEach(handleItem),
      Effect.scoped,
      Effect.matchCauseEffect({
        onSuccess: () => transition({ kind: "dropped", error: "connection closed" }),
        onFailure: (cause) =>
          transition({
            kind: "dropped",
            // A closed socket tears its connection scope down, which surfaces as an interrupt.
            error: Cause.hasInterruptsOnly(cause)
              ? "connection closed"
              : (Cause.pretty(cause).split("\n")[0] ?? "disconnected"),
          }).pipe(
            Effect.andThen(
              Effect.logWarning(
                `environment ${environment.name} stream ended; reconnecting`,
                cause,
              ),
            ),
          ),
      }),
      Effect.andThen(startGrace),
      Effect.andThen(Effect.sleep(reconnectDelay)),
      Effect.forever,
      // A removed environment must not report an outage after it is gone.
      Effect.ensuring(FiberMap.remove(downTimers, environment.name)),
    );
  });

  const watching = yield* FiberMap.make<string>();
  // Only this fiber touches it: the keys of the environments being watched.
  let active = new Set<string>();
  return yield* environments.changes.pipe(
    Stream.runForEach(
      Effect.fnUntraced(function* (current) {
        const keys = new Set(current.map(environmentKey));
        for (const key of active) {
          if (!keys.has(key)) {
            yield* FiberMap.remove(watching, key);
          }
        }
        active = keys;
        for (const environment of current) {
          yield* FiberMap.run(
            watching,
            environmentKey(environment),
            watchEnvironment(environment),
            {
              onlyIfMissing: true,
            },
          );
        }
        yield* Effect.logInfo(
          `watching ${current.map((env) => `${env.name} (${env.url})`).join(", ")}`,
        );
      }),
    ),
  );
});
