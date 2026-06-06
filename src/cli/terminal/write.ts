import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatTerminalWrittenHuman } from "../terminal-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { T3Input } from "../input/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { TerminalCliError } from "./error.ts";

export const writeTerminalCommand = Command.make(
  "write",
  {
    thread: Argument.string("thread"),
    terminalId: Argument.string("terminal-id"),
    data: Argument.string("data").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    hex: Flag.string("hex").pipe(Flag.optional),
    base64: Flag.string("base64").pipe(Flag.optional),
    quiet: Flag.boolean("quiet"),
    format: Flag.choice("format", humanJsonFormatChoices).pipe(Flag.withDefault("auto")),
  },
  ({ thread, terminalId, data, stdin, hex, base64, quiet, format }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const inputService = yield* T3Input;
      const application = yield* T3Application;
      const environment = yield* Environment;
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
          new TerminalCliError({
            message: "provide exactly one of <data>, --stdin, --hex <data>, or --base64 <data>",
            threadId: thread,
            terminalId,
          }),
        );
      }

      const payload =
        hexData !== undefined
          ? yield* decodeHexPayload(hexData, thread, terminalId)
          : base64Data !== undefined
            ? yield* decodeBase64Payload(base64Data, thread, terminalId)
            : stdin
              ? yield* inputService.readStdin()
              : argumentData!;
      if (payload.length === 0) {
        yield* Effect.fail(
          new TerminalCliError({
            message: "terminal write payload is empty",
            threadId: thread,
            terminalId,
          }),
        );
      }

      yield* application.writeTerminal({
        terminal: {
          threadId: thread,
          terminalId,
        },
        data: payload,
      });
      if (quiet) {
        return;
      }
      const bytes = Buffer.byteLength(payload);
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson({
          threadId: thread,
          terminalId,
          bytes,
          encoding: hexData !== undefined ? "hex" : base64Data !== undefined ? "base64" : "utf8",
        });
        return;
      }
      yield* output.printInfo(
        formatTerminalWrittenHuman({
          terminalId,
          threadId: thread,
          bytes,
        }),
      );
    }),
).pipe(Command.withDescription("write raw data to a terminal"));

function decodeHexPayload(value: string, threadId: string, terminalId: string) {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(normalized)
  ) {
    return Effect.fail(
      new TerminalCliError({
        message: "invalid hex payload",
        threadId,
        terminalId,
      }),
    );
  }
  return Effect.succeed(Buffer.from(normalized, "hex").toString("utf8"));
}

function decodeBase64Payload(value: string, threadId: string, terminalId: string) {
  const normalized = value.trim();
  if (normalized.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return Effect.fail(
      new TerminalCliError({
        message: "invalid base64 payload",
        threadId,
        terminalId,
      }),
    );
  }
  return Effect.succeed(Buffer.from(normalized, "base64").toString("utf8"));
}
