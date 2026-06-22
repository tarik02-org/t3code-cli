import "vite-plus/test/config";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { assert, describe, it } from "@effect/vitest";
import { Command } from "effect/unstable/cli";

import { InvalidFlagCombinationError } from "../error.ts";
import { terminalCommandTestLayer } from "./read.test-utils.ts";
import { writeTerminalCommand } from "./write.ts";

describe("writeTerminalCommand", () => {
  it.layer(terminalCommandTestLayer)("writeTerminalCommand", (t) => {
    t.effect("rejects multiple payload sources", () =>
      Effect.gen(function* () {
        const run = Command.runWith(writeTerminalCommand, { version: "0.0.0-test" });
        const exit = yield* run(["--thread", "thread-1", "term-1", "hello", "--stdin"]).pipe(
          Effect.exit,
        );
        assert.isTrue(Exit.isFailure(exit));
        if (!Exit.isFailure(exit)) {
          return;
        }
        const error = Cause.findErrorOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.instanceOf(error.value, InvalidFlagCombinationError);
        }
      }),
    );
  });
});
