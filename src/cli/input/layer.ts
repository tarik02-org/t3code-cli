import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import { InputError } from "./error.ts";
import { T3Input } from "./service.ts";

export const makeT3Input = Effect.fn("makeT3Input")(function* () {
  const stdio = yield* Stdio.Stdio;

  const readStdin = Effect.fn("T3InputLive.readStdin")(function* () {
    return yield* stdio.stdin.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(new InputError({ message: "failed to read stdin", cause: error })),
      }),
    );
  });

  const readStdinBinary = Effect.fn("T3InputLive.readStdinBinary")(function* () {
    return yield* stdio.stdin.pipe(
      Stream.runFold(
        () => new Uint8Array(0),
        (acc, chunk) => {
          const merged = new Uint8Array(acc.length + chunk.length);
          merged.set(acc);
          merged.set(chunk, acc.length);
          return merged;
        },
      ),
      Effect.map((bytes) => Buffer.from(bytes).toString("latin1")),
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(new InputError({ message: "failed to read stdin", cause: error })),
      }),
    );
  });

  return {
    readStdin,
    readStdinBinary,
  };
});

export const T3InputLive = Layer.effect(T3Input, makeT3Input());
