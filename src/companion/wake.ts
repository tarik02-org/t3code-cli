import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";

import { CompanionEnvironments } from "./environments.ts";
import { threadRefKey, type ThreadRef } from "./schema.ts";
import { inTurn } from "./state.ts";
import { CompanionStore, type StoredFire } from "./store.ts";

/** Waits that fire this close together reach their owner as one message. */
export const wakeWindow = Duration.seconds(3);

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** One fired wait as a line: its id, label, and what matched or where things stood. */
export const wakeLine = (fire: StoredFire) =>
  `- [${fire.wait.id}]${fire.wait.label === null ? "" : ` "${fire.wait.label}"`} ${
    fire.result.outcome === "matched" ? "matched" : "timed out"
  }: ${fire.summary}`;

export function formatWake(
  owner: ThreadRef,
  fires: ReadonlyArray<StoredFire>,
  stillPending: number,
): string {
  const first = fires[0];
  return [
    `t3 companion: ${count(fires.length, "wait")} fired.`,
    ...fires.map(wakeLine),
    ...(first === undefined
      ? []
      : [
          `Full payload: wait_result ${JSON.stringify({
            callerThreadId: owner.threadId,
            callerEnvironment: owner.environment,
            id: first.wait.id,
          })}. ${
            stillPending === 0
              ? "You have no waits pending."
              : `${count(stillPending, "wait")} of yours ${stillPending === 1 ? "is" : "are"} still pending (waits).`
          }`,
        ]),
  ].join("\n");
}

/**
 * Sends each owner its fired waits as one message per window. `latestShell` gives the owner's
 * last shell row; `pendingCount` its waits still pending; `settled` is told when an owner has
 * nothing left to be sent.
 */
export const makeWaker = Effect.fn("makeCompanionWaker")(function* (options: {
  readonly latestShell: (ref: ThreadRef) => OrchestrationV2ThreadShell | undefined;
  readonly pendingCount: (owner: ThreadRef) => number;
  readonly settled: (owner: ThreadRef) => void;
}) {
  const store = yield* CompanionStore;
  const environments = yield* CompanionEnvironments;
  const windows = yield* FiberMap.make<string>();

  const send = Effect.fn("CompanionWaker.send")(function* (owner: ThreadRef) {
    const fires = yield* store.undelivered(owner, "woken");
    if (fires.length === 0) {
      options.settled(owner);
      return false;
    }
    const shell = options.latestShell(owner);
    const busy = shell !== undefined && inTurn(shell, yield* Clock.currentTimeMillis);
    // Only a steering wait interrupts a turn; it then carries everything else that fired.
    if (busy && !fires.some((fire) => fire.wait.wake === "steer")) {
      return false;
    }
    const environment = yield* environments.resolve(owner.environment);
    const message = formatWake(owner, fires, options.pendingCount(owner));
    const mode = busy ? "steer" : "auto";
    // Through T3 Code's MCP the message shows as from an agent; a websocket send shows as the user's.
    const asAgent = yield* Option.match(environment.agentSender, {
      onNone: () => Effect.succeed(false),
      onSome: (sender) =>
        sender.send({ threadId: owner.threadId, message, mode }).pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `agent-marked wake to ${threadRefKey(owner)} failed; sending it as a plain message`,
              cause,
            ).pipe(Effect.as(false)),
          ),
        ),
    });
    if (!asAgent) {
      yield* environment.application.sendThread({
        threadId: owner.threadId,
        message,
        mode,
        author: { kind: "agent" },
      });
    }
    yield* store.markDelivered(
      fires.map((fire) => fire.fireId),
      DateTime.formatIso(yield* DateTime.now),
    );
    yield* Effect.logInfo(
      `woke ${threadRefKey(owner)} (${mode}) for waits ${fires.map((fire) => fire.wait.id).join(", ")}`,
    );
    return true;
  });

  // One message per window: waits that fire while one is pending join it, and waits that fire
  // during the send start the next window.
  const schedule = (owner: ThreadRef) =>
    FiberMap.run(
      windows,
      threadRefKey(owner),
      Effect.gen(function* () {
        let sent = true;
        while (sent) {
          yield* Effect.sleep(wakeWindow);
          sent = yield* send(owner);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`wake to ${threadRefKey(owner)} failed; it stays owed`, cause),
        ),
      ),
      { onlyIfMissing: true },
    ).pipe(Effect.asVoid);

  return { schedule };
});
