import * as Effect from "effect/Effect";

import { MessageInputError } from "./error.ts";
import type { InputError } from "./input/error.ts";

export function readInitialMessage(input: {
  readonly message: string | undefined;
  readonly fromStdin: boolean;
  readonly readStdin: () => Effect.Effect<string, InputError>;
}) {
  if (input.message !== undefined && input.message.length > 0 && input.fromStdin) {
    return Effect.fail(
      new MessageInputError({ message: "pass message argument or --stdin, not both" }),
    );
  }
  if (input.fromStdin) {
    return input.readStdin();
  }
  if (input.message === undefined || input.message.length === 0) {
    return Effect.fail(
      new MessageInputError({ message: "message required unless --stdin is used" }),
    );
  }
  return Effect.succeed(input.message);
}
