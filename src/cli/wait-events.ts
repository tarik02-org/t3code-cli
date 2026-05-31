import * as Stream from "effect/Stream";

import type { ApplicationError } from "../application/error.ts";
import type { WaitEvent } from "../application/service.ts";
import type { T3Output } from "./output/service.ts";
import { formatWaitEventNdjson } from "./thread-format.ts";

export function printWaitEventsNdjson(
  output: T3Output["Service"],
  events: Stream.Stream<WaitEvent, ApplicationError>,
) {
  return events.pipe(
    Stream.tap((event) => output.printNdjson(formatWaitEventNdjson(event))),
    Stream.runDrain,
  );
}
