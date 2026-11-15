import type { OrchestrationV2ShellStreamItem } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
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
import { CompanionWaits } from "./waits.ts";

const reconnectDelay = Duration.seconds(5);

/**
 * Follows every environment's shell stream until interrupted, handing each thread row to the
 * waits. A (re)connect starts with a full snapshot, which brings every thread up to date.
 */
export const runCompanionWatcher = Effect.fn("runCompanionWatcher")(function* () {
  const environments = yield* CompanionEnvironments;
  const waits = yield* CompanionWaits;

  const watchEnvironment = Effect.fn("CompanionWatcher.watchEnvironment")(function* (
    environment: CompanionEnvironment,
  ) {
    const handleItem = (item: OrchestrationV2ShellStreamItem) => {
      switch (item.kind) {
        case "snapshot":
          return Ref.set(environment.connection, { kind: "connected" }).pipe(
            Effect.andThen(
              Effect.forEach(
                item.snapshot.threads,
                (shell) => waits.ingest(environment.name, shell),
                { discard: true },
              ),
            ),
          );
        case "thread.updated":
          return waits.ingest(environment.name, item.thread);
        case "thread.removed":
          return waits.forget(environment.name, item.threadId);
        case "synchronized":
        case "project.updated":
        case "project.removed":
          return Effect.void;
      }
      return Effect.void;
    };

    return yield* environment.orchestration.watchShell().pipe(
      Stream.runForEach(handleItem),
      Effect.scoped,
      Effect.matchCauseEffect({
        onSuccess: () =>
          Ref.set(environment.connection, { kind: "down", lastError: "connection closed" }),
        onFailure: (cause) =>
          Ref.set(environment.connection, {
            kind: "down",
            // A closed socket tears its connection scope down, which surfaces as an interrupt.
            lastError: Cause.hasInterruptsOnly(cause)
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
      Effect.andThen(Effect.sleep(reconnectDelay)),
      Effect.forever,
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
