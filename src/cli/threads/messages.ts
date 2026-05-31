import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { InvalidLimitError } from "../error.ts";
import { formatThreadMessagesHuman, formatThreadMessagesJson } from "../thread-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const getThreadMessagesCommand = Command.make(
  "messages",
  {
    thread: Argument.string("thread"),
    limit: Flag.integer("limit").pipe(Flag.withDefault(20)),
    full: Flag.boolean("full"),
    format: Flag.choice("format", humanJsonFormatChoices).pipe(Flag.withDefault("auto")),
  },
  ({ thread, limit, full, format }) =>
    Effect.gen(function* () {
      if (limit < 0) {
        return yield* Effect.fail(
          new InvalidLimitError({ message: `invalid limit: ${limit}`, value: String(limit) }),
        );
      }
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const detail = yield* application.getThreadMessages(thread);
      if (resolvedFormat === "json") {
        return yield* output.printJson(formatThreadMessagesJson(detail, full));
      }
      return yield* output.writeStdout(formatThreadMessagesHuman(detail, limit));
    }),
).pipe(Command.withDescription("get latest thread messages"));
