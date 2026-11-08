import type {
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { type CompanionEnvironment, CompanionEnvironments } from "./environments.ts";
import { CompanionHub } from "./hub.ts";
import { idleCandidate, immediateEvents } from "./state.ts";

/** How long a thread must stay idle before the idle event fires. */
export const idleDebounce = Duration.seconds(3);
const reconnectDelay = Duration.seconds(5);

/**
 * Follows every environment's shell stream until interrupted. A (re)connect starts with a full
 * snapshot, which reconciles every watched thread; store-side dedupe drops repeats.
 */
export const runCompanionWatcher = Effect.fn("runCompanionWatcher")(function* () {
  const environments = yield* CompanionEnvironments;
  const hub = yield* CompanionHub;
  const idleTimers = yield* FiberMap.make<string>();

  const processThread = Effect.fn("CompanionWatcher.processThread")(function* (
    environment: CompanionEnvironment,
    shell: OrchestrationV2ThreadShell,
  ) {
    const key = `${environment.name}/${shell.id}`;
    const watched = yield* hub.isWatched(environment.name, shell.id, shell.projectId);
    if (!watched || shell.deletedAt !== null || shell.archivedAt !== null) {
      yield* FiberMap.remove(idleTimers, key);
      return;
    }
    for (const event of immediateEvents(environment.name, shell)) {
      yield* hub.publish(event);
    }
    const candidate = idleCandidate(environment.name, shell, yield* Clock.currentTimeMillis);
    if (candidate === null) {
      yield* FiberMap.remove(idleTimers, key);
      return;
    }
    // Each update restarts the window, so the event fires only after the thread stays quiet.
    yield* FiberMap.run(
      idleTimers,
      key,
      Effect.sleep(idleDebounce).pipe(
        Effect.andThen(hub.publish(candidate)),
        Effect.catchCause((cause) =>
          Effect.logWarning(`failed to publish ${candidate.eventId}`, cause),
        ),
      ),
    );
  });

  const handleItem = (environment: CompanionEnvironment, item: OrchestrationV2ShellStreamItem) => {
    switch (item.kind) {
      case "snapshot":
        return Ref.set(environment.status, { state: "connected", lastError: null }).pipe(
          Effect.andThen(
            Effect.forEach(item.snapshot.threads, (shell) => processThread(environment, shell), {
              discard: true,
            }),
          ),
        );
      case "thread.updated":
        return processThread(environment, item.thread);
      case "thread.removed":
        return FiberMap.remove(idleTimers, `${environment.name}/${item.threadId}`);
      case "synchronized":
      case "project.updated":
      case "project.removed":
        return Effect.void;
    }
    return Effect.void;
  };

  const watchEnvironment = (environment: CompanionEnvironment) =>
    environment.orchestration.watchShell().pipe(
      Stream.runForEach((item) => handleItem(environment, item)),
      Effect.scoped,
      Effect.catchCause((cause) =>
        Ref.set(environment.status, {
          state: "disconnected",
          lastError: Cause.pretty(cause).split("\n")[0] ?? "disconnected",
        }).pipe(
          Effect.andThen(
            Effect.logWarning(`environment ${environment.name} stream ended; reconnecting`, cause),
          ),
        ),
      ),
      Effect.andThen(Effect.sleep(reconnectDelay)),
      Effect.forever,
    );

  yield* Effect.logInfo(
    `watching ${environments.all.map((env) => `${env.name} (${env.url})`).join(", ")}`,
  );
  return yield* Effect.forEach(environments.all, watchEnvironment, {
    concurrency: "unbounded",
    discard: true,
  });
});
