import * as Effect from "effect/Effect";
import { Argument, CliError } from "effect/unstable/cli";

const rejectExtraArguments = Argument.string("extra").pipe(
  Argument.variadic(),
  Argument.mapEffect((extra) =>
    extra.length === 0
      ? Effect.void
      : Effect.fail(
          new CliError.InvalidValue({
            option: "extra",
            value: extra[0] ?? "",
            expected: "no extra arguments",
            kind: "argument",
          }),
        ),
  ),
);

export const extraArgsConfig = {
  extraArgs: rejectExtraArguments,
};
