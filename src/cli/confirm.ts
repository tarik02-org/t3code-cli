import * as Effect from "effect/Effect";
import * as Prompt from "effect/unstable/cli/Prompt";

import { DestructiveConfirmationRequiredError } from "./error.ts";
import type { EnvironmentShape } from "../environment/service.ts";

function isNonInteractiveEnvironment(environment: EnvironmentShape): boolean {
  return (
    environment.env.CI !== undefined ||
    environment.env.CODEX_CI !== undefined ||
    environment.env.CODEX_THREAD_ID !== undefined ||
    environment.env.T3CLI_AGENT !== undefined ||
    !environment.stdoutIsTTY ||
    environment.env.TERM === "dumb"
  );
}

export const requireDestructiveConfirmation = Effect.fn("requireDestructiveConfirmation")(
  function* (input: {
    readonly message: string;
    readonly yes: boolean;
    readonly environment: EnvironmentShape;
  }) {
    if (!input.yes) {
      if (isNonInteractiveEnvironment(input.environment)) {
        return yield* Effect.fail(
          new DestructiveConfirmationRequiredError({
            message: "destructive action requires --yes in non-interactive mode",
          }),
        );
      }
      const confirmed = yield* Prompt.run(
        Prompt.confirm({ message: input.message, initial: false }),
      );
      if (!confirmed) {
        return yield* Effect.fail(new DestructiveConfirmationRequiredError({ message: "aborted" }));
      }
    }
    return yield* Effect.void;
  },
);
