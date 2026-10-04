import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ThreadSessionError } from "../domain/error.ts";
import { isThreadActive, threadStatus } from "../domain/thread-lifecycle.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import type { WaitEvent } from "./service.ts";

export function watchThread(input: { readonly threadId: string }) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const orchestration = yield* T3Orchestration;
      return Stream.scoped(
        orchestration.watchThread(input.threadId).pipe(
          Stream.flatMap((state) => {
            const events: Array<WaitEvent> = [];
            if (state.event === null) {
              events.push({ type: "thread", projection: state.projection });
            } else if (state.event.type === "message.updated") {
              const messageId = state.event.payload.id;
              const message = state.projection.messages.find((entry) => entry.id === messageId);
              if (message !== undefined) {
                events.push({ type: "message", message });
              }
            }
            events.push({
              type: "status",
              status: threadStatus(state.projection),
              threadId: input.threadId,
              projection: state.projection,
            });
            if (!isThreadActive(state.projection)) {
              events.push({ type: "done", projection: state.projection });
            }
            return Stream.fromIterable(events);
          }),
          Stream.takeUntil((event) => event.type === "done"),
        ),
      );
    }),
  );
}

export function waitForThread(input: { readonly threadId: string }) {
  return watchThread(input).pipe(
    Stream.runLast,
    Effect.flatMap((event) => {
      if (Option.isSome(event) && event.value.type === "done") {
        return Effect.succeed(event.value.projection);
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
