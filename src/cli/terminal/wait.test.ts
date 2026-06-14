import "vite-plus/test/config";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { assert, describe, expect, it } from "@effect/vitest";
import { Command } from "effect/unstable/cli";
import { fromPartial } from "@total-typescript/shoehorn";

import { T3Application } from "../../application/service.ts";
import { T3Config } from "../../config/service.ts";
import { NodeEnvironmentLive } from "../../environment/layer.ts";
import { T3Output } from "../output/service.ts";
import { TerminalCliError } from "./error.ts";
import { resolveMetadataWait, waitTerminalCommand } from "./wait.ts";

describe("resolveMetadataWait", () => {
  it("resolves closed immediately when terminal is missing from snapshot", () => {
    const resolution = resolveMetadataWait(
      { type: "snapshot", terminals: [] },
      "closed",
      "thread-1",
      "term-1",
    );
    expect(resolution).toEqual({
      kind: "result",
      value: {
        threadId: "thread-1",
        terminalId: "term-1",
        target: "closed",
        status: "closed",
        alreadySatisfied: true,
        missingTreatedAsClosed: true,
      },
    });
  });

  it("uses the same exited error when terminal is missing from snapshot or removed", () => {
    const missing = resolveMetadataWait(
      { type: "snapshot", terminals: [] },
      "exited",
      "thread-1",
      "term-1",
    );
    const removed = resolveMetadataWait(
      { type: "remove", threadId: "thread-1", terminalId: "term-1" },
      "exited",
      "thread-1",
      "term-1",
    );

    expect(missing?.kind).toBe("fail");
    expect(removed?.kind).toBe("fail");
    if (missing?.kind === "fail" && removed?.kind === "fail") {
      expect(missing.error.message).toBe(removed.error.message);
      expect(missing.error).toBeInstanceOf(TerminalCliError);
    }
  });
});

describe("waitTerminalCommand", () => {
  const testLayer = Layer.mergeAll(
    Layer.succeed(
      T3Application,
      fromPartial({
        getTerminal: () => Effect.die("getTerminal should not be called"),
        watchTerminalMetadata: () =>
          Stream.make({
            type: "snapshot" as const,
            terminals: [],
          }),
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
    NodeEnvironmentLive,
  );

  it.layer(testLayer)("waitTerminalCommand", (t) => {
    t.effect("does not require getTerminal before waiting for closed", () =>
      Effect.gen(function* () {
        const run = Command.runWith(waitTerminalCommand, { version: "0.0.0-test" });
        const exit = yield* run([
          "--thread",
          "thread-1",
          "term-1",
          "--for",
          "closed",
          "--format",
          "json",
        ]).pipe(Effect.exit);
        assert.isTrue(Exit.isSuccess(exit));
      }),
    );

    t.effect("uses exited error without getTerminal when terminal is already missing", () =>
      Effect.gen(function* () {
        const run = Command.runWith(waitTerminalCommand, { version: "0.0.0-test" });
        const exit = yield* run([
          "--thread",
          "thread-1",
          "term-1",
          "--for",
          "exited",
          "--format",
          "json",
        ]).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        if (!Exit.isFailure(exit)) {
          return;
        }
        const error = Cause.findErrorOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.instanceOf(error.value, TerminalCliError);
          assert.equal(
            error.value.message,
            "terminal closed before an exited event was observed: term-1",
          );
        }
      }),
    );
  });
});
