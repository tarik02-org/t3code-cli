import "vite-plus/test/config";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { assert, describe, it } from "@effect/vitest";
import { CliError } from "effect/unstable/cli";

import { extraArgsConfig } from "./extra-args.ts";

describe("extraArgsConfig", () => {
  it("rejects leftover positional arguments", () =>
    Effect.gen(function* () {
      const exit = yield* extraArgsConfig.extraArgs
        .parse({ flags: {}, arguments: ["extra"] })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (!Exit.isFailure(exit)) {
        return;
      }
      const error = Cause.findErrorOption(exit.cause);
      assert.isTrue(Option.isSome(error));
      if (Option.isSome(error)) {
        assert.instanceOf(error.value, CliError.InvalidValue);
        assert.equal(
          error.value.message,
          'Invalid value for argument <extra>: "extra". Expected: no extra arguments',
        );
      }
    }));
});
