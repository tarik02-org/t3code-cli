import "vite-plus/test/config";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Option from "effect/Option";
import { assert, describe, it } from "@effect/vitest";
import { Command } from "effect/unstable/cli";
import { fromPartial } from "@total-typescript/shoehorn";

import { T3Application } from "../../application/service.ts";
import { T3Config } from "../../config/service.ts";
import { NodeEnvironmentLive } from "../../environment/layer.ts";
import { InvalidFlagCombinationError } from "../error.ts";
import { T3Input } from "../input/service.ts";
import { T3Output } from "../output/service.ts";
import { readTerminalCommand } from "./read.ts";
import { writeTerminalCommand } from "./write.ts";

const testLayer = Layer.mergeAll(
  Layer.succeed(
    T3Application,
    fromPartial({
      getTerminal: () => Effect.die("getTerminal should not be called"),
      attachTerminal: () => Effect.die("attachTerminal should not be called"),
      writeTerminal: () => Effect.die("writeTerminal should not be called"),
    }),
  ),
  Layer.succeed(
    T3Config,
    fromPartial({
      resolve: () =>
        Effect.succeed({
          url: "ws://localhost",
          token: "token",
          source: "config",
          local: true,
        }),
    }),
  ),
  Layer.succeed(T3Output, {
    writeStdout: () => Effect.void,
    writeStderr: () => Effect.void,
    printJson: () => Effect.void,
    printNdjson: () => Effect.void,
    printInfo: () => Effect.void,
  }),
  Layer.succeed(T3Input, {
    readStdin: () => Effect.die("readStdin should not be called"),
    readStdinBinary: () => Effect.die("readStdinBinary should not be called"),
  }),
  NodeServices.layer,
  NodeEnvironmentLive,
);

describe("readTerminalCommand", () => {
  it.layer(testLayer)("readTerminalCommand", (t) => {
    t.effect("rejects --from-sequence without --follow", () =>
      Effect.gen(function* () {
        const run = Command.runWith(readTerminalCommand, { version: "0.0.0-test" });
        const exit = yield* run(["--thread", "thread-1", "term-1", "--from-sequence", "1"]).pipe(
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
          assert.equal(error.value.message, "--from-sequence requires --follow");
        }
      }),
    );
  });
});

describe("writeTerminalCommand", () => {
  it.layer(testLayer)("writeTerminalCommand", (t) => {
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
