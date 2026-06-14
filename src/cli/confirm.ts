import * as Effect from "effect/Effect";
import * as Prompt from "effect/unstable/cli/Prompt";

import { DestructiveConfirmationRequiredError } from "./error.ts";
import { isInteractiveHumanTerminal } from "./output-format.ts";
import type { EnvironmentShape } from "../environment/service.ts";

export const requireDestructiveConfirmation = Effect.fn("requireDestructiveConfirmation")(
  function* (input: {
    readonly message: string;
    readonly yes: boolean;
    readonly environment: EnvironmentShape;
  }) {
    if (input.yes) {
      return;
    }
    if (!isInteractiveHumanTerminal(input.environment)) {
      yield* Effect.fail(
        new DestructiveConfirmationRequiredError({
          message: "destructive action requires --yes in non-interactive mode",
        }),
      );
      return;
    }
    const confirmed = yield* Prompt.run(Prompt.confirm({ message: input.message, initial: false }));
    if (confirmed) {
      return;
    }
    yield* Effect.fail(new DestructiveConfirmationRequiredError({ message: "aborted" }));
  },
);
