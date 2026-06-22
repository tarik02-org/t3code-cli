import { assert } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import { ConfigError, UrlError } from "../../config/error.ts";

function assertExitFailure(
  exit: Exit.Exit<unknown, unknown>,
): asserts exit is Exit.Failure<unknown, unknown> {
  if (!Exit.isFailure(exit)) {
    throw new Error("expected failure");
  }
}

export const expectConfigError = <E, R>(
  effect: Effect.Effect<unknown, E, R>,
  message: string,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    assertExitFailure(exit);
    const error = Cause.findErrorOption(exit.cause);
    if (Option.isNone(error)) {
      return yield* Effect.die("expected failure");
    }
    assert.instanceOf(error.value, ConfigError);
    assert.equal(error.value.message, message);
    return yield* Effect.void;
  });

export const expectUrlError = <E, R>(
  effect: Effect.Effect<unknown, E, R>,
  message: string,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    assertExitFailure(exit);
    const error = Cause.findErrorOption(exit.cause);
    if (Option.isNone(error)) {
      return yield* Effect.die("expected failure");
    }
    assert.instanceOf(error.value, UrlError);
    assert.equal(error.value.message, message);
    return yield* Effect.void;
  });
