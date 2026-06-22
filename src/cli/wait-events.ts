import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Terminal from "effect/Terminal";

import type { ApplicationError } from "../application/error.ts";
import type { WaitEvent } from "../application/service.ts";
import { ThreadSessionError } from "../domain/error.ts";
import { latestAssistantMessage } from "../domain/thread-lifecycle.ts";
import type { T3Output } from "./output/service.ts";
import { formatWaitDoneHuman, formatWaitEventNdjson } from "./format/thread.ts";

export function printWaitEventsNdjson(
  output: T3Output["Service"],
  events: Stream.Stream<WaitEvent, ApplicationError>,
) {
  return events.pipe(
    Stream.tap((event) => output.printNdjson(formatWaitEventNdjson(event))),
    Stream.runDrain,
  );
}

export function printWaitEventsHuman(
  output: T3Output["Service"],
  events: Stream.Stream<WaitEvent, ApplicationError>,
  options: {
    readonly threadId: string;
    readonly live: boolean;
  },
) {
  let latest = "";
  let status = `waiting for ${options.threadId}`;
  let rendered = false;
  let columns = 0;

  const render = () => {
    if (!options.live) {
      return Effect.void;
    }
    rendered = true;
    return output.writeStderr(
      `\r\x1b[2K${fitLine(`${status}${latest.length > 0 ? ` | ${latest}` : ""}`, columns)}`,
    );
  };

  return Effect.gen(function* () {
    if (options.live) {
      const terminal = yield* Terminal.Terminal;
      columns = yield* terminal.columns;
    }
    if (options.live) {
      yield* render();
    } else {
      yield* output.writeStderr(`${status}...\n`);
    }

    yield* events.pipe(
      Stream.tap((event) => {
        if (event.type === "thread") {
          const message = latestAssistantMessage(event.thread);
          if (message !== undefined) {
            latest = compactLine(message.text);
          }
          return render();
        }
        if (event.type === "message") {
          if (event.message.role === "assistant") {
            latest = compactLine(event.message.text);
          }
          return render();
        }
        if (event.type === "status") {
          status = `${event.threadId}: ${event.status}`;
          return render();
        }
        return Effect.gen(function* () {
          if (rendered) {
            yield* output.writeStderr("\r\x1b[2K");
          }
          yield* output.writeStdout(formatWaitDoneHuman(event.thread));
        });
      }),
      Stream.runLast,
      Effect.flatMap((event) => {
        if (Option.isSome(event) && event.value.type === "done") {
          return Effect.void;
        }
        return Effect.fail(
          new ThreadSessionError({
            message: `thread wait ended without done event: ${options.threadId}`,
            threadId: options.threadId,
          }),
        );
      }),
    );
  });
}

function compactLine(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 120 ? compact : `...${compact.slice(-117)}`;
}

function fitLine(text: string, columns: number) {
  if (columns <= 0 || text.length <= columns) {
    return text;
  }
  if (columns <= 3) {
    return text.slice(0, columns);
  }
  return `${text.slice(0, columns - 3)}...`;
}
