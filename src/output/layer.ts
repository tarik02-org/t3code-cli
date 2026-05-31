import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import { OutputError } from "./error.ts";
import { T3Output } from "./service.ts";

export const makeT3Output = Effect.fn("makeT3Output")(function* () {
  const stdio = yield* Stdio.Stdio;

  const writeStdout = Effect.fn("T3OutputLive.writeStdout")(function* (text: string) {
    yield* Stream.succeed(text).pipe(
      Stream.run(stdio.stdout()),
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(new OutputError({ message: "failed to write output", cause: error })),
      }),
    );
  });

  const writeStderr = Effect.fn("T3OutputLive.writeStderr")(function* (text: string) {
    yield* Stream.succeed(text).pipe(
      Stream.run(stdio.stderr()),
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(new OutputError({ message: "failed to write output", cause: error })),
      }),
    );
  });

  const printJson = Effect.fn("T3OutputLive.printJson")(function* (value: unknown) {
    yield* writeStdout(`${JSON.stringify(value, null, 2)}\n`);
  });

  const printNdjson = Effect.fn("T3OutputLive.printNdjson")(function* (value: unknown) {
    yield* writeStdout(`${JSON.stringify(value)}\n`);
  });

  const printInfo = Effect.fn("T3OutputLive.printInfo")(function* (message: string) {
    yield* writeStdout(`${message}\n`);
  });

  return {
    writeStdout,
    writeStderr,
    printJson,
    printNdjson,
    printInfo,
  };
});

export const T3OutputLive = Layer.effect(T3Output, makeT3Output());
