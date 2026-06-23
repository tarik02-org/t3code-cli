import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command } from "effect/unstable/cli";

import {
  formatAuthListHuman,
  formatAuthListJson,
  formatAuthUnpairHuman,
  formatAuthUseHuman,
} from "./format/auth.ts";
import { T3Auth } from "../auth/service.ts";
import { CliRuntime } from "../cli/runtime/service.ts";
import { loadT3CliEnv } from "../config/env/env.ts";
import { requireDestructiveConfirmation } from "./interaction/confirm.ts";
import { extraArgsConfig } from "./extra-args.ts";
import { envNameFlag, formatFlag, yesFlag } from "./flags.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";

export function createEnvCommand() {
  return Command.make("env").pipe(
    Command.withDescription("manage stored environments"),
    Command.withSubcommands([listCommand, useCommand, removeCommand]),
  );
}

const listCommand = Command.make(
  "list",
  {
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const environments = yield* auth.listEnvironments();
      if (resolvedFormat === "json") {
        yield* output.printJson(formatAuthListJson(environments));
      } else {
        yield* output.printInfo(formatAuthListHuman(environments));
      }
    }),
).pipe(Command.withDescription("list stored environments"));

const useCommand = Command.make(
  "use",
  {
    name: Argument.string("name"),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ name, format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const result = yield* auth.useEnvironment(name);
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(formatAuthUseHuman(result));
      }
    }),
).pipe(Command.withDescription("set the default environment"));

const removeCommand = Command.make(
  "remove",
  {
    name: envNameFlag,
    yes: yesFlag,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ name, yes, format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const targetName = yield* auth.resolveUnpairTarget(
        Option.isSome(name) ? { name: name.value } : {},
      );
      yield* requireDestructiveConfirmation({
        message: `Remove local credentials for environment '${targetName}'?`,
        yes,
        cliRuntime,
        t3CliEnv,
      });
      const result = yield* auth.unpairEnvironment({ name: targetName });
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(formatAuthUnpairHuman(result));
      }
    }),
).pipe(
  Command.withDescription(
    "remove local credentials for an environment (remote tokens may remain valid until expiry)",
  ),
);
