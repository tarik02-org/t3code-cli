import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import {
  formatAuthLocalHuman,
  formatAuthLocalJson,
  formatAuthPaired,
  formatAuthStatusHuman,
  formatAuthStatusJson,
} from "./auth-format.ts";
import { T3Auth } from "../auth/service.ts";
import { T3Config } from "../config/service.ts";
import { T3Output } from "./output/service.ts";

export function createAuthCommand() {
  return Command.make("auth").pipe(
    Command.withDescription("auth commands"),
    Command.withSubcommands([pairCommand, localCommand, statusCommand]),
  );
}

const pairCommand = Command.make(
  "pair",
  {
    url: Argument.string("url"),
  },
  ({ url }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const output = yield* T3Output;
      const result = yield* auth.pair(url);
      yield* output.printInfo(formatAuthPaired(result));
    }),
).pipe(Command.withDescription("pair with t3code server"));

const localCommand = Command.make(
  "local",
  {
    baseDir: Flag.string("base-dir").pipe(Flag.optional),
    t3Bin: Flag.string("t3-bin").pipe(Flag.withDefault("t3")),
    origin: Flag.string("origin").pipe(Flag.optional),
    role: Flag.choice("role", ["owner", "client"] as const).pipe(Flag.withDefault("owner")),
    label: Flag.string("label").pipe(Flag.withDefault("t3cli")),
    subject: Flag.string("subject").pipe(Flag.withDefault("t3cli-local")),
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ baseDir, t3Bin, origin, role, label, subject, format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const output = yield* T3Output;
      const result = yield* auth.local({
        t3Bin,
        role,
        label,
        subject,
        ...(Option.isSome(baseDir) ? { baseDir: baseDir.value } : {}),
        ...(Option.isSome(origin) ? { origin: origin.value } : {}),
      });
      if (format === "json") {
        yield* output.printJson(formatAuthLocalJson(result));
      } else {
        yield* output.printInfo(formatAuthLocalHuman(result));
      }
    }),
).pipe(Command.withDescription("authenticate with local t3code installation"));

const statusCommand = Command.make(
  "status",
  {
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ format }) =>
    Effect.gen(function* () {
      const configService = yield* T3Config;
      const auth = yield* T3Auth;
      const output = yield* T3Output;
      const config = yield* configService.resolve();
      const result = yield* auth.status();
      if (format === "json") {
        yield* output.printJson(formatAuthStatusJson({ config, result }));
      } else {
        yield* output.printInfo(formatAuthStatusHuman({ config, result }));
      }
    }),
).pipe(Command.withDescription("show auth status"));
