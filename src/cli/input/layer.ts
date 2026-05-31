import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import { InputError } from "./error.ts";
import { T3Input } from "./service.ts";

export const makeT3Input = Effect.fn("makeT3Input")(function* () {
  const stdio = yield* Stdio.Stdio;

  const readStdin = Effect.fn("T3InputLive.readStdin")(function* () {
    const chunks = yield* Stream.runCollect(stdio.stdin).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(new InputError({ message: "failed to read stdin", cause: error })),
      }),
    );
    return Buffer.concat([...chunks]).toString("utf8");
  });

  return {
    readStdin,
  };
});

export const T3InputLive = Layer.effect(T3Input, makeT3Input());
