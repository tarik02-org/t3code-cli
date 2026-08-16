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
import { t3CliEnvConfigLayer } from "../../config/env/env.test-utils.ts";
import * as CliRuntime from "../runtime/service.ts";
import { T3Output } from "../output/service.ts";
import { updateProjectCommand } from "./update.ts";

const testLayer = Layer.mergeAll(
  Layer.succeed(
    T3Application,
    fromPartial({ updateProject: () => Effect.die("updateProject should not be called") }),
  ),
  Layer.succeed(
    T3Config,
    fromPartial({
      resolve: () =>
        Effect.succeed({ url: "ws://localhost", token: "token", source: "config", local: true }),
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

describe("updateProjectCommand", () => {
  it.layer(testLayer)("validation", (t) => {
    const run = Command.runWith(updateProjectCommand, { version: "0.0.0-test" });

    t.effect("requires at least one update", () =>
      expectError(run(["--project", "proj-1"]), "MissingUpdateFieldsError"),
    );

    t.effect("rejects a default model value with its clear flag", () =>
      expectError(
        run(["--project", "proj-1", "--model", "gpt-5", "--clear-default-model"]),
        "ConflictingUpdateFlagsError",
      ),
    );

    t.effect("rejects a favicon value with its clear flag", () =>
      expectError(
        run(["--project", "proj-1", "--favicon", "icon.png", "--clear-favicon"]),
        "ConflictingUpdateFlagsError",
      ),
    );

    t.effect("rejects a thread environment value with its clear flag", () =>
      expectError(
        run(["--project", "proj-1", "--thread-env", "local", "--clear-thread-env"]),
        "ConflictingUpdateFlagsError",
      ),
    );
  });
});

function expectError<R>(
  effect: Effect.Effect<unknown, unknown, R>,
  expectedTag: string,
) {
  return Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      const error = Cause.findErrorOption(exit.cause);
      assert.isTrue(Option.isSome(error));
      if (Option.isSome(error)) {
        assert.equal((error.value as { readonly _tag?: string })._tag, expectedTag);
      }
    }
  });
}
