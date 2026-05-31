import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ThreadSessionError } from "../domain/error.ts";
import type { Orchestration } from "../orchestration/service.ts";
import type { ThreadDetail, ThreadMessage } from "../domain/schema.ts";
import type { WaitEvent } from "./service.ts";
import {
  applyThreadEvent,
  isThreadActive,
  isThreadCompleteEnough,
  messageFromEvent,
  messageKey,
  threadStatus,
} from "../domain/thread-lifecycle.ts";

export function watchThread(input: {
  readonly orchestration: Orchestration;
  readonly threadId: string;
}) {
  return Stream.scoped(
    Stream.unwrap(
      Effect.gen(function* () {
        const opened = yield* input.orchestration.openThread(input.threadId);
        const messages = new Map<string, ThreadMessage>();
        for (const message of opened.snapshot.messages) {
          messages.set(messageKey(message), message);
        }
        const initialEvents: ReadonlyArray<WaitEvent> = [
          { type: "thread", thread: opened.snapshot },
          {
            type: "status",
            status: threadStatus(opened.snapshot),
            threadId: opened.snapshot.id,
          },
        ];
        if (!isThreadActive(opened.snapshot) && isThreadCompleteEnough(opened.snapshot)) {
          return Stream.fromIterable([
            ...initialEvents,
            { type: "done", thread: opened.snapshot } satisfies WaitEvent,
          ]);
        }

        let current: ThreadDetail = opened.snapshot;
        return Stream.concat(
          Stream.fromIterable(initialEvents),
          Stream.merge(
            opened.events.pipe(Stream.map((event) => ({ type: "event" as const, event }))),
            Stream.tick("5 seconds").pipe(
              Stream.mapEffect(() => input.orchestration.getThreadSnapshot(input.threadId)),
              Stream.map((thread) => ({ type: "snapshot" as const, thread })),
            ),
          ).pipe(
            Stream.flatMap((item) => {
              if (item.type === "snapshot") {
                current = item.thread;
                for (const message of current.messages) {
                  messages.set(messageKey(message), message);
                }
                const events: Array<WaitEvent> = [
                  { type: "thread", thread: current },
                  { type: "status", status: threadStatus(current), threadId: current.id },
                ];
                if (!isThreadActive(current) && isThreadCompleteEnough(current)) {
                  events.push({ type: "done", thread: current });
                }
                return Stream.fromIterable(events);
              }
              current = applyThreadEvent(current, item.event, messages);
              const message = messageFromEvent(item.event, messages);
              const events: Array<WaitEvent> =
                message !== null ? [{ type: "message", message }] : [];
              events.push({ type: "status", status: threadStatus(current), threadId: current.id });
              if (!isThreadActive(current) && isThreadCompleteEnough(current)) {
                events.push({ type: "done", thread: current });
              }
              return Stream.fromIterable(events);
            }),
            Stream.takeUntil((event) => event.type === "done"),
          ),
        );
      }),
    ),
  );
}

export function waitForThread(input: {
  readonly orchestration: Orchestration;
  readonly threadId: string;
}) {
  return watchThread(input).pipe(
    Stream.runLast,
    Effect.flatMap((event) => {
      if (Option.isSome(event) && event.value.type === "done") {
        return Effect.succeed(event.value.thread);
      }
      return Effect.fail(
        new ThreadSessionError({
          message: `thread wait ended without done event: ${input.threadId}`,
          threadId: input.threadId,
        }),
      );
    }),
  );
}
