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
import { T3Config } from "../../config/config.ts";
import * as CliRuntime from "../../cli/runtime/service.ts";
import { t3CliEnvConfigLayer } from "../../config/env/env.test-utils.ts";
import { InvalidFlagCombinationError } from "../error.ts";
import { T3Output } from "../output/service.ts";
import { listThreadsCommand } from "./list.ts";

const testLayer = Layer.mergeAll(
  Layer.succeed(
    T3Application,
    fromPartial({
      listThreads: () => Effect.die("listThreads should not be called"),
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
  NodeServices.layer,
  CliRuntime.layer,
  t3CliEnvConfigLayer("/tmp/t3cli-test"),
);

describe("listThreadsCommand", () => {
  it.layer(testLayer)("listThreadsCommand", (t) => {
    t.effect("rejects --archived and --all together", () =>
      Effect.gen(function* () {
        const run = Command.runWith(listThreadsCommand, { version: "0.0.0-test" });
        const exit = yield* run(["--archived", "--all", "--project", "proj-1"]).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        if (!Exit.isFailure(exit)) {
          return;
        }
        const error = Cause.findErrorOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.instanceOf(error.value, InvalidFlagCombinationError);
          assert.equal(error.value.message, "--archived and --all are mutually exclusive");
        }
      }),
    );
  });
});
