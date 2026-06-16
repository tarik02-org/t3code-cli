import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { OrchestrationMessage, OrchestrationThread } from "#t3tools/contracts";

import { ThreadSessionError } from "../domain/error.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import type { WaitEvent } from "./service.ts";
import {
  applyThreadEvent,
  isThreadActive,
  isThreadCompleteEnough,
  messageFromEvent,
  messageKey,
  threadStatus,
} from "../domain/thread-lifecycle.ts";

export function watchThread(input: { readonly threadId: string }) {
  let current: OrchestrationThread | undefined;
  let currentMessages: Map<string, OrchestrationMessage> | undefined;
  return Stream.unwrap(
    Effect.gen(function* () {
      const orchestration = yield* T3Orchestration;
      return Stream.scoped(
        orchestration.watchThreadItems(input.threadId).pipe(
          Stream.flatMap((item) => {
            if (item.kind === "snapshot") {
              const messages = new Map<string, OrchestrationMessage>();
              for (const message of item.snapshot.thread.messages) {
                messages.set(messageKey(message), message);
              }
              current = item.snapshot.thread;
              currentMessages = messages;

              const events: Array<WaitEvent> = [
                { type: "thread", thread: current },
                { type: "status", status: threadStatus(current), threadId: current.id },
              ];
              if (!isThreadActive(current) && isThreadCompleteEnough(current)) {
                events.push({ type: "done", thread: current });
              }
              return Stream.fromIterable(events);
            }

            if (current === undefined || currentMessages === undefined) {
              return Stream.fail(
                new ThreadSessionError({
                  message: `thread stream event received before snapshot: ${input.threadId}`,
                  threadId: input.threadId,
                }),
              );
            }

            current = applyThreadEvent(current, item.event, currentMessages);
            const message = messageFromEvent(item.event, currentMessages);
            const events: Array<WaitEvent> = message !== null ? [{ type: "message", message }] : [];
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
  );
}

export function waitForThread(input: { readonly threadId: string }) {
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
