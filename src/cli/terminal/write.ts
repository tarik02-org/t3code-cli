import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatTerminalWrittenHuman } from "../format/terminal.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { InvalidFlagCombinationError } from "../error.ts";
import { T3Input } from "../input/service.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { decodeBase64Payload, decodeHexPayload } from "./encoding.ts";
import { TerminalCliError } from "./error.ts";
import { requireCommandThreadId } from "./scope.ts";

export const writeTerminalCommand = Command.make(
  "write",
  {
    thread: threadFlag,
    terminalId: Argument.string("terminal-id"),
    data: Argument.string("data").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    hex: Flag.string("hex").pipe(Flag.optional),
    base64: Flag.string("base64").pipe(Flag.optional),
    quiet: Flag.boolean("quiet"),
    format: formatFlag,
  },
  ({ thread, terminalId, data, stdin, hex, base64, quiet, format }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const inputService = yield* T3Input;
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const threadId = yield* requireCommandThreadId({ thread });
      const argumentData = Option.getOrUndefined(data);
      const hexData = Option.getOrUndefined(hex);
      const base64Data = Option.getOrUndefined(base64);
      const inputCount = [
        stdin,
        argumentData !== undefined,
        hexData !== undefined,
        base64Data !== undefined,
      ].filter(Boolean).length;

      if (inputCount !== 1) {
        yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "provide exactly one of <data>, --stdin, --hex <data>, or --base64 <data>",
          }),
        );
      }

      const payload =
        hexData !== undefined
          ? yield* decodeHexPayloadOrFail(hexData, threadId, terminalId)
          : base64Data !== undefined
            ? yield* decodeBase64PayloadOrFail(base64Data, threadId, terminalId)
            : stdin
              ? yield* inputService.readStdinBinary()
              : argumentData!;
      if (payload.length === 0) {
        yield* Effect.fail(
          new TerminalCliError({
            message: "terminal write payload is empty",
            threadId,
            terminalId,
          }),
        );
      }

      yield* application.writeTerminal({
        terminal: {
          threadId,
          terminalId,
        },
        data: payload,
      });
      if (quiet) {
        return;
      }
      const bytes = Buffer.byteLength(payload, "latin1");
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson({
          threadId,
          terminalId,
          bytes,
          encoding: hexData !== undefined ? "hex" : base64Data !== undefined ? "base64" : "latin1",
        });
        return;
      }
      yield* output.printInfo(
        formatTerminalWrittenHuman({
          terminalId,
          threadId,
          bytes,
        }),
      );
    }),
).pipe(Command.withDescription("write raw data to a terminal"));

function decodeHexPayloadOrFail(value: string, threadId: string, terminalId: string) {
  const decoded = decodeHexPayload(value);
  if (decoded === undefined) {
    return Effect.fail(
      new TerminalCliError({
        message: "invalid hex payload",
        threadId,
        terminalId,
      }),
    );
  }
  return Effect.succeed(decoded);
}

function decodeBase64PayloadOrFail(value: string, threadId: string, terminalId: string) {
  const decoded = decodeBase64Payload(value);
  if (decoded === undefined) {
    return Effect.fail(
      new TerminalCliError({
        message: "invalid base64 payload",
        threadId,
        terminalId,
      }),
    );
  }
  return Effect.succeed(decoded);
}
