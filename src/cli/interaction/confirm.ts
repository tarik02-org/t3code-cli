import * as Effect from "effect/Effect";
import * as Prompt from "effect/unstable/cli/Prompt";

import { DestructiveConfirmationRequiredError } from "../error.ts";
import { isInteractiveHumanTerminal } from "../format/output.ts";
import type { T3CliEnvShape } from "../../config/env/env.ts";
import type { CliRuntime } from "../runtime/service.ts";

export const requireDestructiveConfirmation = Effect.fn("requireDestructiveConfirmation")(
  function* (input: {
    readonly message: string;
    readonly yes: boolean;
    readonly cliRuntime: CliRuntime["Service"];
    readonly t3CliEnv: T3CliEnvShape;
  }) {
    if (input.yes) {
      return;
    }
    if (!isInteractiveHumanTerminal(input.cliRuntime, input.t3CliEnv)) {
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

export const requireEnvironmentReplaceConfirmation = Effect.fn(
  "requireEnvironmentReplaceConfirmation",
)(function* (input: {
  readonly name: string;
  readonly replace: boolean;
  readonly cliRuntime: CliRuntime["Service"];
  readonly t3CliEnv: T3CliEnvShape;
}) {
  if (input.replace) {
    return;
  }
  if (!isInteractiveHumanTerminal(input.cliRuntime, input.t3CliEnv)) {
    yield* Effect.fail(
      new DestructiveConfirmationRequiredError({
        message: `environment '${input.name}' already exists: pass --replace`,
      }),
    );
    return;
  }
  const confirmed = yield* Prompt.run(
    Prompt.confirm({
      message: `Environment '${input.name}' already exists. Replace?`,
      initial: false,
    }),
  );
  if (confirmed) {
    return;
  }
  yield* Effect.fail(new DestructiveConfirmationRequiredError({ message: "aborted" }));
});
