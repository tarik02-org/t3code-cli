import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { formatFlag } from "./flags.ts";
import { T3Application } from "../application/service.ts";
import { Environment } from "../environment/service.ts";
import { formatModelsHuman } from "./model-format.ts";
import { resolveOutputFormat } from "./output-format.ts";
import { T3Output } from "./output/service.ts";

export function createModelCommand() {
  return Command.make("model").pipe(
    Command.withDescription("model commands"),
    Command.withSubcommands([listCommand]),
  );
}

const listCommand = Command.make(
  "list",
  {
    all: Flag.boolean("all"),
    provider: Flag.string("provider").pipe(Flag.optional),
    format: formatFlag,
  },
  ({ all, provider, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const providerValue = Option.getOrUndefined(provider);
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const providers = yield* application.listModels({
        all,
        ...(providerValue !== undefined && providerValue.length > 0
          ? { provider: providerValue }
          : {}),
      });

      if (resolvedFormat === "json") {
        yield* output.printJson(providers);
      } else {
        yield* output.writeStdout(formatModelsHuman(providers));
      }
    }),
).pipe(Command.withDescription("list provider models"));
