import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatTerminalWrittenHuman } from "../terminal-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { T3Input } from "../input/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

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
          new Error("provide exactly one of <data>, --stdin, --hex <data>, or --base64 <data>"),
        );
      }

      const payload =
        hexData !== undefined
          ? decodeHexPayload(hexData)
          : base64Data !== undefined
            ? decodeBase64Payload(base64Data)
            : stdin
              ? yield* inputService.readStdin()
              : argumentData!;
      if (payload.length === 0) {
        yield* Effect.fail(new Error("terminal write payload is empty"));
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

function decodeHexPayload(value: string) {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(normalized)
  ) {
    throw new Error("invalid hex payload");
  }
  return Buffer.from(normalized, "hex").toString("utf8");
}

function decodeBase64Payload(value: string) {
  const normalized = value.trim();
  if (normalized.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("invalid base64 payload");
  }
  return Buffer.from(normalized, "base64").toString("utf8");
}
