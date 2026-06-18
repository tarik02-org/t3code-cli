import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import {
  formatAuthLocalHuman,
  formatAuthLocalJson,
  formatAuthPaired,
  formatAuthStatusHuman,
  formatAuthStatusJson,
} from "./auth-format.ts";
import { T3Auth } from "../auth/service.ts";
import { T3Config } from "../config/service.ts";
import { Environment } from "../environment/service.ts";
import { extraArgsConfig } from "./extra-args.ts";
import { formatFlag } from "./flags.ts";
import { resolveOutputFormat } from "./output-format.ts";
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
    url: Flag.string("url"),
    local: Flag.boolean("local"),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ url, local, format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const result = yield* auth.pair(url);
      yield* auth.writeConfig({
        url: result.url,
        token: result.token,
        local,
      });
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(formatAuthPaired(result));
      }
    }),
).pipe(Command.withDescription("pair with t3code server"));

const localCommand = Command.make(
  "local",
  {
    baseDir: Flag.string("base-dir").pipe(Flag.optional),
    origin: Flag.string("origin").pipe(Flag.optional),
    role: Flag.choice("role", ["owner", "client"] as const).pipe(Flag.withDefault("owner")),
    label: Flag.string("label").pipe(Flag.withDefault("t3cli")),
    subject: Flag.string("subject").pipe(Flag.withDefault("t3cli-local")),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ baseDir, origin, role, label, subject, format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const result = yield* auth.local({
        role,
        label,
        subject,
        ...(Option.isSome(baseDir) ? { baseDir: baseDir.value } : {}),
        ...(Option.isSome(origin) ? { origin: origin.value } : {}),
      });
      yield* auth.writeConfig({
        url: result.url,
        token: result.token,
        local: true,
      });
      if (resolvedFormat === "json") {
        yield* output.printJson(formatAuthLocalJson(result));
      } else {
        yield* output.printInfo(formatAuthLocalHuman(result));
      }
    }),
).pipe(Command.withDescription("authenticate with local t3code installation"));

const statusCommand = Command.make(
  "status",
  {
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ format }) =>
    Effect.gen(function* () {
      const configService = yield* T3Config;
      const auth = yield* T3Auth;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const config = yield* configService.resolve();
      const result = yield* auth.status();
      if (resolvedFormat === "json") {
        yield* output.printJson(formatAuthStatusJson({ config, result }));
      } else {
        yield* output.printInfo(formatAuthStatusHuman({ config, result }));
      }
    }),
).pipe(Command.withDescription("show auth status"));
