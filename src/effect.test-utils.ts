import { assert } from "@effect/vitest";
import { assertInstanceOf } from "@effect/vitest/utils";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

export const expectFailWithMessage = <E extends { readonly message: string }, R>(
  effect: Effect.Effect<unknown, E, R>,
  ErrorClass: new (...args: never) => E,
  message: string,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    if (!Exit.isFailure(exit)) {
      return yield* Effect.die("expected failure");
    }
    const error = Cause.findErrorOption(exit.cause);
    if (Option.isNone(error)) {
      return yield* Effect.die("expected failure cause");
    }
    assertInstanceOf(error.value, ErrorClass);
    assert.equal(error.value.message, message);
    return yield* Effect.void;
  });
