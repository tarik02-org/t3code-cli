import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProviderUserInputAnswers } from "@t3tools/contracts";

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

export function readJsonAnswers(input: {
  readonly answers: string | undefined;
  readonly fromStdin: boolean;
  readonly readStdin: () => Effect.Effect<string, InputError>;
}) {
  if (input.answers !== undefined && input.answers.length > 0 && input.fromStdin) {
    return Effect.fail(new MessageInputError({ message: "pass --answers or --stdin, not both" }));
  }
  if (input.fromStdin) {
    return input.readStdin().pipe(Effect.flatMap(parseJsonAnswers));
  }
  if (input.answers === undefined || input.answers.length === 0) {
    return Effect.fail(
      new MessageInputError({ message: "answers required unless --stdin is used" }),
    );
  }
  return parseJsonAnswers(input.answers);
}

function parseJsonAnswers(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    return Effect.succeed(Schema.decodeUnknownSync(ProviderUserInputAnswers)(parsed));
  } catch {
    return Effect.fail(new MessageInputError({ message: "invalid JSON in answers" }));
  }
}
