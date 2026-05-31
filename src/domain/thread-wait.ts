import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { Orchestration } from "../orchestration/service.ts";
import type { ThreadDetail, ThreadMessage } from "./schema.ts";
import type { WaitEvent } from "./service.ts";
import {
  applyThreadEvent,
  isThreadActive,
  isThreadCompleteEnough,
  messageFromEvent,
  messageKey,
  threadStatus,
} from "./thread-lifecycle.ts";

export function waitForThread<E = never, R = never>(input: {
  readonly orchestration: Orchestration;
  readonly threadId: string;
  readonly onEvent?: (event: WaitEvent) => Effect.Effect<void, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const emit = (event: WaitEvent) => input.onEvent?.(event) ?? Effect.void;
      const opened = yield* input.orchestration.openThread(input.threadId);
      const messages = new Map<string, ThreadMessage>();
      for (const message of opened.snapshot.messages) messages.set(messageKey(message), message);
      yield* emit({ type: "thread", thread: opened.snapshot });
      yield* emit({
        type: "status",
        status: threadStatus(opened.snapshot),
        threadId: opened.snapshot.id,
      });
      if (!isThreadActive(opened.snapshot) && isThreadCompleteEnough(opened.snapshot)) {
        yield* emit({ type: "done", thread: opened.snapshot });
        return opened.snapshot;
      }

      let current: ThreadDetail = opened.snapshot;
      let complete = false;
      yield* Stream.merge(
        opened.events.pipe(Stream.map((event) => ({ type: "event" as const, event }))),
        Stream.tick("5 seconds").pipe(
          Stream.mapEffect(() => input.orchestration.getThreadSnapshot(input.threadId)),
          Stream.map((thread) => ({ type: "snapshot" as const, thread })),
        ),
      ).pipe(
        Stream.tap((item) =>
          Effect.gen(function* () {
            if (item.type === "snapshot") {
              current = item.thread;
              for (const message of current.messages) messages.set(messageKey(message), message);
              yield* emit({ type: "thread", thread: current });
            } else {
              current = applyThreadEvent(current, item.event, messages);
              const message = messageFromEvent(item.event, messages);
              if (message) yield* emit({ type: "message", message });
            }
            yield* emit({ type: "status", status: threadStatus(current), threadId: current.id });
            if (!isThreadActive(current) && isThreadCompleteEnough(current)) {
              complete = true;
              yield* emit({ type: "done", thread: current });
            }
          }),
        ),
        Stream.takeUntil(() => complete),
        Stream.runDrain,
      );
      return current;
    }),
  );
}
